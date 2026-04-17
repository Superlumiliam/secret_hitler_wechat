const { callCloudAction, callWriteAction } = require('./cloud');
const { mapLobbySnapshot } = require('../mappers/lobbyMapper');
const { roomStore } = require('../store/roomStore');
const { sessionStore, setActiveRoom } = require('../store/sessionStore');
const { normalizeDisplayName, normalizeRoomCode, ensureDisplayName } = require('../utils/guard');
const { normalizeError } = require('../mappers/errorMapper');

function syncLobbySnapshot(snapshot) {
  roomStore.patch({
    lobbySnapshot: snapshot,
    lobbyVm: mapLobbySnapshot(snapshot),
    lastVersion: snapshot ? snapshot.version : null,
    loading: false,
    refreshing: false,
  });
  if (snapshot) {
    setActiveRoom({
      roomId: snapshot.roomId,
      roomCode: snapshot.roomCode,
      roomStatus: snapshot.roomStatus,
      memberId: snapshot.myMemberId,
    });
  }
}

async function createRoom(displayName) {
  const payload = {
    displayName: ensureDisplayName(displayName),
  };
  const data = await callWriteAction('roomService', 'createRoom', payload, {
    scope: `room:create:${normalizeDisplayName(displayName)}`,
  });
  if (data && data.lobbySnapshot) {
    syncLobbySnapshot(data.lobbySnapshot);
  }
  return data;
}

async function joinRoom(roomCode, displayName) {
  const payload = {
    roomCode: normalizeRoomCode(roomCode),
    displayName: ensureDisplayName(displayName),
  };
  const data = await callWriteAction('roomService', 'joinRoom', payload, {
    scope: `room:join:${payload.roomCode}:${normalizeDisplayName(displayName)}`,
  });
  if (data && data.lobbySnapshot) {
    syncLobbySnapshot(data.lobbySnapshot);
  }
  return data;
}

async function leaveRoom(roomId) {
  const data = await callWriteAction('roomService', 'leaveRoom', { roomId }, {
    scope: `room:leave:${roomId}`,
  });
  setActiveRoom(null);
  roomStore.patch({
    lobbySnapshot: null,
    lobbyVm: null,
    loading: false,
    refreshing: false,
    lastVersion: null,
    error: null,
  });
  return data;
}

async function getLobbySnapshot(roomId) {
  roomStore.patch({ loading: true });
  try {
    const snapshot = await callCloudAction('roomService', 'getLobbySnapshot', { roomId });
    syncLobbySnapshot(snapshot);
    return snapshot;
  } catch (error) {
    roomStore.patch({ loading: false });
    throw error;
  }
}

async function updateDisplayName(roomId, displayName) {
  const payload = {
    roomId,
    displayName: ensureDisplayName(displayName),
  };
  const data = await callWriteAction('roomService', 'updateDisplayName', payload, {
    scope: `room:updateName:${roomId}`,
  });
  if (data && data.lobbySnapshot) {
    syncLobbySnapshot(data.lobbySnapshot);
  }
  return data;
}

async function updateSeatOrder(roomId, orderedMemberIds) {
  const data = await callWriteAction('roomService', 'updateSeatOrder', {
    roomId,
    orderedMemberIds,
  }, {
    scope: `room:updateSeat:${roomId}`,
  });
  if (data && data.lobbySnapshot) {
    syncLobbySnapshot(data.lobbySnapshot);
  }
  return data;
}

async function setReady(roomId, ready) {
  const data = await callWriteAction('roomService', 'setReady', {
    roomId,
    ready: !!ready,
  }, {
    scope: `room:setReady:${roomId}:${ready ? '1' : '0'}`,
  });
  if (data && data.lobbySnapshot) {
    syncLobbySnapshot(data.lobbySnapshot);
  }
  return data;
}

async function startGame(roomId) {
  const data = await callWriteAction('roomService', 'startGame', { roomId }, {
    scope: `room:start:${roomId}`,
  });
  return data;
}

module.exports = {
  roomService: {
    createRoom,
    joinRoom,
    leaveRoom,
    getLobbySnapshot,
    updateDisplayName,
    updateSeatOrder,
    setReady,
    startGame,
  },
};
