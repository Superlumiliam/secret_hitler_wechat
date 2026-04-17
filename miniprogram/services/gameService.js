const { callCloudAction, callWriteAction } = require('./cloud');
const { gameStore } = require('../store/gameStore');
const { mapGameSnapshot } = require('../mappers/gameMapper');
const { mapResultSnapshot } = require('../mappers/resultMapper');
const { normalizeError } = require('../mappers/errorMapper');

function syncGameSnapshot(snapshot) {
  const mapped = mapGameSnapshot(snapshot);
  gameStore.patch({
    snapshot,
    boardVm: mapped.boardVm,
    identityVm: mapped.identityVm,
    taskVm: mapped.taskVm,
    lastVersion: snapshot ? snapshot.version : null,
    loading: false,
    refreshing: false,
  });
}

async function getGameSnapshot(roomId) {
  gameStore.patch({ loading: true });
  try {
    const snapshot = await callCloudAction('gameService', 'getGameSnapshot', { roomId });
    syncGameSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    gameStore.patch({ loading: false });
    throw error;
  }
}

async function submitCommand(command) {
  const state = gameStore.getState();
  const snapshot = state.snapshot;
  const expectedVersion = snapshot && typeof snapshot.version === 'number' ? snapshot.version : state.lastVersion;
  if (typeof expectedVersion !== 'number') {
    throw normalizeError({
      code: 'INTERNAL_ERROR',
      message: '缺少可提交版本号，请先刷新快照',
      retryable: true,
    });
  }

  const scope = `game:${command.roomId}:${command.type}:${command.taskId || 'no-task'}`;
  const payload = {
    roomId: command.roomId,
    taskId: command.taskId || null,
    type: command.type,
    body: command.body || {},
    expectedVersion,
  };
  const data = await callWriteAction('gameService', 'submitCommand', payload, { scope });
  return data;
}

async function getResultSnapshot(roomId) {
  const snapshot = await callCloudAction('gameService', 'getResultSnapshot', { roomId });
  const resultVm = mapResultSnapshot(snapshot);
  gameStore.patch({ resultVm });
  return snapshot;
}

module.exports = {
  gameService: {
    getGameSnapshot,
    submitCommand,
    getResultSnapshot,
    syncGameSnapshot,
  },
};
