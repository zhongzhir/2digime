function normalizeTitle(value) {
  return String(value).trim().replace(/\s+/g, '');
}

module.exports = { normalizeTitle };
