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
    topSeats: [],
    bottomSeats: [],
    liberalTrack: [],
    fascistTrack: [],
    electionTrack: [],
    statusText: "",
    canVote: false,
    votingSubmitted: false,
    voteProgressText: "",
    voteResult: null,
    voteWaitingText: "",
    isDevRoom: false,
    controlledMemberId: "",
    controlledSeatText: "",
    canNominate: false,
    nominateTargets: [],
    nominateRuleHint: "",
    canDiscardPolicy: false,
    policyCards: [],
    policyPickerTitle: "",
    policyPickerHint: "",
    isSubmittingCommand: false,
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
    const splitIndex = Math.ceil(seats.length / 2);

    this.setData({
      snapshot,
      board,
      topSeats: seats.slice(0, splitIndex),
      bottomSeats: seats.slice(splitIndex),
      liberalTrack: this.createLiberalTrack(board.liberalPolicyCount),
      fascistTrack: this.createFascistTrack(board.targetPlayerCount, board.fascistPolicyCount),
      electionTrack: this.createElectionTrack(board.electionTracker),
      statusText: this.createStatusText(snapshot, board),
      isDevRoom: snapshot.roomMode === "dev",
      controlledSeatText: this.createControlledSeatText(snapshot),
      canVote: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "SUBMIT_VOTE"),
      votingSubmitted: this.hasSubmittedVote(snapshot),
      voteProgressText: this.createVoteProgressText(snapshot),
      voteResult: this.createVoteResult(snapshot),
      voteWaitingText: this.createVoteWaitingText(snapshot),
      canNominate: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "NOMINATE_CHANCELLOR"),
      nominateTargets: this.createNominateTargets(snapshot),
      nominateRuleHint: this.createNominateRuleHint(snapshot),
      canDiscardPolicy: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "PRESIDENT_DISCARD_POLICY"),
      policyCards: this.createPolicyCards(snapshot),
      policyPickerTitle: this.createPolicyPickerTitle(snapshot),
      policyPickerHint: this.createPolicyPickerHint(snapshot),
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
    const chancellorCandidateId = publicState.currentChancellorCandidateId;
    const currentViewerMemberId = snapshot && snapshot.myMemberId;
    const nominationAllowedIds = this.getNominationAllowedIds(snapshot);

    return (publicState.seatOrder || []).map((member) => {
      const roleLabel =
        member.memberId === presidentCandidateId
          ? "总统候选人"
          : member.memberId === chancellorCandidateId
            ? "总理候选人"
            : "";
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
          member.memberId === currentViewerMemberId ? "is-controlled" : ""
        } ${
          member.memberId === chancellorCandidateId ? "is-nominee" : ""
        } ${
          nominationAllowedIds.includes(member.memberId) ? "is-eligible-nominee" : ""
        } ${
          member.isAlive === false ? "is-dead" : ""
        }`,
      };
    });
  },

  createControlledSeatText(snapshot) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const seat = (publicState.seatOrder || []).find((member) => member.memberId === snapshot.myMemberId);
    if (!seat) {
      return "当前操控席位：未知";
    }
    return `当前操控席位：${seat.seatIndex}号 ${seat.displayName}`;
  },

  createNominateTargets(snapshot) {
    const pendingTask = snapshot && snapshot.pendingTask;
    if (!pendingTask || pendingTask.taskType !== "NOMINATE_CHANCELLOR") {
      return [];
    }

    const allowedTargets = pendingTask.allowedTargets || [];
    const targetOptions = pendingTask.meta && Array.isArray(pendingTask.meta.targetOptions) ? pendingTask.meta.targetOptions : [];
    const optionByMemberId = {};
    targetOptions.forEach((option) => {
      optionByMemberId[option.memberId] = option;
    });

    const publicState = (snapshot && snapshot.publicState) || {};
    return (publicState.seatOrder || []).map((member) => {
      const option = optionByMemberId[member.memberId] || {};
      const canNominate =
        typeof option.canNominate === "boolean" ? option.canNominate : allowedTargets.includes(member.memberId);
      const disabledReason = option.disabledReason || (canNominate ? "" : "暂不可提名");

      return {
        memberId: member.memberId,
        label: `${member.seatIndex}号 ${member.displayName}`,
        canNominate,
        disabledReason,
      };
    });
  },

  createNominateRuleHint(snapshot) {
    const pendingTask = snapshot && snapshot.pendingTask;
    if (!pendingTask || pendingTask.taskType !== "NOMINATE_CHANCELLOR") {
      return "";
    }
    return (pendingTask.meta && pendingTask.meta.ruleHint) || "";
  },

  getNominationAllowedIds(snapshot) {
    const pendingTask = snapshot && snapshot.pendingTask;
    if (!pendingTask || pendingTask.taskType !== "NOMINATE_CHANCELLOR") {
      return [];
    }
    return pendingTask.allowedTargets || [];
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
      const voteProgressText = this.createVoteProgressText(snapshot);
      return voteProgressText ? `当前：政府投票中，${voteProgressText}` : "当前：等待所有存活玩家完成政府投票";
    }
    if (snapshot.pendingTask && snapshot.pendingTask.taskType === "PRESIDENT_DISCARD_POLICY") {
      return "当前：你是总统，请从 3 张政策牌中秘密弃掉 1 张";
    }
    if (snapshot.currentPhase === "legislative_president") {
      return `当前：${board.presidentSeatNo}号 ${board.presidentName} 正在秘密处理政策牌`;
    }
    return `当前阶段：${board.phaseName}`;
  },

  hasSubmittedVote(snapshot) {
    const privateState = (snapshot && snapshot.privateState) || {};
    const voting = privateState.voting || {};
    return Boolean(voting.submitted);
  },

  createVoteProgressText(snapshot) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const progress = publicState.voteProgress || null;
    if (!progress) {
      return "";
    }
    return `已投票 ${progress.submittedCount || 0}/${progress.requiredCount || progress.totalCount || 0}`;
  },

  createVoteWaitingText(snapshot) {
    if (snapshot.currentPhase !== "voting" || !this.hasSubmittedVote(snapshot)) {
      return "";
    }
    const privateState = (snapshot && snapshot.privateState) || {};
    const voting = privateState.voting || {};
    const voteText = voting.myVote === "JA" ? "赞成 JA" : voting.myVote === "NEIN" ? "反对 NEIN" : "已提交";
    return `${voteText}，等待其他玩家`;
  },

  createVoteResult(snapshot) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const revealedVotes = Array.isArray(publicState.revealedVotes) ? publicState.revealedVotes : null;
    const result = publicState.voteResult || {};
    if (!revealedVotes) {
      return null;
    }
    const voteRows = revealedVotes.map((item) => ({
      memberId: item.memberId,
      name: item.displayName || "玩家",
      voteText: item.vote === "JA" ? "JA" : "NEIN",
      voteClass: item.vote === "JA" ? "is-ja" : "is-nein",
    }));
    let detailText = `赞成 ${result.jaCount || 0}，反对 ${result.neinCount || 0}`;
    if (result.chaosPolicy) {
      const policyName = result.chaosPolicy.policy === "LIBERAL" ? "自由派政策" : "极权派政策";
      detailText = `${detailText}；三轮未通过，混乱政策颁布：${policyName}`;
    } else if (result.hitlerCheck && result.hitlerCheck.checked) {
      detailText = result.hitlerCheck.passed
        ? `${detailText}；危险阶段检查通过：该总理不是独裁者`
        : `${detailText}；独裁者当选，极权派获胜`;
    } else {
      detailText = `${detailText}；选举轨 ${result.electionTrackerBefore || 0} → ${
        result.electionTrackerAfter || 0
      }`;
    }

    return {
      title: result.passed ? "投票通过" : "投票未通过",
      resultClass: result.passed ? "is-passed" : "is-failed",
      detailText,
      voteRows,
    };
  },

  createPolicyCards(snapshot) {
    const privateState = (snapshot && snapshot.privateState) || {};
    const legislative = privateState.legislative || {};
    const hand = Array.isArray(legislative.hand) ? legislative.hand : [];
    return hand.map((policy, index) => {
      const isLiberal = policy === "LIBERAL";
      return {
        index,
        policy,
        title: isLiberal ? "自由派政策" : "极权派政策",
        mark: isLiberal ? "自" : "极",
        cardClass: `policy-pick-card ${isLiberal ? "is-liberal" : "is-fascist"} ${
          this.data.isSubmittingCommand ? "is-disabled" : ""
        }`,
      };
    });
  },

  createPolicyPickerTitle(snapshot) {
    const privateState = (snapshot && snapshot.privateState) || {};
    const action = privateState.legislative && privateState.legislative.action;
    return action === "discard_one" ? "请选择 1 张弃掉" : "";
  },

  createPolicyPickerHint(snapshot) {
    const pendingTask = snapshot && snapshot.pendingTask;
    if (!pendingTask || pendingTask.taskType !== "PRESIDENT_DISCARD_POLICY") {
      return "";
    }
    return "弃牌不会公开，事后你可以自由陈述。";
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
    if (!this.data.roomId) {
      wx.showToast({
        title: "房间信息缺失",
        icon: "none",
      });
      return;
    }

    wx.navigateTo({
      url: `/packageRoom/pages/identity/index?roomId=${encodeURIComponent(this.data.roomId)}&controlledMemberId=${encodeURIComponent(
        this.data.controlledMemberId || "",
      )}`,
    });
  },

  onTapHistory() {
    wx.showToast({
      title: "历史记录待接入",
      icon: "none",
    });
  },

  onTapSeat(event) {
    const memberId = event.currentTarget.dataset.memberId;
    if (!memberId || !this.data.isDevRoom) {
      return;
    }

    const nextControlledMemberId = memberId === this.data.snapshot.realMemberId ? "" : memberId;
    this.setData({
      controlledMemberId: nextControlledMemberId,
      errorText: "",
    });
    this.loadGameSnapshot();
  },

  async onTapNominate(event) {
    const targetMemberId = event.currentTarget.dataset.memberId;
    const canNominate = event.currentTarget.dataset.canNominate;
    const disabledReason = event.currentTarget.dataset.disabledReason;
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    if (!targetMemberId || this.data.isSubmittingCommand) {
      return;
    }
    if (canNominate !== true && canNominate !== "true") {
      wx.showToast({
        title: disabledReason || "该玩家暂不可提名",
        icon: "none",
      });
      return;
    }

    this.setData({
      isSubmittingCommand: true,
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "gameService",
        data: {
          action: "submitCommand",
          payload: {
            roomId: this.data.roomId,
            controlledMemberId: this.data.controlledMemberId || "",
            commandId: this.createCommandId("nominate_chancellor"),
            expectedVersion: snapshot.version,
            taskId: pendingTask.taskId || "",
            type: "NOMINATE_CHANCELLOR",
            body: {
              targetMemberId,
            },
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "提交提名失败");
      }
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error("提交提名失败", err);
      wx.showToast({
        title: err.message || "提交提名失败",
        icon: "none",
      });
      if (err.code === "VERSION_CONFLICT") {
        this.loadGameSnapshot({ silent: true });
      }
    } finally {
      this.setData({
        isSubmittingCommand: false,
      });
    }
  },

  onVoteJa() {
    this.submitVote("JA");
  },

  onVoteNein() {
    this.submitVote("NEIN");
  },

  async submitVote(vote) {
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    if (!this.data.canVote || this.data.isSubmittingCommand) {
      return;
    }

    const voteText = vote === "JA" ? "赞成 JA" : "反对 NEIN";
    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认投票",
        content: `确定提交${voteText}？投票提交后不能修改。`,
        confirmText: "提交",
        cancelText: "取消",
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!confirmRes.confirm) {
      return;
    }

    this.setData({
      isSubmittingCommand: true,
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "gameService",
        data: {
          action: "submitCommand",
          payload: {
            roomId: this.data.roomId,
            controlledMemberId: this.data.controlledMemberId || "",
            commandId: this.createCommandId("submit_vote"),
            expectedVersion: snapshot.version,
            taskId: pendingTask.taskId || "",
            type: "SUBMIT_VOTE",
            body: {
              vote,
            },
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "提交投票失败");
      }
      wx.showToast({
        title: "投票已提交",
        icon: "none",
      });
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error("提交投票失败", err);
      if (err.code === "VERSION_CONFLICT" || err.code === "DUPLICATE_COMMAND" || err.code === "ACTION_NOT_ALLOWED") {
        await this.loadGameSnapshot({ silent: true });
      }
      wx.showToast({
        title: err.code === "DUPLICATE_COMMAND" ? "投票已提交" : err.message || "提交投票失败",
        icon: "none",
      });
    } finally {
      this.setData({
        isSubmittingCommand: false,
      });
    }
  },

  async onTapDiscardPolicy(event) {
    const discardPolicyIndex = Number(event.currentTarget.dataset.index);
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    const card = this.data.policyCards.find((item) => item.index === discardPolicyIndex);
    if (!this.data.canDiscardPolicy || this.data.isSubmittingCommand || !Number.isInteger(discardPolicyIndex)) {
      return;
    }

    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认弃牌",
        content: `确定秘密弃掉这张${card ? card.title : "政策牌"}？弃牌不会公开，事后可自由陈述。`,
        confirmText: "弃掉",
        cancelText: "取消",
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!confirmRes.confirm) {
      return;
    }

    this.setData({
      isSubmittingCommand: true,
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "gameService",
        data: {
          action: "submitCommand",
          payload: {
            roomId: this.data.roomId,
            controlledMemberId: this.data.controlledMemberId || "",
            commandId: this.createCommandId("president_discard_policy"),
            expectedVersion: snapshot.version,
            taskId: pendingTask.taskId || "",
            type: "PRESIDENT_DISCARD_POLICY",
            body: {
              discardPolicyIndex,
            },
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "提交弃牌失败");
      }
      wx.showToast({
        title: "已交给总理",
        icon: "none",
      });
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error("提交总统弃牌失败", err);
      if (err.code === "VERSION_CONFLICT" || err.code === "ACTION_NOT_ALLOWED") {
        await this.loadGameSnapshot({ silent: true });
      }
      wx.showToast({
        title: err.message || "提交弃牌失败",
        icon: "none",
      });
    } finally {
      this.setData({
        isSubmittingCommand: false,
      });
    }
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
