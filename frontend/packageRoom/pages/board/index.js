const gameMapper = require("../../mappers/gameMapper");
const taskMapper = require("../../mappers/taskMapper");
const { ERROR_MESSAGE_MAP, POLICY_TRACK_ASSET_FILE_IDS } = require("../../types/game");
const {
  EXECUTIVE_COMMAND_TYPES,
  POLICY_PICK_TASK_TYPES,
  REFRESH_AFTER_COMMAND_ERROR_CODES,
} = require("../../types/task");
const { resolveTempFileUrls } = require("../../utils/tempFileUrlCache");
const { createRoomSyncSignalWatcher } = require("../../utils/roomSyncSignal");
const { clearGameSnapshotCache, setGameSnapshotCache } = require("../../../utils/gameSnapshotCache");
const { buildPageUrl, reLaunchIfPageStacked, reLaunchPage } = require("../../../utils/protectedPageRoute");
const { buildRoomShare, enableShareMenu } = require("../../../utils/share");

const GAME_POLL_INTERVAL_MS = 4000;
const GAME_POLL_WITH_TASK_INTERVAL_MS = 1000;
const GAME_POLL_AFTER_COMMAND_INTERVAL_MS = 800;
const COMMAND_REFRESH_WINDOW_MS = 5000;
const GAME_POLL_FAILURE_BACKOFF_MS = [3000, 5000, 10000, 15000, 30000];
const GAME_RECONCILE_INTERVAL_MS = 60 * 1000;
const PRESENCE_TOUCH_INTERVAL_MS = 60 * 1000;
const INVESTIGATION_REVEAL_EXIT_MS = 260;
const IDENTITY_INTRO_REVEAL_EXIT_MS = 320;
const POLICY_PEEK_REVEAL_READY_MS = 1050;
const POLICY_PEEK_REVEAL_EXIT_MS = 320;
function isRoomUnavailableError(err) {
  return Boolean(err && ["ROOM_EXPIRED", "ROOM_NOT_FOUND", "NOT_ROOM_MEMBER"].includes(err.code));
}

