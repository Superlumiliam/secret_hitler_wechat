function createPageLifecycle(options) {
  const config = options || {};
  return {
    onShow() {
      if (typeof config.onShow === 'function') {
        config.onShow.call(this);
      }
    },
    onHide() {
      if (typeof config.onHide === 'function') {
        config.onHide.call(this);
      }
    },
    onUnload() {
      if (typeof config.onUnload === 'function') {
        config.onUnload.call(this);
      }
    },
  };
}

module.exports = {
  createPageLifecycle,
};

