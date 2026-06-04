const PROFILE_STORAGE_KEY = "secret_hitler_user_profile";

let cachedProfile = null;
let hasLoaded = false;

function normalizeProfile(profile) {
  if (profile && profile.profileCompleted && profile.displayName) {
    return profile;
  }
  return null;
}

function getCachedProfile() {
  if (hasLoaded) {
    return cachedProfile;
  }

  try {
    cachedProfile = normalizeProfile(wx.getStorageSync(PROFILE_STORAGE_KEY));
  } catch (err) {
    console.error("读取用户资料缓存失败", err);
    cachedProfile = null;
  }
  hasLoaded = true;
  return cachedProfile;
}

function getCachedProfileAsync() {
  if (hasLoaded) {
    return Promise.resolve(cachedProfile);
  }

  return new Promise((resolve) => {
    wx.getStorage({
      key: PROFILE_STORAGE_KEY,
      success: (res) => {
        cachedProfile = normalizeProfile(res.data);
        hasLoaded = true;
        resolve(cachedProfile);
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf("data not found") === -1) {
          console.error("读取用户资料缓存失败", err);
        }
        cachedProfile = null;
        hasLoaded = true;
        resolve(null);
      },
    });
  });
}

function saveProfile(profile) {
  return new Promise((resolve, reject) => {
    wx.setStorage({
      key: PROFILE_STORAGE_KEY,
      data: profile,
      success: () => {
        cachedProfile = normalizeProfile(profile);
        hasLoaded = true;
        resolve();
      },
      fail: reject,
    });
  });
}

module.exports = {
  getCachedProfile,
  getCachedProfileAsync,
  saveProfile,
};
