function safeGetStorage(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function safeSetStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    console.warn('[storage:set]', key, error);
  }
}

function safeRemoveStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (error) {
    console.warn('[storage:remove]', key, error);
  }
}

function readStorage(key, fallback) {
  return safeGetStorage(key, fallback);
}

function writeStorage(key, value) {
  safeSetStorage(key, value);
}

function removeStorage(key) {
  safeRemoveStorage(key);
}

module.exports = {
  readStorage,
  writeStorage,
  removeStorage,
};

