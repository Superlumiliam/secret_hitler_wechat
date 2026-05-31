const gameService = require("../../services/gameService");
const { mapResultSnapshot } = require("./resultMapper");
const { POLICY_TRACK_ASSET_FILE_IDS } = require("../../../utils/policyTrack");
const {
  RESULT_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
} = require("../../../utils/pageTimeout");

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

Page({
  data: {
    roomId: "",
    roomCode: "",
    displayRoomCode: "------",
    loading: true,
    errorText: "",
    result: null,
    policyAssets: {},
    activePowerTipSlot: 0,
  },

  onLoad(options = {}) {
    this.setData({
      roomId: options.roomId || "",
      roomCode: options.roomCode || "",
      displayRoomCode: options.roomCode || "------",
    });
    setupPageTimeout(this, {
      timeoutMs: RESULT_PAGE_TIMEOUT_MS,
    });
    this.loadResult();
  },

  onShow() {
    schedulePageTimeout(this, {
      timeoutMs: RESULT_PAGE_TIMEOUT_MS,
    });
  },

  onHide() {
    clearPageTimeout(this);
  },

  onUnload() {
    clearPageTimeout(this);
  },

  async loadResult() {
    if (!this.data.roomId) {
      this.setData({
        loading: false,
        errorText: "房间信息缺失",
      });
      return;
    }

    this.setData({
      loading: true,
      errorText: "",
    });

    try {
      const snapshot = await gameService.getResultSnapshot(this.data.roomId);
      syncPageTimeoutDeadline(this, snapshot && snapshot.expireAt);
      const hydrated = await this.hydrateResultAssets(snapshot);
      this.setData({
        result: mapResultSnapshot(hydrated, hydrated.policyAssets || {}),
        policyAssets: hydrated.policyAssets || {},
        roomCode: hydrated.roomCode || this.data.roomCode,
        displayRoomCode: hydrated.roomCode || this.data.roomCode || "------",
      });
    } catch (err) {
      console.error("获取结果失败", err);
      if (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND" || err.code === "NOT_ROOM_MEMBER") {
        handlePageTimeout(this, {
          reasonCode: err.code,
        });
        return;
      }

      this.setData({
        errorText: err.message || "获取结果失败",
      });
      wx.showToast({
        title: err.message || "获取结果失败",
        icon: "none",
      });
    } finally {
      this.setData({
        loading: false,
      });
    }
  },

  async hydrateResultAssets(snapshot) {
    const players = (snapshot && snapshot.finalPlayers) || [];
    const cachedPolicyAssets = this.data.policyAssets || {};
    const hasCachedPolicyAssets = Object.keys(POLICY_TRACK_ASSET_FILE_IDS).every((key) => Boolean(cachedPolicyAssets[key]));
    const policyAssetFileIds = Object.values(POLICY_TRACK_ASSET_FILE_IDS);
    const fileIds = players
      .map((player) => player.avatarUrl)
      .filter(isCloudFileId)
      .concat(hasCachedPolicyAssets ? [] : policyAssetFileIds);
    if (!fileIds.length || !wx.cloud) {
      return {
        ...snapshot,
        policyAssets: cachedPolicyAssets,
      };
    }

    const urlByFileId = {};
    const policyAssets = { ...cachedPolicyAssets };
    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: Array.from(new Set(fileIds)),
      });
      (res.fileList || []).forEach((file) => {
        if (file.status === 0 && file.tempFileURL) {
          urlByFileId[file.fileID] = file.tempFileURL;
        }
      });
      if (!hasCachedPolicyAssets) {
        Object.keys(POLICY_TRACK_ASSET_FILE_IDS).forEach((key) => {
          const fileId = POLICY_TRACK_ASSET_FILE_IDS[key];
          policyAssets[key] = urlByFileId[fileId] || "";
        });
      }
    } catch (err) {
      console.error("结果页图片临时链接获取失败", err);
    }

    return {
      ...snapshot,
      policyAssets,
      finalPlayers: players.map((player) => ({
        ...player,
        avatarUrl: urlByFileId[player.avatarUrl] || player.avatarUrl || "",
      })),
    };
  },

  onTogglePowerTip(event) {
    const slot = Number(event.detail && event.detail.slot) || 0;
    this.setData({
      activePowerTipSlot: this.data.activePowerTipSlot === slot ? 0 : slot,
    });
  },

  onBackHome() {
    wx.reLaunch({
      url: "/pages/home/index",
    });
  },

  onTapRules() {
    const timeoutDeadlineAt = this.__pageTimeoutDeadline || Date.now() + RESULT_PAGE_TIMEOUT_MS;
    wx.navigateTo({
      url: `/packageRoom/pages/rules/index?roomId=${encodeURIComponent(
        this.data.roomId || "",
      )}&timeoutMs=${RESULT_PAGE_TIMEOUT_MS}&timeoutDeadlineAt=${timeoutDeadlineAt}`,
    });
  },
});
