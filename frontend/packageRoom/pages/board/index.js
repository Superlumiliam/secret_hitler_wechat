const gameMapper = require("../../mappers/gameMapper");
const taskMapper = require("../../mappers/taskMapper");
const { ERROR_MESSAGE_MAP, POLICY_TRACK_ASSET_FILE_IDS } = require("../../types/game");
const {
  EXECUTIVE_COMMAND_TYPES,
  POLICY_PICK_TASK_TYPES,
  REFRESH_AFTER_COMMAND_ERROR_CODES,
} = require("../../types/task");

const GAME_POLL_INTERVAL_MS = 1500;
const GAME_POLL_WITH_TASK_INTERVAL_MS = 1000;
const GAME_POLL_AFTER_COMMAND_INTERVAL_MS = 800;
const COMMAND_REFRESH_WINDOW_MS = 5000;
const GAME_POLL_FAILURE_BACKOFF_MS = [3000, 5000, 10000, 15000, 30000];
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
  consecutiveSnapshotFailures: 0,

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
    voteProgressText: "",
    voteResult: null,
    voteResultModalVisible: false,
    currentVoteResultKey: "",
    currentVoteResultViewerKey: "",
    confirmedVoteResultKey: "",
    confirmedVoteResultKeyByViewer: {},
    isSoloRoom: false,
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
    canAckPolicyPeek: false,
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

      this.consecutiveSnapshotFailures = 0;
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
      this.consecutiveSnapshotFailures += 1;
      if (this.refreshTimer) {
        this.startRefreshTimer();
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

    const board = this.createBoard(snapshot, policyAssetUrlByKey);
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

    const voteResult = this.createVoteResult(snapshot);
    const currentVoteResultKey = voteResult ? voteResult.resultKey : "";
    const currentVoteResultViewerKey = this.createVoteResultViewerKey(snapshot);
    const confirmedVoteResultKey =
      (this.data.confirmedVoteResultKeyByViewer || {})[currentVoteResultViewerKey] || "";
    const voteResultModalVisible = Boolean(
      voteResult && currentVoteResultKey && currentVoteResultKey !== confirmedVoteResultKey,
    );

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
      electionTrack: this.createElectionTrack(board.electionTracker, policyAssetUrlByKey),
      statusText: this.createStatusText(snapshot, board),
      phaseHintText: this.createPhaseHintText(snapshot, board),
      isSoloRoom: snapshot.roomMode === "solo",
      controlledSeatText: this.createControlledSeatText(snapshot),
      canVote: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "SUBMIT_VOTE"),
      voteProgressText: this.createVoteProgressText(snapshot),
      voteResult,
      currentVoteResultKey,
      currentVoteResultViewerKey,
      confirmedVoteResultKey,
      voteResultModalVisible,
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
          POLICY_PICK_TASK_TYPES.includes(snapshot.pendingTask.taskType),
      ),
      canRequestVeto: this.canRequestVeto(snapshot),
      canRespondVeto: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "PRESIDENT_RESPOND_VETO"),
      vetoResponse: this.createVetoResponse(snapshot),
      policyCards: this.createPolicyCards(snapshot, policyAssetUrlByKey),
      policyPickerTitle: this.createPolicyPickerTitle(snapshot),
      policyPickerHint: this.createPolicyPickerHint(snapshot),
      executiveAction: this.createExecutiveAction(snapshot),
      canExecuteAction: Boolean(
        snapshot.pendingTask &&
          EXECUTIVE_COMMAND_TYPES.includes(snapshot.pendingTask.taskType),
      ),
      canAckPolicyPeek: Boolean(snapshot.pendingTask && snapshot.pendingTask.taskType === "EXEC_POLICY_PEEK_ACK"),
      executiveTargets: this.createExecutiveTargets(snapshot),
      policyPeekCards: this.createPolicyPeekCards(snapshot, policyAssetUrlByKey),
      investigationResult: this.createInvestigationResult(snapshot),
    });
  },

  createBoard(snapshot, assets = {}) {
    return gameMapper.createBoard(snapshot, assets);
  },

  createSeats(snapshot, avatarUrlByFileId, identityJudgmentByMemberId = {}, assets = {}) {
    return gameMapper.createSeats(snapshot, {
      avatarUrlByFileId,
      identityJudgmentByMemberId,
      assets,
      selectedNominationTargetId: this.data.selectedNominationTargetId || "",
    });
  },

  createControlledSeatText(snapshot) {
    return gameMapper.createControlledSeatText(snapshot);
  },

  createNominateTargets(snapshot) {
    return taskMapper.createNominateTargets(snapshot);
  },

  createNominateTargetMap(snapshot) {
    return taskMapper.createNominateTargetMap(snapshot);
  },

  resolveSelectedNominationTargetId(snapshot) {
    return taskMapper.resolveSelectedNominationTargetId(snapshot, this.data.selectedNominationTargetId || "");
  },

  createSelectedNominationTargetLabel(snapshot) {
    return taskMapper.createSelectedNominationTargetLabel(snapshot, this.data.selectedNominationTargetId || "");
  },

  createNominateRuleHint(snapshot) {
    return taskMapper.createNominateRuleHint(snapshot);
  },

  getNominationAllowedIds(snapshot) {
    return taskMapper.getNominationAllowedIds(snapshot);
  },

  createActiveIdentityPickerOptions(
    memberId,
    snapshot = this.data.snapshot,
    judgments = this.data.identityJudgmentByMemberId || {},
    assets = this.data.policyAssets || {},
  ) {
    return gameMapper.createActiveIdentityPickerOptions(memberId, snapshot, judgments, assets);
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
    return gameMapper.createLiberalTrack(liberalPolicyCount, assets, newPolicySlot);
  },

  createFascistTrack(targetPlayerCount, fascistPolicyCount, assets = {}, newPolicySlot = 0) {
    return gameMapper.createFascistTrack(targetPlayerCount, fascistPolicyCount, assets, newPolicySlot);
  },

  createElectionTrack(electionTracker, assets = {}) {
    return gameMapper.createElectionTrack(electionTracker, assets);
  },

  createStatusText(snapshot, board) {
    return gameMapper.createStatusText(snapshot, board);
  },

  createPhaseHintText(snapshot, board) {
    return gameMapper.createPhaseHintText(snapshot, board);
  },

  createVoteProgressText(snapshot) {
    return gameMapper.createVoteProgressText(snapshot);
  },

  createVoteResult(snapshot) {
    return gameMapper.createVoteResult(snapshot);
  },

  createVoteResultViewerKey(snapshot) {
    return gameMapper.createVoteResultViewerKey(snapshot, this.data.controlledMemberId || "");
  },

  onConfirmVoteResult() {
    const viewerKey = this.data.currentVoteResultViewerKey || this.createVoteResultViewerKey(this.data.snapshot);
    const resultKey = this.data.currentVoteResultKey || "";
    const confirmedVoteResultKeyByViewer = {
      ...(this.data.confirmedVoteResultKeyByViewer || {}),
      [viewerKey]: resultKey,
    };
    this.setData({
      confirmedVoteResultKey: resultKey,
      confirmedVoteResultKeyByViewer,
      voteResultModalVisible: false,
    });
  },

  createPolicyCards(snapshot, assets = this.data.policyAssets || {}) {
    return taskMapper.createPolicyCards(snapshot, assets, this.data.isSubmittingCommand);
  },

  createPolicyPickerTitle(snapshot) {
    return taskMapper.createPolicyPickerTitle(snapshot);
  },

  createPolicyPickerHint(snapshot) {
    return taskMapper.createPolicyPickerHint(snapshot);
  },

  canRequestVeto(snapshot) {
    return taskMapper.canRequestVeto(snapshot);
  },

  createVetoResponse(snapshot) {
    return taskMapper.createVetoResponse(snapshot);
  },

  createExecutiveAction(snapshot) {
    return taskMapper.createExecutiveAction(snapshot);
  },

  createExecutiveTargets(snapshot) {
    return taskMapper.createExecutiveTargets(snapshot);
  },

  createPolicyPeekCards(snapshot, assets = this.data.policyAssets || {}) {
    return taskMapper.createPolicyPeekCards(snapshot, assets, this.data.isSubmittingCommand);
  },

  createInvestigationResult(snapshot) {
    return taskMapper.createInvestigationResult(snapshot);
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
    if (this.consecutiveSnapshotFailures > 0) {
      const backoffIndex = Math.min(this.consecutiveSnapshotFailures, GAME_POLL_FAILURE_BACKOFF_MS.length) - 1;
      return GAME_POLL_FAILURE_BACKOFF_MS[backoffIndex];
    }
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
    const slot = Number((event.detail && event.detail.slot) || event.currentTarget.dataset.slot) || 0;
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
    const memberId = (event.detail && event.detail.memberId) || event.currentTarget.dataset.memberId;
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

    if (!this.data.isSoloRoom) {
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
    const rawIsSelf =
      event.detail && Object.prototype.hasOwnProperty.call(event.detail, "isSelf")
        ? event.detail.isSelf
        : event.currentTarget.dataset.isSelf;
    const isSelf = rawIsSelf === true || rawIsSelf === "true";
    if (isSelf) {
      this.onTapIdentity();
      return;
    }

    this.onTapSeat(event);
  },

  onTapIdentityMark(event) {
    const memberId = (event.detail && event.detail.memberId) || event.currentTarget.dataset.memberId;
    const canChange =
      event.detail && Object.prototype.hasOwnProperty.call(event.detail, "canChange")
        ? event.detail.canChange
        : event.currentTarget.dataset.canChange;
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
          ? "确认同意否决？本轮 2 张政策全部弃掉，不颁布政策，选举计数器推进 1 格。"
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
