const FASCIST_POWER_MAP = {
  5: ["无", "无", "政策预览", "处决", "处决"],
  6: ["无", "无", "政策预览", "处决", "处决"],
  7: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  8: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  9: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
  10: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
};

const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";

const POLICY_TRACK_ASSET_FILE_IDS = {
  liberalBg: `${CLOUD_ASSET_ROOT}policy-track-liberal-bg.webp`,
  authoritarianBg: `${CLOUD_ASSET_ROOT}policy-track-authoritarian-bg.webp`,
  liberalCard: `${CLOUD_ASSET_ROOT}policy-card-liberal.webp`,
  authoritarianCard: `${CLOUD_ASSET_ROOT}policy-card-authoritarian.webp`,
  liberalSlot: `${CLOUD_ASSET_ROOT}slot-empty-liberal.webp`,
  authoritarianSlot: `${CLOUD_ASSET_ROOT}slot-empty-authoritarian.webp`,
  execution: `${CLOUD_ASSET_ROOT}power-badge-execution.webp`,
  investigate: `${CLOUD_ASSET_ROOT}power-badge-investigate.webp`,
  policyPeek: `${CLOUD_ASSET_ROOT}power-badge-policy-peek.webp`,
  specialElection: `${CLOUD_ASSET_ROOT}power-badge-special-election.webp`,
  playerSeat: `${CLOUD_ASSET_ROOT}player-seat.webp`,
  playerTabletPresident: `${CLOUD_ASSET_ROOT}player-tablet-president.webp`,
  playerTabletMinister: `${CLOUD_ASSET_ROOT}player-tablet-minister.webp`,
  stampFascist: `${CLOUD_ASSET_ROOT}stamp-fascist.webp`,
  stampLiberal: `${CLOUD_ASSET_ROOT}stamp-liberal.webp`,
  liberalBadge: `${CLOUD_ASSET_ROOT}icon-liberal-badge.webp`,
  authoritarianBadge: `${CLOUD_ASSET_ROOT}icon-authoritarian-badge.webp`,
  modalFrameMobile: `${CLOUD_ASSET_ROOT}modal-frame-mobile.webp`,
  modalCancelButtonMobile: `${CLOUD_ASSET_ROOT}modal-cancel-button-mobile.webp`,
  defaultAvatar: `${CLOUD_ASSET_ROOT}man-in-black.webp`,
};

