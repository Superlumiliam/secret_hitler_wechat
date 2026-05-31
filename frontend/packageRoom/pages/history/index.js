const OUTCOME_CLASS_BY_TYPE = {
  pending_nomination: "is-pending",
  pending_vote: "is-pending",
  vote_failed: "is-failed",
  pending_legislation: "is-pending",
  liberal_policy: "is-liberal",
  fascist_policy: "is-fascist",
  vetoed: "is-veto",
  chaos_policy: "is-chaos",
  win: "is-win",
};
const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const HISTORY_ASSET_FILE_IDS = {
  background: `${CLOUD_ASSET_ROOT}background-room-prepare.webp`,
  frame: `${CLOUD_ASSET_ROOT}history-frame.webp`,
  ring: `${CLOUD_ASSET_ROOT}history-ring.webp`,
  liberal: `${CLOUD_ASSET_ROOT}history-liberal.webp`,
  fascist: `${CLOUD_ASSET_ROOT}history-fascist.webp`,
};
const {
  GAME_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
} = require("../../../utils/pageTimeout");

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

function getSeatLabel(member, fallback = "待定") {
  if (!member) {
    return fallback;
  }
  return `${member.seatIndex}号`;
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
    if (!this.data.roomId || !wx.cloud) {
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
      syncPageTimeoutDeadline(this, result.data && result.data.expireAt);
      await this.hydrateHistory(result.data);
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
    const memberById = {};
    seatOrder.forEach((member) => {
      memberById[member.memberId] = member;
    });

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
      rounds: this.createRoundViews(history.rounds || [], seatOrder, memberById, historyAssets),
    });
  },

  async loadHistoryAssets() {
    const cachedAssets = this.data.historyAssets || {};
    const hasCachedAssets = Object.keys(HISTORY_ASSET_FILE_IDS).every((key) => Boolean(cachedAssets[key]));
    if (hasCachedAssets || !wx.cloud || !wx.cloud.getTempFileURL) {
      return cachedAssets;
    }

    const urlByKey = { ...cachedAssets };
    const fileIds = Object.values(HISTORY_ASSET_FILE_IDS).filter(isCloudFileId);
    try {
      const tempRes = await wx.cloud.getTempFileURL({
        fileList: Array.from(new Set(fileIds)),
      });
      const urlByFileId = {};
      (tempRes.fileList || []).forEach((file) => {
        if (file.status === 0 && file.tempFileURL) {
          urlByFileId[file.fileID] = file.tempFileURL;
        } else {
          console.error("历史记录页云存储临时链接获取失败", file);
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

  createRoundViews(rounds, seatOrder, memberById, historyAssets = {}) {
    return rounds.map((round) => {
      const president = memberById[round.presidentId] || null;
      const chancellor = memberById[round.chancellorId] || null;
      const outcome = round.outcome || {};
      const voteSummary = round.voteSummary || {};
      const executiveResult = round.executiveResult || null;

      return {
        round: round.round,
        presidentText: getSeatLabel(president),
        chancellorText: getSeatLabel(chancellor, "等待提名"),
        voteText: voteSummary.revealed
          ? `${voteSummary.ja || 0}赞成/${voteSummary.nein || 0}反对`
          : this.getHiddenVoteText(round.status),
        outcomeText: this.createOutcomeText(outcome),
        outcomeClass: `outcome-badge ${OUTCOME_CLASS_BY_TYPE[outcome.type] || "is-pending"}`,
        showPolicyBadge: outcome.type === "liberal_policy" || outcome.type === "fascist_policy",
        outcomeImageSrc: this.getOutcomeImageSrc(outcome, historyAssets),
        executiveResultText: executiveResult && executiveResult.text ? executiveResult.text : "",
        votes: this.createVoteRows(round.votes || [], seatOrder),
      };
    });
  },

  getOutcomeImageSrc(outcome, historyAssets = {}) {
    if (outcome.type === "liberal_policy") {
      return historyAssets.liberal || "";
    }
    if (outcome.type === "fascist_policy") {
      return historyAssets.fascist || "";
    }
    return "";
  },

  getHiddenVoteText(status) {
    if (status === "nominating") {
      return "尚未开始";
    }
    if (status === "voting") {
      return "投票未公开";
    }
    return "未公开";
  },

  createOutcomeText(outcome) {
    return outcome.label || "等待进展";
  },

  createVoteRows(votes, seatOrder) {
    const voteByMemberId = {};
    votes.forEach((vote) => {
      voteByMemberId[vote.memberId] = vote.state;
    });

    return seatOrder.map((member) => {
      const state = voteByMemberId[member.memberId] || (member.isAlive === false ? "dead" : "not_started");
      return {
        memberId: member.memberId,
        seatIndex: member.seatIndex,
        state,
        mark: this.getVoteMark(state),
        cellClass: `vote-cell is-${state}`,
      };
    });
  },

  getVoteMark(state) {
    if (state === "ja") {
      return "✔";
    }
    if (state === "nein") {
      return "×";
    }
    if (state === "dead") {
      return "出";
    }
    if (state === "pending") {
      return "…";
    }
    return "·";
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
        wx.redirectTo({
          url: `/packageRoom/pages/board/index?roomId=${encodeURIComponent(
            this.data.roomId,
          )}&controlledMemberId=${encodeURIComponent(this.data.controlledMemberId || "")}`,
        });
      },
    });
  },
});
