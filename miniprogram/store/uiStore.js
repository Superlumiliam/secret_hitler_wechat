const { createStore } = require('./createStore');

const uiStore = createStore({
  globalLoadingText: '',
  privacyShieldVisible: false,
  latestToast: null,
});

function showToast(type, text) {
  uiStore.patch({
    latestToast: {
      type,
      text,
      at: Date.now(),
    },
  });
  wx.showToast({
    title: text,
    icon: type === 'error' ? 'none' : 'success',
    duration: 1800,
  });
}

module.exports = {
  uiStore,
  showToast,
};

