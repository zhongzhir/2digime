"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { generateIdentity, loadOrCreateIdentity, signWithIdentity, verifyWithIdentity } = require("../src/identity");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

// Test 1: generateIdentity returns valid DID
const id1 = generateIdentity();
assert(id1.did && id1.did.startsWith("did:dme:"), "DID format correct");
assert(id1.publicKey && id1.privateKey, "key pair generated");

// Test 2: loadOrCreateIdentity creates and persists identity
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-identity-"));
const id2 = loadOrCreateIdentity(tmpDir);
assert(id2.did && id2.did.startsWith("did:dme:"), "identity created");
assert(fs.existsSync(path.join(tmpDir, "identity.json")), "identity.json persisted");

// Test 3: loadOrCreateIdentity returns same identity on second call
const id3 = loadOrCreateIdentity(tmpDir);
assert(id3.did === id2.did, "identity persisted across calls");

// Test 4: sign and verify
const data = "test data to sign";
const signature = signWithIdentity(tmpDir, data);
assert(signature && signature.length > 0, "signature generated");
const valid = verifyWithIdentity(tmpDir, data, signature);
assert(valid === true, "signature verified");

// Test 5: verify rejects wrong data
const invalid = verifyWithIdentity(tmpDir, "wrong data", signature);
assert(invalid === false, "wrong data rejected");

// Test 6: verify rejects wrong signature
const invalid2 = verifyWithIdentity(tmpDir, data, "invalid-signature");
assert(invalid2 === false, "wrong signature rejected");

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
