"use strict";

/**
 * Role View — 角色身份管理：角色选择、角色视图配置、角色切换。
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROLES = [
  {
    id: "founder",
    label: "创始人",
    description: "以创业者身份展示能力：项目经验、商业判断、团队管理",
    visibleClaims: ["experience", "judgment", "leadership"],
    expressionStyle: "direct",
    boundaries: ["no_financial_advice", "no_legal_commitment"],
  },
  {
    id: "investor",
    label: "投资人",
    description: "以投资人身份展示能力：投资判断、行业分析、风险评估",
    visibleClaims: ["investment", "analysis", "risk"],
    expressionStyle: "analytical",
    boundaries: ["no_financial_advice", "no_guaranteed_return"],
  },
  {
    id: "writer",
    label: "写作者",
    description: "以写作者身份展示能力：内容创作、观点表达、风格一致",
    visibleClaims: ["writing", "style", "creativity"],
    expressionStyle: "creative",
    boundaries: ["no_plagiarism", "no_false_facts"],
  },
  {
    id: "researcher",
    label: "研究者",
    description: "以研究者身份展示能力：深度分析、文献综述、方法严谨",
    visibleClaims: ["research", "methodology", "evidence"],
    expressionStyle: "academic",
    boundaries: ["no_unverified_claims", "cite_sources"],
  },
];

function loadRoleView(packageDir) {
  const rolePath = path.join(packageDir, "role-view.json");
  if (fs.existsSync(rolePath)) {
    try {
      const raw = fs.readFileSync(rolePath, "utf8");
      const data = JSON.parse(raw);
      if (data.currentRole && data.roles) {
        return data;
      }
    } catch (err) {
      console.warn("[role-view] failed to load role-view.json:", err.message);
    }
  }
  return {
    currentRole: "founder",
    roles: DEFAULT_ROLES,
    updatedAt: new Date().toISOString(),
  };
}

function saveRoleView(packageDir, roleView) {
  const rolePath = path.join(packageDir, "role-view.json");
  roleView.updatedAt = new Date().toISOString();
  fs.writeFileSync(rolePath, JSON.stringify(roleView, null, 2), "utf8");
  return roleView;
}

function getCurrentRole(packageDir) {
  const roleView = loadRoleView(packageDir);
  const role = roleView.roles.find((r) => r.id === roleView.currentRole);
  return role || roleView.roles[0];
}

function setCurrentRole(packageDir, roleId) {
  const roleView = loadRoleView(packageDir);
  const role = roleView.roles.find((r) => r.id === roleId);
  if (!role) {
    throw new Error("未知角色：" + roleId);
  }
  roleView.currentRole = roleId;
  return saveRoleView(packageDir, roleView);
}

function getRoleContext(packageDir) {
  const role = getCurrentRole(packageDir);
  return {
    roleId: role.id,
    roleLabel: role.label,
    visibleClaims: role.visibleClaims,
    expressionStyle: role.expressionStyle,
    boundaries: role.boundaries,
  };
}

module.exports = {
  DEFAULT_ROLES,
  loadRoleView,
  saveRoleView,
  getCurrentRole,
  setCurrentRole,
  getRoleContext,
};