function isCloudFunctionPollingTimeout(err) {
  if (!err) {
    return false;
  }
  const errCode = err.errCode || err.code;
  const message = String(err.errMsg || err.message || "");
  return errCode === -404012 || message.includes("-404012") || message.includes("polling exceed");
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
  syncSignalWatcher: null,
  initialSnapshotSettled: false,
  shouldStartRefreshAfterInitial: false,
  isPageVisible: false,
  isPageUnloaded: false,
  identityJudgmentCacheByKey: {},
  identityIntroRevealShownByKey: {},
  policyPeekRevealShownByKey: {},
  policyPeekRevealReadyTimer: null,
  policyPeekRevealExitTimer: null,
  policyPeekAckConfirming: false,
  lastSeatTap: null,
  lastCommandSettledAt: 0,
  pendingInvestigationRevealActorId: "",
  consecutiveSnapshotFailures: 0,
  snapshotRequestInFlight: null,
  snapshotRequestQueue: [],
  pendingSyncVersion: 0,
  pendingSyncRoomStatus: "",
  pendingSyncSequence: 0,
  syncSignalCatchUpPromise: null,
  isLeaveConfirming: false,
  lastPresenceTouchAt: 0,
  boardShareMenuEnabled: false,

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
    voteModalVisible: false,
    voteModalTaskKey: "",
    voteProgressText: "",
    voteResult: null,
    voteResultModalVisible: false,
    currentVoteResultKey: "",
    currentVoteResultViewerKey: "",
    confirmedVoteResultKey: "",
    confirmedVoteResultKeyByViewer: {},
    isSoloRoom: false,
    isSpectatorView: false,
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
    selectedExecutiveTargetId: "",
    selectedExecutiveTargetLabel: "",
    policyPeekCards: [],
    policyPeekReveal: null,
    investigationResult: null,
    investigationReveal: null,
    identityIntroReveal: null,
    shownInvestigationRevealKey: "",
    isSubmittingCommand: false,
  },

  onLoad(options = {}) {
    if (reLaunchIfPageStacked(buildPageUrl("/packageRoom/pages/board/index", options), this)) {
      return;
    }

    this.initialSnapshotSettled = false;
    this.shouldStartRefreshAfterInitial = false;
    this.isPageVisible = false;
    this.isPageUnloaded = false;
    this.isLeaveConfirming = false;
    this.snapshotRequestInFlight = null;
    this.snapshotRequestQueue = [];
    this.pendingSyncVersion = 0;
    this.pendingSyncRoomStatus = "";
    this.pendingSyncSequence = 0;
    this.syncSignalCatchUpPromise = null;
    this.syncSignalWatcher = null;
    this.lastPresenceTouchAt = 0;
    this.identityJudgmentCacheByKey = {};
    this.identityIntroRevealShownByKey = {};
    this.policyPeekRevealShownByKey = {};
    this.policyPeekAckConfirming = false;
    this.boardShareMenuEnabled = false;
    if (wx.hideShareMenu) {
      wx.hideShareMenu({
        menus: ["shareAppMessage", "shareTimeline"],
      });
    }
    this.setData({
      roomId: options.roomId || "",
      controlledMemberId: options.controlledMemberId || "",
    });
    setupPageTimeout(this, {
      timeoutMs: GAME_PAGE_TIMEOUT_MS,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    this.loadGameSnapshot().then((shouldContinuePolling) => {
      this.markInitialSnapshotSettled(shouldContinuePolling);
    });
  },

  onShareAppMessage() {
    const roomCode = this.data.board && this.data.board.roomCode;
    if (!roomCode) {
      return undefined;
    }
    return buildRoomShare(roomCode, this.data.roomId);
  },

  enableBoardShareMenu(board) {
    if (this.boardShareMenuEnabled || !board || !board.roomCode) {
      return false;
    }
    enableShareMenu({
      includeTimeline: false,
    });
    this.boardShareMenuEnabled = true;
    return true;
  },

  onShow() {
    this.isPageVisible = true;
    schedulePageTimeout(this, {
      timeoutMs: GAME_PAGE_TIMEOUT_MS,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    if (this.data.roomId) {
      if (!this.initialSnapshotSettled) {
        this.shouldStartRefreshAfterInitial = true;
        return;
      }
      this.loadGameSnapshot({ silent: true }).then((shouldContinuePolling) => {
        if (shouldContinuePolling) {
          this.startRealtimeSync();
          this.startRefreshTimer();
        }
      });
    }
  },

  onHide() {
    this.isPageVisible = false;
    this.shouldStartRefreshAfterInitial = false;
    this.stopRealtimeSync();
    this.stopRefreshTimer();
    this.clearPolicyPeekRevealTimers();
    if (this.data.policyPeekReveal) {
      this.setData({
        policyPeekReveal: null,
      });
    }
    clearPageTimeout(this);
  },

  onUnload() {
    this.isPageVisible = false;
    this.isPageUnloaded = true;
    this.shouldStartRefreshAfterInitial = false;
    this.stopRealtimeSync();
    this.stopRefreshTimer();
    this.clearPolicyPeekRevealTimers();
    clearPageTimeout(this);
  },

  startRefreshTimer() {
    this.stopRefreshTimer();
    if (!this.isPageVisible || this.isPageUnloaded) {
      return;
    }
    this.refreshTimer = setTimeout(async () => {
      this.refreshTimer = null;
      const shouldContinuePolling = await this.loadGameSnapshot({ silent: true });
      if (shouldContinuePolling) {
        this.startRefreshTimer();
      }
    }, this.getPollIntervalMs());
  },

  stopRefreshTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  isRealtimeSyncHealthy() {
    return Boolean(this.syncSignalWatcher && this.syncSignalWatcher.isHealthy());
  },

  startRealtimeSync() {
    this.stopRealtimeSync();
    if (!this.isPageVisible || this.isPageUnloaded || !this.data.roomId) {
      return;
    }

    this.syncSignalWatcher = createRoomSyncSignalWatcher({
      roomId: this.data.roomId,
      onHealthy: () => {
        this.startRefreshTimer();
      },
      onUnavailable: (err) => {
        console.warn("对局实时同步不可用，已降级为轮询", err);
        this.startRefreshTimer();
      },
      onSignal: (signal) => {
        this.handleRealtimeSignal(signal);
      },
    });
    this.syncSignalWatcher.start();
  },

  stopRealtimeSync() {
    if (this.syncSignalWatcher) {
      this.syncSignalWatcher.stop();
      this.syncSignalWatcher = null;
    }
    this.pendingSyncVersion = 0;
    this.pendingSyncRoomStatus = "";
    this.pendingSyncSequence += 1;
  },

  handleRealtimeSignal(signal = {}) {
    const nextVersion = Number(signal.version) || 0;
    if (nextVersion >= this.pendingSyncVersion) {
      this.pendingSyncVersion = nextVersion;
      this.pendingSyncRoomStatus = signal.roomStatus || this.pendingSyncRoomStatus;
    }
    this.pendingSyncSequence += 1;
    this.drainRealtimeSignals();
  },

  hasPendingRealtimeSignal() {
    const snapshot = this.data.snapshot || {};
    const currentVersion = Number(snapshot.version) || 0;
    return (
      this.pendingSyncVersion > currentVersion ||
      Boolean(this.pendingSyncRoomStatus && this.pendingSyncRoomStatus !== snapshot.roomStatus)
    );
  },

  drainRealtimeSignals() {
    if (this.syncSignalCatchUpPromise) {
      return this.syncSignalCatchUpPromise;
    }

    let lastObservedSyncSequence = this.pendingSyncSequence;
    const catchUpPromise = (async () => {
      let noProgressRetryCount = 0;
      while (this.isPageVisible && !this.isPageUnloaded && this.hasPendingRealtimeSignal()) {
        const sequenceBeforeRequest = this.pendingSyncSequence;
        lastObservedSyncSequence = sequenceBeforeRequest;
        const snapshotBeforeRequest = this.data.snapshot || {};
        const versionBeforeRequest = Number(snapshotBeforeRequest.version) || 0;
        const statusBeforeRequest = snapshotBeforeRequest.roomStatus || "";
        const shouldContinue = await this.loadGameSnapshot({ silent: true });
        if (!shouldContinue || !this.isPageVisible || this.isPageUnloaded) {
          return;
        }
        if (!this.hasPendingRealtimeSignal()) {
          this.pendingSyncVersion = 0;
          this.pendingSyncRoomStatus = "";
          return;
        }

        const snapshotAfterRequest = this.data.snapshot || {};
        const versionAfterRequest = Number(snapshotAfterRequest.version) || 0;
        const statusAfterRequest = snapshotAfterRequest.roomStatus || "";
        const madeProgress = versionAfterRequest > versionBeforeRequest || statusAfterRequest !== statusBeforeRequest;
        if (madeProgress || this.pendingSyncSequence !== sequenceBeforeRequest) {
          noProgressRetryCount = 0;
          continue;
        }
        if (noProgressRetryCount < 1) {
          noProgressRetryCount += 1;
          continue;
        }
        return;
      }
    })();

    this.syncSignalCatchUpPromise = catchUpPromise;
    catchUpPromise
      .catch((err) => {
        console.warn("对局同步信号追赶失败", err);
      })
      .finally(() => {
        if (this.syncSignalCatchUpPromise === catchUpPromise) {
          this.syncSignalCatchUpPromise = null;
          if (
            this.isPageVisible &&
            !this.isPageUnloaded &&
            this.hasPendingRealtimeSignal() &&
            this.pendingSyncSequence !== lastObservedSyncSequence
          ) {
            this.drainRealtimeSignals();
          }
        }
      });
    return catchUpPromise;
  },

  markInitialSnapshotSettled(shouldStartRefresh) {
    this.initialSnapshotSettled = true;
    const canStartRefresh =
      shouldStartRefresh &&
      this.shouldStartRefreshAfterInitial &&
      this.isPageVisible &&
      !this.isPageUnloaded &&
      this.data.roomId &&
      !this.data.isLeaving;
    this.shouldStartRefreshAfterInitial = false;
    if (canStartRefresh) {
      this.startRealtimeSync();
      this.startRefreshTimer();
    }
  },

  async loadGameSnapshot(options = {}) {
    const requestContext = this.getSnapshotRequestContext();
    const requestKey = this.getSnapshotRequestKey(requestContext);
    if (this.snapshotRequestInFlight && this.snapshotRequestInFlight.key === requestKey) {
      return await this.snapshotRequestInFlight.promise;
    }

    const queued = this.snapshotRequestQueue.find((entry) => entry.key === requestKey);
    if (queued) {
      if (!options.silent) {
        queued.options.silent = false;
      }
      return await queued.promise;
    }

    let resolveRequest;
    let rejectRequest;
    const entry = {
      key: requestKey,
      requestContext,
      options: { ...options },
      promise: new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      }),
      resolve: resolveRequest,
      reject: rejectRequest,
    };

    if (this.snapshotRequestInFlight) {
      this.snapshotRequestQueue.push(entry);
    } else {
      this.startSnapshotRequest(entry);
    }
    return await entry.promise;
  },

  getSnapshotRequestContext() {
    return {
      roomId: this.data.roomId || "",
      controlledMemberId: this.data.controlledMemberId || "",
    };
  },

  getSnapshotRequestKey(requestContext) {
    return `${requestContext.roomId}\0${requestContext.controlledMemberId}`;
  },

  isCurrentSnapshotRequestContext(requestContext) {
    return this.getSnapshotRequestKey(requestContext) === this.getSnapshotRequestKey(this.getSnapshotRequestContext());
  },

  startSnapshotRequest(entry) {
    this.snapshotRequestInFlight = entry;
    Promise.resolve(this.fetchGameSnapshot(entry.options, entry.requestContext))
      .then(
        (value) => {
          this.finishSnapshotRequest(entry);
          entry.resolve(value);
        },
        (err) => {
          this.finishSnapshotRequest(entry);
          entry.reject(err);
        },
      );
  },

  finishSnapshotRequest(entry) {
    if (this.snapshotRequestInFlight === entry) {
      this.snapshotRequestInFlight = null;
    }
    const nextEntry = this.snapshotRequestQueue.shift();
    if (nextEntry) {
      this.startSnapshotRequest(nextEntry);
    }
  },

  async fetchGameSnapshot(options = {}, requestContext = this.getSnapshotRequestContext()) {
    if (!requestContext.roomId || !wx.cloud) {
      this.setData({
        isLoading: false,
      });
      return false;
    }

    if (!options.silent) {
      this.setData({
        isLoading: true,
        errorText: "",
      });
    }

    const touchPresence =
      options.touchPresence === true || Date.now() - (Number(this.lastPresenceTouchAt) || 0) >= PRESENCE_TOUCH_INTERVAL_MS;

    try {
      const res = await wx.cloud.callFunction({
        name: "gameService",
        data: {
          action: "getGameSnapshot",
          payload: {
            roomId: requestContext.roomId,
            controlledMemberId: requestContext.controlledMemberId,
            touchPresence,
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "获取对局数据失败");
      }
      if (!this.isCurrentSnapshotRequestContext(requestContext)) {
        return true;
      }
      if (touchPresence) {
        this.lastPresenceTouchAt = Date.now();
      }
      setGameSnapshotCache(requestContext.roomId, requestContext.controlledMemberId, result.data);
      if (this.redirectToResultIfNeeded(result.data)) {
        return false;
      }

      this.consecutiveSnapshotFailures = 0;
      syncPageTimeoutDeadline(this, result.data && result.data.expireAt, {
        beforeRedirect: () => this.stopRefreshTimer(),
      });
      if (this.shouldHydrateSnapshot(result.data, options)) {
        await this.hydrateSnapshot(result.data);
      }
      return true;
    } catch (err) {
      if (!this.isCurrentSnapshotRequestContext(requestContext)) {
        return true;
      }
      console.error("获取对局数据失败", err);
      if (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND" || err.code === "NOT_ROOM_MEMBER") {
        handlePageTimeout(this, {
          reasonCode: err.code,
          beforeRedirect: () => this.stopRefreshTimer(),
        });
        return false;
      }

      if (err.code === "GAME_ALREADY_ENDED") {
        this.redirectToResult();
        return false;
      }
      this.consecutiveSnapshotFailures += 1;
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
      return true;
    } finally {
      this.setData({
        isLoading: false,
      });
    }
  },

  shouldHydrateSnapshot(snapshot, options = {}) {
    const current = this.data.snapshot;
    return !(
      options.silent &&
      current &&
      snapshot &&
      current.version !== undefined &&
      snapshot.version !== undefined &&
      current.version === snapshot.version &&
      current.myMemberId === snapshot.myMemberId &&
      current.realMemberId === snapshot.realMemberId
    );
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
        Object.assign(avatarUrlByFileId, await resolveTempFileUrls(cloudFileIds));
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
    const newElectionTracker =
      shouldAnimateNewPolicy && board.electionTracker > (previousBoard.electionTracker || 0)
        ? board.electionTracker
        : 0;

    const voteResult = this.createVoteResult(snapshot);
    const currentVoteResultKey = voteResult ? voteResult.resultKey : "";
    const currentVoteResultViewerKey = this.createVoteResultViewerKey(snapshot);
    const confirmedVoteResultKey =
      (this.data.confirmedVoteResultKeyByViewer || {})[currentVoteResultViewerKey] || "";
    const voteResultModalVisible = Boolean(
      voteResult && currentVoteResultKey && currentVoteResultKey !== confirmedVoteResultKey,
    );
    const pendingTask = snapshot.pendingTask || {};
    const canVote = pendingTask.taskType === "SUBMIT_VOTE";
    const voteModalTaskKey = canVote
      ? [
          snapshot.roomId || this.data.roomId || "",
          "voting",
          snapshot.round || "",
          snapshot.myMemberId || snapshot.realMemberId || this.data.controlledMemberId || "",
        ].join(":")
      : "";
    const voteModalVisible = canVote && (
      this.data.voteModalTaskKey !== voteModalTaskKey || this.data.voteModalVisible
    );
    const investigationResult = this.createInvestigationResult(snapshot, policyAssetUrlByKey);
    const investigationReveal = this.createInvestigationReveal(snapshot, policyAssetUrlByKey);
    const identityIntroReveal = this.createIdentityIntroReveal(snapshot, policyAssetUrlByKey);
    const policyPeekCards = this.createPolicyPeekCards(snapshot, policyAssetUrlByKey);
    const policyPeekReveal =
      voteResultModalVisible || investigationReveal || identityIntroReveal
        ? null
        : this.createPolicyPeekReveal(snapshot, policyPeekCards);

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
      electionTrack: this.createElectionTrack(board.electionTracker, policyAssetUrlByKey, newElectionTracker),
      statusText: this.createStatusText(snapshot, board),
      phaseHintText: this.createPhaseHintText(snapshot, board),
      isSoloRoom: snapshot.roomMode === "solo",
      isSpectatorView: Boolean(snapshot.viewerState && snapshot.viewerState.isSpectatorView),
      controlledSeatText: this.createControlledSeatText(snapshot),
      canVote,
      voteModalVisible,
      voteModalTaskKey,
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
      selectedExecutiveTargetId: this.resolveSelectedExecutiveTargetId(snapshot),
      selectedExecutiveTargetLabel: this.createSelectedExecutiveTargetLabel(snapshot),
      policyPeekCards,
      policyPeekReveal,
      investigationResult,
      investigationReveal,
      identityIntroReveal,
      shownInvestigationRevealKey: investigationReveal && investigationReveal.visible
        ? investigationReveal.resultKey
        : this.data.shownInvestigationRevealKey,
    });
    this.enableBoardShareMenu(board);
    if (policyPeekReveal && policyPeekReveal.visible && !policyPeekReveal.dismissible) {
      this.schedulePolicyPeekRevealReady(policyPeekReveal.revealKey);
    }
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
      selectedExecutiveTargetId: this.data.selectedExecutiveTargetId || "",
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
    if (Object.prototype.hasOwnProperty.call(this.identityJudgmentCacheByKey, key)) {
      return this.identityJudgmentCacheByKey[key];
    }
    try {
      const stored = wx.getStorageSync(key);
      const judgments = stored && typeof stored === "object" ? stored : {};
      this.identityJudgmentCacheByKey[key] = judgments;
      return judgments;
    } catch (err) {
      console.error("读取身份判断标记失败", err);
      this.identityJudgmentCacheByKey[key] = {};
      return {};
    }
  },

  writeIdentityJudgments(snapshot, judgments) {
    const key = this.createIdentityJudgmentStorageKey(snapshot);
    if (!key) {
      return;
    }
    const nextJudgments = judgments || {};
    this.identityJudgmentCacheByKey[key] = nextJudgments;
    wx.setStorage({
      key,
      data: nextJudgments,
      fail: (err) => {
        console.error("保存身份判断标记失败", err);
        wx.showToast({
          title: "标记保存失败",
          icon: "none",
        });
      },
    });
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

  createElectionTrack(electionTracker, assets = {}, newElectionTracker = 0) {
    return gameMapper.createElectionTrack(electionTracker, assets, newElectionTracker);
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

  resolveSelectedExecutiveTargetId(snapshot) {
    return taskMapper.resolveSelectedExecutiveTargetId(snapshot, this.data.selectedExecutiveTargetId || "");
  },

  createSelectedExecutiveTargetLabel(snapshot) {
    return taskMapper.createSelectedExecutiveTargetLabel(snapshot, this.data.selectedExecutiveTargetId || "");
  },

  createPolicyPeekCards(snapshot, assets = this.data.policyAssets || {}) {
    return taskMapper.createPolicyPeekCards(snapshot, assets, this.data.isSubmittingCommand);
  },

  createPolicyPeekReveal(snapshot, policyPeekCards = []) {
    const pendingTask = snapshot && snapshot.pendingTask;
    if (!pendingTask || pendingTask.taskType !== "EXEC_POLICY_PEEK_ACK" || policyPeekCards.length !== 3) {
      this.clearPolicyPeekRevealTimers();
      return null;
    }
    const revealKey = `${snapshot.myMemberId || ""}:${pendingTask.taskId || snapshot.version || ""}`;
    const currentReveal = this.data.policyPeekReveal || null;
    if (currentReveal && currentReveal.revealKey === revealKey && (currentReveal.visible || currentReveal.exiting)) {
      return currentReveal;
    }
    if (this.policyPeekRevealShownByKey[revealKey]) {
      return null;
    }
    this.policyPeekRevealShownByKey[revealKey] = true;
    return {
      revealKey,
      visible: true,
      exiting: false,
      dismissible: false,
    };
  },

  schedulePolicyPeekRevealReady(revealKey) {
    if (this.policyPeekRevealReadyTimer) {
      return;
    }
    this.policyPeekRevealReadyTimer = setTimeout(() => {
      this.policyPeekRevealReadyTimer = null;
      const reveal = this.data.policyPeekReveal || null;
      if (reveal && reveal.revealKey === revealKey && reveal.visible && !reveal.exiting) {
        this.setData({
          policyPeekReveal: {
            ...reveal,
            dismissible: true,
          },
        });
      }
    }, POLICY_PEEK_REVEAL_READY_MS);
  },

  clearPolicyPeekRevealTimers() {
    if (this.policyPeekRevealReadyTimer) {
      clearTimeout(this.policyPeekRevealReadyTimer);
      this.policyPeekRevealReadyTimer = null;
    }
    if (this.policyPeekRevealExitTimer) {
      clearTimeout(this.policyPeekRevealExitTimer);
      this.policyPeekRevealExitTimer = null;
    }
  },

  createInvestigationResult(snapshot, assets = this.data.policyAssets || {}) {
    return taskMapper.createInvestigationResult(snapshot, assets);
  },

  createInvestigationReveal(snapshot, assets = this.data.policyAssets || {}) {
    const nextResult = this.createInvestigationResult(snapshot, assets);
    const currentReveal = this.data.investigationReveal || null;
    if (currentReveal && (currentReveal.visible || currentReveal.exiting)) {
      return currentReveal;
    }
    if (!nextResult || !this.pendingInvestigationRevealActorId) {
      return null;
    }
    if (this.pendingInvestigationRevealActorId !== snapshot.myMemberId) {
      return null;
    }
    if (nextResult.resultKey === this.data.shownInvestigationRevealKey) {
      this.pendingInvestigationRevealActorId = "";
      return null;
    }
    this.pendingInvestigationRevealActorId = "";
    return {
      ...nextResult,
      visible: true,
      exiting: false,
    };
  },

  createIdentityIntroReveal(snapshot, assets = this.data.policyAssets || {}) {
    if ((Number(snapshot && snapshot.round) || 1) !== 1) {
      return null;
    }

    const currentReveal = this.data.identityIntroReveal || null;
    if (currentReveal && (currentReveal.visible || currentReveal.exiting)) {
      return currentReveal;
    }

    const privateState = (snapshot && snapshot.privateState) || {};
    const identity = privateState.identity || {};
    if (!identity.role || !snapshot.roomId || !snapshot.myMemberId) {
      return null;
    }

    const storageKey = this.createIdentityIntroRevealStorageKey(snapshot);
    if (!storageKey || this.hasShownIdentityIntroReveal(storageKey)) {
      return null;
    }

    this.markIdentityIntroRevealShown(storageKey);
    const roleMeta = this.createIdentityIntroRoleMeta(identity.role, assets);
    return {
      visible: true,
      exiting: false,
      titleVisible: true,
      role: identity.role,
      titleText: roleMeta.titleText,
      cardSrc: roleMeta.cardSrc,
      roleClass: roleMeta.roleClass,
    };
  },

  createIdentityIntroRevealStorageKey(snapshot) {
    const roomId = (snapshot && snapshot.roomId) || this.data.roomId || "";
    const memberId = snapshot && snapshot.myMemberId;
    if (!roomId || !memberId) {
      return "";
    }
    return `board_identity_intro_reveal:${roomId}:${memberId}`;
  },

  hasShownIdentityIntroReveal(storageKey) {
    if (Object.prototype.hasOwnProperty.call(this.identityIntroRevealShownByKey, storageKey)) {
      return this.identityIntroRevealShownByKey[storageKey];
    }
    try {
      const hasShown = Boolean(wx.getStorageSync(storageKey));
      this.identityIntroRevealShownByKey[storageKey] = hasShown;
      return hasShown;
    } catch (err) {
      console.error("读取入场身份揭示状态失败", err);
      this.identityIntroRevealShownByKey[storageKey] = false;
      return false;
    }
  },

  markIdentityIntroRevealShown(storageKey) {
    this.identityIntroRevealShownByKey[storageKey] = true;
    wx.setStorage({
      key: storageKey,
      data: true,
      fail: (err) => {
        console.error("保存入场身份揭示状态失败", err);
      },
    });
  },

  createIdentityIntroRoleMeta(role, assets = {}) {
    if (role === "HITLER") {
      return {
        titleText: "你的身份是独裁者",
        cardSrc: assets.identityHitler || "",
        roleClass: "is-dictator",
      };
    }
    if (role === "FASCIST") {
      return {
        titleText: "你的身份是极权派",
        cardSrc: assets.identityFascist || "",
        roleClass: "is-fascist",
      };
    }
    return {
      titleText: "你的身份是自由派",
      cardSrc: assets.identityLiberal || "",
      roleClass: "is-liberal",
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
    if (this.consecutiveSnapshotFailures > 0) {
      const backoffIndex = Math.min(this.consecutiveSnapshotFailures, GAME_POLL_FAILURE_BACKOFF_MS.length) - 1;
      return GAME_POLL_FAILURE_BACKOFF_MS[backoffIndex];
    }
    if (this.isRealtimeSyncHealthy()) {
      return GAME_RECONCILE_INTERVAL_MS;
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
    this.startRefreshTimer();
  },

  createCommandFailureToast(err, fallbackMessage) {
    return isCloudFunctionPollingTimeout(err)
      ? "网络超时，请稍后查看局势是否已更新"
      : err.message || fallbackMessage || "操作失败";
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
    reLaunchPage(`/packageResult/pages/result/index?${query}`);
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
    if (this.data.isSpectatorView) {
      wx.showToast({
        title: "观战视角仅显示公共信息，无法查看玩家身份",
        icon: "none",
      });
      return;
    }

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

  async onTapSeat(event) {
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

    if (this.data.canExecuteAction && !this.data.canAckPolicyPeek) {
      const target = (this.data.executiveTargets || []).find((item) => item.memberId === memberId);
      if (target && !target.canTarget) {
        wx.showModal({
          title: "不可选择",
          content: target.disabledReason || "该玩家暂不可选择",
          showCancel: false,
          confirmText: "知道了",
        });
        return;
      }
      this.setData({
        selectedExecutiveTargetId: memberId,
        selectedExecutiveTargetLabel: target ? target.label : "",
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
    const isRealSpectator = snapshot.viewerState && snapshot.viewerState.realMemberType === "spectator";
    const previousControlledMemberId = this.data.controlledMemberId || "";
    const nextControlledMemberId =
      isRealSpectator && previousControlledMemberId === memberId
        ? ""
        : memberId === snapshot.realMemberId
          ? ""
          : memberId;
    const crossedMemberType =
      isRealSpectator &&
      Boolean(previousControlledMemberId) !== Boolean(nextControlledMemberId);
    this.setData({
      controlledMemberId: nextControlledMemberId,
      errorText: "",
    });
    await this.loadGameSnapshot();
    const refreshedSnapshot = this.data.snapshot || {};
    const refreshedViewerState = refreshedSnapshot.viewerState || {};
    const viewSwitchSucceeded = nextControlledMemberId
      ? refreshedSnapshot.myMemberId === nextControlledMemberId &&
        refreshedViewerState.isSpectatorView === false
      : refreshedSnapshot.myMemberId === snapshot.realMemberId &&
        refreshedViewerState.isSpectatorView === true;
    if (crossedMemberType && viewSwitchSucceeded) {
      wx.showToast({
        title: nextControlledMemberId ? "已切换到玩家位" : "已切换到观战位",
        icon: "none",
      });
    }
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

  onDismissVoteModal() {
    if (!this.data.canVote) {
      return;
    }
    this.setData({
      voteModalVisible: false,
      voteModalTaskKey: this.data.voteModalTaskKey || "",
    });
  },

  onTapOpenVoteModal() {
    if (!this.data.canVote || this.data.isSubmittingCommand) {
      return;
    }
    this.setData({
      voteModalVisible: true,
    });
  },

  onTapDrawPile() {
    if (!this.data.canAckPolicyPeek || this.data.policyPeekCards.length !== 3) {
      return;
    }
    const currentReveal = this.data.policyPeekReveal || null;
    if (currentReveal && (currentReveal.visible || currentReveal.exiting)) {
      return;
    }
    const pendingTask = (this.data.snapshot && this.data.snapshot.pendingTask) || {};
    const revealKey = `${(this.data.snapshot && this.data.snapshot.myMemberId) || ""}:${
      pendingTask.taskId || (this.data.snapshot && this.data.snapshot.version) || ""
    }`;
    const policyPeekReveal = {
      revealKey,
      visible: true,
      exiting: false,
      dismissible: false,
    };
    this.setData({
      policyPeekReveal,
    });
    this.schedulePolicyPeekRevealReady(revealKey);
  },

  onDismissPolicyPeekReveal() {
    const reveal = this.data.policyPeekReveal || null;
    if (!reveal || !reveal.dismissible || reveal.exiting) {
      return;
    }
    this.clearPolicyPeekRevealTimers();
    this.setData({
      policyPeekReveal: {
        ...reveal,
        visible: false,
        exiting: true,
        dismissible: false,
      },
    });
    this.policyPeekRevealExitTimer = setTimeout(() => {
      this.policyPeekRevealExitTimer = null;
      const currentReveal = this.data.policyPeekReveal || null;
      if (currentReveal && currentReveal.revealKey === reveal.revealKey && currentReveal.exiting) {
        this.setData({
          policyPeekReveal: null,
        });
      }
    }, POLICY_PEEK_REVEAL_EXIT_MS);
  },

  onDismissInvestigationReveal() {
    const reveal = this.data.investigationReveal || null;
    if (!reveal || reveal.exiting) {
      return;
    }
    this.setData({
      investigationReveal: {
        ...reveal,
        visible: false,
        exiting: true,
      },
      shownInvestigationRevealKey: reveal.resultKey || this.data.shownInvestigationRevealKey,
    });
    setTimeout(() => {
      const currentReveal = this.data.investigationReveal || null;
      if (currentReveal && currentReveal.resultKey === reveal.resultKey) {
        this.setData({
          investigationReveal: null,
        });
      }
    }, INVESTIGATION_REVEAL_EXIT_MS);
  },

  onDismissIdentityIntroReveal() {
    const reveal = this.data.identityIntroReveal || null;
    if (!reveal || reveal.exiting) {
      return;
    }
    this.setData({
      identityIntroReveal: {
        ...reveal,
        titleVisible: false,
        visible: false,
        exiting: true,
      },
    });
    setTimeout(() => {
      const currentReveal = this.data.identityIntroReveal || null;
      if (currentReveal && currentReveal.role === reveal.role) {
        this.setData({
          identityIntroReveal: null,
        });
      }
    }, IDENTITY_INTRO_REVEAL_EXIT_MS);
  },

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
      selectedExecutiveTargetId: this.resolveSelectedExecutiveTargetId(snapshot),
      selectedExecutiveTargetLabel: this.createSelectedExecutiveTargetLabel(snapshot),
      activeIdentityPickerOptions: this.createActiveIdentityPickerOptions(this.data.activeIdentityPickerMemberId, snapshot),
    });
  },

  onTapNominateSelected() {
    if (this.data.isSubmittingCommand) {
      return;
    }
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
        title: this.createCommandFailureToast(err, "提交提名失败"),
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

    const voteText = vote === "JA" ? "赞同 JA" : "反对 NEIN";
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
        title: "投票已提交，等待局势更新",
        icon: "none",
      });
      if (this.redirectToResultIfNeeded(result.data)) {
        return;
      }
      this.markCommandSettled();
      this.setData({
        canVote: false,
        voteModalVisible: false,
        voteModalTaskKey: "",
        statusText: "投票已提交，等待局势更新",
      });
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
        this.loadGameSnapshot({ silent: true });
      }
      wx.showToast({
        title: err.code === "DUPLICATE_COMMAND" ? "投票已提交" : this.createCommandFailureToast(err, "提交投票失败"),
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
        title: this.createCommandFailureToast(err, isDiscard ? "提交弃牌失败" : "提交颁布失败"),
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
        title: this.createCommandFailureToast(err, "提出否决失败"),
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
        title: this.createCommandFailureToast(err, "回应否决失败"),
        icon: "none",
      });
    } finally {
      this.setData({
        isSubmittingCommand: false,
      });
    }
  },

  async onTapExecutiveSelected() {
    if (this.data.isSubmittingCommand) {
      return;
    }
    const targetMemberId = this.data.selectedExecutiveTargetId;
    if (!targetMemberId) {
      wx.showToast({
        title: "请先点击一个玩家席位",
        icon: "none",
      });
      return;
    }
    const target = (this.data.executiveTargets || []).find((item) => item.memberId === targetMemberId);
    if (!target) {
      wx.showToast({
        title: "该玩家暂不可选择",
        icon: "none",
      });
      return;
    }
    if (!target.canTarget) {
      wx.showModal({
        title: "不可选择",
        content: target.disabledReason || "该玩家暂不可选择",
        showCancel: false,
        confirmText: "知道了",
      });
      return;
    }

    const snapshot = this.data.snapshot || {};
    const pendingTask = snapshot.pendingTask || {};
    const action = this.data.executiveAction || {};
    const isExecution = pendingTask.taskType === "EXECUTE_PLAYER";
    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: action.title || "确认总统权力",
        content: isExecution ? `确认处决${target.label}？目标将立即出局。` : `确认选择${target.label}？`,
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
    if (pendingTask.taskType !== "EXEC_POLICY_PEEK_ACK" || this.data.isSubmittingCommand || this.policyPeekAckConfirming) {
      return;
    }

    this.policyPeekAckConfirming = true;
    try {
      const confirmRes = await new Promise((resolve) => {
        wx.showModal({
          title: "确认完成政策预览",
          content: "确认完成政策预览？牌库顶 3 张政策牌将按原顺序放回，并进入下一轮。",
          confirmText: "确认完成",
          cancelText: "取消",
          success: resolve,
          fail: () => resolve({ confirm: false }),
        });
      });
      if (!confirmRes.confirm) {
        return;
      }

      await this.submitExecutiveCommand({
        commandType: "EXEC_POLICY_PEEK_ACK",
        body: {
          acknowledged: true,
        },
        toastText: "政策预览已确认",
      });
    } finally {
      this.policyPeekAckConfirming = false;
    }
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
      if (options.commandType === "EXEC_INVESTIGATE") {
        this.pendingInvestigationRevealActorId = snapshot.myMemberId || "";
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
        title: this.createCommandFailureToast(err, "提交总统权力失败"),
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
    if (this.data.isLeaving || this.isLeaveConfirming) {
      return;
    }

    this.isLeaveConfirming = true;
    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认离开",
        content: "离开后无法回到当前对局",
        confirmText: "确认",
        cancelText: "取消",
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    this.isLeaveConfirming = false;

    if (!confirmRes.confirm) {
      return;
    }

    if (!this.data.roomId || !wx.cloud) {
      clearGameSnapshotCache(this.data.roomId);
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

    clearGameSnapshotCache(this.data.roomId);
    wx.reLaunch({
      url: "/pages/home/index",
    });
  },
});
