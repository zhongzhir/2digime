function formatPrice(cents) {
  return `¥${cents / 100}`;
}

module.exports = { formatPrice };
