const { roomService } = require('./roomService');
const { gameService } = require('./gameService');
const { sessionStore } = require('../store/sessionStore');
const { roomStore } = require('../store/roomStore');
const { gameStore } = require('../store/gameStore');
const { emitHidden, visibilityBus } = require('../utils/visibility');
const { logger } = require('../utils/logger');

const activeSyncs = new Map();

function createSyncKey(type, id) {
  return `${type}:${id}`;
}

function stopSync(key) {
  const sync = activeSyncs.get(key);
  if (!sync) return;
  if (sync.timer) clearInterval(sync.timer);
  if (sync.watchers) {
    sync.watchers.forEach((watcher) => {
      if (watcher && typeof watcher.close === 'function') {
        watcher.close();
      } else if (typeof watcher === 'function') {
        watcher();
      }
    });
  }
  activeSyncs.delete(key);
}

function stopAll() {
  Array.from(activeSyncs.keys()).forEach((key) => stopSync(key));
}

function pauseAll() {
  stopAll();
  emitHidden();
}

function startLobbySync(roomId, onUpdate, onError) {
  const key = createSyncKey('lobby', roomId);
  stopSync(key);
  const sync = { timer: null, watchers: [] };
  activeSyncs.set(key, sync);

  const refresh = async () => {
    try {
      const snapshot = await roomService.getLobbySnapshot(roomId);
      if (typeof onUpdate === 'function') {
        onUpdate(snapshot);
      }
    } catch (error) {
      logger.warn('lobby sync refresh failed', error);
      roomStore.patch({ error });
      if (typeof onError === 'function') {
        onError(error);
      }
    }
  };

  refresh();
  sync.timer = setInterval(refresh, 2000);
  tryAttachWatchers(sync, 'room_public_snapshots', roomId, refresh);
  return () => stopSync(key);
}

function startGameSync(roomId, onUpdate, onError) {
  const key = createSyncKey('game', roomId);
  stopSync(key);
  const sync = { timer: null, watchers: [] };
  activeSyncs.set(key, sync);

  const refresh = async () => {
    try {
      const snapshot = await gameService.getGameSnapshot(roomId);
      if (typeof onUpdate === 'function') {
        onUpdate(snapshot);
      }
    } catch (error) {
      logger.warn('game sync refresh failed', error);
      gameStore.patch({ error });
      if (typeof onError === 'function') {
        onError(error);
      }
    }
  };

  refresh();
  sync.timer = setInterval(refresh, 1500);
  tryAttachWatchers(sync, 'room_public_snapshots', roomId, refresh);
  const memberId = sessionStore.getState().activeMemberId;
  if (memberId) {
    tryAttachWatchers(sync, 'player_private_snapshots', memberId, refresh);
  }
  return () => stopSync(key);
}

function tryAttachWatchers(sync, collectionName, docId, refresh) {
  try {
    if (!wx.cloud || !wx.cloud.database) return;
    const db = wx.cloud.database();
    const docWatcher = db.collection(collectionName).doc(docId).watch({
      onChange() {
        refresh();
      },
      onError(error) {
        logger.warn('watcher error', error);
      },
    });
    if (docWatcher) {
      sync.watchers.push(docWatcher);
    }
  } catch (error) {
    logger.info('database watch unavailable, fallback to polling');
  }
}

function refreshRoom(roomId) {
  return roomService.getLobbySnapshot(roomId);
}

function refreshGame(roomId) {
  return gameService.getGameSnapshot(roomId);
}

function refreshAfterCommand(roomId, mode) {
  if (mode === 'lobby') {
    return refreshRoom(roomId);
  }
  return refreshGame(roomId);
}

function onVisibilityChange(handler) {
  return visibilityBus.on('hidden', handler);
}

module.exports = {
  snapshotService: {
    startLobbySync,
    startGameSync,
    stopSync,
    stopAll,
    pauseAll,
    refreshRoom,
    refreshGame,
    refreshAfterCommand,
    onVisibilityChange,
  },
};
