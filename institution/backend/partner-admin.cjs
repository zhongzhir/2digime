'use strict';

const { randomUUID } = require('node:crypto');

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

function text(value, name, max = 200) {
  const result = String(value || '').trim();
  if (!result) throw Object.assign(new Error(`${name}_required`), { statusCode: 400 });
  if (result.length > max) throw Object.assign(new Error(`${name}_too_long`), { statusCode: 400 });
  return result;
}

function id(value, name) {
  const result = text(value, name, 64);
  if (!ID_PATTERN.test(result)) throw Object.assign(new Error(`${name}_invalid`), { statusCode: 400 });
  return result;
}

function optionalUrl(value, name) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(new Error(`${name}_invalid`), { statusCode: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error(`${name}_invalid`), { statusCode: 400 });
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeData(data) {
  return {
    version: Math.max(2, Number(data.version || 1)),
    organizations: data.organizations && typeof data.organizations === 'object' ? data.organizations : {},
    users: data.users && typeof data.users === 'object' ? data.users : {},
    services: data.services && typeof data.services === 'object' ? data.services : {},
    auditEvents: Array.isArray(data.auditEvents) ? data.auditEvents.slice(-500) : [],
    updatedAt: data.updatedAt || null,
  };
}

function audit(data, action, resourceType, resourceId, nowIso, outcome = 'success') {
  data.auditEvents.push({
    auditId: `audit_${randomUUID()}`,
    at: nowIso,
    actor: 'sandbox-admin',
    action,
    resourceType,
    resourceId,
    outcome,
  });
  data.auditEvents = data.auditEvents.slice(-500);
}

function publicOverview(data) {
  const current = normalizeData(data);
  return {
    organizations: Object.values(current.organizations).map((org) => ({
      id: org.id,
      name: org.name,
      status: org.status,
      brandRef: org.brandRef || null,
      createdAt: org.createdAt || null,
    })),
    users: Object.values(current.users).map((user) => ({
      institutionUserId: user.institutionUserId,
      organizationId: user.organizationId,
      displayName: user.displayName || user.institutionUserId,
      status: user.status,
      verificationLevel: user.verificationLevel || 'sandbox_account',
      entitlement: user.entitlement || null,
      credentialProvisioned: Boolean(user.virtualKey),
      provisionedAt: user.provisionedAt || null,
    })),
    services: Object.values(current.services).map((service) => ({
      serviceId: service.serviceId,
      organizationId: service.organizationId,
      name: service.name,
      status: service.status,
      subjectId: service.subjectId,
      a2aEndpoint: service.a2aEndpoint || null,
      agentCardUrl: service.agentCardUrl || null,
      authorizationPolicy: service.authorizationPolicy,
      createdAt: service.createdAt || null,
    })),
    auditEvents: current.auditEvents.slice(-50).reverse(),
    privacyBoundary: {
      allowed: ['机构账号映射', '权益', '服务配置', '授权策略', '用量汇总', '最小审计'],
      forbidden: ['prompt', 'response', 'Digital Self', '私人文件', '长期记忆', 'provider master key'],
    },
  };
}

function createOrganization(data, input, nowIso) {
  const current = normalizeData(data);
  const organizationId = id(input.id, 'organization_id');
  if (current.organizations[organizationId]) {
    throw Object.assign(new Error('organization_exists'), { statusCode: 409 });
  }
  current.organizations[organizationId] = {
    id: organizationId,
    name: text(input.name, 'organization_name'),
    status: 'active',
    brandRef: String(input.brandRef || 'tujimi').trim() || 'tujimi',
    gatewayBaseUrl: optionalUrl(input.gatewayBaseUrl, 'gateway_base_url') || null,
    createdAt: nowIso,
  };
  audit(current, 'organization.created', 'organization', organizationId, nowIso);
  return current;
}

function createUser(data, input, nowIso) {
  const current = normalizeData(data);
  const institutionUserId = id(input.institutionUserId, 'institution_user_id');
  const organizationId = id(input.organizationId, 'organization_id');
  if (!current.organizations[organizationId]) {
    throw Object.assign(new Error('organization_not_found'), { statusCode: 404 });
  }
  if (current.users[institutionUserId]) {
    throw Object.assign(new Error('user_exists'), { statusCode: 409 });
  }
  const models = Array.isArray(input.models)
    ? input.models.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 10)
    : [];
  const quotaAmount = Number(input.quotaAmount);
  current.users[institutionUserId] = {
    institutionUserId,
    organizationId,
    displayName: String(input.displayName || institutionUserId).trim().slice(0, 200),
    status: 'active',
    verificationLevel: 'sandbox_account',
    entitlementGroup: null,
    entitlement: {
      label: text(input.entitlementLabel || '沙箱权益', 'entitlement_label'),
      models,
      quotaType: 'synthetic_units',
      quotaAmount: Number.isFinite(quotaAmount) && quotaAmount >= 0 ? quotaAmount : 100,
      validFrom: nowIso,
      validTo: input.validTo ? text(input.validTo, 'valid_to', 64) : null,
      scopes: ['ai:talk'],
    },
    provisionedAt: nowIso,
  };
  audit(current, 'user.created', 'institution_user', institutionUserId, nowIso);
  return current;
}