const POWER_BADGE_ASSET_KEY_MAP = {
  政策预览: "policyPeek",
  调查忠诚: "investigate",
  特别选举: "specialElection",
  处决: "execution",
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

const ERROR_MESSAGE_MAP = {
  VERSION_CONFLICT: "局势已更新，请按最新页面操作",
  PHASE_MISMATCH: "当前阶段已变化，请按最新页面操作",
  FORBIDDEN: "你当前不能执行该操作",
  ALREADY_ACTED: "你已经完成过该操作",
  ACTION_NOT_ALLOWED: "当前局势不允许执行该操作",
  ROOM_NOT_FOUND: "房间不存在或已失效",
  ROOM_EXPIRED: "房间已过期",
  NOT_ROOM_MEMBER: "当前用户不在房间中",
  GAME_NOT_STARTED: "房间尚未开局",
  GAME_ALREADY_ENDED: "对局已结束",
  INVALID_PAYLOAD: "请求参数有误",
  DUPLICATE_COMMAND: "该操作已提交，请勿重复操作",
  NOT_CURRENT_ACTOR: "当前不是你的操作阶段",
  INVALID_TARGET: "目标不符合当前规则",
  TARGET_ALREADY_DEAD: "目标已出局",
  TARGET_ALREADY_INVESTIGATED: "该玩家已被调查过",
  INTERNAL_ERROR: "服务暂时异常，请稍后再试",
};

const GAME_POLL_INTERVAL_MS = 1500;
const GAME_POLL_WITH_TASK_INTERVAL_MS = 1000;
const GAME_POLL_AFTER_COMMAND_INTERVAL_MS = 800;
const COMMAND_REFRESH_WINDOW_MS = 5000;
const REFRESH_AFTER_COMMAND_ERROR_CODES = [
  "VERSION_CONFLICT",
  "PHASE_MISMATCH",
  "DUPLICATE_COMMAND",
  "ALREADY_ACTED",
  "FORBIDDEN",
  "ACTION_NOT_ALLOWED",
  "NOT_CURRENT_ACTOR",
  "INVALID_TARGET",
  "TARGET_ALREADY_DEAD",
  "TARGET_ALREADY_INVESTIGATED",
];

function isRoomUnavailableError(err) {
  return Boolean(err && ["ROOM_EXPIRED", "ROOM_NOT_FOUND", "NOT_ROOM_MEMBER"].includes(err.code));
}

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

Page({
  refreshTimer: null,
  lastSeatTap: null,
  lastCommandSettledAt: 0,

  data: {
    roomId: "",
    isLoading: true,
    errorText: "",
    isLeaving: false,
    snapshot: null,
    board: null,
    seats: [],
    avatarTempUrlByFileId: {},
    policyAssets: {},
    activePowerTipSlot: 0,
    liberalTrack: [],
    fascistTrack: [],
    electionTrack: [],
    statusText: "",
    phaseHintText: "",
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
    selectedNominationTargetId: "",
    selectedNominationTargetLabel: "",
    activeIdentityPickerMemberId: "",
    activeIdentityPickerOptions: [],
    identityJudgmentByMemberId: {},
    canDiscardPolicy: false,
    canEnactPolicy: false,
    canPickPolicy: false,
    canRequestVeto: false,
    canRespondVeto: false,
    vetoResponse: null,
    policyCards: [],
    policyPickerTitle: "",
    policyPickerHint: "",
    executiveAction: null,
    canExecuteAction: false,
    executiveTargets: [],
    policyPeekCards: [],
    investigationResult: null,
    isSubmittingCommand: false,
  },

  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
      controlledMemberId: options.controlledMemberId || "",
    });
    setupPageTimeout(this, {
      timeoutMs: GAME_PAGE_TIMEOUT_MS,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    this.loadGameSnapshot();
  },

  onShow() {
    schedulePageTimeout(this, {
      timeoutMs: GAME_PAGE_TIMEOUT_MS,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    if (this.data.roomId) {
      this.loadGameSnapshot({ silent: true });
      this.startRefreshTimer();
    }
  },

  onHide() {
    this.stopRefreshTimer();
    clearPageTimeout(this);
  },

  onUnload() {
    this.stopRefreshTimer();
    clearPageTimeout(this);
  },

  startRefreshTimer() {
    this.stopRefreshTimer();
    this.refreshTimer = setInterval(() => {
      this.loadGameSnapshot({ silent: true });
    }, this.getPollIntervalMs());
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
      if (this.redirectToResultIfNeeded(result.data)) {
        return;
      }

      syncPageTimeoutDeadline(this, result.data && result.data.expireAt, {
        beforeRedirect: () => this.stopRefreshTimer(),
      });
      await this.hydrateSnapshot(result.data);
      if (this.refreshTimer) {
        this.startRefreshTimer();
      }
    } catch (err) {
      console.error("获取对局数据失败", err);
      if (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND" || err.code === "NOT_ROOM_MEMBER") {
        handlePageTimeout(this, {
          reasonCode: err.code,
          beforeRedirect: () => this.stopRefreshTimer(),
        });
        return;
      }

      if (err.code === "GAME_ALREADY_ENDED") {
        this.redirectToResult();
        return;
      }
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
    if (this.redirectToResultIfNeeded(snapshot)) {
      return;
    }

    const publicState = (snapshot && snapshot.publicState) || {};
    const seatOrder = publicState.seatOrder || [];
    const cachedPolicyAssets = this.data.policyAssets || {};
    const hasCachedPolicyAssets = Object.keys(POLICY_TRACK_ASSET_FILE_IDS).every((key) => Boolean(cachedPolicyAssets[key]));
    const policyAssetFileIds = Object.values(POLICY_TRACK_ASSET_FILE_IDS);
    const cloudFileIds = seatOrder
      .map((member) => member.avatarUrl)
      .filter(isCloudFileId)
      .concat(hasCachedPolicyAssets ? [] : policyAssetFileIds);
    const avatarUrlByFileId = {};
    const policyAssetUrlByKey = { ...cachedPolicyAssets };

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
        if (!hasCachedPolicyAssets) {
          Object.keys(POLICY_TRACK_ASSET_FILE_IDS).forEach((key) => {
            const fileId = POLICY_TRACK_ASSET_FILE_IDS[key];
            policyAssetUrlByKey[key] = avatarUrlByFileId[fileId] || "";
          });
        }
      } catch (err) {
        console.error("对局图片临时链接获取失败", err);
      }
    }

    const board = this.createBoard(snapshot);
    const identityJudgmentByMemberId = this.readIdentityJudgments(snapshot);
    const seats = this.createSeats(snapshot, avatarUrlByFileId, identityJudgmentByMemberId, policyAssetUrlByKey);
    const activeIdentityPickerOptions = this.createActiveIdentityPickerOptions(
      this.data.activeIdentityPickerMemberId,
      snapshot,
      identityJudgmentByMemberId,
      policyAssetUrlByKey,
    );
    const previousBoard = this.data.board || {};
    const shouldAnimateNewPolicy = Boolean(this.data.snapshot);
    const newLiberalPolicySlot =
      shouldAnimateNewPolicy && board.liberalPolicyCount > (previousBoard.liberalPolicyCount || 0)
        ? board.liberalPolicyCount
        : 0;
    const newFascistPolicySlot =
      shouldAnimateNewPolicy && board.fascistPolicyCount > (previousBoard.fascistPolicyCount || 0)
        ? board.fascistPolicyCount
        : 0;

    this.setData({
      snapshot,
      board,
      seats,
      avatarTempUrlByFileId: avatarUrlByFileId,
      policyAssets: policyAssetUrlByKey,
      liberalTrack: this.createLiberalTrack(board.liberalPolicyCount, policyAssetUrlByKey, newLiberalPolicySlot),
      fascistTrack: this.createFascistTrack(
        board.targetPlayerCount,
        board.fascistPolicyCount,
        policyAssetUrlByKey,
        newFascistPolicySlot,
      ),
      electionTrack: this.createElectionTrack(board.electionTracker),
      statusText: this.createStatusText(snapshot, board),
      phaseHintText: this.createPhaseHintText(snapshot, board),
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
      selectedNominationTargetId: this.resolveSelectedNominationTargetId(snapshot),
      selectedNominationTargetLabel: this.createSelectedNominationTargetLabel(snapshot),
      identityJudgmentByMemberId,
      activeIdentityPickerOptions,
      canDiscardPolicy: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "PRESIDENT_DISCARD_POLICY"),
      canEnactPolicy: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "CHANCELLOR_ENACT_POLICY"),
      canPickPolicy: Boolean(
        snapshot.pendingTask &&
          ["PRESIDENT_DISCARD_POLICY", "CHANCELLOR_ENACT_POLICY"].includes(snapshot.pendingTask.taskType),
      ),
      canRequestVeto: this.canRequestVeto(snapshot),
      canRespondVeto: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "PRESIDENT_RESPOND_VETO"),
      vetoResponse: this.createVetoResponse(snapshot),
      policyCards: this.createPolicyCards(snapshot),
      policyPickerTitle: this.createPolicyPickerTitle(snapshot),
      policyPickerHint: this.createPolicyPickerHint(snapshot),
      executiveAction: this.createExecutiveAction(snapshot),
      canExecuteAction: Boolean(
        snapshot.pendingTask &&
          ["EXEC_INVESTIGATE", "EXEC_SPECIAL_ELECTION", "EXEC_POLICY_PEEK_ACK", "EXECUTE_PLAYER"].includes(
            snapshot.pendingTask.taskType,
          ),
      ),
      executiveTargets: this.createExecutiveTargets(snapshot),
      policyPeekCards: this.createPolicyPeekCards(snapshot),
      investigationResult: this.createInvestigationResult(snapshot),
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
      deckPiles: this.createDeckPiles(publicState.policyDeck),
      electionTracker: publicState.electionTracker || 0,
      vetoUnlocked: Boolean(publicState.vetoUnlocked),
      executiveActionType: publicState.executiveActionType || "",
      nextSpecialPresidentCandidateId: publicState.nextSpecialPresidentCandidateId || "",
    };
  },

  createDeckPiles(policyDeck) {
    const drawCount = Math.max(0, Number(policyDeck && policyDeck.drawCount) || 0);
    const discardCount = Math.max(0, Number(policyDeck && policyDeck.discardCount) || 0);

    return [
      {
        key: "draw",
        label: "抽牌堆",
        count: drawCount,
        pileClass: `deck-pile is-draw ${drawCount > 0 ? "has-cards" : "is-empty"}`,
        countText: `${drawCount} 张`,
      },
      {
        key: "discard",
        label: "弃牌堆",
        count: discardCount,
        pileClass: `deck-pile is-discard ${discardCount > 0 ? "has-cards" : "is-empty"}`,
        countText: `${discardCount} 张`,
      },
    ];
  },

  createSeats(snapshot, avatarUrlByFileId, identityJudgmentByMemberId = {}, assets = {}) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const presidentCandidateId = publicState.currentPresidentCandidateId;
    const chancellorCandidateId = publicState.currentChancellorCandidateId;
    const currentViewerMemberId = snapshot && snapshot.myMemberId;
    const nominationAllowedIds = this.getNominationAllowedIds(snapshot);
    const nominateTargetByMemberId = this.createNominateTargetMap(snapshot);
    const investigationMarkByMemberId = this.createInvestigationMarkMap(snapshot);
    const privateIdentity = ((snapshot && snapshot.privateState) || {}).identity || {};
    const selectedNominationTargetId = this.resolveSelectedNominationTargetId(snapshot);

    return (publicState.seatOrder || []).map((member) => {
      const roleLabel =
        member.memberId === presidentCandidateId
          ? "总统候选人"
          : member.memberId === chancellorCandidateId
            ? "总理候选人"
            : "";
      const roleBadgeSrc =
        member.memberId === presidentCandidateId
          ? assets.playerTabletPresident || POLICY_TRACK_ASSET_FILE_IDS.playerTabletPresident
          : member.memberId === chancellorCandidateId
            ? assets.playerTabletMinister || POLICY_TRACK_ASSET_FILE_IDS.playerTabletMinister
            : "";
      const avatarSrc = avatarUrlByFileId[member.avatarUrl] || "";
      const defaultAvatarSrc = assets.defaultAvatar || POLICY_TRACK_ASSET_FILE_IDS.defaultAvatar;
      const isSelf = member.memberId === currentViewerMemberId;
      const targetOption = nominateTargetByMemberId[member.memberId] || null;
      const canNominateTarget = targetOption ? targetOption.canNominate : nominationAllowedIds.includes(member.memberId);
      const judgment = isSelf ? privateIdentity.party || "UNKNOWN" : identityJudgmentByMemberId[member.memberId] || "UNKNOWN";
      const identityMark = this.createIdentityMarkView(judgment, isSelf, assets);
      const investigationMark = investigationMarkByMemberId[member.memberId] || null;

      return {
        memberId: member.memberId,
        seatNo: member.seatIndex,
        name: member.displayName,
        avatarSrc: (isCloudFileId(member.avatarUrl) ? avatarSrc : member.avatarUrl || "") || defaultAvatarSrc,
        roleLabel,
        roleBadgeSrc,
        isSelf,
        isAlive: member.isAlive,
        isOffline: member.isOffline,
        canChangeIdentityMark: !isSelf,
        identityMark,
        investigationStampSrc: investigationMark ? this.getInvestigationStampSrc(investigationMark.party, assets) : "",
        investigationStampLabel: investigationMark ? (investigationMark.party === "LIBERAL" ? "自由派" : "极权派") : "",
        seatClass: `seat-card ${member.memberId === presidentCandidateId ? "is-current" : ""} ${
          isSelf ? "is-controlled" : ""
        } ${
          member.memberId === chancellorCandidateId ? "is-nominee" : ""
        } ${
          nominationAllowedIds.includes(member.memberId) ? "is-eligible-nominee" : ""
        } ${
          targetOption && !canNominateTarget ? "is-ineligible-nominee" : ""
        } ${
          selectedNominationTargetId === member.memberId ? "is-selected-nomination" : ""
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

  createNominateTargetMap(snapshot) {
    const targets = this.createNominateTargets(snapshot);
    return targets.reduce((map, target) => {
      map[target.memberId] = target;
      return map;
    }, {});
  },

  resolveSelectedNominationTargetId(snapshot) {
    if (!(snapshot && snapshot.pendingTask && snapshot.pendingTask.taskType === "NOMINATE_CHANCELLOR")) {
      return "";
    }
    const selected = this.data.selectedNominationTargetId || "";
    if (!selected) {
      return "";
    }
    const publicState = snapshot.publicState || {};
    const exists = (publicState.seatOrder || []).some((member) => member.memberId === selected);
    return exists ? selected : "";
  },

  createSelectedNominationTargetLabel(snapshot) {
    const selected = this.resolveSelectedNominationTargetId(snapshot);
    if (!selected) {
      return "";
    }
    const target = this.createNominateTargets(snapshot).find((item) => item.memberId === selected);
    return target ? target.label : "";
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

  createInvestigationMarkMap(snapshot) {
    const privateState = (snapshot && snapshot.privateState) || {};
    const marks = Array.isArray(privateState.investigationMarks) ? privateState.investigationMarks : [];
    return marks.reduce((map, mark) => {
      if (mark && mark.targetMemberId && mark.party) {
        map[mark.targetMemberId] = mark;
      }
      return map;
    }, {});
  },

  getInvestigationStampSrc(party, assets = {}) {
    return party === "LIBERAL" ? assets.stampLiberal || "" : assets.stampFascist || "";
  },

  createIdentityMarkView(judgment, isSelf, assets = {}) {
    const normalized = judgment === "LIBERAL" || judgment === "FASCIST" ? judgment : "UNKNOWN";
    if (normalized === "LIBERAL") {
      return {
        state: normalized,
        label: isSelf ? "你的真实阵营：自由派" : "你标记为自由派",
        iconSrc: assets.liberalBadge || "",
        className: "identity-mark is-liberal",
      };
    }
    if (normalized === "FASCIST") {
      return {
        state: normalized,
        label: isSelf ? "你的真实阵营：极权派" : "你标记为极权派",
        iconSrc: assets.authoritarianBadge || "",
        className: "identity-mark is-fascist",
      };
    }
    return {
      state: "UNKNOWN",
      label: "身份判断未知",
      iconSrc: "",
      className: "identity-mark is-unknown",
    };
  },

  createIdentityPickerOptions(memberId, currentJudgment, assets = {}) {
    return [
      {
        memberId,
        value: "UNKNOWN",
        label: "无",
        iconSrc: "",
        optionClass: `identity-option is-unknown ${currentJudgment === "UNKNOWN" || !currentJudgment ? "is-active" : ""}`,
      },
      {
        memberId,
        value: "LIBERAL",
        label: "自由派",
        iconSrc: assets.liberalBadge || "",
        optionClass: `identity-option is-liberal ${currentJudgment === "LIBERAL" ? "is-active" : ""}`,
      },
      {
        memberId,
        value: "FASCIST",
        label: "极权派",
        iconSrc: assets.authoritarianBadge || "",
        optionClass: `identity-option is-fascist ${currentJudgment === "FASCIST" ? "is-active" : ""}`,
      },
    ];
  },

  createActiveIdentityPickerOptions(
    memberId,
    snapshot = this.data.snapshot,
    judgments = this.data.identityJudgmentByMemberId || {},
    assets = this.data.policyAssets || {},
  ) {
    if (!memberId || !snapshot || memberId === snapshot.myMemberId) {
      return [];
    }
    const currentJudgment = judgments[memberId] || "UNKNOWN";
    return this.createIdentityPickerOptions(memberId, currentJudgment, assets);
  },

  readIdentityJudgments(snapshot) {
    const key = this.createIdentityJudgmentStorageKey(snapshot);
    if (!key) {
      return {};
    }
    try {
      const stored = wx.getStorageSync(key);
      return stored && typeof stored === "object" ? stored : {};
    } catch (err) {
      console.error("读取身份判断标记失败", err);
      return {};
    }
  },

  writeIdentityJudgments(snapshot, judgments) {
    const key = this.createIdentityJudgmentStorageKey(snapshot);
    if (!key) {
      return;
    }
    try {
      wx.setStorageSync(key, judgments || {});
    } catch (err) {
      console.error("保存身份判断标记失败", err);
      wx.showToast({
        title: "标记保存失败",
        icon: "none",
      });
    }
  },

  createIdentityJudgmentStorageKey(snapshot) {
    const roomId = (snapshot && snapshot.roomId) || this.data.roomId || "";
    const viewerMemberId = snapshot && snapshot.myMemberId;
    if (!roomId || !viewerMemberId) {
      return "";
    }
    return `board_identity_judgments:${roomId}:${viewerMemberId}`;
  },

  createLiberalTrack(liberalPolicyCount, assets = {}, newPolicySlot = 0) {
    return Array.from({ length: 5 }, (_, index) => {
      const slot = index + 1;
      const isVictory = slot === 5;
      const isEnacted = slot <= liberalPolicyCount;
      const cardSrc = isEnacted ? assets.liberalCard : assets.liberalSlot;

      return {
        slot,
        label: isVictory ? "自由派胜利" : String(slot),
        isVictory,
        isEnacted,
        cardSrc,
        cellClass: [
          "policy-cell",
          "liberal-cell",
          isEnacted ? "is-enacted" : "is-empty",
          slot === newPolicySlot ? "is-new-policy" : "",
          isVictory ? "is-victory" : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    });
  },

  createFascistTrack(targetPlayerCount, fascistPolicyCount, assets = {}, newPolicySlot = 0) {
    const powers = FASCIST_POWER_MAP[targetPlayerCount] || FASCIST_POWER_MAP[6];

    return Array.from({ length: 6 }, (_, index) => {
      const slot = index + 1;
      const isVictory = slot === 6;
      const isEnacted = slot <= fascistPolicyCount;
      const power = isVictory ? "极权派胜利" : powers[index];
      const powerBadgeAssetKey = POWER_BADGE_ASSET_KEY_MAP[power] || "";
      const cardSrc = isEnacted ? assets.authoritarianCard : assets.authoritarianSlot;

      return {
        slot,
        label: isVictory ? "极权派胜利" : String(slot),
        power,
        powerBadgeSrc: powerBadgeAssetKey ? assets[powerBadgeAssetKey] : "",
        isEnacted,
        isVictory,
        cardSrc,
        cellClass: [
          "policy-cell",
          "fascist-cell",
          isEnacted ? "is-enacted" : "is-empty",
          slot === newPolicySlot ? "is-new-policy" : "",
          isVictory ? "is-victory" : "",
        ]
          .filter(Boolean)
          .join(" "),
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
    if (snapshot.pendingTask && snapshot.pendingTask.taskType === "CHANCELLOR_ENACT_POLICY") {
      return this.canRequestVeto(snapshot)
        ? "当前：你是总理，请颁布 1 张政策，或提出否决"
        : "当前：你是总理，请从 2 张政策牌中秘密颁布 1 张";
    }
    if (snapshot.currentPhase === "legislative_chancellor") {
      return `当前：${board.chancellorSeatNo}号 ${board.chancellorName} 正在秘密处理政策牌`;
    }
    if (snapshot.pendingTask && snapshot.pendingTask.taskType === "PRESIDENT_RESPOND_VETO") {
      return "当前：总理提出否决，请你决定是否同意";
    }
    if (snapshot.currentPhase === "veto_response") {
      return `当前：${board.chancellorSeatNo}号 ${board.chancellorName} 提出否决，等待总统回应`;
    }
    if (snapshot.currentPhase === "executive_action") {
      const action = this.createExecutiveAction(snapshot);
      if (snapshot.pendingTask && action) {
        return `当前：你是总统，请执行${action.title}`;
      }
      if (action && action.waitingText) {
        return action.waitingText;
      }
      return `当前：${board.presidentSeatNo}号 ${board.presidentName} 正在执行总统权力`;
    }
    return `当前阶段：${board.phaseName}`;
  },

  createPhaseHintText(snapshot, board) {
    const pendingTask = snapshot.pendingTask || null;
    const taskType = pendingTask && pendingTask.taskType;
    const action = this.createExecutiveAction(snapshot);

    if (taskType === "NOMINATE_CHANCELLOR") {
      return "你负责提名总理候选人；其他玩家可继续讨论，只有最终提名会公开。";
    }
    if (snapshot.currentPhase === "nomination") {
      return `${board.presidentSeatNo}号等待提名总理；其他玩家可讨论局势，暂时不需要提交操作。`;
    }
    if (snapshot.currentPhase === "voting") {
      return "所有存活玩家同时投票；提交前彼此看不到选择，公开后会显示每个人的票。";
    }
    if (snapshot.currentPhase === "hitler_check") {
      return "政府已通过，正在结算危险胜利条件；不会公开真实身份，只公开是否触发终局。";
    }
    if (taskType === "PRESIDENT_DISCARD_POLICY") {
      return "你秘密摸 3 弃 1；其他人等待，手牌与弃牌都不会公开。";
    }
    if (snapshot.currentPhase === "legislative_president") {
      return "总统正在秘密处理政策牌；其他玩家等待，不能看到总统手牌或弃牌。";
    }
    if (taskType === "CHANCELLOR_ENACT_POLICY") {
      return this.canRequestVeto(snapshot)
        ? "你可颁布 1 张政策或请求否决；未颁布的牌不会公开。"
        : "你秘密从 2 张中颁布 1 张；另一张弃牌不会公开。";
    }
    if (snapshot.currentPhase === "legislative_chancellor") {
      return "总理正在秘密处理政策牌；其他玩家等待，只会公开最终颁布的政策。";
    }
    if (taskType === "PRESIDENT_RESPOND_VETO") {
      return "你决定是否同意否决；同意则本轮无政策颁布，拒绝则总理必须颁布。";
    }
    if (snapshot.currentPhase === "veto_response") {
      return "总理已提出否决，等待总统回应；总理手中政策牌内容不会公开。";
    }
    if (snapshot.currentPhase === "executive_action") {
      if (taskType === "EXEC_POLICY_PEEK_ACK") {
        return "你秘密查看牌库顶 3 张并按原顺序放回；牌面不会公开。";
      }
      if (taskType === "EXEC_INVESTIGATE") {
        return "你选择调查对象并秘密查看其党派归属；结果是否公开由你发言决定。";
      }
      if (taskType === "EXEC_SPECIAL_ELECTION") {
        return "你指定下一轮特别总统候选人；该选择会公开，但不会永久改变轮换顺序。";
      }
      if (taskType === "EXECUTE_PLAYER") {
        return "你选择处决 1 名玩家；只有处决到独裁者时才会公开并立即终局。";
      }
      return `${board.presidentSeatNo}号正在执行${(action && action.title) || "总统权力"}；其他玩家等待，私密结果不会自动公开。`;
    }
    if (snapshot.currentPhase === "round_result") {
      return "本轮公开结算中；隐藏身份、弃牌和调查结果仍不公开。";
    }
    if (snapshot.currentPhase === "game_ended") {
      return "对局已结束，可进入复盘查看最终身份与关键时间线。";
    }
    return "当前无需主动操作；按桌面公开信息讨论，隐藏信息仍由玩家自行陈述。";
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
    if (action === "discard_one") {
      return "请选择 1 张弃掉";
    }
    if (action === "enact_one") {
      return "请选择 1 张颁布";
    }
    return "";
  },

  createPolicyPickerHint(snapshot) {
    const pendingTask = snapshot && snapshot.pendingTask;
    if (!pendingTask) {
      return "";
    }
    if (pendingTask.taskType === "PRESIDENT_DISCARD_POLICY") {
      return "弃牌不会公开，事后你可以自由陈述。";
    }
    if (pendingTask.taskType === "CHANCELLOR_ENACT_POLICY") {
      return this.canRequestVeto(snapshot)
        ? "否决需要总统同意；若总统拒绝，你仍必须颁布 1 张政策。"
        : "只公开最终颁布的政策，另一张弃牌不会公开。";
    }
    return "";
  },

  canRequestVeto(snapshot) {
    const pendingTask = snapshot && snapshot.pendingTask;
    const privateState = (snapshot && snapshot.privateState) || {};
    const legislative = privateState.legislative || {};
    return Boolean(
      pendingTask &&
        pendingTask.taskType === "CHANCELLOR_ENACT_POLICY" &&
        (legislative.canRequestVeto || (pendingTask.meta && pendingTask.meta.canRequestVeto)),
    );
  },

  createVetoResponse(snapshot) {
    if (!snapshot || snapshot.currentPhase !== "veto_response") {
      return null;
    }
    const publicState = snapshot.publicState || {};
    const seatOrder = publicState.seatOrder || [];
    const president = seatOrder.find((member) => member.memberId === publicState.currentPresidentId);
    const chancellor = seatOrder.find((member) => member.memberId === publicState.currentChancellorId);
    const pendingTask = snapshot.pendingTask || {};
    const trackerBefore =
      (pendingTask.meta && Number.isFinite(Number(pendingTask.meta.electionTrackerBefore))
        ? Number(pendingTask.meta.electionTrackerBefore)
        : publicState.electionTracker) || 0;
    const trackerAfter = Math.min(3, trackerBefore + 1);
    return {
      title: "否决请求",
      presidentName: president ? `${president.seatIndex}号 ${president.displayName}` : "总统",
      chancellorName: chancellor ? `${chancellor.seatIndex}号 ${chancellor.displayName}` : "总理",
      hint: `${chancellor ? `${chancellor.seatIndex}号 ${chancellor.displayName}` : "总理"} 提出否决。若总统同意，本轮不颁布政策，选举轨 ${trackerBefore} → ${trackerAfter}。`,
    };
  },

  createExecutiveAction(snapshot) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const pendingTask = snapshot && snapshot.pendingTask;
    const taskType = pendingTask && pendingTask.taskType;
    const actionType = publicState.executiveActionType || "";
    const seatOrder = publicState.seatOrder || [];
    const president = seatOrder.find((member) => member.memberId === publicState.currentPresidentId);
    const presidentName = president ? `${president.seatIndex}号 ${president.displayName}` : "总统";
    const titleByType = {
      INVESTIGATE: "调查忠诚",
      SPECIAL_ELECTION: "特别选举",
      POLICY_PEEK: "政策预览",
      EXECUTION: "处决玩家",
    };
    const taskTitleByType = {
      EXEC_INVESTIGATE: "调查忠诚",
      EXEC_SPECIAL_ELECTION: "特别选举",
      EXEC_POLICY_PEEK_ACK: "政策预览",
      EXECUTE_PLAYER: "处决玩家",
    };
    const title = (pendingTask && pendingTask.meta && pendingTask.meta.actionTitle) || taskTitleByType[taskType] || titleByType[actionType] || "";
    if (!title && snapshot.currentPhase !== "executive_action") {
      return null;
    }

    let waitingText = `${presidentName} 正在执行${title || "总统权力"}`;
    if (actionType === "SPECIAL_ELECTION" && publicState.nextSpecialPresidentCandidateId) {
      const forced = seatOrder.find((member) => member.memberId === publicState.nextSpecialPresidentCandidateId);
      if (forced) {
        waitingText = `${presidentName} 正在发动特别选举，下一任特别总统候选人将是 ${forced.seatIndex}号 ${forced.displayName}`;
      }
    }

    return {
      title,
      hint: (pendingTask && pendingTask.meta && pendingTask.meta.actionHint) || "",
      confirmText: (pendingTask && pendingTask.meta && (pendingTask.meta.confirmText || pendingTask.meta.dangerConfirmText)) || "确认",
      taskType: taskType || "",
      actionType,
      waitingText,
    };
  },

  createExecutiveTargets(snapshot) {
    const pendingTask = snapshot && snapshot.pendingTask;
    if (
      !pendingTask ||
      !["EXEC_INVESTIGATE", "EXEC_SPECIAL_ELECTION", "EXECUTE_PLAYER"].includes(pendingTask.taskType)
    ) {
      return [];
    }
    const allowedTargets = pendingTask.allowedTargets || [];
    const publicState = (snapshot && snapshot.publicState) || {};
    return (publicState.seatOrder || []).map((member) => {
      const canTarget = allowedTargets.includes(member.memberId);
      return {
        memberId: member.memberId,
        label: `${member.seatIndex}号 ${member.displayName}`,
        canTarget,
        disabledReason: member.isAlive === false ? "已出局" : canTarget ? "" : "暂不可选择",
      };
    });
  },

  createPolicyPeekCards(snapshot) {
    const privateState = (snapshot && snapshot.privateState) || {};
    const policyPeek = privateState.policyPeek || {};
    const cards = Array.isArray(policyPeek.cards) ? policyPeek.cards : [];
    return cards.map((policy, index) => {
      const isLiberal = policy === "LIBERAL";
      return {
        index,
        policy,
        title: isLiberal ? "自由派政策" : "极权派政策",
        mark: isLiberal ? "自" : "极",
        cardClass: `policy-pick-card ${isLiberal ? "is-liberal" : "is-fascist"}`,
      };
    });
  },

  createInvestigationResult(snapshot) {
    const privateState = (snapshot && snapshot.privateState) || {};
    const result = privateState.investigationResult || null;
    if (!result) {
      return null;
    }
    return {
      targetName: result.targetDisplayName || "目标玩家",
      partyText: result.party === "LIBERAL" ? "自由派" : "极权派",
      partyClass: result.party === "LIBERAL" ? "is-liberal-text" : "is-fascist-text",
    };
  },

  createServiceError(result, fallbackMessage) {
    const error = (result && result.error) || {};
    const code = error.code || "";
    const err = new Error(ERROR_MESSAGE_MAP[code] || error.message || fallbackMessage || "操作失败");
    err.code = code;
    err.retryable = Boolean(error.retryable);
    err.isBusinessFailure = true;
    return err;
  },

  shouldRefreshAfterCommandError(err) {
    return Boolean(err && (err.retryable || REFRESH_AFTER_COMMAND_ERROR_CODES.includes(err.code)));
  },

  handleRoomUnavailable(err) {
    if (!isRoomUnavailableError(err)) {
      return false;
    }

    handlePageTimeout(this, {
      reasonCode: err.code,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    return true;
  },

  getPollIntervalMs() {
    if (Date.now() - this.lastCommandSettledAt <= COMMAND_REFRESH_WINDOW_MS) {
      return GAME_POLL_AFTER_COMMAND_INTERVAL_MS;
    }
    if (this.data.snapshot && this.data.snapshot.pendingTask) {
      return GAME_POLL_WITH_TASK_INTERVAL_MS;
    }
    return GAME_POLL_INTERVAL_MS;
  },

  markCommandSettled() {
    this.lastCommandSettledAt = Date.now();
  },

  redirectToResultIfNeeded(snapshot) {
    if (!snapshot) {
      return false;
    }
    if (
      snapshot.routeHint === "result" ||
      snapshot.roomStatus === "ended" ||
      snapshot.currentPhase === "game_ended"
    ) {
      this.redirectToResult(snapshot.roomCode || "");
      return true;
    }
    return false;
  },

  redirectToResult(roomCode = "") {
    this.stopRefreshTimer();
    clearPageTimeout(this);
    const query = `roomId=${encodeURIComponent(this.data.roomId)}&roomCode=${encodeURIComponent(roomCode || "")}`;
    wx.redirectTo({
      url: `/packageResult/pages/result/index?${query}`,
    });
  },

  onTogglePowerTip(event) {
    const slot = Number(event.currentTarget.dataset.slot) || 0;
    this.setData({
      activePowerTipSlot: this.data.activePowerTipSlot === slot ? 0 : slot,
    });
  },

  onTapRules() {
    const timeoutDeadlineAt = this.__pageTimeoutDeadline || Date.now() + GAME_PAGE_TIMEOUT_MS;
    wx.navigateTo({
      url: `/packageRoom/pages/rules/index?roomId=${encodeURIComponent(this.data.roomId || "")}&controlledMemberId=${encodeURIComponent(
        this.data.controlledMemberId || "",
      )}&timeoutMs=${GAME_PAGE_TIMEOUT_MS}&timeoutDeadlineAt=${timeoutDeadlineAt}`,
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

    const timeoutDeadlineAt = this.__pageTimeoutDeadline || Date.now() + GAME_PAGE_TIMEOUT_MS;
    wx.navigateTo({
      url: `/packageRoom/pages/identity/index?roomId=${encodeURIComponent(this.data.roomId)}&controlledMemberId=${encodeURIComponent(
        this.data.controlledMemberId || "",
      )}&timeoutDeadlineAt=${timeoutDeadlineAt}`,
    });
  },

  onTapHistory() {
    if (!this.data.roomId) {
      wx.showToast({
        title: "房间信息缺失",
        icon: "none",
      });
      return;
    }

    const timeoutDeadlineAt = this.__pageTimeoutDeadline || Date.now() + GAME_PAGE_TIMEOUT_MS;
    wx.navigateTo({
      url: `/packageRoom/pages/history/index?roomId=${encodeURIComponent(this.data.roomId)}&controlledMemberId=${encodeURIComponent(
        this.data.controlledMemberId || "",
      )}&timeoutDeadlineAt=${timeoutDeadlineAt}`,
    });
  },

  onTapSeat(event) {
    const memberId = event.currentTarget.dataset.memberId;
    if (!memberId) {
      return;
    }

    if (this.data.canNominate) {
      const snapshot = this.data.snapshot || {};
      const publicState = snapshot.publicState || {};
      const target = (publicState.seatOrder || []).find((member) => member.memberId === memberId);
      this.setData({
        selectedNominationTargetId: memberId,
        selectedNominationTargetLabel: target ? `${target.seatIndex}号 ${target.displayName}` : "",
        activeIdentityPickerMemberId: "",
        activeIdentityPickerOptions: [],
      });
      this.refreshSeatViews();
    }

    if (!this.data.isDevRoom) {
      return;
    }

    const now = Date.now();
    const lastSeatTap = this.lastSeatTap || {};
    const isDoubleTap = lastSeatTap.memberId === memberId && now - lastSeatTap.time <= 450;
    this.lastSeatTap = {
      memberId,
      time: now,
    };
    if (!isDoubleTap) {
      return;
    }

    this.lastSeatTap = null;
    const snapshot = this.data.snapshot || {};
    const nextControlledMemberId = memberId === snapshot.realMemberId ? "" : memberId;
    this.setData({
      controlledMemberId: nextControlledMemberId,
      errorText: "",
    });
    this.loadGameSnapshot();
  },

  onTapAvatar(event) {
    const isSelf = event.currentTarget.dataset.isSelf === true || event.currentTarget.dataset.isSelf === "true";
    if (isSelf) {
      this.onTapIdentity();
      return;
    }

    this.onTapSeat(event);
  },

  onTapIdentityMark(event) {
    const memberId = event.currentTarget.dataset.memberId;
    const canChange = event.currentTarget.dataset.canChange;
    if (!memberId || canChange === false || canChange === "false") {
      return;
    }
    const nextMemberId = this.data.activeIdentityPickerMemberId === memberId ? "" : memberId;
    this.setData({
      activeIdentityPickerMemberId: nextMemberId,
      activeIdentityPickerOptions: nextMemberId ? this.createActiveIdentityPickerOptions(nextMemberId) : [],
    });
    this.refreshSeatViews();
  },

  onCancelIdentityPicker() {
    this.setData({
      activeIdentityPickerMemberId: "",
      activeIdentityPickerOptions: [],
    });
    this.refreshSeatViews();
  },

  onStopTap() {},

  onTapIdentityOption(event) {
    const memberId = event.currentTarget.dataset.memberId;
    const value = event.currentTarget.dataset.value || "UNKNOWN";
    if (!memberId) {
      return;
    }
    const snapshot = this.data.snapshot || {};
    if (memberId === snapshot.myMemberId) {
      return;
    }
    const nextJudgments = { ...(this.data.identityJudgmentByMemberId || {}) };
    if (value === "LIBERAL" || value === "FASCIST") {
      nextJudgments[memberId] = value;
    } else {
      delete nextJudgments[memberId];
    }
    this.writeIdentityJudgments(snapshot, nextJudgments);
    this.setData({
      identityJudgmentByMemberId: nextJudgments,
      activeIdentityPickerMemberId: "",
      activeIdentityPickerOptions: [],
    });
    this.refreshSeatViews(nextJudgments);
  },

  refreshSeatViews(identityJudgmentByMemberId = this.data.identityJudgmentByMemberId || {}) {
    const snapshot = this.data.snapshot;
    if (!snapshot) {
      return;
    }
    this.setData({
      seats: this.createSeats(
        snapshot,
        this.data.avatarTempUrlByFileId || {},
        identityJudgmentByMemberId,
        this.data.policyAssets || {},
      ),
      selectedNominationTargetId: this.resolveSelectedNominationTargetId(snapshot),
      selectedNominationTargetLabel: this.createSelectedNominationTargetLabel(snapshot),
      activeIdentityPickerOptions: this.createActiveIdentityPickerOptions(this.data.activeIdentityPickerMemberId, snapshot),
    });
  },

  onTapNominateSelected() {
    if (!this.data.selectedNominationTargetId) {
      wx.showToast({
        title: "请先点击一个玩家席位",
        icon: "none",
      });
      return;
    }
    const target = (this.data.nominateTargets || []).find((item) => item.memberId === this.data.selectedNominationTargetId);
    if (!target) {
      wx.showToast({
        title: "该玩家暂不可提名",
        icon: "none",
      });
      return;
    }
    if (!target.canNominate) {
      wx.showModal({
        title: "不可提名",
        content: target.disabledReason || "该玩家暂不可提名",
        showCancel: false,
        confirmText: "知道了",
      });
      return;
    }

    wx.showModal({
      title: "确认提名",
      content: `确认提名 ${target.label} 为总理候选人？`,
      confirmText: "确认",
      cancelText: "取消",
      success: (res) => {
        if (res.confirm) {
          this.submitNomination(target.memberId);
        }
      },
    });
  },

  async submitNomination(targetMemberId) {
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    if (!targetMemberId || this.data.isSubmittingCommand) {
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
      if (this.redirectToResultIfNeeded(result.data)) {
        return;
      }
      this.markCommandSettled();
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error("提交提名失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      if (err.code === "GAME_ALREADY_ENDED") {
        this.redirectToResult();
        return;
      }
      wx.showToast({
        title: err.message || "提交提名失败",
        icon: "none",
      });
      if (this.shouldRefreshAfterCommandError(err)) {
        this.markCommandSettled();
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
      if (this.redirectToResultIfNeeded(result.data)) {
        return;
      }
      this.markCommandSettled();
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error("提交投票失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      if (err.code === "GAME_ALREADY_ENDED") {
        this.redirectToResult();
        return;
      }
      if (this.shouldRefreshAfterCommandError(err) || err.code === "DUPLICATE_COMMAND") {
        this.markCommandSettled();
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
    return this.submitPolicyChoice(event);
  },

  async onTapPolicyCard(event) {
    return this.submitPolicyChoice(event);
  },

  async submitPolicyChoice(event) {
    const discardPolicyIndex = Number(event.currentTarget.dataset.index);
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    const card = this.data.policyCards.find((item) => item.index === discardPolicyIndex);
    const isDiscard = pendingTask.taskType === "PRESIDENT_DISCARD_POLICY";
    const isEnact = pendingTask.taskType === "CHANCELLOR_ENACT_POLICY";
    if (!this.data.canPickPolicy || this.data.isSubmittingCommand || !Number.isInteger(discardPolicyIndex)) {
      return;
    }
    if (!isDiscard && !isEnact) {
      return;
    }

    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: isDiscard ? "确认弃牌" : "确认颁布",
        content: isDiscard
          ? `确定秘密弃掉这张${card ? card.title : "政策牌"}？弃牌不会公开，事后可自由陈述。`
          : `确定颁布这张${card ? card.title : "政策牌"}？颁布后将公开并推进政策轨。`,
        confirmText: isDiscard ? "弃掉" : "颁布",
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
            commandId: this.createCommandId(isDiscard ? "president_discard_policy" : "chancellor_enact_policy"),
            expectedVersion: snapshot.version,
            taskId: pendingTask.taskId || "",
            type: isDiscard ? "PRESIDENT_DISCARD_POLICY" : "CHANCELLOR_ENACT_POLICY",
            body: isDiscard
              ? {
                  discardPolicyIndex,
                }
              : {
                  enactPolicyIndex: discardPolicyIndex,
                },
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, isDiscard ? "提交弃牌失败" : "提交颁布失败");
      }
      wx.showToast({
        title: isDiscard ? "已交给总理" : "政策已颁布",
        icon: "none",
      });
      if (this.redirectToResultIfNeeded(result.data)) {
        return;
      }
      this.markCommandSettled();
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error(isDiscard ? "提交总统弃牌失败" : "提交总理颁布失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      if (err.code === "GAME_ALREADY_ENDED") {
        this.redirectToResult();
        return;
      }
      if (this.shouldRefreshAfterCommandError(err)) {
        this.markCommandSettled();
        await this.loadGameSnapshot({ silent: true });
      }
      wx.showToast({
        title: err.message || (isDiscard ? "提交弃牌失败" : "提交颁布失败"),
        icon: "none",
      });
    } finally {
      this.setData({
        isSubmittingCommand: false,
      });
    }
  },

  async onTapRequestVeto() {
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    if (!this.data.canRequestVeto || this.data.isSubmittingCommand) {
      return;
    }

    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: "提出否决",
        content: "确认请求总统否决本届议程？若总统拒绝，你仍需从这 2 张政策中颁布 1 张。",
        confirmText: "提出否决",
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
            commandId: this.createCommandId("chancellor_request_veto"),
            expectedVersion: snapshot.version,
            taskId: pendingTask.taskId || "",
            type: "CHANCELLOR_REQUEST_VETO",
            body: {
              request: true,
            },
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "提出否决失败");
      }
      wx.showToast({
        title: "已提出否决",
        icon: "none",
      });
      if (this.redirectToResultIfNeeded(result.data)) {
        return;
      }
      this.markCommandSettled();
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error("提出否决失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      if (err.code === "GAME_ALREADY_ENDED") {
        this.redirectToResult();
        return;
      }
      if (this.shouldRefreshAfterCommandError(err)) {
        this.markCommandSettled();
        await this.loadGameSnapshot({ silent: true });
      }
      wx.showToast({
        title: err.message || "提出否决失败",
        icon: "none",
      });
    } finally {
      this.setData({
        isSubmittingCommand: false,
      });
    }
  },

  onTapAcceptVeto() {
    this.submitVetoResponse(true);
  },

  onTapRejectVeto() {
    this.submitVetoResponse(false);
  },

  async submitVetoResponse(accepted) {
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    if (!this.data.canRespondVeto || this.data.isSubmittingCommand) {
      return;
    }

    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: accepted ? "同意否决" : "拒绝否决",
        content: accepted
          ? "确认同意否决？本轮 2 张政策全部弃掉，不颁布政策，选举轨推进 1 格。"
          : "确认拒绝否决？总理将必须从 2 张政策中颁布 1 张。",
        confirmText: accepted ? "同意否决" : "拒绝否决",
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
            commandId: this.createCommandId(accepted ? "president_accept_veto" : "president_reject_veto"),
            expectedVersion: snapshot.version,
            taskId: pendingTask.taskId || "",
            type: "PRESIDENT_RESPOND_VETO",
            body: {
              accepted,
            },
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "回应否决失败");
      }
      wx.showToast({
        title: accepted ? "已同意否决" : "已拒绝否决",
        icon: "none",
      });
      if (this.redirectToResultIfNeeded(result.data)) {
        return;
      }
      this.markCommandSettled();
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error("回应否决失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      if (err.code === "GAME_ALREADY_ENDED") {
        this.redirectToResult();
        return;
      }
      if (this.shouldRefreshAfterCommandError(err)) {
        this.markCommandSettled();
        await this.loadGameSnapshot({ silent: true });
      }
      wx.showToast({
        title: err.message || "回应否决失败",
        icon: "none",
      });
    } finally {
      this.setData({
        isSubmittingCommand: false,
      });
    }
  },

  async onTapExecutiveTarget(event) {
    const targetMemberId = event.currentTarget.dataset.memberId;
    const canTarget = event.currentTarget.dataset.canTarget;
    const disabledReason = event.currentTarget.dataset.disabledReason;
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    const action = this.data.executiveAction || {};
    if (!targetMemberId || this.data.isSubmittingCommand) {
      return;
    }
    if (canTarget !== true && canTarget !== "true") {
      wx.showToast({
        title: disabledReason || "该玩家暂不可选择",
        icon: "none",
      });
      return;
    }

    const target = this.data.executiveTargets.find((item) => item.memberId === targetMemberId) || {};
    const isExecution = pendingTask.taskType === "EXECUTE_PLAYER";
    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: action.title || "确认总统权力",
        content: isExecution
          ? `确认处决${target.label || "该玩家"}？目标将立即出局。`
          : `确认选择${target.label || "该玩家"}？`,
        confirmText: isExecution ? "确认处决" : "确认",
        cancelText: "取消",
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!confirmRes.confirm) {
      return;
    }

    await this.submitExecutiveCommand({
      commandType: pendingTask.taskType,
      body: {
        targetMemberId,
      },
      toastText: isExecution ? "处决已执行" : "总统权力已执行",
    });
  },

  async onTapPolicyPeekAck() {
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    if (pendingTask.taskType !== "EXEC_POLICY_PEEK_ACK" || this.data.isSubmittingCommand) {
      return;
    }
    await this.submitExecutiveCommand({
      commandType: "EXEC_POLICY_PEEK_ACK",
      body: {
        acknowledged: true,
      },
      toastText: "政策预览已确认",
    });
  },

  async submitExecutiveCommand(options) {
    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};

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
            commandId: this.createCommandId((options.commandType || "executive_action").toLowerCase()),
            expectedVersion: snapshot.version,
            taskId: pendingTask.taskId || "",
            type: options.commandType,
            body: options.body || {},
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "提交总统权力失败");
      }
      wx.showToast({
        title: options.toastText || "已提交",
        icon: "none",
      });
      if (this.redirectToResultIfNeeded(result.data)) {
        return;
      }
      this.markCommandSettled();
      await this.loadGameSnapshot({ silent: true });
    } catch (err) {
      console.error("提交总统权力失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      if (err.code === "GAME_ALREADY_ENDED") {
        this.redirectToResult();
        return;
      }
      if (this.shouldRefreshAfterCommandError(err)) {
        this.markCommandSettled();
        await this.loadGameSnapshot({ silent: true });
      }
      wx.showToast({
        title: err.message || "提交总统权力失败",
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
