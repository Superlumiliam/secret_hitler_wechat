const { sessionStore } = require('../../../store/sessionStore');
const { gameStore } = require('../../../store/gameStore');
const { uiStore } = require('../../../store/uiStore');
const { createStoreBinding } = require('../../../behaviors/withStore');
const { snapshotService } = require('../../../services/snapshotService');
const { gameService } = require('../../../services/gameService');
const { COPY } = require('../../../constants/copy');
const { ROUTE } = require('../../../constants/route');
const { normalizeError, getErrorCopy, shouldRefreshOnError } = require('../../../mappers/errorMapper');
const { redirectToRoute, reLaunchToRoute } = require('../../../utils/router');

Page({
  data: {
    roomId: '',
    safeModeText: COPY.SAFE_MODE,
    actionPanelVisible: false,
    currentPanel: '',
    currentTaskId: '',
    secretMasked: true,
    submitting: false,
    errorText: '',
    board: {
      phase: '',
      phaseTitle: '',
      phaseDescription: '',
      phaseDanger: false,
      round: 0,
      players: [],
      government: {
        president: null,
        chancellor: null,
        presidentCandidate: null,
        chancellorCandidate: null,
      },
      tracks: {
        liberal: 0,
        fascist: 0,
        electionTracker: 0,
        vetoUnlocked: false,
      },
      publicLogs: [],
      currentTaskSummary: '当前无需操作',
    },
    task: {
      taskId: '',
      taskType: '',
      title: '',
      description: '',
      actionMode: 'none',
      cards: [],
      targets: [],
      extra: {},
    },
    identity: {
      roomId: '',
      knownMembers: [],
    },
    peekCards: [],
    peekSummary: '',
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '桌面' });
    this._gameUnsub = createStoreBinding(this, gameStore, (state) => ({
      board: state.boardVm || {
        phase: '',
        phaseTitle: '',
        phaseDescription: '',
        phaseDanger: false,
        round: 0,
        players: [],
        government: {
          president: null,
          chancellor: null,
          presidentCandidate: null,
          chancellorCandidate: null,
        },
        tracks: {
          liberal: 0,
          fascist: 0,
          electionTracker: 0,
          vetoUnlocked: false,
        },
        publicLogs: [],
        currentTaskSummary: '当前无需操作',
      },
      task: state.taskVm || {
        taskId: '',
        taskType: '',
        title: '',
        description: '',
        actionMode: 'none',
        cards: [],
        targets: [],
        extra: {},
      },
      identity: state.identityVm || {
        roomId: '',
        knownMembers: [],
      },
      taskType: state.taskVm ? state.taskVm.taskType : '',
      snapshot: state.snapshot,
      loading: state.loading,
      resultVm: state.resultVm,
      peekCards: state.snapshot && state.snapshot.privateState && state.snapshot.privateState.policyPeek
        ? state.snapshot.privateState.policyPeek.cards || []
        : [],
      peekSummary: state.snapshot && state.snapshot.privateState && state.snapshot.privateState.policyPeek
        ? `已查看 ${((state.snapshot.privateState.policyPeek.cards || []).length)} 张牌`
        : '',
    }));
    this._uiUnsub = createStoreBinding(this, uiStore, (state) => ({
      privacyShieldVisible: state.privacyShieldVisible,
    }));
    const roomId = options && options.roomId ? options.roomId : sessionStore.getState().activeRoomId;
    if (!roomId) {
      reLaunchToRoute(ROUTE.HOME);
      return;
    }
    this.setData({ roomId });
    this.refreshGame(roomId);
  },

  onShow() {
    uiStore.patch({ privacyShieldVisible: false });
    const roomId = this.data.roomId;
    if (roomId && !this._stopSync) {
      this._stopSync = snapshotService.startGameSync(roomId);
    }
  },

  onHide() {
    this.setData({
      actionPanelVisible: false,
      currentPanel: '',
      secretMasked: true,
    });
    uiStore.patch({ privacyShieldVisible: true });
  },

  onUnload() {
    if (this._gameUnsub) this._gameUnsub();
    if (this._uiUnsub) this._uiUnsub();
    if (this._stopSync) this._stopSync();
    this._gameUnsub = null;
    this._uiUnsub = null;
    this._stopSync = null;
  },

  handleOpenTask() {
    const task = gameStore.getState().taskVm;
    if (!task) return;
    this.setData({
      actionPanelVisible: true,
      currentPanel: task.actionMode,
      currentTaskId: task.taskId,
      secretMasked: true,
      taskType: task.taskType,
    });
  },

  closePanels() {
    this.setData({
      actionPanelVisible: false,
      currentPanel: '',
      currentTaskId: '',
      secretMasked: true,
    });
  },

  async submitGameCommand(type, body, extra) {
    if (this.data.submitting) return;
    const task = gameStore.getState().taskVm;
    const targetRoomId = this.data.roomId || sessionStore.getState().activeRoomId;
    this.setData({ submitting: true, errorText: '' });
    try {
      await gameService.submitCommand({
        roomId: targetRoomId,
        type,
        body,
        taskId: extra && extra.taskId ? extra.taskId : this.data.currentTaskId || (task && task.taskId),
      });
      const snapshot = await gameService.getGameSnapshot(targetRoomId);
      this.afterSnapshot(snapshot);
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code === 'GAME_ALREADY_ENDED') {
        try {
          await gameService.getResultSnapshot(targetRoomId);
          redirectToRoute(ROUTE.RESULT, { roomId: targetRoomId });
          return;
        } catch (resultError) {
          const next = normalizeError(resultError);
          this.setData({ errorText: getErrorCopy(next.code, next.message) });
        }
      } else {
        this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
      }
      if (shouldRefreshOnError(normalized.code)) {
        try {
          const snapshot = await gameService.getGameSnapshot(targetRoomId);
          this.afterSnapshot(snapshot);
        } catch (refreshError) {
          const next = normalizeError(refreshError);
          this.setData({ errorText: getErrorCopy(next.code, next.message) });
        }
      }
    } finally {
      this.setData({ submitting: false });
    }
  },

  handleVoteSelect(e) {
    this.setData({ selectedVote: e.detail.vote });
  },

  handleVoteConfirm(e) {
    const vote = e.detail.vote || this.data.selectedVote;
    if (!vote) return;
    this.submitGameCommand('SUBMIT_VOTE', { vote });
    this.closePanels();
  },

  handleVoteCancel() {
    this.closePanels();
  },

  handlePolicySelect(e) {
    this.setData({ selectedPolicyIndex: e.detail.index });
  },

  handlePolicyConfirm(e) {
    const task = gameStore.getState().taskVm;
    const index = typeof e.detail.index === 'number' ? e.detail.index : e.detail.card && e.detail.card.index;
    if (index === undefined || index === null || index < 0) return;
    const type = task && task.taskType;
    if (!type) return;
    const body =
      type === 'PRESIDENT_DISCARD_POLICY'
        ? { discardPolicyIndex: index }
        : { enactPolicyIndex: index };
    this.submitGameCommand(type, body);
    this.closePanels();
  },

  handleRequestVeto() {
    this.submitGameCommand('CHANCELLOR_REQUEST_VETO', { request: true });
    this.closePanels();
  },

  handleVetoAccept() {
    this.submitGameCommand('PRESIDENT_RESPOND_VETO', { accepted: true });
    this.closePanels();
  },

  handleVetoReject() {
    this.submitGameCommand('PRESIDENT_RESPOND_VETO', { accepted: false });
    this.closePanels();
  },

  handleTargetSelect(e) {
    this.setData({ selectedTargetId: e.detail.target && e.detail.target.memberId });
  },

  handleTargetConfirm(e) {
    const task = gameStore.getState().taskVm;
    const target = e.detail.target;
    if (!target) return;
    if (!task || !task.taskType) return;
    let body = { targetMemberId: target.memberId };
    if (task.taskType === 'EXECUTE_PLAYER') {
      wx.showModal({
        title: '危险操作确认',
        content: '该操作不可撤销，确认继续吗？',
        success: (res) => {
          if (res.confirm) {
            this.submitGameCommand(task.taskType, body);
            this.closePanels();
          }
        },
      });
      return;
    }
    this.submitGameCommand(task.taskType, body);
    this.closePanels();
  },

  handleSecretReveal() {
    this.setData({ secretMasked: false });
  },

  handleSecretConfirm() {
    const task = gameStore.getState().taskVm;
    if (!task || task.taskType !== 'EXEC_POLICY_PEEK_ACK') return;
    this.submitGameCommand('EXEC_POLICY_PEEK_ACK', { acknowledged: true });
    this.closePanels();
  },

  handleSecretClose() {
    this.closePanels();
  },

  refreshGame(roomId) {
    const targetRoomId = typeof roomId === 'string' && roomId ? roomId : this.data.roomId || sessionStore.getState().activeRoomId;
    if (!targetRoomId) return;
    gameService.getGameSnapshot(targetRoomId)
      .then((snapshot) => this.afterSnapshot(snapshot))
      .catch((error) => {
        const normalized = normalizeError(error);
        if (normalized.code === 'GAME_ALREADY_ENDED') {
          gameService.getResultSnapshot(targetRoomId)
            .then(() => redirectToRoute(ROUTE.RESULT, { roomId: targetRoomId }))
            .catch((resultError) => {
              const next = normalizeError(resultError);
              this.setData({ errorText: getErrorCopy(next.code, next.message) });
            });
          return;
        }
        this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
        if (normalized.code === 'ROOM_EXPIRED') {
          reLaunchToRoute(ROUTE.HOME);
        }
      });
    if (!this._stopSync) {
      this._stopSync = snapshotService.startGameSync(targetRoomId);
    }
  },

  afterSnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.roomStatus === 'ended' || snapshot.currentPhase === 'game_ended') {
      redirectToRoute(ROUTE.RESULT, { roomId: snapshot.roomId });
      return;
    }
    if (snapshot.currentPhase === 'role_reveal') {
      redirectToRoute(ROUTE.IDENTITY, { roomId: snapshot.roomId });
      return;
    }
    const task = gameStore.getState().taskVm;
    if (!task) {
      this.closePanels();
    }
  },

  onShareAppMessage() {
    return {
      title: COPY.APP_TITLE,
      path: '/pages/home/index',
    };
  },
});
