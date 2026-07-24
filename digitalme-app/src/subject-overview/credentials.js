"use strict";

/**
 * Subject credential generation — upgraded to W3C VC format (ID-03).
 */

const { issueCredential, verifyCredential } = require("../identity/vc");

/**
 * Generate a Verifiable Credential from the current package contents.
 * @param {object} pkg - package object from package:load ({ dir, exists, persona, lifeSummary, ... })
 * @param {object} opts - { validDays, audience }
 * @returns {{ ok: boolean, credential?: object, message?: string }}
 */
function generateCredential(pkg, opts = {}) {
  if (!pkg || !pkg.exists) {
    return { ok: false, message: "尚未构建数字之我，无法生成凭据。" };
  }

  const items = [];
  if (pkg.persona && String(pkg.persona).trim()) {
    items.push({
      category: "identity",
      label: "本人描述",
      value: String(pkg.persona).trim().slice(0, 300),
    });
  }
  if (pkg.lifeSummary && String(pkg.lifeSummary).trim()) {
    items.push({
      category: "experience",
      label: "经历与角色",
      value: String(pkg.lifeSummary).trim().slice(0, 400),
    });
  }
  if (pkg.decisionFrameworks && String(pkg.decisionFrameworks).trim()) {
    items.push({
      category: "framework",
      label: "专业判断框架",
      value: "已建立结构化判断框架",
    });
  }
  if (pkg.styleGuide && String(pkg.styleGuide).trim()) {
    items.push({
      category: "style",
      label: "表达风格",
      value: "已形成稳定表达风格",
    });
  }

  if (items.length === 0) {
    return { ok: false, message: "没有足够的信息生成凭据。" };
  }

  const subject = {
    claims: items,
    generatedAt: new Date().toISOString(),
  };

  const vc = issueCredential(pkg.dir, subject, {
    validDays: opts.validDays || 30,
    audience: opts.audience,
  });

  return { ok: true, credential: vc };
}

module.exports = {
  generateCredential,
  verifyCredential,
};
