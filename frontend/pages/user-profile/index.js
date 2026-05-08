const PROFILE_STORAGE_KEY = "secret_hitler_user_profile";
const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const IDENTITY_BACKGROUND_FILE_ID = `${CLOUD_ASSET_ROOT}background-identity.webp`;
const DEFAULT_AVATAR_FILE_ID = `${CLOUD_ASSET_ROOT}man-in-black.webp`;
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

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

Page({
  data: {
    avatarUrl: "",
    avatarPreviewSrc: "",
    avatarDirty: false,
    backgroundSrc: "",
    backgroundVisible: true,
    displayName: "",
    isSaving: false,
    defaultAvatarSrc: "",
    redirect: "",
  },

  onLoad(options = {}) {
    const cached = readCachedProfile();
    if (cached) {
      const avatarUrl = cached.avatarUrl || "";
      this.setData({
        avatarUrl,
        avatarPreviewSrc: isCloudFileId(avatarUrl) ? "" : avatarUrl,
        displayName: cached.displayName || "",
      });
    }

    this.setData({
      redirect: options.redirect ? decodeURIComponent(options.redirect) : "",
    });

    this.loadCloudAssets();
  },

  loadCloudAssets() {
    if (!wx.cloud) {
      this.setData({
        backgroundVisible: false,
      });
      return;
    }

    const cloudAvatarUrl = isCloudFileId(this.data.avatarUrl) ? this.data.avatarUrl : "";
    const fileList = [IDENTITY_BACKGROUND_FILE_ID, DEFAULT_AVATAR_FILE_ID];
    if (cloudAvatarUrl && cloudAvatarUrl !== DEFAULT_AVATAR_FILE_ID) {
      fileList.push(cloudAvatarUrl);
    }

    wx.cloud.getTempFileURL({
      fileList,
      success: (res) => {
        const urlByFileId = {};
        (res.fileList || []).forEach((file) => {
          if (file.status === 0 && file.tempFileURL) {
            urlByFileId[file.fileID] = file.tempFileURL;
          } else {
            console.error("创建用户页云存储临时链接获取失败", file);
          }
        });

        this.setData({
          backgroundSrc: urlByFileId[IDENTITY_BACKGROUND_FILE_ID] || "",
          backgroundVisible: Boolean(urlByFileId[IDENTITY_BACKGROUND_FILE_ID]),
          defaultAvatarSrc: urlByFileId[DEFAULT_AVATAR_FILE_ID] || "",
          avatarPreviewSrc: cloudAvatarUrl ? urlByFileId[cloudAvatarUrl] || "" : this.data.avatarPreviewSrc,
        });
      },
      fail: (err) => {
        console.error("创建用户页云存储临时链接获取失败", err);
        this.setData({
          backgroundVisible: false,
        });
      },
    });
  },

  onBackgroundError() {
    console.error("创建用户页背景图加载失败", this.data.backgroundSrc);
    this.setData({
      backgroundVisible: false,
    });
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
      avatarPreviewSrc: avatarUrl,
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
      return avatarUrl || DEFAULT_AVATAR_FILE_ID;
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

      const redirect = this.data.redirect;
      if (redirect) {
        wx.redirectTo({
          url: redirect,
        });
        return;
      }

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
