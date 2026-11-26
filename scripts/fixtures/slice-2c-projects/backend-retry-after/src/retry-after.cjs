function retryAfterMs(headerValue) {
  const seconds = Number.parseInt(headerValue, 10);
  return Number.isFinite(seconds) ? seconds : 0;
}

module.exports = { retryAfterMs };
