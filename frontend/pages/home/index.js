const HOME_BACKGROUND_FILE_ID =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/home-background.png";

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
    wx.navigateTo({
      url: "/pages/create-room/index",
    });
  },

  onJoinRoom() {
    wx.showToast({
      title: "暂未开放",
      icon: "none",
    });
  },
});
