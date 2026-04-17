const { ERROR_CODE, ROOM_STATUS } = require('../constants/phase');

function isTruthyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRoomCode(code) {
  return String(code || '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .slice(0, 6);
}

function normalizeDisplayName(name) {
  return String(name || '').trim().slice(0, 20);
}

function isActiveRoomStatus(status) {
  return status === ROOM_STATUS.LOBBY || status === ROOM_STATUS.IN_GAME || status === ROOM_STATUS.ENDED;
}

function ensureDisplayName(name) {
  const normalized = normalizeDisplayName(name);
  if (!normalized) {
    const error = new Error('displayName required');
    error.code = ERROR_CODE.INVALID_PAYLOAD;
    throw error;
  }
  return normalized;
}

module.exports = {
  isTruthyString,
  normalizeRoomCode,
  normalizeDisplayName,
  isActiveRoomStatus,
  ensureDisplayName,
};

