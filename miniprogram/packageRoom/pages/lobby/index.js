const { sessionStore } = require('../../../store/sessionStore');
const { roomStore } = require('../../../store/roomStore');
const { createStoreBinding } = require('../../../behaviors/withStore');
const { bootstrapService } = require('../../../services/bootstrapService');
const { roomService } = require('../../../services/roomService');
const { snapshotService } = require('../../../services/snapshotService');
const { shareService } = require('../../../services/shareService');
const { ROUTE } = require('../../../constants/route');
const { COPY } = require('../../../constants/copy');
const { normalizeDisplayName } = require('../../../utils/guard');
const { normalizeError, getErrorCopy } = require('../../../mappers/errorMapper');
const { redirectToRoute, reLaunchToRoute } = require('../../../utils/router');

Page({
  data: {
    roomId: '',
    displayName: '',
    renaming: false,
    readySubmitting: false,
    startSubmitting: false,
    seatSubmitting: false,
    leaving: false,
    errorText: '',
    shareEnabled: true,
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '房间大厅' });
    this._sessionUnsub = createStoreBinding(this, sessionStore, (state) => ({
      displayName: state.displayName,
      activeRoomCode: state.activeRoomCode || '',
    }));
    this._roomUnsub = createStoreBinding(this, roomStore, (state) => ({
      lobbyVm: state.lobbyVm || {
        roomId: '',
        roomCode: '',
        roomStatus: 'lobby',
        myMemberId: '',
        hostMemberId: '',
        isHost: false,
        canStart: false,
        playerCount: 0,
        minPlayerCount: 5,
        maxPlayerCount: 10,
        players: [],
        summaryText: '',
        version: 0,
        updatedAt: '',
      },
      loading: state.loading,
      errorText: state.error ? getErrorCopy(state.error.code, state.error.message) : '',
      isHost: state.lobbyVm ? state.lobbyVm.isHost : false,
      canStart: state.lobbyVm ? state.lobbyVm.canStart : false,
      myReady: state.lobbyVm && state.lobbyVm.players
        ? !!state.lobbyVm.players.find((item) => item.isSelf && item.isReady)
        : false,
    }));
    const roomId = options && options.roomId ? options.roomId : sessionStore.getState().activeRoomId;
    if (!roomId) {
      reLaunchToRoute(ROUTE.HOME);
      return;
    }
    this.setData({
      roomId,
      displayName: sessionStore.getState().displayName,
    });
    this.refreshLobby(roomId);
  },

  onShow() {
    const roomId = this.data.roomId || sessionStore.getState().activeRoomId;
    if (roomId && !this._stopSync) {
      this._stopSync = snapshotService.startLobbySync(
        roomId,
        null,
        this.handleLobbySyncError.bind(this)
      );
    }
  },

  onUnload() {
    if (this._sessionUnsub) this._sessionUnsub();
    if (this._roomUnsub) this._roomUnsub();
    if (this._stopSync) this._stopSync();
    this._sessionUnsub = null;
    this._roomUnsub = null;
    this._stopSync = null;
  },

  onDisplayNameInput(e) {
    this.setData({
      displayName: normalizeDisplayName(e.detail.value),
    });
  },

  async handleUpdateDisplayName() {
    if (this.data.renaming) return;
    const nextName = normalizeDisplayName(this.data.displayName);
    if (!nextName) return;
    this.setData({ renaming: true, errorText: '' });
    try {
      await roomService.updateDisplayName(this.data.roomId, nextName);
      sessionStore.patch({ displayName: nextName });
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
    } finally {
      this.setData({ renaming: false });
    }
  },

  async handleToggleReady() {
    if (this.data.readySubmitting) return;
    const lobby = roomStore.getState().lobbyVm;
    const me = lobby && lobby.players ? lobby.players.find((item) => item.isSelf) : null;
    if (!me) return;
    this.setData({ readySubmitting: true, errorText: '' });
    try {
      await roomService.setReady(this.data.roomId, !me.isReady);
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
    } finally {
      this.setData({ readySubmitting: false });
    }
  },

  async handleStartGame() {
    const lobby = roomStore.getState().lobbyVm;
    if (!lobby || !lobby.isHost || !lobby.canStart || this.data.startSubmitting) {
      return;
    }
    this.setData({ startSubmitting: true, errorText: '' });
    try {
      const result = await roomService.startGame(this.data.roomId);
      const route = this.resolveRouteFromHint(result.routeHint || 'identity');
      redirectToRoute(route, { roomId: this.data.roomId });
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
    } finally {
      this.setData({ startSubmitting: false });
    }
  },

  async handleMoveUp(e) {
    const roomId = this.data.roomId;
    const memberId = e.detail && e.detail.memberId;
    const lobby = roomStore.getState().lobbyVm;
    if (!lobby || !lobby.isHost || !memberId || this.data.seatSubmitting) return;
    const players = lobby.players.slice();
    const index = players.findIndex((item) => item.memberId === memberId);
    if (index <= 0) return;
    const next = players.slice();
    const temp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = temp;
    this.setData({ seatSubmitting: true, errorText: '' });
    try {
      await roomService.updateSeatOrder(roomId, next.map((item) => item.memberId));
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
    } finally {
      this.setData({ seatSubmitting: false });
    }
  },

  async handleMoveDown(e) {
    const roomId = this.data.roomId;
    const memberId = e.detail && e.detail.memberId;
    const lobby = roomStore.getState().lobbyVm;
    if (!lobby || !lobby.isHost || !memberId || this.data.seatSubmitting) return;
    const players = lobby.players.slice();
    const index = players.findIndex((item) => item.memberId === memberId);
    if (index < 0 || index >= players.length - 1) return;
    const next = players.slice();
    const temp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = temp;
    this.setData({ seatSubmitting: true, errorText: '' });
    try {
      await roomService.updateSeatOrder(roomId, next.map((item) => item.memberId));
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
    } finally {
      this.setData({ seatSubmitting: false });
    }
  },

  async handleLeaveRoom() {
    if (this.data.leaving) return;
    this.setData({ leaving: true });
    try {
      await roomService.leaveRoom(this.data.roomId);
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
    } finally {
      reLaunchToRoute(ROUTE.HOME);
      this.setData({ leaving: false });
    }
  },

  handleCopyRoom() {
    const lobby = roomStore.getState().lobbyVm;
    if (!lobby) return;
    wx.setClipboardData({
      data: lobby.roomCode,
    });
  },

  onShareAppMessage() {
    const lobby = roomStore.getState().lobbyVm;
    return shareService.buildRoomShareMessage(lobby || { roomCode: this.data.activeRoomCode, playerCount: 0, maxPlayerCount: 10 });
  },

  resolveRouteFromHint(routeHint) {
    if (routeHint === 'lobby') return ROUTE.LOBBY;
    if (routeHint === 'identity') return ROUTE.IDENTITY;
    if (routeHint === 'board') return ROUTE.BOARD;
    if (routeHint === 'result') return ROUTE.RESULT;
    return ROUTE.HOME;
  },

  async refreshLobby(roomId) {
    const targetRoomId = typeof roomId === 'string' && roomId ? roomId : this.data.roomId || sessionStore.getState().activeRoomId;
    if (!targetRoomId) return;
    try {
      const snapshot = await roomService.getLobbySnapshot(targetRoomId);
      if (snapshot && snapshot.roomStatus !== 'lobby') {
        redirectToRoute(this.resolveRouteFromHint(snapshot.routeHint || snapshot.roomStatus), { roomId: targetRoomId });
      }
      if (!this._stopSync) {
        this._stopSync = snapshotService.startLobbySync(
          targetRoomId,
          null,
          this.handleLobbySyncError.bind(this)
        );
      }
    } catch (error) {
      await this.handleLobbySyncError(error, targetRoomId);
    }
  },

  async handleLobbySyncError(error, roomId) {
    const normalized = normalizeError(error);
    if (normalized.code === 'GAME_ALREADY_STARTED' || normalized.code === 'GAME_ALREADY_ENDED') {
      try {
        const recovered = await bootstrapService.recoverActiveRoom();
        const activeRoom = recovered && recovered.activeRoom;
        if (activeRoom) {
          const route = this.resolveRouteFromHint(activeRoom.routeHint || activeRoom.roomStatus);
          redirectToRoute(route, { roomId: activeRoom.roomId });
          return;
        }
      } catch (recoverError) {
        const next = normalizeError(recoverError);
        this.setData({ errorText: getErrorCopy(next.code, next.message) });
      }
      reLaunchToRoute(ROUTE.HOME);
      return;
    }

    if (normalized.code === 'ROOM_EXPIRED' || normalized.code === 'ROOM_NOT_FOUND') {
      reLaunchToRoute(ROUTE.HOME);
      return;
    }

    this.setData({ errorText: getErrorCopy(normalized.code, normalized.message) });
  },
});
