const { sessionStore } = require('../../store/sessionStore');
const { createStoreBinding } = require('../../behaviors/withStore');
const { roomService } = require('../../services/roomService');
const { bootstrapService } = require('../../services/bootstrapService');
const { shareService } = require('../../services/shareService');
const { ROUTE } = require('../../constants/route');
const { COPY } = require('../../constants/copy');
const { normalizeRoomCode } = require('../../utils/guard');
const { normalizeError, shouldReturnHomeOnError, getErrorCopy } = require('../../mappers/errorMapper');
const { redirectToRoute, navigateToRoute } = require('../../utils/router');

Page({
  data: {
    displayName: '',
    roomCode: '',
    creating: false,
    joining: false,
    recovering: false,
    canRecover: false,
    activeRoomCode: '',
    errorText: '',
    loadingText: '',
    subtitle: COPY.APP_TAGLINE,
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: COPY.APP_TITLE });
    this._unsubscribe = createStoreBinding(this, sessionStore, (state) => ({
      displayName: state.displayName,
      activeRoomCode: state.activeRoomCode || '',
      canRecover: !!state.activeRoomId,
    }));
    if (options && options.roomCode) {
      this.setData({
        roomCode: normalizeRoomCode(options.roomCode),
      });
    }
  },

  onShow() {
    const state = sessionStore.getState();
    this.setData({
      displayName: state.displayName,
      activeRoomCode: state.activeRoomCode || '',
      canRecover: !!state.activeRoomId,
    });
  },

  onUnload() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  },

  onDisplayNameInput(e) {
    this.setData({
      displayName: (e.detail.value || '').slice(0, 20),
      errorText: '',
    });
  },

  onRoomCodeInput(e) {
    this.setData({
      roomCode: normalizeRoomCode(e.detail.value),
      errorText: '',
    });
  },

  async handleCreateRoom() {
    if (this.data.creating) return;
    const displayName = this.data.displayName || sessionStore.getState().displayName;
    this.setData({ creating: true, errorText: '' });
    try {
      const data = await roomService.createRoom(displayName);
      const roomId = data.roomId || (data.lobbySnapshot && data.lobbySnapshot.roomId);
      if (!roomId) {
        throw new Error('missing roomId');
      }
      redirectToRoute(ROUTE.LOBBY, { roomId });
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({
        errorText: getErrorCopy(normalized.code, normalized.message),
      });
      if (shouldReturnHomeOnError(normalized.code)) {
        redirectToRoute(ROUTE.HOME);
      }
    } finally {
      this.setData({ creating: false });
    }
  },

  async handleJoinRoom() {
    if (this.data.joining) return;
    const displayName = this.data.displayName || sessionStore.getState().displayName;
    const roomCode = normalizeRoomCode(this.data.roomCode);
    if (!roomCode) {
      this.setData({ errorText: '请输入 6 位房号' });
      return;
    }
    this.setData({ joining: true, errorText: '' });
    try {
      const data = await roomService.joinRoom(roomCode, displayName);
      const roomId = data.roomId || (data.lobbySnapshot && data.lobbySnapshot.roomId);
      if (!roomId) {
        throw new Error('missing roomId');
      }
      redirectToRoute(ROUTE.LOBBY, { roomId });
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({
        errorText: getErrorCopy(normalized.code, normalized.message),
      });
    } finally {
      this.setData({ joining: false });
    }
  },

  async handleRecoverRoom() {
    if (this.data.recovering) return;
    this.setData({ recovering: true, errorText: '' });
    try {
      const result = await bootstrapService.recoverActiveRoom();
      if (!result || !result.activeRoom) {
        this.setData({ errorText: '暂时没有可恢复的房间' });
        return;
      }
      const activeRoom = result.activeRoom;
      const route = this.resolveActiveRoomRoute(activeRoom.routeHint);
      redirectToRoute(route, { roomId: activeRoom.roomId });
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({
        errorText: getErrorCopy(normalized.code, normalized.message),
      });
    } finally {
      this.setData({ recovering: false });
    }
  },

  handleShareEntry() {
    const share = shareService.buildHomeShareMessage(this.data.activeRoomCode || this.data.roomCode);
    wx.setClipboardData({
      data: share.path,
    });
  },

  onShareAppMessage() {
    return shareService.buildHomeShareMessage(this.data.activeRoomCode || this.data.roomCode);
  },

  resolveActiveRoomRoute(routeHint) {
    if (routeHint === 'lobby') return ROUTE.LOBBY;
    if (routeHint === 'identity') return ROUTE.IDENTITY;
    if (routeHint === 'board') return ROUTE.BOARD;
    if (routeHint === 'result') return ROUTE.RESULT;
    return ROUTE.HOME;
  },
});
