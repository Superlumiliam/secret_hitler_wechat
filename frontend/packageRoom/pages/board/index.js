Page({
  data: {
    roomId: "",
    isLeaving: false,
  },

  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
    });
  },

  createCommandId(prefix) {
    return `cmd_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  },

  async onBackHome() {
    if (this.data.isLeaving) {
      return;
    }

    if (!this.data.roomId || !wx.cloud) {
      wx.reLaunch({
        url: "/pages/home/index",
      });
      return;
    }

    this.setData({
      isLeaving: true,
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "leaveRoom",
          payload: {
            commandId: this.createCommandId("leave_board"),
            roomId: this.data.roomId,
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        console.error("离开对局失败", result.error || result);
      }
    } catch (err) {
      console.error("离开对局失败", err);
    }

    wx.reLaunch({
      url: "/pages/home/index",
    });
  },
});
