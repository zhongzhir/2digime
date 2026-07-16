"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("../package-store/fs-util");

function readBoundariesReadOnly(pkgDir) {
  const filePath = path.join(path.resolve(pkgDir), "policies", "boundaries.json");
  if (!fs.existsSync(filePath)) {
    return { exists: false, items: [], enabledCount: 0, parseOk: true };
  }
  try {
    const data = readJson(filePath, null);
    if (!data || typeof data !== "object") {
      return { exists: true, items: [], enabledCount: 0, parseOk: false };
    }
    const items = Array.isArray(data.items) ? data.items : [];
    const enabledCount = items.filter((b) => b && b.enabled !== false).length;
    return { exists: true, items, enabledCount, parseOk: true };
  } catch {
    return { exists: true, items: [], enabledCount: 0, parseOk: false };
  }
}

function readCollaborationReadOnly(pkgDir) {
  const root = path.resolve(pkgDir);
  const agentCard = path.join(root, "contracts", "agent-card.json");
  const contract = path.join(root, "contracts", "interaction-contract.sample.json");
  const hasAgentCard = fs.existsSync(agentCard);
  const hasContract = fs.existsSync(contract);
  return {
    hasAgentCard,
    hasContract,
    filesPresent: hasAgentCard || hasContract,
  };
}

module.exports = { readBoundariesReadOnly, readCollaborationReadOnly };
