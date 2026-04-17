const { sessionStore } = require('../../../store/sessionStore');
const { gameStore } = require('../../../store/gameStore');
const { createStoreBinding } = require('../../../behaviors/withStore');
const { gameService } = require('../../../services/gameService');
const { COPY } = require('../../../constants/copy');
const { ROUTE } = require('../../../constants/route');
const { normalizeError, getErrorCopy } = require('../../../mappers/errorMapper');
const { reLaunchToRoute, redirectToRoute } = require('../../../utils/router');

Page({
  data: {
    roomId: '',
    loading: true,
    errorText: '',
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '赛后结果' });
    this._gameUnsub = createStoreBinding(this, gameStore, (state) => ({
      resultVm: state.resultVm,
      loading: state.loading,
    }));
    const roomId = options && options.roomId ? options.roomId : sessionStore.getState().activeRoomId;
    if (!roomId) {
      reLaunchToRoute(ROUTE.HOME);
      return;
    }
    this.setData({ roomId });
    this.refreshResult(roomId);
  },

  onUnload() {
    if (this._gameUnsub) this._gameUnsub();
    this._gameUnsub = null;
  },

  async refreshResult(roomId) {
    const targetRoomId = typeof roomId === 'string' && roomId ? roomId : this.data.roomId || sessionStore.getState().activeRoomId;
    if (!targetRoomId) return;
    this.setData({ loading: true, errorText: '' });
    try {
      const snapshot = await gameService.getResultSnapshot(targetRoomId);
      if (!snapshot || snapshot.roomStatus !== 'ended') {
        redirectToRoute(ROUTE.BOARD, { roomId: targetRoomId });
        return;
      }
      this.setData({ loading: false });
    } catch (error) {
      const normalized = normalizeError(error);
      this.setData({ errorText: getErrorCopy(normalized.code, normalized.message), loading: false });
      if (normalized.code === 'GAME_NOT_STARTED') {
        redirectToRoute(ROUTE.BOARD, { roomId: targetRoomId });
      }
      if (normalized.code === 'ROOM_EXPIRED') {
        reLaunchToRoute(ROUTE.HOME);
      }
    }
  },

  handleBackHome() {
    reLaunchToRoute(ROUTE.HOME);
  },

  handleOpenRules() {
    redirectToRoute(ROUTE.RULES);
  },

  onShareAppMessage() {
    return {
      title: COPY.APP_TITLE,
      path: '/pages/home/index',
    };
  },
});
