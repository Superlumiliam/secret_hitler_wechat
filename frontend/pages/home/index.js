const HOME_BACKGROUND_FILE_ID =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/home-background.webp";
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

Page({
  data: {
    homeBackgroundSrc: "",
    homeBackgroundVisible: true,
  },

  onLoad() {
    this.loadHomeBackground();
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
