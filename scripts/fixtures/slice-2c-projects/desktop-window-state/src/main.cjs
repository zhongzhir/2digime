function restoreWindowBounds(saved, primaryDisplay) {
  return saved || primaryDisplay.workArea;
}

module.exports = { restoreWindowBounds };
