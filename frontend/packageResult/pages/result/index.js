const gameService = require("../../services/gameService");
const bootstrapService = require("../../../services/bootstrapService");
const { mapResultSnapshot } = require("./resultMapper");
const { POLICY_TRACK_ASSET_FILE_IDS } = require("../../utils/policyTrack");
const {
  RESULT_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
} = require("../../../utils/pageTimeout");
const { clearGameSnapshotCache } = require("../../../utils/gameSnapshotCache");
const { buildPageUrl, reLaunchIfPageStacked } = require("../../../utils/protectedPageRoute");

const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const RESULT_ASSET_FILE_IDS_BY_KEY = {
  "result-success-liberal": `${CLOUD_ASSET_ROOT}result-success-liberal.webp`,
  "result-success-fascist": `${CLOUD_ASSET_ROOT}result-success-fascist.webp`,
  "result-fail-liberal": `${CLOUD_ASSET_ROOT}result-fail-liberal.webp`,
  "result-fail-fascist": `${CLOUD_ASSET_ROOT}result-fail-fascist.webp`,
  "result-identity-row-liberal": `${CLOUD_ASSET_ROOT}result-identity-row-liberal-transparent.webp`,
  "result-identity-row-fascist": `${CLOUD_ASSET_ROOT}result-identity-row-fascist-transparent.webp`,
  "result-role-chip-liberal": `${CLOUD_ASSET_ROOT}result-role-chip-liberal-transparent.webp`,
  "result-role-chip-fascist": `${CLOUD_ASSET_ROOT}result-role-chip-fascist-transparent.webp`,
  "result-role-chip-dictator": `${CLOUD_ASSET_ROOT}result-role-chip-dictator-transparent.webp`,
  "default-avatar": `${CLOUD_ASSET_ROOT}man-in-black.webp`,
};
const RESULT_POLICY_ASSET_KEYS = [
  "liberalBg",
  "authoritarianBg",
  "liberalCard",
  "authoritarianCard",
  "liberalSlot",
  "authoritarianSlot",
  "execution",
  "investigate",
  "policyPeek",
  "specialElection",
];
const TEMP_FILE_URL_BATCH_SIZE = 50;

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

async function resolveTempFileUrlsInBatches(fileIds) {
  const uniqueFileIds = Array.from(new Set(fileIds));
  const urlByFileId = {};

  for (let start = 0; start < uniqueFileIds.length; start += TEMP_FILE_URL_BATCH_SIZE) {
    const fileList = uniqueFileIds.slice(start, start + TEMP_FILE_URL_BATCH_SIZE);
    try {
      const res = await wx.cloud.getTempFileURL({
        fileList,
      });
      (res.fileList || []).forEach((file) => {
        if (file.status === 0 && file.tempFileURL) {
          urlByFileId[file.fileID] = file.tempFileURL;
        }
      });
    } catch (err) {
      console.error("结果页图片临时链接获取失败", err);
    }
  }

  return urlByFileId;
}

function clearRuntimeActiveRoomState() {
  clearGameSnapshotCache();
  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || !app.globalData) {
    return;
  }

  app.globalData.activeRoom = null;
  app.globalData.initialLobbySnapshots = {};
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
    isLeaving: false,
  },

  onLoad(options = {}) {
    if (reLaunchIfPageStacked(buildPageUrl("/packageResult/pages/result/index", options), this)) {
      return;
    }

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
      const resultAssets = hydrated.resultAssets || {};
      const result = mapResultSnapshot(hydrated, hydrated.policyAssets || {});
      result.players = result.players.map((player) => ({
        ...player,
        identityPlateSrc: resultAssets[player.identityPlateAssetKey] || "",
        roleChipSrc: resultAssets[player.roleChipAssetKey] || "",
      }));
      this.setData({
        result,
        resultImageSrc: resultAssets[result.resultImageAssetKey] || "",
        policyAssets: hydrated.policyAssets || {},
        resultAssetSrcByKey: resultAssets,
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
    const hasCachedPolicyAssets = RESULT_POLICY_ASSET_KEYS.every((key) => Boolean(cachedPolicyAssets[key]));
    const hasCachedResultAssets = Object.keys(RESULT_ASSET_FILE_IDS_BY_KEY).every((key) =>
      Boolean(cachedResultAssets[key]),
    );
    const policyAssetFileIds = RESULT_POLICY_ASSET_KEYS.map((key) => POLICY_TRACK_ASSET_FILE_IDS[key]);
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

    const urlByFileId = await resolveTempFileUrlsInBatches(fileIds);
    const policyAssets = { ...cachedPolicyAssets };
    const resultAssets = { ...cachedResultAssets };
    if (!hasCachedPolicyAssets) {
      RESULT_POLICY_ASSET_KEYS.forEach((key) => {
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

    return {
      ...snapshot,
      policyAssets,
      resultAssets,
      finalPlayers: players.map((player) => ({
        ...player,
        avatarUrl: isCloudFileId(player.avatarUrl)
          ? urlByFileId[player.avatarUrl] || resultAssets["default-avatar"] || ""
          : player.avatarUrl || resultAssets["default-avatar"] || "",
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

  async clearResultActiveRoom(options = {}) {
    if (this.__resultActiveRoomCleared) {
      return;
    }

    this.__resultActiveRoomCleared = true;
    clearRuntimeActiveRoomState();
    try {
      await bootstrapService.clearActiveRoom(this.data.roomId);
    } catch (err) {
      if (!options.silent) {
        console.error("清理结果页活跃房间失败", err);
      }
    }
  },

  async onBackHome() {
    if (this.data.isLeaving) {
      return;
    }

    this.setData({
      isLeaving: true,
    });

    await this.clearResultActiveRoom();
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
