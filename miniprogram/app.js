const { APP_EVENT, STORAGE_KEYS } = require('./constants/phase');
const { sessionStore } = require('./store/sessionStore');
const { uiStore } = require('./store/uiStore');
const { createEmitter } = require('./utils/emitter');
const { bootstrapService } = require('./services/bootstrapService');
const { snapshotService } = require('./services/snapshotService');
const { logger } = require('./utils/logger');
const { readStorage } = require('./utils/storage');

const ENV_ID = 'cloud1-9gcbbsjv4ce11da4';

App({
  globalData: {
    env: ENV_ID,
    bus: createEmitter(),
    startOptions: null,
  },

  onLaunch(options) {
    this.globalData.startOptions = options || {};

    if (!wx.cloud) {
      logger.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }

    wx.cloud.init({
      env: ENV_ID,
      traceUser: true,
    });

    sessionStore.patch({ envReady: true });
    this._syncLocalSession();
    this._bindNetworkListener();
    bootstrapService.ensureSession().catch((error) => {
      logger.warn('ensureSession failed', error);
    });
  },

  async onShow(options) {
    uiStore.patch({ privacyShieldVisible: false });
    sessionStore.patch({ bootstrapReady: true });

    const query = (options && options.query) || {};
    if (query.roomCode) {
      sessionStore.patch({ activeRoomCode: String(query.roomCode).toUpperCase() });
    }

    try {
      const recovery = await bootstrapService.recoverActiveRoom();
      if (recovery && recovery.activeRoom) {
        sessionStore.patch({
          activeRoomId: recovery.activeRoom.roomId,
          activeRoomCode: recovery.activeRoom.roomCode,
          activeMemberId: recovery.activeRoom.memberId,
          activeRoomStatus: recovery.activeRoom.roomStatus,
          lastRecoverAt: Date.now(),
        });
      }
    } catch (error) {
      logger.warn('recoverActiveRoom failed', error);
    }

    const appBus = this.globalData.bus;
    if (appBus) {
      appBus.emit(APP_EVENT.APP_FOREGROUND, { options });
    }
  },

  onHide() {
    uiStore.patch({ privacyShieldVisible: true });
    snapshotService.pauseAll();
    const appBus = this.globalData.bus;
    if (appBus) {
      appBus.emit(APP_EVENT.APP_HIDDEN, {});
    }
  },

  _syncLocalSession() {
    const stored = readStorage(STORAGE_KEYS.SESSION, {});
    if (stored && typeof stored === 'object') {
      sessionStore.patch({
        displayName: stored.displayName || sessionStore.getState().displayName,
        activeRoomId: stored.activeRoomId || null,
        activeRoomCode: stored.activeRoomCode || null,
        activeMemberId: stored.activeMemberId || null,
        activeRoomStatus: stored.activeRoomStatus || null,
      });
    }
  },

  _bindNetworkListener() {
    if (!wx.onNetworkStatusChange) {
      return;
    }

    wx.onNetworkStatusChange((res) => {
      sessionStore.patch({ isNetworkAvailable: !!res.isConnected });
      if (res.isConnected) {
        bootstrapService.recoverActiveRoom().catch((error) => logger.warn('network recover failed', error));
      }
    });
  },
});
