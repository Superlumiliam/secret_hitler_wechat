const { rulesContent } = require("../../../static/rulesContent");

Page({
  data: {
    roomId: "",
    controlledMemberId: "",
    sections: rulesContent,
    activeSectionId: rulesContent[0] ? rulesContent[0].id : "",
  },

  onLoad(options = {}) {
    this.setData({
      roomId: options.roomId || "",
      controlledMemberId: options.controlledMemberId || "",
    });
  },

  onTapBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
      });
      return;
    }

    if (!this.data.roomId) {
      wx.reLaunch({
        url: "/pages/home/index",
      });
      return;
    }

    wx.redirectTo({
      url: `/packageRoom/pages/board/index?roomId=${encodeURIComponent(
        this.data.roomId,
      )}&controlledMemberId=${encodeURIComponent(this.data.controlledMemberId || "")}`,
    });
  },

  onTapSection(event) {
    const sectionId = event.currentTarget.dataset.sectionId || "";
    if (!sectionId) {
      return;
    }
    this.setData({
      activeSectionId: sectionId,
    });
  },
});
