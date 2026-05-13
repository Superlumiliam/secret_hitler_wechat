const FASCIST_POWER_MAP = {
  5: ["无", "无", "政策预览", "处决", "处决"],
  6: ["无", "无", "政策预览", "处决", "处决"],
  7: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  8: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  9: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
  10: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
};

const POWER_ICON_MAP = {
  无: "○",
  政策预览: "览",
  调查忠诚: "查",
  特别选举: "选",
  处决: "锤",
  极权派胜利: "冠",
};

const PHASE_NAME_MAP = {
  nomination: "总统候选人提名总理",
  voting: "政府投票",
  hitler_check: "独裁者当选检查",
  legislative_president: "总统立法",
  legislative_chancellor: "总理立法",
  veto_response: "总统回应否决",
  executive_action: "总统执行权力",
  round_result: "回合结算",
  game_ended: "对局结束",
};

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

Page({
  refreshTimer: null,

  data: {
    roomId: "",
    isLoading: true,
    errorText: "",
    isLeaving: false,
    snapshot: null,
    board: null,
    leftSeats: [],
    rightSeats: [],
    liberalTrack: [],
    fascistTrack: [],
    electionTrack: [],
    statusText: "",
    canVote: false,
  },

  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
    });
    this.loadGameSnapshot();
  },

  onShow() {
    if (this.data.roomId) {
      this.startRefreshTimer();
    }
  },

  onHide() {
    this.stopRefreshTimer();
  },

  onUnload() {
    this.stopRefreshTimer();
  },

  startRefreshTimer() {
    this.stopRefreshTimer();
    this.refreshTimer = setInterval(() => {
      this.loadGameSnapshot({ silent: true });
    }, 3000);
  },

  stopRefreshTimer() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  async loadGameSnapshot(options = {}) {
    if (!this.data.roomId || !wx.cloud) {
      this.setData({
        isLoading: false,
      });
      return;
    }

    if (!options.silent) {
      this.setData({
        isLoading: true,
        errorText: "",
      });
    }

    try {
      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "getGameSnapshot",
          payload: {
            roomId: this.data.roomId,
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "获取对局数据失败");
      }

      await this.hydrateSnapshot(result.data);
    } catch (err) {
      console.error("获取对局数据失败", err);
      if (!options.silent) {
        this.setData({
          board: null,
          errorText: err.message || "获取对局数据失败",
        });
        wx.showToast({
          title: err.message || "获取对局数据失败",
          icon: "none",
        });
      }
    } finally {
      this.setData({
        isLoading: false,
      });
    }
  },

  async hydrateSnapshot(snapshot) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const seatOrder = publicState.seatOrder || [];
    const cloudFileIds = seatOrder.map((member) => member.avatarUrl).filter(isCloudFileId);
    const avatarUrlByFileId = {};

    if (cloudFileIds.length && wx.cloud) {
      try {
        const tempRes = await wx.cloud.getTempFileURL({
          fileList: Array.from(new Set(cloudFileIds)),
        });
        (tempRes.fileList || []).forEach((file) => {
          if (file.status === 0 && file.tempFileURL) {
            avatarUrlByFileId[file.fileID] = file.tempFileURL;
          }
        });
      } catch (err) {
        console.error("对局头像临时链接获取失败", err);
      }
    }

    const board = this.createBoard(snapshot);
    const seats = this.createSeats(snapshot, avatarUrlByFileId);
    const splitIndex = Math.min(5, seats.length);

    this.setData({
      snapshot,
      board,
      leftSeats: seats.slice(0, splitIndex),
      rightSeats: seats.slice(splitIndex),
      liberalTrack: this.createLiberalTrack(board.liberalPolicyCount),
      fascistTrack: this.createFascistTrack(board.targetPlayerCount, board.fascistPolicyCount),
      electionTrack: this.createElectionTrack(board.electionTracker),
      statusText: this.createStatusText(snapshot, board),
      canVote: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "SUBMIT_VOTE"),
    });
  },

  createBoard(snapshot) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const seatOrder = publicState.seatOrder || [];
    const president = seatOrder.find((member) => member.memberId === publicState.currentPresidentCandidateId);
    const chancellor = seatOrder.find((member) => member.memberId === publicState.currentChancellorCandidateId);

    return {
      roomCode: snapshot.roomCode || "",
      targetPlayerCount: seatOrder.length,
      roundNo: snapshot.round || 1,
      phaseName: PHASE_NAME_MAP[snapshot.currentPhase] || "议会进程",
      presidentSeatNo: president ? president.seatIndex : "",
      presidentName: president ? president.displayName : "待定",
      chancellorSeatNo: chancellor ? chancellor.seatIndex : "",
      chancellorName: chancellor ? chancellor.displayName : "待提名",
      liberalPolicyCount: publicState.liberalPolicyCount || 0,
      fascistPolicyCount: publicState.fascistPolicyCount || 0,
      electionTracker: publicState.electionTracker || 0,
      vetoUnlocked: Boolean(publicState.vetoUnlocked),
    };
  },

  createSeats(snapshot, avatarUrlByFileId) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const presidentCandidateId = publicState.currentPresidentCandidateId;

    return (publicState.seatOrder || []).map((member) => {
      const roleLabel = member.memberId === presidentCandidateId ? "总统候选人" : "";
      const avatarSrc = avatarUrlByFileId[member.avatarUrl] || "";

      return {
        memberId: member.memberId,
        seatNo: member.seatIndex,
        name: member.displayName,
        avatarSrc: isCloudFileId(member.avatarUrl) ? avatarSrc : member.avatarUrl || "",
        roleLabel,
        isAlive: member.isAlive,
        isOffline: member.isOffline,
        seatClass: `seat-card ${member.memberId === presidentCandidateId ? "is-current" : ""} ${
          member.isAlive === false ? "is-dead" : ""
        }`,
      };
    });
  },

  createLiberalTrack(liberalPolicyCount) {
    return Array.from({ length: 5 }, (_, index) => {
      const slot = index + 1;
      const isVictory = slot === 5;
      const isEnacted = slot <= liberalPolicyCount;

      return {
        slot,
        label: isVictory ? "自由派胜利" : String(slot),
        isVictory,
        cellClass: `policy-cell liberal-cell ${isEnacted ? "is-enacted" : ""} ${isVictory ? "is-victory" : ""}`,
      };
    });
  },

  createFascistTrack(targetPlayerCount, fascistPolicyCount) {
    const powers = FASCIST_POWER_MAP[targetPlayerCount] || FASCIST_POWER_MAP[6];

    return Array.from({ length: 6 }, (_, index) => {
      const slot = index + 1;
      const isVictory = slot === 6;
      const isEnacted = slot <= fascistPolicyCount;

      return {
        slot,
        label: isVictory ? "极权派胜利" : String(slot),
        power: isVictory ? "极权派胜利" : powers[index],
        powerIcon: POWER_ICON_MAP[isVictory ? "极权派胜利" : powers[index]],
        isVictory,
        cellClass: `policy-cell fascist-cell ${isEnacted ? "is-enacted" : ""} ${isVictory ? "is-victory" : ""}`,
      };
    });
  },

  createElectionTrack(electionTracker) {
    return Array.from({ length: 3 }, (_, index) => {
      const slot = index + 1;
      return {
        slot,
        cellClass: `election-dot ${slot <= electionTracker ? "is-active" : ""}`,
      };
    });
  },

  createStatusText(snapshot, board) {
    if (snapshot.pendingTask && snapshot.pendingTask.taskType === "NOMINATE_CHANCELLOR") {
      return `当前：${board.presidentSeatNo}号 ${board.presidentName} 正在提名总理候选人`;
    }
    if (snapshot.currentPhase === "nomination") {
      return `当前：${board.presidentSeatNo}号 ${board.presidentName} 是总统候选人，等待提名总理候选人`;
    }
    if (snapshot.currentPhase === "voting") {
      return "当前：等待所有存活玩家完成政府投票";
    }
    return `当前阶段：${board.phaseName}`;
  },

  createServiceError(result, fallbackMessage) {
    const error = (result && result.error) || {};
    const err = new Error(error.message || fallbackMessage);
    err.code = error.code || "";
    err.retryable = Boolean(error.retryable);
    err.isBusinessFailure = true;
    return err;
  },

  onTapRules() {
    wx.showToast({
      title: "规则页待接入",
      icon: "none",
    });
  },

  onTapSettings() {
    wx.showToast({
      title: "设置待接入",
      icon: "none",
    });
  },

  onTapIdentity() {
    wx.showToast({
      title: "身份页待接入",
      icon: "none",
    });
  },

  onTapHistory() {
    wx.showToast({
      title: "历史记录待接入",
      icon: "none",
    });
  },

  onVoteJa() {
    wx.showToast({
      title: "投票流程待接入",
      icon: "none",
    });
  },

  onVoteNein() {
    wx.showToast({
      title: "投票流程待接入",
      icon: "none",
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
