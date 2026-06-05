const DEFAULT_GAME_SNAPSHOT_CACHE_TTL_MS = 30 * 1000;
const snapshotByKey = new Map();

function normalizeKeyPart(value) {
  return typeof value === "string" ? value : "";
}

function createGameSnapshotCacheKey(roomId, controlledMemberId = "") {
  return `${normalizeKeyPart(roomId)}\0${normalizeKeyPart(controlledMemberId)}`;
}

function setGameSnapshotCache(roomId, controlledMemberId, snapshot, options = {}) {
  if (!roomId || !snapshot) {
    return;
  }

  const ttlMs = Number(options.ttlMs);
  snapshotByKey.set(createGameSnapshotCacheKey(roomId, controlledMemberId), {
    roomId,
    controlledMemberId: normalizeKeyPart(controlledMemberId),
    snapshot,
    expiresAt: Date.now() + (Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : DEFAULT_GAME_SNAPSHOT_CACHE_TTL_MS),
  });
}

function getGameSnapshotCache(roomId, controlledMemberId = "") {
  if (!roomId) {
    return null;
  }

  const key = createGameSnapshotCacheKey(roomId, controlledMemberId);
  const entry = snapshotByKey.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    snapshotByKey.delete(key);
    return null;
  }
  return entry.snapshot;
}

function clearGameSnapshotCache(roomId) {
  if (!roomId) {
    snapshotByKey.clear();
    return;
  }

  for (const [key, entry] of snapshotByKey.entries()) {
    if (entry.roomId === roomId) {
      snapshotByKey.delete(key);
    }
  }
}

module.exports = {
  DEFAULT_GAME_SNAPSHOT_CACHE_TTL_MS,
  clearGameSnapshotCache,
  createGameSnapshotCacheKey,
  getGameSnapshotCache,
  setGameSnapshotCache,
};
