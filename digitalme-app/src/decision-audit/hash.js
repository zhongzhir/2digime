"use strict";

const crypto = require("node:crypto");
const { stableStringify } = require("../policy-engine/digest");

const GENESIS_HASH = "0".repeat(64);

function hashEntryBody(entry) {
  const { entryHash, previousHash, ...body } = entry;
  return crypto.createHash("sha256").update(stableStringify(body), "utf8").digest("hex");
}

function chainHash(previousHash, entryBodyHash) {
  return crypto
    .createHash("sha256")
    .update(String(previousHash || GENESIS_HASH) + "|" + String(entryBodyHash), "utf8")
    .digest("hex");
}

function buildEntryHash(previousHash, entry) {
  const bodyHash = hashEntryBody(entry);
  return chainHash(previousHash, bodyHash);
}

function canonicalEntryForHash(entry) {
  const copy = { ...entry };
  delete copy.entryHash;
  delete copy.previousHash;
  return copy;
}

module.exports = {
  GENESIS_HASH,
  hashEntryBody,
  chainHash,
  buildEntryHash,
  canonicalEntryForHash,
};
