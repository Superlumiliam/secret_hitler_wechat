Page({
  data: {
    roomId: "",
  },

  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
    });
  },
});
