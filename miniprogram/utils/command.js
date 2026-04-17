const { readStorage, writeStorage } = require('./storage');
const { STORAGE_KEYS } = require('../constants/phase');

function randomSegment() {
  return Math.random().toString(36).slice(2, 8);
}

function getMemberPrefix() {
  const session = readStorage(STORAGE_KEYS.SESSION, {});
  if (session && session.activeMemberId) {
    return session.activeMemberId;
  }
  return 'member';
}

function createCommandId(scope) {
  const prefix = scope || getMemberPrefix();
  return `${prefix}_${Date.now()}_${randomSegment()}`;
}

function getCommandCacheKey(scope) {
  return `secret_hitler_cmd_${scope}`;
}

function rememberCommandId(scope, commandId) {
  writeStorage(getCommandCacheKey(scope), commandId);
}

function reuseOrCreateCommandId(scope) {
  const key = getCommandCacheKey(scope);
  const cached = readStorage(key, null);
  if (cached) {
    return cached;
  }
  const commandId = createCommandId(scope);
  rememberCommandId(scope, commandId);
  return commandId;
}

function clearCommandId(scope) {
  writeStorage(getCommandCacheKey(scope), null);
}

module.exports = {
  createCommandId,
  reuseOrCreateCommandId,
  rememberCommandId,
  clearCommandId,
};

