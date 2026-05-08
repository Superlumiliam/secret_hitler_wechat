const HOME_BACKGROUND_FILE_ID =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/background-home.webp";
const DEFAULT_AVATAR_FILE_ID =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/man-in-black.webp";
const PROFILE_STORAGE_KEY = "secret_hitler_user_profile";

function getCachedUserProfile() {
  try {
    const profile = wx.getStorageSync(PROFILE_STORAGE_KEY);
    if (profile && profile.profileCompleted && profile.displayName) {
      return profile;
    }
  } catch (err) {
    console.error("读取用户资料缓存失败", err);
  }
  return null;
}

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

Page({
  data: {
    homeBackgroundSrc: "",
    homeBackgroundVisible: true,
    profileAvatarSrc: "",
  },

  onLoad() {
    this.loadHomeBackground();
  },

  onShow() {
    this.loadProfileAvatar();
  },

  loadHomeBackground() {
    if (!wx.cloud) {
      this.setData({
        homeBackgroundVisible: false,
      });
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: [HOME_BACKGROUND_FILE_ID],
      success: (res) => {
        const file = res.fileList && res.fileList[0];
        if (!file || file.status !== 0 || !file.tempFileURL) {
          console.error("首页背景图云存储临时链接获取失败", file);
          this.setData({
            homeBackgroundVisible: false,
          });
          return;
        }

        this.setData({
          homeBackgroundSrc: file.tempFileURL,
          homeBackgroundVisible: true,
        });
      },
      fail: (err) => {
        console.error("首页背景图云存储临时链接获取失败", err);
        this.setData({
          homeBackgroundVisible: false,
        });
      },
    });
  },

  onBackgroundError() {
    console.error("首页背景图加载失败", this.data.homeBackgroundSrc);
    this.setData({
      homeBackgroundVisible: false,
    });
  },

  loadProfileAvatar() {
    const profile = getCachedUserProfile();
    const avatarUrl = profile && profile.avatarUrl ? profile.avatarUrl : DEFAULT_AVATAR_FILE_ID;
    this.loadCloudAvatar(avatarUrl, avatarUrl !== DEFAULT_AVATAR_FILE_ID);
  },

  loadCloudAvatar(avatarUrl, canFallbackToDefault) {
    if (!isCloudFileId(avatarUrl)) {
      this.setData({
        profileAvatarSrc: avatarUrl,
      });
      return;
    }

    if (!wx.cloud) {
      this.setData({
        profileAvatarSrc: "",
      });
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: [avatarUrl],
      success: (res) => {
        const file = res.fileList && res.fileList[0];
        if (!file || file.status !== 0 || !file.tempFileURL) {
          console.error("首页头像云存储临时链接获取失败", file);
          if (canFallbackToDefault) {
            this.loadCloudAvatar(DEFAULT_AVATAR_FILE_ID, false);
            return;
          }
          this.setData({
            profileAvatarSrc: "",
          });
          return;
        }

        this.setData({
          profileAvatarSrc: file.tempFileURL,
        });
      },
      fail: (err) => {
        console.error("首页头像云存储临时链接获取失败", err);
        if (canFallbackToDefault) {
          this.loadCloudAvatar(DEFAULT_AVATAR_FILE_ID, false);
          return;
        }
        this.setData({
          profileAvatarSrc: "",
        });
      },
    });
  },

  onProfileEntry() {
    wx.navigateTo({
      url: "/pages/user-profile/index",
    });
  },

  onCreateRoom() {
    if (!getCachedUserProfile()) {
      wx.navigateTo({
        url: "/pages/user-profile/index",
      });
      return;
    }

    wx.navigateTo({
      url: "/pages/create-room/index",
    });
  },

  onJoinRoom() {
    if (!getCachedUserProfile()) {
      wx.navigateTo({
        url: "/pages/user-profile/index",
      });
      return;
    }

    wx.showToast({
      title: "暂未开放",
      icon: "none",
    });
  },
});
