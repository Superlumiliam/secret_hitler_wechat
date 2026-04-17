const { createStore } = require('./createStore');
const { STORAGE_KEYS, ROOM_STATUS } = require('../constants/phase');
const { readStorage, writeStorage } = require('../utils/storage');

function createInitialState() {
  const stored = readStorage(STORAGE_KEYS.SESSION, {});
  return {
    envReady: false,
    bootstrapReady: false,
    activeRoomId: stored.activeRoomId || null,
    activeRoomCode: stored.activeRoomCode || null,
    activeMemberId: stored.activeMemberId || null,
    activeRoomStatus: stored.activeRoomStatus || null,
    displayName: stored.displayName || `玩家${String(Math.floor(Math.random() * 9000) + 1000)}`,
    isNetworkAvailable: true,
    lastRecoverAt: stored.lastRecoverAt || null,
  };
}

const sessionStore = createStore(createInitialState);

sessionStore.subscribe((state) => {
  writeStorage(STORAGE_KEYS.SESSION, {
    displayName: state.displayName,
    activeRoomId: state.activeRoomId,
    activeRoomCode: state.activeRoomCode,
    activeMemberId: state.activeMemberId,
    activeRoomStatus: state.activeRoomStatus,
    lastRecoverAt: state.lastRecoverAt,
  });
  writeStorage(STORAGE_KEYS.DISPLAY_NAME, state.displayName);
  writeStorage(STORAGE_KEYS.ACTIVE_ROOM_ID, state.activeRoomId);
  writeStorage(STORAGE_KEYS.ACTIVE_ROOM_CODE, state.activeRoomCode);
  writeStorage(STORAGE_KEYS.ACTIVE_MEMBER_ID, state.activeMemberId);
  writeStorage(STORAGE_KEYS.ACTIVE_ROOM_STATUS, state.activeRoomStatus);
  writeStorage(STORAGE_KEYS.LAST_RECOVER_AT, state.lastRecoverAt);
});

function setActiveRoom(room) {
  if (!room) {
    sessionStore.patch({
      activeRoomId: null,
      activeRoomCode: null,
      activeMemberId: null,
      activeRoomStatus: null,
      lastRecoverAt: Date.now(),
    });
    return;
  }
  sessionStore.patch({
    activeRoomId: room.roomId || null,
    activeRoomCode: room.roomCode || null,
    activeMemberId: room.memberId || null,
    activeRoomStatus: room.roomStatus || null,
    lastRecoverAt: Date.now(),
  });
}

function resetActiveRoom() {
  setActiveRoom(null);
}

module.exports = {
  sessionStore,
  setActiveRoom,
  resetActiveRoom,
};

