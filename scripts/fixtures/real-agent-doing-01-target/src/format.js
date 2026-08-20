'use strict';

/**
 * 显示用全名。
 * 公共 API：formatFullName(givenName, familyName)
 */
function formatFullName(givenName, familyName) {
  const given = givenName == null ? '' : String(givenName);
  const family = familyName == null ? '' : String(familyName);
  return given + ' ' + family;
}

module.exports = { formatFullName };
