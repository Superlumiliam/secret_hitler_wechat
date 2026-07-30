const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const HISTORY_ASSET_FILE_IDS = {
  background: `${CLOUD_ASSET_ROOT}background-room-prepare.webp`,
  frame: `${CLOUD_ASSET_ROOT}history-frame-v2.webp`,
};
const {
  GAME_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
} = require("../../../utils/pageTimeout");
const { getGameSnapshotCache } = require("../../../utils/gameSnapshotCache");
const { reLaunchPage } = require("../../../utils/protectedPageRoute");
const { resolveTempFileUrls } = require("../../../utils/tempFileUrlCache");
const { createHistoryRoundViews } = require("./historyMapper");

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

Page({
  data: {
    roomId: "",
    controlledMemberId: "",
    isLoading: true,
    errorText: "",
    header: null,
    summary: null,
    rounds: [],
    historyAssets: {},
  },

  onLoad(options = {}) {
    this.setData({
      roomId: options.roomId || "",
      controlledMemberId: options.controlledMemberId || "",
    });
    setupPageTimeout(this, {
      timeoutMs: GAME_PAGE_TIMEOUT_MS,
      deadlineAt: options.timeoutDeadlineAt,
    });
    this.loadHistorySnapshot();
  },

  onShow() {
    schedulePageTimeout(this, {
      timeoutMs: GAME_PAGE_TIMEOUT_MS,
    });
  },

  onHide() {
    clearPageTimeout(this);
  },

  onUnload() {
    clearPageTimeout(this);
  },

  async loadHistorySnapshot() {
    if (!this.data.roomId) {
      this.setData({
        isLoading: false,
        errorText: "房间信息缺失",
      });
      return;
    }

    const cachedSnapshot = getGameSnapshotCache(this.data.roomId, this.data.controlledMemberId || "");
    if (!cachedSnapshot && !wx.cloud) {
      this.setData({
        isLoading: false,
        errorText: "房间信息缺失",
      });
      return;
    }

    this.setData({
      isLoading: true,
      errorText: "",
    });

    try {
      let snapshot = cachedSnapshot;
      if (!snapshot) {
        const res = await wx.cloud.callFunction({
          name: "gameService",
          data: {
            action: "getGameSnapshot",
            payload: {
              roomId: this.data.roomId,
              controlledMemberId: this.data.controlledMemberId || "",
            },
          },
        });
        const result = res.result || {};
        if (!result.success) {
          throw this.createServiceError(result, "获取历史记录失败");
        }
        snapshot = result.data;
      }
      syncPageTimeoutDeadline(this, snapshot && snapshot.expireAt);
      await this.hydrateHistory(snapshot);
    } catch (err) {
      console.error("获取历史记录失败", err);
      if (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND" || err.code === "NOT_ROOM_MEMBER") {
        handlePageTimeout(this, {
          reasonCode: err.code,
        });
        return;
      }

      this.setData({
        errorText: err.message || "获取历史记录失败",
      });
      wx.showToast({
        title: err.message || "获取历史记录失败",
        icon: "none",
      });
    } finally {
      this.setData({
        isLoading: false,
      });
    }
  },

  async hydrateHistory(snapshot) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const history = publicState.history || {
      roundsStarted: snapshot.round || 1,
      roundsCompleted: 0,
      rounds: [],
    };
    const seatOrder = publicState.seatOrder || [];

    const historyAssets = await this.loadHistoryAssets();

    this.setData({
      header: {
        roomCode: snapshot.roomCode || "",
        playerCount: seatOrder.length,
        round: snapshot.round || history.roundsStarted || 1,
      },
      summary: {
        roundsStarted: history.roundsStarted || 0,
        roundsCompleted: history.roundsCompleted || 0,
        liberalPolicyCount: publicState.liberalPolicyCount || 0,
        fascistPolicyCount: publicState.fascistPolicyCount || 0,
        electionTracker: publicState.electionTracker || 0,
        electionDots: this.createElectionDots(publicState.electionTracker || 0),
      },
      rounds: createHistoryRoundViews(history.rounds || [], seatOrder),
    });
  },

  async loadHistoryAssets() {
    const cachedAssets = this.data.historyAssets || {};
    const hasCachedAssets = Object.keys(HISTORY_ASSET_FILE_IDS).every((key) => Boolean(cachedAssets[key]));
    if (hasCachedAssets || !wx.cloud) {
      return cachedAssets;
    }

    const urlByKey = { ...cachedAssets };
    const fileIds = Object.values(HISTORY_ASSET_FILE_IDS).filter(isCloudFileId);
    try {
      const uniqueFileIds = Array.from(new Set(fileIds));
      const urlByFileId = await resolveTempFileUrls(uniqueFileIds);
      uniqueFileIds.forEach((fileId) => {
        if (!urlByFileId[fileId]) {
          console.error("历史记录页云存储临时链接获取失败", fileId);
        }
      });
      Object.keys(HISTORY_ASSET_FILE_IDS).forEach((key) => {
        const fileId = HISTORY_ASSET_FILE_IDS[key];
        urlByKey[key] = urlByFileId[fileId] || "";
      });
      this.setData({
        historyAssets: urlByKey,
      });
    } catch (err) {
      console.error("历史记录页云存储临时链接获取失败", err);
    }
    return urlByKey;
  },

  createElectionDots(electionTracker) {
    return [1, 2, 3].map((slot) => ({
      slot,
      dotClass: `tracker-dot ${slot <= electionTracker ? "is-active" : ""}`,
    }));
  },

  createServiceError(result, fallbackMessage) {
    const error = (result && result.error) || {};
    const err = new Error(error.message || fallbackMessage);
    err.code = error.code || "";
    err.retryable = Boolean(error.retryable);
    return err;
  },

  onBackBoard() {
    wx.navigateBack({
      fail: () => {
        if (!this.data.roomId) {
          return;
        }
        reLaunchPage(
          `/packageRoom/pages/board/index?roomId=${encodeURIComponent(
            this.data.roomId,
          )}&controlledMemberId=${encodeURIComponent(this.data.controlledMemberId || "")}`,
        );
      },
    });
  },
});
