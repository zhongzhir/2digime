"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { exportCredential, importCredential } = require("../src/identity/credential-exchange");
const { verifyCredential, verifyCredentialWithPublicKey } = require("../src/identity/vc");
const { presentCredential, revokeCredential, loadCredentialStore } = require("../src/identity/credential-flow");
const { loadOrCreateIdentity } = require("../src/identity");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

// Two independent accounts, each with its own Package directory
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-exchange-a-"));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-exchange-b-"));
const exportPath = path.join(os.tmpdir(), "dm-test-exchange-export-" + Date.now() + ".json");

const pkgA = {
  persona: "注重长期价值的产品创始人。",
  lifeSummary: "十年创业经历，两次融资。",
  decisionFrameworks: '{"frameworks":[]}',
  styleGuide: "简洁直接。",
};

// Test 1: two accounts have distinct identities
const identityA = loadOrCreateIdentity(dirA);
const identityB = loadOrCreateIdentity(dirB);
assert(identityA.did !== identityB.did, "accounts A and B have distinct DIDs");
assert(identityA.publicKey !== identityB.publicKey, "accounts A and B have distinct public keys");

// Test 2: account A generates a credential
const presented = presentCredential(dirA, pkgA, { audience: "账户 B", validDays: 30, scope: "full" });
assert(presented.ok === true && presented.credential, "account A presents credential");
const cred = presented.credential;
assert(verifyCredential(dirA, cred.vc).valid === true, "credential verifies locally in account A");

// Test 3: export fails for unknown / revoked credentials
const missing = exportCredential(dirA, "cred_nonexistent", exportPath);
assert(missing.ok === false && /不存在/.test(missing.message), "export unknown id rejected");

// Test 4: account A exports the credential to a JSON file
const exported = exportCredential(dirA, cred.id, exportPath);
assert(exported.ok === true && exported.filePath === path.resolve(exportPath), "export succeeds");
assert(fs.existsSync(exportPath), "export file written");
const exportData = JSON.parse(fs.readFileSync(exportPath, "utf8"));
assert(exportData.version === 1 && typeof exportData.exportedAt === "string", "export carries version and timestamp");
assert(
  exportData.issuer && exportData.issuer.did === identityA.did,
  "export carries issuer DID"
);
assert(
  typeof exportData.issuer.publicKey === "string" &&
    exportData.issuer.publicKey.includes("BEGIN PUBLIC KEY") &&
    exportData.issuer.publicKey === identityA.publicKey,
  "export carries issuer full SPKI PEM public key"
);
assert(exportData.credential && exportData.credential.proof, "export carries the VC with proof");
assert(exportData.scope === "full", "export carries scope");

// Test 5: account B imports the credential — signature verified cross-account
const imported = importCredential(dirB, exportPath);
assert(imported.ok === true && imported.valid === true, "cross-account import succeeds and verifies");
assert(imported.issuer === identityA.did, "import reports issuer DID");
const rec = imported.credential;
assert(typeof rec.id === "string" && rec.id.startsWith("imported_"), "imported credential gets new id");
assert(rec.issuer === identityA.did && rec.issuerPublicKey === identityA.publicKey, "imported credential keeps issuer identity");
assert(rec.scope === "full", "imported credential preserves scope");
assert(rec.audience === "账户 B", "imported credential preserves audience");
assert(rec.revoked === false && typeof rec.importedAt === "string", "imported credential metadata correct");

// Test 6: imported credential persisted in account B's store
const storeB = loadCredentialStore(dirB);
assert(storeB.credentials.length === 1 && storeB.credentials[0].id === rec.id, "imported credential persisted in account B");
const onDiskB = JSON.parse(fs.readFileSync(path.join(dirB, "credentials.json"), "utf8"));
assert(onDiskB.credentials.length === 1 && onDiskB.credentials[0].scope === "full", "imported credential persisted to disk with scope");

// Test 7: signature verifies against exported public key but NOT against account B's local identity
assert(
  verifyCredentialWithPublicKey(exportData.credential, identityA.publicKey).valid === true,
  "VC verifies with issuer public key from export"
);
assert(
  verifyCredential(dirB, exportData.credential).valid === false,
  "VC does NOT verify against account B local identity (different key)"
);

// Test 8: tampered credential content rejected on import
const tampered = JSON.parse(JSON.stringify(exportData));
tampered.credential.credentialSubject.claims[0].value = "已被篡改";
const tamperedPath = exportPath + ".tampered.json";
fs.writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2), "utf8");
const tamperedResult = importCredential(dirB, tamperedPath);
assert(
  tamperedResult.ok === true && tamperedResult.valid === false && tamperedResult.reason === "invalid_signature",
  "tampered credential content rejected as invalid_signature"
);
assert(loadCredentialStore(dirB).credentials.length === 1, "tampered import not stored");

// Test 9: wrong issuer public key rejected on import
const wrongKey = JSON.parse(JSON.stringify(exportData));
wrongKey.issuer.publicKey = identityB.publicKey;
const wrongKeyPath = exportPath + ".wrongkey.json";
fs.writeFileSync(wrongKeyPath, JSON.stringify(wrongKey, null, 2), "utf8");
const wrongKeyResult = importCredential(dirB, wrongKeyPath);
assert(
  wrongKeyResult.ok === true && wrongKeyResult.valid === false && wrongKeyResult.reason === "invalid_signature",
  "wrong issuer public key rejected as invalid_signature"
);
assert(loadCredentialStore(dirB).credentials.length === 1, "wrong-key import not stored");

// Test 10: expired credential import marked invalid
const expired = JSON.parse(JSON.stringify(exportData));
expired.validUntil = new Date(Date.now() - 86400000).toISOString();
const expiredPath = exportPath + ".expired.json";
fs.writeFileSync(expiredPath, JSON.stringify(expired, null, 2), "utf8");
const expiredResult = importCredential(dirB, expiredPath);
assert(
  expiredResult.ok === true && expiredResult.valid === false && expiredResult.reason === "expired",
  "expired credential import marked invalid"
);
assert(loadCredentialStore(dirB).credentials.length === 1, "expired import not stored");

// Test 11: revoked credential cannot be exported
const revoked = revokeCredential(dirA, cred.id);
assert(revoked.ok === true, "account A revokes credential");
const exportRevoked = exportCredential(dirA, cred.id, exportPath + ".revoked.json");
assert(exportRevoked.ok === false && /已撤销/.test(exportRevoked.message), "revoked credential export rejected");

// Test 12: import guards — missing file / malformed JSON / missing fields
const noFile = importCredential(dirB, exportPath + ".does-not-exist.json");
assert(noFile.ok === false && /不存在/.test(noFile.message), "missing file rejected");
const badJsonPath = exportPath + ".bad.json";
fs.writeFileSync(badJsonPath, "{ not json", "utf8");
const badJson = importCredential(dirB, badJsonPath);
assert(badJson.ok === false && /格式无效/.test(badJson.message), "malformed JSON rejected");
const noFieldsPath = exportPath + ".nofields.json";
fs.writeFileSync(noFieldsPath, JSON.stringify({ version: 1 }), "utf8");
const noFields = importCredential(dirB, noFieldsPath);
assert(noFields.ok === false && /缺少必要字段/.test(noFields.message), "missing required fields rejected");

// Cleanup
for (const p of [exportPath, tamperedPath, wrongKeyPath, expiredPath, badJsonPath, noFieldsPath]) {
  try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
}
fs.rmSync(dirA, { recursive: true, force: true });
fs.rmSync(dirB, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
