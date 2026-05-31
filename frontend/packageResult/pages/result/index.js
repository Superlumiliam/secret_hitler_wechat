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

const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const RESULT_ASSET_FILE_IDS_BY_KEY = {
  "result-success-liberal": `${CLOUD_ASSET_ROOT}result-success-liberal.webp`,
  "result-success-fascist": `${CLOUD_ASSET_ROOT}result-success-fascist.webp`,
  "result-fail-liberal": `${CLOUD_ASSET_ROOT}result-fail-liberal.webp`,
  "result-fail-fascist": `${CLOUD_ASSET_ROOT}result-fail-fascist.webp`,
};

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
    resultImageSrc: "",
    policyAssets: {},
    resultAssetSrcByKey: {},
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
      const result = mapResultSnapshot(hydrated, hydrated.policyAssets || {});
      this.setData({
        result,
        resultImageSrc: (hydrated.resultAssets || {})[result.resultImageAssetKey] || "",
        policyAssets: hydrated.policyAssets || {},
        resultAssetSrcByKey: hydrated.resultAssets || {},
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
    const cachedResultAssets = this.data.resultAssetSrcByKey || {};
    const hasCachedPolicyAssets = Object.keys(POLICY_TRACK_ASSET_FILE_IDS).every((key) => Boolean(cachedPolicyAssets[key]));
    const hasCachedResultAssets = Object.keys(RESULT_ASSET_FILE_IDS_BY_KEY).every((key) =>
      Boolean(cachedResultAssets[key]),
    );
    const policyAssetFileIds = Object.values(POLICY_TRACK_ASSET_FILE_IDS);
    const resultAssetFileIds = Object.values(RESULT_ASSET_FILE_IDS_BY_KEY);
    const fileIds = players
      .map((player) => player.avatarUrl)
      .filter(isCloudFileId)
      .concat(hasCachedPolicyAssets ? [] : policyAssetFileIds)
      .concat(hasCachedResultAssets ? [] : resultAssetFileIds);
    if (!fileIds.length || !wx.cloud) {
      return {
        ...snapshot,
        policyAssets: cachedPolicyAssets,
        resultAssets: cachedResultAssets,
      };
    }

    const urlByFileId = {};
    const policyAssets = { ...cachedPolicyAssets };
    const resultAssets = { ...cachedResultAssets };
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
      if (!hasCachedResultAssets) {
        Object.keys(RESULT_ASSET_FILE_IDS_BY_KEY).forEach((key) => {
          const fileId = RESULT_ASSET_FILE_IDS_BY_KEY[key];
          resultAssets[key] = urlByFileId[fileId] || "";
        });
      }
    } catch (err) {
      console.error("结果页图片临时链接获取失败", err);
    }

    return {
      ...snapshot,
      policyAssets,
      resultAssets,
      finalPlayers: players.map((player) => ({
        ...player,
        avatarUrl: urlByFileId[player.avatarUrl] || player.avatarUrl || "",
      })),
    };
  },

  onResultAssetError(event) {
    console.error("结果页素材加载失败", event && event.detail);
    const assetKey = event.currentTarget.dataset.assetKey || "";
    if (!assetKey) {
      return;
    }
    const nextSrcByKey = {
      ...(this.data.resultAssetSrcByKey || {}),
      [assetKey]: "",
    };
    this.setData({
      resultImageSrc: "",
      resultAssetSrcByKey: nextSrcByKey,
    });
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
