const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = [
  "rooms",
  "room_members",
  "room_public_snapshots",
  "room_sync_signals",
  "user_profiles",
  "command_records",
  "game_core",
  "player_private_snapshots",
  "game_events",
  "multiplayer_stat_events",
  "maintenance_state",
];
const BATCH_LIMIT = 100;
const ROOM_TTL_LOBBY_MS = 30 * 60 * 1000;
const ROOM_TTL_ACTIVE_MS = 3 * 60 * 60 * 1000;
const ROOM_TTL_RESULT_MS = 30 * 60 * 1000;
const MAINTENANCE_STATE_COLLECTION = "maintenance_state";
const COLLECTION_INIT_STATE_DOC_ID = "collection_init_daily";
const PREPARE_ROOM_SYNC_SIGNALS_ACTION = "prepareRoomSyncSignals";
const CHINA_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const ROOM_CLEANUP_CONCURRENCY = 3;
const ROOM_DATA_CLEANUP_CONCURRENCY = 3;
const COMMAND_RECORD_CLEANUP_CONCURRENCY = 5;
const MULTIPLAYER_STAT_EVENT_CONCURRENCY = 3;

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.from(items || []);
  if (!list.length) {
    return [];
  }

  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, list.length));
  const results = new Array(list.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

function getChinaDateKey(date) {
  return new Date(date.getTime() + CHINA_TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
}

function isCollectionAlreadyExistsError(err) {
  const errCode = err && (err.errCode || err.code);
  const errMessage = String((err && (err.errMsg || err.message)) || "");
  return (
    errCode === -501001 ||
    errMessage.includes("already exists") ||
    errMessage.includes("ResourceExist") ||
    errMessage.includes("Table exist") ||
    errMessage.includes("DATABASE_COLLECTION_ALREADY_EXIST")
  );
}

function isCollectionNotFoundError(err) {
  const errMessage = String((err && (err.errMsg || err.message)) || "").toLowerCase();
  return (
    errMessage.includes("collection not exist") ||
    errMessage.includes("collection_not_exist") ||
    errMessage.includes("database_collection_not_exist") ||
    errMessage.includes("table not exist")
  );
}

function isDocumentNotFoundError(err) {
  const errCode = err && (err.errCode || err.code);
  const errMessage = String((err && (err.errMsg || err.message)) || "").toLowerCase();
  return (
    errCode === -502005 ||
    errMessage.includes("document not exist") ||
    errMessage.includes("document_not_exist") ||
    errMessage.includes("database_document_not_exist") ||
    errMessage.includes("does not exist") ||
    errMessage.includes("doesn't exist")
  );
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
    return {
      name,
      created: true,
      alreadyExists: false,
    };
  } catch (err) {
    if (isCollectionAlreadyExistsError(err)) {
      return {
        name,
        created: false,
        alreadyExists: true,
      };
    }
    throw err;
  }
}

async function readCollectionInitState() {
  try {
    const res = await db.collection(MAINTENANCE_STATE_COLLECTION).doc(COLLECTION_INIT_STATE_DOC_ID).get();
    return res.data || null;
  } catch (err) {
    if (isCollectionNotFoundError(err)) {
      await ensureCollection(MAINTENANCE_STATE_COLLECTION);
      return null;
    }

    if (isDocumentNotFoundError(err)) {
      return null;
    }

    throw err;
  }
}

async function saveCollectionInitState(data) {
  try {
    await db.collection(MAINTENANCE_STATE_COLLECTION).doc(COLLECTION_INIT_STATE_DOC_ID).set({
      data,
    });
  } catch (err) {
    if (!isCollectionNotFoundError(err)) {
      throw err;
    }

    await ensureCollection(MAINTENANCE_STATE_COLLECTION);
    await db.collection(MAINTENANCE_STATE_COLLECTION).doc(COLLECTION_INIT_STATE_DOC_ID).set({
      data,
    });
  }
}

async function ensureCollectionsDaily(now) {
  const todayKey = getChinaDateKey(now);
  const state = await readCollectionInitState();
  const previouslyCheckedCollections = (state && state.checkedCollections) || [];
  const collectionsToCheck =
    state && state.lastCheckedDate === todayKey
      ? COLLECTIONS.filter((name) => !previouslyCheckedCollections.includes(name))
      : COLLECTIONS;
  if (!collectionsToCheck.length) {
    return {
      collectionInitSkipped: true,
      collectionInitDate: todayKey,
      checkedCollections: previouslyCheckedCollections,
    };
  }

  const collectionResults = [];
  for (const name of collectionsToCheck) {
    collectionResults.push(await ensureCollection(name));
  }

  await saveCollectionInitState({
    stateId: COLLECTION_INIT_STATE_DOC_ID,
    lastCheckedDate: todayKey,
    lastCheckedAt: now,
    checkedCollections: COLLECTIONS,
    collectionResults,
    updatedAt: now,
  });

  return {
    collectionInitSkipped: false,
    collectionInitDate: todayKey,
    checkedCollections: COLLECTIONS,
    collectionResults,
  };
}

function toDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getRoomId(room) {
  return room.roomId || room._id;
}

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

function isRoomAssetFileId(fileId) {
  return isCloudFileId(fileId) && fileId.indexOf("/room_assets/") !== -1;
}

function getRoomAssetFileIds(room) {
  return Array.from(new Set(((room && room.assetFileIds) || []).filter(isRoomAssetFileId)));
}

async function deleteRoomAssets(room) {
  const fileList = getRoomAssetFileIds(room);
  if (!fileList.length) {
    return {
      success: true,
      deletedFileCount: 0,
      fileList: [],
    };
  }

  try {
    const res = await cloud.deleteFile({
      fileList,
    });
    const resultFileList = res.fileList || [];
    const failedFiles = resultFileList.filter((file) => file && file.status !== 0);
    if (failedFiles.length || resultFileList.length !== fileList.length) {
      return {
        success: false,
        deletedFileCount: resultFileList.length - failedFiles.length,
        fileList: resultFileList,
        error: "部分房间资源删除失败",
      };
    }

    return {
      success: true,
      deletedFileCount: fileList.length,
      fileList: resultFileList,
    };
  } catch (err) {
    console.error("delete room assets failed", {
      roomId: getRoomId(room),
      fileList,
      err,
    });
    return {
      success: false,
      deletedFileCount: 0,
      fileList: [],
      error: String((err && (err.errMsg || err.message)) || err),
    };
  }
}

function isRoomExpired(room, now) {
  const status = room.status;
  const updatedAt = toDate(room.updatedAt) || toDate(room.createdAt);
  const expireAt = toDate(room.expireAt || room.expiresAt);

  if (status === "expired") {
    return true;
  }

  if (expireAt && expireAt.getTime() <= now.getTime()) {
    return true;
  }

  if (!updatedAt) {
    return false;
  }

  const age = now.getTime() - updatedAt.getTime();
  if (status === "lobby") {
    return age >= ROOM_TTL_LOBBY_MS;
  }

  if (status === "in_game") {
    return age >= ROOM_TTL_ACTIVE_MS;
  }

  if (status === "ended") {
    const endedAt = toDate(room.endedAt) || updatedAt;
    return now.getTime() - endedAt.getTime() >= ROOM_TTL_RESULT_MS;
  }

  return false;
}

async function fetchRoomBatch(query) {
  const res = await db.collection("rooms").where(query).limit(BATCH_LIMIT).get();
  return res.data || [];
}

async function getCandidateRooms(now) {
  const staleLobbyAt = new Date(now.getTime() - ROOM_TTL_LOBBY_MS);
  const staleActiveAt = new Date(now.getTime() - ROOM_TTL_ACTIVE_MS);
  const staleResultAt = new Date(now.getTime() - ROOM_TTL_RESULT_MS);
  const batches = await Promise.all([
    fetchRoomBatch({
      status: "expired",
    }),
    fetchRoomBatch({
      status: _.in(["lobby", "in_game", "ended"]),
      expireAt: _.lte(now),
    }),
    fetchRoomBatch({
      status: "lobby",
      playerCount: 0,
    }),
    fetchRoomBatch({
      status: "lobby",
      updatedAt: _.lte(staleLobbyAt),
    }),
    fetchRoomBatch({
      status: "in_game",
      updatedAt: _.lte(staleActiveAt),
    }),
    fetchRoomBatch({
      status: "ended",
      endedAt: _.lte(staleResultAt),
    }),
    fetchRoomBatch({
      status: "ended",
      updatedAt: _.lte(staleResultAt),
    }),
  ]);

  const roomsById = new Map();
  for (const room of batches.flat()) {
    const roomId = getRoomId(room);
    if (roomId) {
      roomsById.set(roomId, room);
    }
  }

  return Array.from(roomsById.values());
}

async function markRoomExpired(room, now) {
  const roomId = getRoomId(room);
  if (!roomId || room.status === "expired") {
    return false;
  }

  await db.collection("rooms").doc(roomId).update({
    data: {
      status: "expired",
      hostMemberId: null,
      playerCount: 0,
      expireAt: now,
      updatedAt: now,
      version: _.inc(1),
    },
  });

  return true;
}

async function removeRoomData(room) {
  const roomId = getRoomId(room);
  if (!roomId) {
    return {
      roomId: "",
      removed: false,
      assetStats: null,
      memberStats: null,
      snapshotStats: null,
      syncSignalStats: null,
      privateSnapshotStats: null,
      eventStats: null,
      gameCoreStats: null,
      profileStats: null,
      roomStats: null,
    };
  }

  const assetStats = await deleteRoomAssets(room);
  if (!assetStats.success) {
    return {
      roomId,
      removed: false,
      assetStats,
      memberStats: null,
      snapshotStats: null,
      syncSignalStats: null,
      privateSnapshotStats: null,
      eventStats: null,
      gameCoreStats: null,
      profileStats: null,
      roomStats: null,
    };
  }

  const cleanupOperations = [
    async () =>
      await db
        .collection("room_members")
        .where({
          roomId,
        })
        .remove(),
    async () =>
      await db
        .collection("room_public_snapshots")
        .where({
          roomId,
        })
        .remove(),
    async () =>
      await db
        .collection("room_sync_signals")
        .where({
          roomId,
        })
        .remove(),
    async () =>
      await db
        .collection("player_private_snapshots")
        .where({
          roomId,
        })
        .remove(),
    async () =>
      await db
        .collection("game_events")
        .where({
          roomId,
        })
        .remove(),
    async () =>
      await db
        .collection("game_core")
        .where({
          roomId,
        })
        .remove(),
    async () =>
      await db
        .collection("user_profiles")
        .where({
          activeRoomId: roomId,
        })
        .update({
          data: {
            activeRoomId: null,
            activeMemberId: null,
            activeRoomStatus: null,
            updatedAt: new Date(),
          },
        }),
  ];
  const [memberRes, snapshotRes, syncSignalRes, privateSnapshotRes, eventRes, gameCoreRes, profileRes] = await mapWithConcurrency(
    cleanupOperations,
    ROOM_DATA_CLEANUP_CONCURRENCY,
    async (operation) => await operation(),
  );

  const roomRes = await db.collection("rooms").doc(roomId).remove();

  return {
    roomId,
    removed: true,
    assetStats,
    memberStats: memberRes.stats || null,
    snapshotStats: snapshotRes.stats || null,
    syncSignalStats: syncSignalRes.stats || null,
    privateSnapshotStats: privateSnapshotRes.stats || null,
    eventStats: eventRes.stats || null,
    gameCoreStats: gameCoreRes.stats || null,
    profileStats: profileRes.stats || null,
    roomStats: roomRes.stats || null,
  };
}

async function cleanupRooms(now) {
  const candidateRooms = await getCandidateRooms(now);
  const expiredRooms = candidateRooms.filter((room) => isRoomExpired(room, now));
  const cleanupResults = await mapWithConcurrency(expiredRooms, ROOM_CLEANUP_CONCURRENCY, async (room) => {
    const didMark = await markRoomExpired(room, now);
    const cleanupResult = await removeRoomData({
      ...room,
      status: "expired",
    });
    return {
      didMark,
      cleanupResult,
    };
  });

  return {
    scannedRooms: candidateRooms.length,
    expiredRooms: expiredRooms.length,
    markedExpired: cleanupResults.filter((result) => result.didMark).length,
    removedRooms: cleanupResults
      .map((result) => result.cleanupResult)
      .filter((cleanupResult) => cleanupResult.removed),
  };
}

async function cleanupCommandRecords(now) {
  const res = await db
    .collection("command_records")
    .where({
      expiresAt: _.lte(now),
    })
    .limit(BATCH_LIMIT)
    .get();

  const records = res.data || [];
  const removedRecordIds = await mapWithConcurrency(records, COMMAND_RECORD_CLEANUP_CONCURRENCY, async (record) => {
    await db.collection("command_records").doc(record._id).remove();
    return record._id;
  });

  return {
    scannedCommandRecords: records.length,
    removedCommandRecords: removedRecordIds.length,
    removedRecordIds,
  };
}

function getMultiplayerStatCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function getMultiplayerStatEventId(event) {
  return (event && (event._id || event.gameId)) || "";
}

function validateMultiplayerStatEvent(event, eventId) {
  if (
    !event ||
    event.gameId !== eventId ||
    event.status !== "pending" ||
    !Array.isArray(event.players) ||
    !event.players.length
  ) {
    throw new Error("INVALID_MULTIPLAYER_STAT_EVENT");
  }

  const seenOpenIds = new Set();
  for (const player of event.players) {
    if (
      !player ||
      !player.memberId ||
      !player.openId ||
      (player.party && !["LIBERAL", "FASCIST"].includes(player.party)) ||
      typeof player.didWin !== "boolean" ||
      seenOpenIds.has(player.openId)
    ) {
      throw new Error("INVALID_MULTIPLAYER_STAT_EVENT_PLAYER");
    }
    seenOpenIds.add(player.openId);
  }
}

async function readTransactionDocument(ref) {
  try {
    const res = await ref.get();
    return res.data || null;
  } catch (err) {
    if (isDocumentNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

async function applyMultiplayerStatEvent(eventId, now) {
  return await db.runTransaction(async (transaction) => {
    const eventRef = transaction.collection("multiplayer_stat_events").doc(eventId);
    const event = await readTransactionDocument(eventRef);
    if (!event || event.status !== "pending") {
      return { status: "missing" };
    }

    validateMultiplayerStatEvent(event, eventId);
    for (const player of event.players) {
      const profileRef = transaction.collection("user_profiles").doc(player.openId);
      const profile = await readTransactionDocument(profileRef);
      if (!profile) {
        console.warn("multiplayer stat event profile missing", {
          gameId: eventId,
          memberId: player.memberId,
        });
        continue;
      }

      await profileRef.update({
        data: {
          multiplayerGameCount: getMultiplayerStatCount(profile.multiplayerGameCount) + 1,
          multiplayerWinCount: getMultiplayerStatCount(profile.multiplayerWinCount) + (player.didWin ? 1 : 0),
          multiplayerLossCount: getMultiplayerStatCount(profile.multiplayerLossCount) + (player.didWin ? 0 : 1),
          liberalWinCount:
            getMultiplayerStatCount(profile.liberalWinCount) + (player.party === "LIBERAL" && player.didWin ? 1 : 0),
          fascistWinCount:
            getMultiplayerStatCount(profile.fascistWinCount) + (player.party === "FASCIST" && player.didWin ? 1 : 0),
          updatedAt: now,
        },
      });
    }

    await eventRef.remove();
    return { status: "processed" };
  });
}

async function recordMultiplayerStatEventFailure(eventId, now) {
  return await db.runTransaction(async (transaction) => {
    const eventRef = transaction.collection("multiplayer_stat_events").doc(eventId);
    const event = await readTransactionDocument(eventRef);
    if (!event || event.status !== "pending") {
      return { status: "missing" };
    }

    const failureCount = Number.isInteger(event.failureCount) && event.failureCount >= 0 ? event.failureCount : 0;
    if (failureCount >= 2) {
      await eventRef.remove();
      return { status: "dropped" };
    }

    await eventRef.update({
      data: {
        failureCount: failureCount + 1,
        lastFailedAt: now,
        updatedAt: now,
      },
    });
    return { status: "retryScheduled" };
  });
}

async function processMultiplayerStatEvent(event, now) {
  const eventId = getMultiplayerStatEventId(event);
  if (!eventId) {
    return { status: "missing" };
  }

  try {
    return await applyMultiplayerStatEvent(eventId, now);
  } catch (err) {
    const errorCode = String((err && (err.errCode || err.code)) || "MULTIPLAYER_STAT_EVENT_PROCESSING_FAILED");
    console.error("multiplayer stat event processing failed", {
      gameId: eventId,
      errorCode,
    });
    try {
      const failureResult = await recordMultiplayerStatEventFailure(eventId, now);
      if (failureResult.status === "dropped") {
        console.error("multiplayer stat event dropped after three failed attempts", {
          gameId: eventId,
          errorCode,
        });
      }
      return failureResult;
    } catch (recordErr) {
      console.error("multiplayer stat event failure could not be recorded", {
        gameId: eventId,
        errorCode: String(
          (recordErr && (recordErr.errCode || recordErr.code)) || "MULTIPLAYER_STAT_EVENT_FAILURE_RECORD_FAILED",
        ),
      });
      return { status: "retryScheduled" };
    }
  }
}

async function processPendingMultiplayerStatEvents(now) {
  const res = await db
    .collection("multiplayer_stat_events")
    .where({
      status: "pending",
    })
    .limit(BATCH_LIMIT)
    .get();
  const events = res.data || [];
  const results = await mapWithConcurrency(events, MULTIPLAYER_STAT_EVENT_CONCURRENCY, async (event) => {
    return await processMultiplayerStatEvent(event, now);
  });

  return {
    scanned: events.length,
    processed: results.filter((result) => result.status === "processed").length,
    retryScheduled: results.filter((result) => result.status === "retryScheduled").length,
    dropped: results.filter((result) => result.status === "dropped").length,
  };
}

exports.main = async (event = {}) => {
  const startedAt = new Date();
  if (event.action === PREPARE_ROOM_SYNC_SIGNALS_ACTION) {
    const collectionResult = await ensureCollection("room_sync_signals");
    return {
      success: true,
      serverTime: new Date().toISOString(),
      action: PREPARE_ROOM_SYNC_SIGNALS_ACTION,
      collectionResult,
    };
  }

  const collectionInitResult = await ensureCollectionsDaily(startedAt);
  let multiplayerStatEventResult;
  try {
    multiplayerStatEventResult = await processPendingMultiplayerStatEvents(startedAt);
  } catch (err) {
    console.error("multiplayer stat event batch failed", {
      errorCode: String((err && (err.errCode || err.code)) || "MULTIPLAYER_STAT_EVENT_BATCH_FAILED"),
    });
    multiplayerStatEventResult = {
      scanned: 0,
      processed: 0,
      retryScheduled: 0,
      dropped: 0,
    };
  }
  const roomResult = await cleanupRooms(startedAt);
  const commandRecordResult = await cleanupCommandRecords(startedAt);

  return {
    success: true,
    serverTime: new Date().toISOString(),
    ...collectionInitResult,
    multiplayerStatEventResult,
    ...roomResult,
    ...commandRecordResult,
  };
};

exports.__testHooks = {
  COMMAND_RECORD_CLEANUP_CONCURRENCY,
  MULTIPLAYER_STAT_EVENT_CONCURRENCY,
  PREPARE_ROOM_SYNC_SIGNALS_ACTION,
  ROOM_CLEANUP_CONCURRENCY,
  ROOM_DATA_CLEANUP_CONCURRENCY,
  cleanupCommandRecords,
  ensureCollectionsDaily,
  mapWithConcurrency,
  processMultiplayerStatEvent,
  processPendingMultiplayerStatEvents,
  removeRoomData,
};
