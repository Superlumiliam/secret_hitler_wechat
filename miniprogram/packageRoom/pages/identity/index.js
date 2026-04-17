const { sessionStore } = require('../../../store/sessionStore');
const { gameStore } = require('../../../store/gameStore');
const { uiStore } = require('../../../store/uiStore');
const { createStoreBinding } = require('../../../behaviors/withStore');
const { gameService } = require('../../../services/gameService');
const { snapshotService } = require('../../../services/snapshotService');
const { COPY } = require('../../../constants/copy');
const { ROUTE } = require('../../../constants/route');
const { normalizeError, getErrorCopy, shouldRefreshOnError } = require('../../../mappers/errorMapper');
const { redirectToRoute, reLaunchToRoute } = require('../../../utils/router');

Page({
  data: {
    roomId: '',
    revealed: false,
    ackSubmitting: false,
    errorText: '',
    safeModeText: COPY.SAFE_MODE,
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '身份确认' });
    this._gameUnsub = createStoreBinding(this, gameStore, (state) => ({
      identityVm: state.identityVm || {
        roomId: '',
        roomCode: '',
        acknowledged: false,
        role: null,
        party: null,
        knownMembers: [],
        title: '',
        description: '',
      },
      loading: state.loading,
      taskVm: state.taskVm || null,
      snapshot: state.snapshot,
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
    this.setData({ revealed: false });
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

  handleReveal() {
    this.setData({ revealed: true });
  },

  handleCloseIdentity() {
    this.setData({ revealed: false });
  },

  async handleAckIdentity() {
    if (this.data.ackSubmitting) return;
    const task = gameStore.getState().taskVm;
    const roomId = this.data.roomId;
    this.setData({ ackSubmitting: true, errorText: '' });
    try {
      await gameService.submitCommand({
        roomId,
        type: 'ACK_ROLE_REVEAL',
        body: { acknowledged: true },
        taskId: task && task.taskId,
      });
      const snapshot = await gameService.getGameSnapshot(roomId);
      this.syncRoute(snapshot);
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
      if (shouldRefreshOnError(normalized.code)) {
        try {
          const snapshot = await gameService.getGameSnapshot(roomId);
          this.syncRoute(snapshot);
        } catch (refreshError) {
          const next = normalizeError(refreshError);
          this.setData({ errorText: getErrorCopy(next.code, next.message) });
        }
      }
    } finally {
      this.setData({ ackSubmitting: false });
    }
  },

  handleCopyRoom() {
    const identityVm = gameStore.getState().identityVm;
    if (!identityVm) return;
    wx.setClipboardData({
      data: identityVm.roomCode,
    });
  },

  onShareAppMessage() {
    return {
      title: COPY.APP_TITLE,
      path: '/pages/home/index',
    };
  },

  refreshGame(roomId) {
    const targetRoomId = typeof roomId === 'string' && roomId ? roomId : this.data.roomId || sessionStore.getState().activeRoomId;
    if (!targetRoomId) return;
    gameService.getGameSnapshot(targetRoomId)
      .then((snapshot) => this.syncRoute(snapshot))
      .catch((error) => {
        const normalized = normalizeError(error);
        this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
        if (normalized.code === 'ROOM_EXPIRED') {
          reLaunchToRoute(ROUTE.HOME);
        }
      });
    if (!this._stopSync) {
      this._stopSync = snapshotService.startGameSync(targetRoomId);
    }
  },

  syncRoute(snapshot) {
    if (!snapshot) return;
    if (snapshot.roomStatus === 'ended' || snapshot.currentPhase === 'game_ended') {
      redirectToRoute(ROUTE.RESULT, { roomId: snapshot.roomId });
      return;
    }
    if (snapshot.currentPhase !== 'role_reveal') {
      redirectToRoute(ROUTE.BOARD, { roomId: snapshot.roomId });
    }
  },
});
