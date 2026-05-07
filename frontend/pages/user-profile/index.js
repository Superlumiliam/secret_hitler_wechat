const PROFILE_STORAGE_KEY = "secret_hitler_user_profile";
const DEFAULT_AVATAR = "/assets/images/avatars/liberal-avatar.svg";
const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 12;

function readCachedProfile() {
  try {
    return wx.getStorageSync(PROFILE_STORAGE_KEY) || null;
  } catch (err) {
    console.error("读取用户资料缓存失败", err);
    return null;
  }
}

function getFileExtension(filePath) {
  const cleanPath = String(filePath || "").split("?")[0];
  const matched = cleanPath.match(/\.([a-zA-Z0-9]+)$/);
  return matched ? matched[1].toLowerCase() : "jpg";
}

function buildCloudPath(filePath) {
  const ext = getFileExtension(filePath);
  return `user_avatars/avatar_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
}

function createCommandId() {
  return `cmd_save_profile_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

Page({
  data: {
    avatarUrl: "",
    avatarDirty: false,
    displayName: "",
    isSaving: false,
    defaultAvatar: DEFAULT_AVATAR,
  },

  onLoad() {
    const cached = readCachedProfile();
    if (cached) {
      this.setData({
        avatarUrl: cached.avatarUrl || "",
        displayName: cached.displayName || "",
      });
    }
  },

  onBackHome() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
      });
      return;
    }

    wx.reLaunch({
      url: "/pages/home/index",
    });
  },

  onChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl;
    if (!avatarUrl) {
      return;
    }

    this.setData({
      avatarUrl,
      avatarDirty: true,
    });
  },

  onNameInput(event) {
    this.setData({
      displayName: event.detail.value,
    });
  },

  async uploadAvatarIfNeeded() {
    const avatarUrl = this.data.avatarUrl;
    if (!this.data.avatarDirty) {
      return avatarUrl;
    }

    if (!wx.cloud || !wx.cloud.uploadFile) {
      throw new Error("当前基础库不支持头像上传");
    }

    const res = await wx.cloud.uploadFile({
      cloudPath: buildCloudPath(avatarUrl),
      filePath: avatarUrl,
    });

    if (!res.fileID) {
      throw new Error("头像上传失败");
    }

    return res.fileID;
  },

  async saveProfileToCloud(profile) {
    if (!wx.cloud) {
      return profile;
    }

    const res = await wx.cloud.callFunction({
      name: "roomService",
      data: {
        action: "saveProfile",
        payload: {
          commandId: createCommandId(),
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        },
      },
    });
    const result = res.result || {};
    if (!result.success) {
      throw new Error((result.error && result.error.message) || "保存用户资料失败");
    }

    return {
      ...profile,
      ...(result.data || {}),
    };
  },

  async onSubmitProfile(event) {
    if (this.data.isSaving) {
      return;
    }

    const formValue = (event && event.detail && event.detail.value) || {};
    const displayName = String(formValue.displayName || "").trim();
    if (displayName.length < DISPLAY_NAME_MIN_LENGTH || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      wx.showToast({
        title: "用户名需为 2-12 个字符",
        icon: "none",
      });
      return;
    }

    if (!this.data.avatarUrl) {
      wx.showToast({
        title: "请先选择头像",
        icon: "none",
      });
      return;
    }

    this.setData({
      isSaving: true,
    });

    try {
      const avatarUrl = await this.uploadAvatarIfNeeded();
      const savedProfile = await this.saveProfileToCloud({
        profileCompleted: true,
        displayName,
        avatarUrl,
        updatedAt: new Date().toISOString(),
      });

      wx.setStorageSync(PROFILE_STORAGE_KEY, savedProfile);
      wx.showToast({
        title: "已保存",
        icon: "success",
      });

      wx.reLaunch({
        url: "/pages/home/index",
      });
    } catch (err) {
      console.error("保存用户资料失败", err);
      wx.showToast({
        title: err.message || "保存失败",
        icon: "none",
      });
      this.setData({
        isSaving: false,
      });
    }
  },
});
