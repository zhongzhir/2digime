"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  VC_CONTEXT,
  VC_TYPE,
  DM_CREDENTIAL_TYPE,
  issueCredential,
  verifyCredential,
  createPresentation,
} = require("../src/identity/vc");
const { loadOrCreateIdentity, signWithIdentity } = require("../src/identity");
const { generateCredential } = require("../src/subject-overview/credentials");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-vc-"));
const identity = loadOrCreateIdentity(tmpDir);

// Test 1: VC format correct (W3C VC 2.0)
const subject = {
  claims: [
    { category: "identity", label: "本人描述", value: "测试用户" },
    { category: "experience", label: "经历与角色", value: "创始人" },
  ],
  generatedAt: new Date().toISOString(),
};
const vc = issueCredential(tmpDir, subject, { validDays: 30, audience: "test-service" });
assert(Array.isArray(vc["@context"]) && vc["@context"][0] === VC_CONTEXT, "@context correct");
assert(
  Array.isArray(vc.type) && vc.type.includes(VC_TYPE) && vc.type.includes(DM_CREDENTIAL_TYPE),
  "type includes VerifiableCredential and DigitalMeCredential"
);
assert(vc.issuer === identity.did, "issuer is identity DID");
assert(vc.issuanceDate && !Number.isNaN(new Date(vc.issuanceDate).getTime()), "issuanceDate is valid ISO date");
assert(vc.expirationDate && new Date(vc.expirationDate) > new Date(), "expirationDate is in the future");
assert(
  vc.credentialSubject && vc.credentialSubject.id === identity.did && Array.isArray(vc.credentialSubject.claims),
  "credentialSubject carries DID and claims"
);
assert(vc.audience === "test-service", "audience included when provided");
assert(
  vc.proof &&
    vc.proof.type === "Ed25519Signature2020" &&
    vc.proof.verificationMethod === identity.did + "#key-1" &&
    vc.proof.proofPurpose === "assertionMethod" &&
    typeof vc.proof.proofValue === "string" &&
    vc.proof.proofValue.length > 0,
  "proof fields correct"
);

// Test 2: signature generation and verification
const result = verifyCredential(tmpDir, vc);
assert(result.valid === true, "freshly issued VC verifies");
const roundTripped = JSON.parse(JSON.stringify(vc));
assert(verifyCredential(tmpDir, roundTripped).valid === true, "VC verifies after JSON round-trip");

// Test 3: expired credential rejected (properly re-signed so only expiry is wrong)
const expiredVc = issueCredential(tmpDir, { claims: [{ category: "identity", label: "x", value: "y" }] });
expiredVc.expirationDate = new Date(Date.now() - 86400000).toISOString();
const expiredPayload = { ...expiredVc };
delete expiredPayload.proof;
expiredVc.proof = { ...expiredVc.proof, proofValue: signWithIdentity(tmpDir, JSON.stringify(expiredPayload)) };
const expiredResult = verifyCredential(tmpDir, expiredVc);
assert(expiredResult.valid === false && expiredResult.reason === "expired", "expired credential rejected");

// Test 4: missing required fields / invalid format rejected
assert(
  verifyCredential(tmpDir, null).reason === "invalid_format" &&
    verifyCredential(tmpDir, "not-an-object").reason === "invalid_format",
  "non-object credential rejected as invalid_format"
);
const noProof = { ...vc };
delete noProof.proof;
assert(verifyCredential(tmpDir, noProof).reason === "missing_required_fields", "missing proof rejected");
const noIssuer = { ...vc, issuer: "" };
assert(verifyCredential(tmpDir, noIssuer).reason === "missing_required_fields", "missing issuer rejected");
const noSubject = { ...vc };
delete noSubject.credentialSubject;
assert(verifyCredential(tmpDir, noSubject).reason === "missing_required_fields", "missing credentialSubject rejected");

// Test 5: tampered signature rejected
const tamperedSubject = JSON.parse(JSON.stringify(vc));
tamperedSubject.credentialSubject.claims[0].value = "已被篡改";
const tamperedSubjectResult = verifyCredential(tmpDir, tamperedSubject);
assert(
  tamperedSubjectResult.valid === false && tamperedSubjectResult.reason === "invalid_signature",
  "tampered credentialSubject rejected as invalid_signature"
);
const tamperedProof = JSON.parse(JSON.stringify(vc));
tamperedProof.proof.proofValue = Buffer.from("forged-signature-bytes-000000000000000000000000000000000000000000000000").toString("base64");
const tamperedProofResult = verifyCredential(tmpDir, tamperedProof);
assert(
  tamperedProofResult.valid === false && tamperedProofResult.reason === "invalid_signature",
  "forged proofValue rejected as invalid_signature"
);
const garbageProof = JSON.parse(JSON.stringify(vc));
garbageProof.proof.proofValue = "!!!not-base64!!!";
assert(verifyCredential(tmpDir, garbageProof).valid === false, "malformed proofValue rejected");

// Test 6: presentation format
const presentation = createPresentation(vc, { audience: "verifier", challenge: "abc123" });
assert(
  Array.isArray(presentation["@context"]) && presentation["@context"][0] === VC_CONTEXT,
  "presentation @context correct"
);
assert(
  Array.isArray(presentation.type) && presentation.type.includes("VerifiablePresentation"),
  "presentation type correct"
);
assert(
  Array.isArray(presentation.verifiableCredential) && presentation.verifiableCredential[0] === vc,
  "presentation embeds the VC"
);
assert(presentation.audience === "verifier", "presentation audience set");
assert(presentation.proof && presentation.proof.challenge === "abc123", "presentation challenge set");

// Test 7: generateCredential (subject-overview) — VC format upgrade
const noPkg = generateCredential({ dir: tmpDir, exists: false });
assert(noPkg.ok === false && /尚未构建/.test(noPkg.message), "generateCredential fails without package");
const emptyPkg = generateCredential({ dir: tmpDir, exists: true, persona: "", lifeSummary: "" });
assert(emptyPkg.ok === false && /没有足够的信息/.test(emptyPkg.message), "generateCredential fails with empty package");
fs.writeFileSync(path.join(tmpDir, "persona.md"), "注重长期价值的产品创始人。", "utf8");
const genPkg = generateCredential({
  dir: tmpDir,
  exists: true,
  persona: "注重长期价值的产品创始人。",
  lifeSummary: "十年创业经历。",
  decisionFrameworks: '{"frameworks":[]}',
  styleGuide: "简洁直接。",
}, { validDays: 15, audience: "partner" });
assert(genPkg.ok === true && genPkg.credential, "generateCredential succeeds with package content");
assert(
  genPkg.credential.type && genPkg.credential.type.includes(DM_CREDENTIAL_TYPE) && genPkg.credential.proof,
  "generateCredential returns VC format"
);
assert(
  genPkg.credential.credentialSubject.claims.length === 4,
  "generateCredential collects claims from all package fields"
);
assert(verifyCredential(tmpDir, genPkg.credential).valid === true, "generated credential verifies locally");
const noAudience = generateCredential({ dir: tmpDir, exists: true, persona: "x" });
assert(noAudience.ok === true && !("audience" in noAudience.credential), "audience omitted when not provided");

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
