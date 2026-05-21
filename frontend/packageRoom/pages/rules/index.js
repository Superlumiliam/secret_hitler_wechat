const { rulesContent } = require("../../static/rulesContent");
const {
  GAME_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
} = require("../../../utils/pageTimeout");

function normalizeTimeoutMs(value) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : GAME_PAGE_TIMEOUT_MS;
}

Page({
  pageTimeoutMs: GAME_PAGE_TIMEOUT_MS,

  data: {
    roomId: "",
    controlledMemberId: "",
    sections: rulesContent,
    activeSectionId: rulesContent[0] ? rulesContent[0].id : "",
  },

  onLoad(options = {}) {
    this.pageTimeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.setData({
      roomId: options.roomId || "",
      controlledMemberId: options.controlledMemberId || "",
    });
    setupPageTimeout(this, {
      timeoutMs: this.pageTimeoutMs,
      deadlineAt: options.timeoutDeadlineAt,
    });
  },

  onShow() {
    schedulePageTimeout(this, {
      timeoutMs: this.pageTimeoutMs,
    });
  },

  onHide() {
    clearPageTimeout(this);
  },

  onUnload() {
    clearPageTimeout(this);
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