function createService(data, input, nowIso) {
  const current = normalizeData(data);
  const serviceId = id(input.serviceId, 'service_id');
  const organizationId = id(input.organizationId, 'organization_id');
  if (!current.organizations[organizationId]) {
    throw Object.assign(new Error('organization_not_found'), { statusCode: 404 });
  }
  if (current.services[serviceId]) {
    throw Object.assign(new Error('service_exists'), { statusCode: 409 });
  }
  const scopes = Array.isArray(input.scopes)
    ? input.scopes.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  current.services[serviceId] = {
    serviceId,
    organizationId,
    name: text(input.name, 'service_name'),
    status: 'active',
    subjectId: id(input.subjectId, 'subject_id'),
    a2aEndpoint: optionalUrl(input.a2aEndpoint, 'a2a_endpoint'),
    agentCardUrl: optionalUrl(input.agentCardUrl, 'agent_card_url'),
    authorizationPolicy: {
      scopes,
      humanInLoop: input.humanInLoop !== false,
      maxCostCny: 0,
    },
    createdAt: nowIso,
  };
  audit(current, 'service.created', 'service', serviceId, nowIso);
  return current;
}

function disableResource(data, input, nowIso) {
  const current = normalizeData(data);
  const resourceType = String(input.resourceType || '');
  const resourceId = id(input.resourceId, 'resource_id');
  const collection = resourceType === 'organization'
    ? current.organizations
    : resourceType === 'institution_user'
      ? current.users
      : resourceType === 'service'
        ? current.services
        : null;
  if (!collection) throw Object.assign(new Error('resource_type_invalid'), { statusCode: 400 });
  if (!collection[resourceId]) throw Object.assign(new Error('resource_not_found'), { statusCode: 404 });
  collection[resourceId] = { ...collection[resourceId], status: 'disabled', disabledAt: nowIso };
  if (resourceType === 'organization') {
    for (const [userId, user] of Object.entries(current.users)) {
      if (user.organizationId === resourceId) current.users[userId] = { ...user, status: 'disabled', disabledAt: nowIso };
    }
    for (const [serviceId, service] of Object.entries(current.services)) {
      if (service.organizationId === resourceId) current.services[serviceId] = { ...service, status: 'disabled', disabledAt: nowIso };
    }
  }
  audit(current, `${resourceType}.disabled`, resourceType, resourceId, nowIso);
  return current;
}

module.exports = {
  normalizeData,
  publicOverview,
  createOrganization,
  createUser,
  createService,
  disableResource,
};

