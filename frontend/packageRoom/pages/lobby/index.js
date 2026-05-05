Page({
  data: {
    roomId: "",
    memberId: "",
    lobby: null,
    isLoading: true,
  },

  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
      memberId: options.memberId || "",
    });
    this.loadLobbySnapshot();
  },

  async loadLobbySnapshot() {
    if (!this.data.roomId || !wx.cloud) {
      this.setData({
        isLoading: false,
      });
      return;
    }

    try {
      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "getLobbySnapshot",
          payload: {
            roomId: this.data.roomId,
          },
        },
      });
      const result = res.result || {};

      if (!result.success) {
        throw new Error((result.error && result.error.message) || "获取大厅失败");
      }

      this.setData({
        lobby: result.data,
        isLoading: false,
      });
    } catch (err) {
      console.error("获取大厅失败", err);
      wx.showToast({
        title: err.message || "获取大厅失败",
        icon: "none",
      });
      this.setData({
        isLoading: false,
      });
    }
  },

  onBackHome() {
    wx.reLaunch({
      url: "/pages/home/index",
    });
  },
});
