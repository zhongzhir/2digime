#!/usr/bin/env node
'use strict';
/**
 * 真实公开仓库 GitHub 审计 smoke。默认不进入 npm test。
 * 运行：node scripts/github-audit-live-smoke.cjs
 * 或：DIGITALME_GITHUB_LIVE_SMOKE=1 node scripts/github-audit-live-smoke.cjs
 *
 * 未实际运行成功时，只能报告「待真实网络验收」，不得称 GitHub 审计已修复。
 */
const path = require('node:path');
const fs = require('node:fs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const dist = path.join(root, 'dist', 'work-runtime', 'remote-github-audit.js');
  if (!fs.existsSync(dist)) {
    console.error('missing dist; run npm run build first');
    process.exit(2);
  }
  const {
    parseGitHubTarget,
    fetchGitHubPublicIntoDir,
  } = require(dist);
  const target = parseGitHubTarget('审计 https://github.com/octocat/Hello-World 看看有没有问题');
  if (!target) {
    console.error('unable to parse public repo target');
    process.exit(2);
  }
  const dest = path.join(require('node:os').tmpdir(), `digitalme-gh-live-${Date.now()}`);
  const result = await fetchGitHubPublicIntoDir({ target, destDir: dest });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        code: result.ok ? undefined : result.code,
        blocker: result.ok ? undefined : result.blocker,
        diagnostics: result.ok ? undefined : result.diagnostics,
        foundRepoCount: result.ok ? result.foundRepoCount : undefined,
        auditedRepos: result.ok ? result.auditedRepos : undefined,
        overviewOnly: result.ok ? result.overviewOnly : undefined,
        dest: result.ok ? dest : undefined,
      },
      null,
      2,
    ),
  );
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
