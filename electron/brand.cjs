/**
 * Runtime brand loader. Packaged builds ship electron/brand.json;
 * official default remains 兔机米 when brand file is absent.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FALLBACK = {
  id: 'tujimi',
  productName: '兔机米',
  organizationName: '兔机米',
  appId: 'local.digitalme.v2',
  userDataDirName: 'digitalme-v2',
  copyright: '兔机米',
  supportText: '密钥保存在本机。',
  supportUrl: '',
  themeTokens: { accent: '#1f6feb' },
  institutionDefaults: {
    organizationName: 'Demo Telecom',
    backendBaseUrl: 'http://127.0.0.1:4100',
  },
  strings: {
    windowTitle: '兔机米',
    navTalk: '与兔机米',
    navSelf: '数字之我',
    navSettings: '设置',
    talkTitle: '与兔机米',
    talkLead: '聊聊近况，或把一件事交给兔机米。',
    talkLabel: '告诉兔机米',
    assistantRole: '兔机米',
    selfHeadline: '兔机米现在怎样理解我',
    helpIntro: '日常使用这四个页面：与兔机米、发现、数字之我、设置。',
    aboutLabel: '关于兔机米',
    hideLabel: '隐藏兔机米',
    institutionProvidedBy: '你的 AI 服务由 {organizationName} 提供。',
    openSourceNote: '开源主体：2digime。机构可白标分发，用户数字之我仍属于本人。',
  },
};

function resolveBrandPath() {
  const envPath = process.env.DIGITALME_BRAND_FILE;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const local = path.join(__dirname, 'brand.json');
  if (fs.existsSync(local)) return local;
  return null;
}

function loadBrand() {
  const file = resolveBrandPath();
  if (!file) return { ...FALLBACK, strings: { ...FALLBACK.strings } };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...FALLBACK,
      ...parsed,
      themeTokens: { ...FALLBACK.themeTokens, ...(parsed.themeTokens || {}) },
      institutionDefaults: {
        ...FALLBACK.institutionDefaults,
        ...(parsed.institutionDefaults || {}),
      },
      strings: { ...FALLBACK.strings, ...(parsed.strings || {}) },
      _source: file,
    };
  } catch {
    return { ...FALLBACK, strings: { ...FALLBACK.strings } };
  }
}

function publicBrandView(brand) {
  const b = brand || loadBrand();
  return {
    id: b.id,
    productName: b.productName,
    organizationName: b.organizationName,
    supportText: b.supportText || '',
    supportUrl: b.supportUrl || '',
    themeTokens: b.themeTokens || {},
    institutionDefaults: {
      organizationName: (b.institutionDefaults && b.institutionDefaults.organizationName) || '',
      backendBaseUrl: (b.institutionDefaults && b.institutionDefaults.backendBaseUrl) || '',
    },
    strings: b.strings || {},
    // never expose secrets — brand kit must not carry keys
  };
}

module.exports = {
  FALLBACK,
  loadBrand,
  publicBrandView,
  resolveBrandPath,
};
