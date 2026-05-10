const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const BATCH_LIMIT = 100;
const ROOM_TTL_LOBBY_MS = 30 * 60 * 1000;
const ROOM_TTL_ACTIVE_MS = 2 * 60 * 60 * 1000;
const ROOM_TTL_RESULT_MS = 30 * 60 * 1000;

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
      profileStats: null,
      roomStats: null,
    };
  }

  const memberRes = await db
    .collection("room_members")
    .where({
      roomId,
    })
    .remove();

  const snapshotRes = await db
    .collection("room_public_snapshots")
    .where({
      roomId,
    })
    .remove();

  const profileRes = await db
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
    });

  const roomRes = await db.collection("rooms").doc(roomId).remove();

  return {
    roomId,
    removed: true,
    assetStats,
    memberStats: memberRes.stats || null,
    snapshotStats: snapshotRes.stats || null,
    profileStats: profileRes.stats || null,
    roomStats: roomRes.stats || null,
  };
}

async function cleanupRooms(now) {
  const candidateRooms = await getCandidateRooms(now);
  const expiredRooms = candidateRooms.filter((room) => isRoomExpired(room, now));
  let markedExpired = 0;
  const removedRooms = [];

  for (const room of expiredRooms) {
    const didMark = await markRoomExpired(room, now);
    if (didMark) {
      markedExpired += 1;
    }

    const cleanupResult = await removeRoomData({
      ...room,
      status: "expired",
    });
    if (cleanupResult.removed) {
      removedRooms.push(cleanupResult);
    }
  }

  return {
    scannedRooms: candidateRooms.length,
    expiredRooms: expiredRooms.length,
    markedExpired,
    removedRooms,
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
  const removedRecordIds = [];

  for (const record of records) {
    await db.collection("command_records").doc(record._id).remove();
    removedRecordIds.push(record._id);
  }

  return {
    scannedCommandRecords: records.length,
    removedCommandRecords: removedRecordIds.length,
    removedRecordIds,
  };
}

exports.main = async () => {
  const startedAt = new Date();
  const roomResult = await cleanupRooms(startedAt);
  const commandRecordResult = await cleanupCommandRecords(startedAt);

  return {
    success: true,
    serverTime: new Date().toISOString(),
    ...roomResult,
    ...commandRecordResult,
    pendingWork: [],
  };
};
