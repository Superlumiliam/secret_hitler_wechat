const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const MIN_PLAYER_COUNT = 5;
const MAX_PLAYER_COUNT = 10;
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_RETRY_LIMIT = 10;
const ROOM_TTL_LOBBY_MS = 30 * 60 * 1000;
const COMMAND_RECORD_TTL_MS = 10 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 20 * 1000;
const MIN_DISPLAY_NAME_LENGTH = 2;
const MAX_DISPLAY_NAME_LENGTH = 12;
const ROOM_MODE_NORMAL = "normal";
const ROOM_MODE_SOLO = "solo";
const COMMAND_RECORD_DIRECT_ID_ENABLED_AT = Date.now();
const lastSeenTouchedAtByMember = new Map();

function nowIso() {
  return new Date().toISOString();
}

function ok(data) {
  return {
    success: true,
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    serverTime: nowIso(),
    data,
  };
}

function fail(code, message, retryable = false) {
  return {
    success: false,
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    serverTime: nowIso(),
    error: {
      code,
      message,
      retryable,
    },
  };
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

function createExpireAt(baseTime, ttlMs) {
  const base = baseTime instanceof Date ? baseTime.getTime() : Date.now();
  return new Date(base + ttlMs);
}

function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value.toDate === "function") {
    return value.toDate();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoString(value) {
  const date = toDate(value);
  return date ? date.toISOString() : "";
}

function isRoomExpired(room, now = new Date()) {
  if (!room) {
    return false;
  }
  if (room.status === "expired") {
    return true;
  }
  const expireAt = toDate(room.expireAt || room.expiresAt);
  return Boolean(expireAt && expireAt.getTime() <= now.getTime());
}

function getMemberId(member) {
  return member.memberId || member._id;
}

function getMemberOpenId(member) {
  return member.openId || member.openid;
}

function isActiveMember(member) {
  return (member.memberStatus || member.status) === "active";
}

function payloadHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isDocumentNotFoundError(err) {
  const errMessage = String((err && (err.errMsg || err.message)) || "").toLowerCase();
  const errCode = err && (err.errCode || err.code);
  const normalizedErrCode = String(errCode || "").toLowerCase();
  return (
    normalizedErrCode === "-502005" ||
    normalizedErrCode.includes("document_not_exist") ||
    errMessage.includes("document not exist") ||
    errMessage.includes("document_not_exist") ||
    errMessage.includes("database_document_not_exist") ||
    errMessage.includes("does not exist") ||
    errMessage.includes("doesn't exist")
  );
}

async function touchRoomMemberLastSeen(openid, roomId, options = {}) {
  if (!openid || !roomId) {
    return;
  }

  const throttleKey = `${roomId}:${openid}`;
  const now = Date.now();
  if (options.throttle && now - (lastSeenTouchedAtByMember.get(throttleKey) || 0) < LAST_SEEN_THROTTLE_MS) {
    return;
  }
  lastSeenTouchedAtByMember.set(throttleKey, now);

  try {
    const membersRes = await db
      .collection("room_members")
      .where({
        roomId,
        openId: openid,
        memberStatus: _.in(["active", "offline"]),
      })
      .limit(1)
      .get();
    const member = membersRes.data[0];
    if (!member) {
      return;
    }

    const updatedAt = new Date();
    await db.collection("room_members").doc(getMemberId(member)).update({
      data: {
        memberStatus: "active",
        lastSeenAt: updatedAt,
        updatedAt,
      },
    });
  } catch (err) {
    lastSeenTouchedAtByMember.delete(throttleKey);
    throw err;
  }
}

function normalizeProfilePayload(payload) {
  const displayName = String((payload && payload.displayName) || "").trim();
  const avatarUrl = String((payload && payload.avatarUrl) || "").trim();

  if (displayName.length < MIN_DISPLAY_NAME_LENGTH || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      error: fail("INVALID_PAYLOAD", "用户名需为 2-12 个字符"),
    };
  }

  if (avatarUrl && !isRoomAssetFileId(avatarUrl)) {
    return {
      error: fail("INVALID_PAYLOAD", "头像必须是房间临时资源"),
    };
  }

  return {
    data: {
      defaultDisplayName: displayName,
      avatarUrl,
      profileCompleted: true,
      updatedAt: new Date(),
    },
  };
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

function mergeRoomAssetFileIds(existingFileIds, fileId) {
  const fileIds = Array.isArray(existingFileIds) ? existingFileIds.slice() : [];
  if (isRoomAssetFileId(fileId) && !fileIds.includes(fileId)) {
    fileIds.push(fileId);
  }
  return fileIds.filter(isRoomAssetFileId);
}

async function deleteRoomAssets(room) {
  const fileList = getRoomAssetFileIds(room);
  if (!fileList.length) {
    return {
      success: true,
      deletedFileCount: 0,
      fileList: [],
      remainingFileIds: [],
    };
  }

  try {
    const res = await cloud.deleteFile({
      fileList,
    });
    const resultFileList = res.fileList || [];
    const successfulFileIds = resultFileList
      .filter((file) => file && file.status === 0 && file.fileID)
      .map((file) => file.fileID);
    const remainingFileIds = fileList.filter((fileID) => !successfulFileIds.includes(fileID));

    return {
      success: remainingFileIds.length === 0,
      deletedFileCount: successfulFileIds.length,
      fileList: resultFileList,
      remainingFileIds,
    };
  } catch (err) {
    console.error("delete room assets failed", {
      roomId: room && (room.roomId || room._id),
      fileList,
      err,
    });
    return {
      success: false,
      deletedFileCount: 0,
      fileList: [],
      remainingFileIds: fileList,
      error: String((err && (err.errMsg || err.message)) || err),
    };
  }
}

function getCommandRecordId(scopeKey, commandId) {
  return `cmd_${crypto.createHash("sha256").update(`${scopeKey}\0${commandId}`).digest("hex")}`;
}

function getCommandTimestamp(commandId) {
  const matched = String(commandId || "").match(/^cmd_.+_(\d{13})_[^_]+$/);
  return matched ? Number(matched[1]) : null;
}

function shouldQueryLegacyCommandRecord(commandId) {
  const commandTimestamp = getCommandTimestamp(commandId);
  return commandTimestamp === null || commandTimestamp <= COMMAND_RECORD_DIRECT_ID_ENABLED_AT;
}

async function getCommandRecord(scopeKey, commandId) {
  try {
    const directRes = await db.collection("command_records").doc(getCommandRecordId(scopeKey, commandId)).get();
    if (directRes.data) {
      return directRes.data;
    }
  } catch (err) {
    if (!isDocumentNotFoundError(err)) {
      throw err;
    }
  }

  if (!shouldQueryLegacyCommandRecord(commandId)) {
    return null;
  }
  const legacyRes = await db.collection("command_records").where({ scopeKey, commandId }).limit(1).get();
  return legacyRes.data[0] || null;
}

async function saveCommandRecord(scopeKey, commandId, hash, response) {
  await db.collection("command_records").doc(getCommandRecordId(scopeKey, commandId)).set({
    data: {
      scopeKey,
      commandId,
      payloadHash: hash,
      response,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + COMMAND_RECORD_TTL_MS),
    },
  });
}

async function withCommandIdempotency(openid, payload, handler) {
  const commandId = payload && payload.commandId;
  if (!commandId || typeof commandId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 commandId");
  }

  const scopeKey = `user:${openid}`;
  const hash = payloadHash(payload);
  const existing = await getCommandRecord(scopeKey, commandId);

  if (existing) {
    if (existing.payloadHash !== hash) {
      return fail("DUPLICATE_COMMAND", "commandId 已被不同请求使用");
    }
    return existing.response;
  }

  const response = await handler();
  if (response.success) {
    await saveCommandRecord(scopeKey, commandId, hash, response);
  }
  return response;
}

async function generateRoomCode() {
  for (let i = 0; i < ROOM_CODE_RETRY_LIMIT; i += 1) {
    const code = String(Math.floor(Math.random() * 1000000)).padStart(ROOM_CODE_LENGTH, "0");
    const existing = await db
      .collection("rooms")
      .where({
        roomCode: code,
        status: _.in(["lobby", "in_game"]),
      })
      .limit(1)
      .get();
    if (!existing.data.length) {
      return code;
    }
  }
  throw new Error("ROOM_CODE_GENERATE_FAILED");
}

async function getProfile(openid) {
  try {
    const res = await db.collection("user_profiles").doc(openid).get();
    return res.data || null;
  } catch (err) {
    if (isDocumentNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

async function upsertProfile(openid, data) {
  const profile = await getProfile(openid);
  if (profile) {
    await db.collection("user_profiles").doc(openid).update({
      data: {
        openid,
        ...data,
      },
    });
    return openid;
  }

  await db.collection("user_profiles").doc(openid).set({
    data: {
      openid,
      defaultDisplayName: `玩家${openid.slice(-4)}`,
      ...data,
      createdAt: new Date(),
    },
  });
  return openid;
}

async function clearActiveRoomForProfile(openid, updatedAt) {
  if (!openid) {
    return;
  }

  try {
    await db.collection("user_profiles").doc(openid).update({
      data: {
        openid,
        activeRoomId: null,
        activeMemberId: null,
        activeRoomStatus: null,
        updatedAt,
      },
    });
  } catch (err) {
    if (!isDocumentNotFoundError(err)) {
      throw err;
    }
  }
}

async function expireLobbyRoom(room, updatedAt) {
  const assetStats = await deleteRoomAssets(room);

  await db.collection("rooms").doc(room.roomId || room._id).update({
    data: {
      status: "expired",
      playerCount: 0,
      hostMemberId: null,
      expireAt: updatedAt,
      assetFileIds: assetStats.remainingFileIds,
      updatedAt,
      version: _.inc(1),
    },
  });
}

async function expireSoloRoomWithVirtualMembers(room, members, openid, updatedAt) {
  const roomId = room.roomId || room._id;
  const canExpireSoloRoom =
    (room.mode || ROOM_MODE_NORMAL) === ROOM_MODE_SOLO &&
    room.createdByOpenId === openid &&
    members.length > 0 &&
    members.every((member) => getMemberOpenId(member) === openid || member.isVirtual);

  if (!canExpireSoloRoom) {
    return false;
  }

  await Promise.all(
    members.map((member) =>
      db
        .collection("room_members")
        .doc(getMemberId(member))
        .update({
          data: {
            memberStatus: "left",
            isReady: false,
            leftAt: updatedAt,
            updatedAt,
            lastSeenAt: updatedAt,
          },
        }),
    ),
  );

  await db.collection("rooms").doc(roomId).update({
    data: {
      status: "expired",
      playerCount: 0,
      hostMemberId: null,
      expireAt: updatedAt,
      updatedAt,
      version: _.inc(1),
    },
  });

  return true;
}

async function assertNoActiveRoom(profile, openid) {
  if (!profile || !profile.activeRoomId) {
    return null;
  }

  try {
    const roomRes = await db.collection("rooms").doc(profile.activeRoomId).get();
    const room = roomRes.data;
    const expireAt = room && (room.expireAt || room.expiresAt);
    if (!room || !["lobby", "in_game"].includes(room.status)) {
      await clearActiveRoomForProfile(openid, new Date());
      return null;
    }

    if (expireAt && new Date(expireAt).getTime() <= Date.now()) {
      await clearActiveRoomForProfile(openid, new Date());
      return null;
    }

    if ((room.mode || ROOM_MODE_NORMAL) === ROOM_MODE_SOLO) {
      const members = await getActiveRoomMembers(profile.activeRoomId);
      const updatedAt = new Date();
      const expiredSoloRoom = await expireSoloRoomWithVirtualMembers(room, members, openid, updatedAt);
      if (expiredSoloRoom) {
        await clearActiveRoomForProfile(openid, updatedAt);
        return null;
      }
    }

    if (room.status === "lobby") {
      const members = await getActiveRoomMembers(profile.activeRoomId);
      const myMember = members.find((member) => getMemberOpenId(member) === openid);
      if (!myMember) {
        await clearActiveRoomForProfile(openid, new Date());
        return null;
      }

      if (members.length === 1) {
        const updatedAt = new Date();
        await db.collection("room_members").doc(getMemberId(myMember)).update({
          data: {
            memberStatus: "left",
            isReady: false,
            leftAt: updatedAt,
            updatedAt,
            lastSeenAt: updatedAt,
          },
        });
        await expireLobbyRoom(room, updatedAt);
        await clearActiveRoomForProfile(openid, updatedAt);
        return null;
      }
    }

    if (room && ["lobby", "in_game"].includes(room.status)) {
      return fail("ACTION_NOT_ALLOWED", "当前账号已有进行中的房间");
    }
  } catch (err) {
    if (isDocumentNotFoundError(err)) {
      await clearActiveRoomForProfile(openid, new Date());
      return null;
    }
    throw err;
  }

  return null;
}

function buildLobbySnapshotFromData(room, members, openid) {
  if (!room) {
    return null;
  }

  const roomId = room.roomId || room._id;
  const roomMode = room.mode || ROOM_MODE_NORMAL;
  const activeMembers = members.filter(isActiveMember);
  const myMember = activeMembers.find((member) => getMemberOpenId(member) === openid) || null;
  const isHost = Boolean(myMember && getMemberId(myMember) === room.hostMemberId);
  const isLobby = room.status === "lobby";
  const isFull = activeMembers.length === room.targetPlayerCount;
  const allReady = activeMembers.length > 0 && activeMembers.every((member) => Boolean(member.isReady));

  return {
    roomId,
    roomCode: room.roomCode,
    roomStatus: room.status,
    roomMode,
    isSoloRoom: roomMode === ROOM_MODE_SOLO,
    hostMemberId: room.hostMemberId,
    playerCount: activeMembers.length,
    targetPlayerCount: room.targetPlayerCount,
    minPlayerCount: MIN_PLAYER_COUNT,
    maxPlayerCount: MAX_PLAYER_COUNT,
    expireAt: toIsoString(room.expireAt || room.expiresAt),
    seatOrder: activeMembers.map((member) => ({
      memberId: getMemberId(member),
      displayName: member.displayName,
      avatarUrl: member.avatarUrl || "",
      seatIndex: member.seatIndex,
      isHost: Boolean(member.isHost || getMemberId(member) === room.hostMemberId),
      isReady: member.isReady,
      isVirtual: Boolean(member.isVirtual),
      controlledByCurrentViewer: Boolean(member.isVirtual && member.controlledByOpenId === openid),
    })),
    viewerState: {
      myMemberId: myMember ? getMemberId(myMember) : "",
      isHost,
      myIsReady: Boolean(myMember && myMember.isReady),
      canStart: Boolean(isHost && isLobby && isFull && allReady),
    },
    version: room.version || 1,
    updatedAt: room.updatedAt ? new Date(room.updatedAt).toISOString() : nowIso(),
  };
}

async function buildLobbySnapshot(roomId, openid, existingRoom = null) {
  const room = existingRoom || (await db.collection("rooms").doc(roomId).get()).data;
  if (!room) {
    return null;
  }

  const membersRes = await db
    .collection("room_members")
    .where({
      roomId,
    })
    .orderBy("seatIndex", "asc")
    .get();
  return buildLobbySnapshotFromData(room, membersRes.data, openid);
}

async function createRoom(payload, openid, options = {}) {
  const roomMode = options.mode === ROOM_MODE_SOLO ? ROOM_MODE_SOLO : ROOM_MODE_NORMAL;
  const targetPlayerCount = Number(payload.targetPlayerCount);
  if (
    !Number.isInteger(targetPlayerCount) ||
    targetPlayerCount < MIN_PLAYER_COUNT ||
    targetPlayerCount > MAX_PLAYER_COUNT
  ) {
    return fail("INVALID_PAYLOAD", "人数必须是 5-10 的整数");
  }

  return withCommandIdempotency(openid, payload, async () => {
    const profile = await getProfile(openid);
    const activeRoomError = await assertNoActiveRoom(profile, openid);
    if (activeRoomError) {
      return activeRoomError;
    }

    const requestProfile = normalizeProfilePayload(payload);
    if (requestProfile.error && !(profile && profile.profileCompleted)) {
      return requestProfile.error;
    }

    const roomId = createId("room");
    const memberId = createId("mem");
    const roomCode = await generateRoomCode();
    const profileData = requestProfile.error ? null : requestProfile.data;
    const displayName =
      (profileData && profileData.defaultDisplayName) ||
      (profile && (profile.defaultDisplayName || profile.displayName)) ||
      `玩家${openid.slice(-4)}`;
    const avatarUrl = (profileData && profileData.avatarUrl) || "";
    const assetFileIds = mergeRoomAssetFileIds([], avatarUrl);
    const createdAt = new Date();
    const expireAt = createExpireAt(createdAt, ROOM_TTL_LOBBY_MS);

    const roomData = {
      roomId,
      roomCode,
      mode: roomMode,
      status: "lobby",
      hostMemberId: memberId,
      currentGameId: null,
      targetPlayerCount,
      playerCount: 1,
      version: 1,
      createdByOpenId: openid,
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      endedAt: null,
      expireAt,
      assetFileIds,
    };
    const memberData = {
      memberId,
      roomId,
      openId: openid,
      displayName,
      avatarUrl,
      seatIndex: 1,
      isHost: true,
      isReady: false,
      isVirtual: false,
      memberStatus: "active",
      joinedAt: createdAt,
      leftAt: null,
      lastSeenAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    };

    await db.collection("rooms").doc(roomId).set({
      data: roomData,
    });

    await db.collection("room_members").doc(memberId).set({
      data: memberData,
    });

    await upsertProfile(openid, {
      ...(profileData
        ? {
            defaultDisplayName: profileData.defaultDisplayName,
            profileCompleted: profileData.profileCompleted,
          }
        : {}),
      activeRoomId: roomId,
      activeMemberId: memberId,
      activeRoomStatus: "lobby",
      updatedAt: createdAt,
    });

    const lobbySnapshot = buildLobbySnapshotFromData(roomData, [memberData], openid);

    return ok({
      roomId,
      roomCode,
      roomStatus: "lobby",
      memberId,
      lobbySnapshot,
    });
  });
}

async function joinRoom(payload, openid) {
  const roomId = payload && payload.roomId;
  const roomCode = String((payload && payload.roomCode) || "").trim();
  if ((!roomId || typeof roomId !== "string") && !/^\d{6}$/.test(roomCode)) {
    return fail("INVALID_PAYLOAD", "请输入 6 位房间号");
  }

  return withCommandIdempotency(openid, payload, async () => {
    let room = null;
    if (roomId && typeof roomId === "string") {
      try {
        const roomRes = await db.collection("rooms").doc(roomId).get();
        room = roomRes.data || null;
      } catch (err) {
        if (!isDocumentNotFoundError(err)) {
          throw err;
        }
      }
    } else {
      const roomRes = await db
        .collection("rooms")
        .where({
          roomCode,
          status: _.in(["lobby", "in_game"]),
        })
        .limit(1)
        .get();
      room = roomRes.data[0] || null;
    }

    if (!room) {
      return fail("ROOM_NOT_FOUND", "房间不存在");
    }

    const resolvedRoomId = room.roomId || room._id;
    if (isRoomExpired(room)) {
      return fail("ROOM_EXPIRED", "房间已过期");
    }

    if (room.status !== "lobby") {
      return fail("ROOM_NOT_JOINABLE", "房间不可加入");
    }

    const existingMember = await getRoomMember(resolvedRoomId, openid);
    if (existingMember) {
      const lobbySnapshot = await buildLobbySnapshot(resolvedRoomId, openid);
      return ok({
        roomId: resolvedRoomId,
        roomCode: room.roomCode,
        roomStatus: "lobby",
        memberId: getMemberId(existingMember),
        lobbySnapshot,
      });
    }

    if ((room.mode || ROOM_MODE_NORMAL) === ROOM_MODE_SOLO) {
      return fail("ROOM_NOT_JOINABLE", "单人模式房间不可加入");
    }

    const profile = await getProfile(openid);
    const activeRoomError = await assertNoActiveRoom(profile, openid);
    if (activeRoomError) {
      return activeRoomError;
    }

    const requestProfile = normalizeProfilePayload(payload);
    if (requestProfile.error && !(profile && profile.profileCompleted)) {
      return fail("PROFILE_REQUIRED", "请先创建用户资料");
    }

    const membersRes = await db
      .collection("room_members")
      .where({
        roomId: resolvedRoomId,
      })
      .orderBy("seatIndex", "asc")
      .get();
    const members = membersRes.data.filter(isActiveMember);
    if (members.length >= room.targetPlayerCount) {
      return fail("ROOM_FULL", "房间已满");
    }

    const occupiedSeats = members.map((member) => member.seatIndex);
    let seatIndex = 1;
    while (occupiedSeats.includes(seatIndex) && seatIndex <= room.targetPlayerCount) {
      seatIndex += 1;
    }

    const profileData = requestProfile.error ? null : requestProfile.data;
    const displayName =
      (profileData && profileData.defaultDisplayName) ||
      (profile && (profile.defaultDisplayName || profile.displayName)) ||
      `玩家${openid.slice(-4)}`;
    const avatarUrl = (profileData && profileData.avatarUrl) || "";
    const assetFileIds = mergeRoomAssetFileIds(room.assetFileIds, avatarUrl);
    const memberId = createId("mem");
    const joinedAt = new Date();

    await db.collection("room_members").doc(memberId).set({
      data: {
        memberId,
        roomId: resolvedRoomId,
        openId: openid,
        displayName,
        avatarUrl,
        seatIndex,
        isHost: false,
        isReady: false,
        memberStatus: "active",
        joinedAt,
        leftAt: null,
        lastSeenAt: joinedAt,
        createdAt: joinedAt,
        updatedAt: joinedAt,
      },
    });

    await db.collection("rooms").doc(resolvedRoomId).update({
      data: {
        playerCount: members.length + 1,
        assetFileIds,
        version: _.inc(1),
        updatedAt: joinedAt,
      },
    });

    await upsertProfile(openid, {
      ...(profileData
        ? {
            defaultDisplayName: profileData.defaultDisplayName,
            profileCompleted: profileData.profileCompleted,
          }
        : {}),
      activeRoomId: resolvedRoomId,
      activeMemberId: memberId,
      activeRoomStatus: "lobby",
      updatedAt: joinedAt,
    });

    const lobbySnapshot = await buildLobbySnapshot(resolvedRoomId, openid);

    return ok({
      roomId: resolvedRoomId,
      roomCode: room.roomCode,
      roomStatus: "lobby",
      memberId,
      lobbySnapshot,
    });
  });
}

async function getLobbySnapshot(payload, openid) {
  const roomId = payload && payload.roomId;
  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }

  const roomRes = await db.collection("rooms").doc(roomId).get();
  const room = roomRes.data;
  if (!room) {
    return fail("ROOM_NOT_FOUND", "房间不存在");
  }
  if (isRoomExpired(room)) {
    return fail("ROOM_EXPIRED", "房间已过期");
  }

  const snapshot = await buildLobbySnapshot(roomId, openid, room);
  if (!snapshot) {
    return fail("ROOM_NOT_FOUND", "房间不存在");
  }

  if (!snapshot.viewerState || !snapshot.viewerState.myMemberId) {
    return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
  }

  if (snapshot.roomStatus !== "lobby") {
    return fail("GAME_ALREADY_STARTED", "房间已开局");
  }

  return ok(snapshot);
}

async function getActiveRoomMembers(roomId) {
  const membersRes = await db
    .collection("room_members")
    .where({
      roomId,
    })
    .orderBy("seatIndex", "asc")
    .get();
  return membersRes.data.filter(isActiveMember);
}

async function getRoomMember(roomId, openid) {
  const membersRes = await db
    .collection("room_members")
    .where({
      roomId,
      openId: openid,
    })
    .limit(1)
    .get();
  return membersRes.data.find(isActiveMember) || null;
}

async function leaveRoom(payload, openid) {
  const roomId = payload && payload.roomId;
  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }

  return withCommandIdempotency(openid, payload, async () => {
    const roomRes = await db.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room) {
      return fail("ROOM_NOT_FOUND", "房间不存在");
    }

    if (!["lobby", "in_game"].includes(room.status)) {
      return fail("ACTION_NOT_ALLOWED", "当前房间已失效");
    }

    const member = await getRoomMember(roomId, openid);
    if (!member) {
      return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
    }

    const memberId = getMemberId(member);
    const updatedAt = new Date();

    if (room.status === "in_game") {
      const isSoloRoom = (room.mode || ROOM_MODE_NORMAL) === ROOM_MODE_SOLO;
      const leavingSoloHost = isSoloRoom && (memberId === room.hostMemberId || room.createdByOpenId === openid);

      if (leavingSoloHost) {
        const activeMembers = await getActiveRoomMembers(roomId);
        const expiredSoloRoom = await expireSoloRoomWithVirtualMembers(room, activeMembers, openid, updatedAt);

        if (expiredSoloRoom) {
          await clearActiveRoomForProfile(openid, updatedAt);

          return ok({
            roomId,
            roomStatus: "expired",
            memberId,
            leaveMode: "expired_solo_room",
            newHostMemberId: null,
            roomExpired: true,
            routeHint: "home",
          });
        }
      }

      await db.collection("room_members").doc(memberId).update({
        data: {
          memberStatus: "offline",
          updatedAt,
          lastSeenAt: updatedAt,
        },
      });

      await clearActiveRoomForProfile(openid, updatedAt);

      return ok({
        roomId,
        roomStatus: "in_game",
        memberId,
        leaveMode: "marked_offline",
        newHostMemberId: null,
        roomExpired: false,
        routeHint: "home",
      });
    }

    await db.collection("room_members").doc(memberId).update({
      data: {
        memberStatus: "left",
        isReady: false,
        leftAt: updatedAt,
        updatedAt,
        lastSeenAt: updatedAt,
      },
    });

    await clearActiveRoomForProfile(openid, updatedAt);

    const remainingMembers = (await getActiveRoomMembers(roomId)).filter((item) => getMemberId(item) !== memberId);

    if (!remainingMembers.length) {
      const assetStats = await deleteRoomAssets(room);

      await db.collection("rooms").doc(roomId).update({
        data: {
          status: "expired",
          playerCount: 0,
          hostMemberId: null,
          expireAt: updatedAt,
          assetFileIds: assetStats.remainingFileIds,
          updatedAt,
          version: _.inc(1),
        },
      });

      return ok({
        roomId,
        roomStatus: "expired",
        memberId,
        leaveMode: "removed_from_lobby",
        newHostMemberId: null,
        roomExpired: true,
        routeHint: "home",
      });
    }

    let newHostMemberId = room.hostMemberId;
    const leavingWasHost = memberId === room.hostMemberId || member.isHost;
    if (leavingWasHost) {
      newHostMemberId = getMemberId(remainingMembers[0]);
    }

    await Promise.all(
      remainingMembers.map((remainingMember, index) =>
        db
          .collection("room_members")
          .doc(getMemberId(remainingMember))
          .update({
            data: {
              seatIndex: index + 1,
              isHost: getMemberId(remainingMember) === newHostMemberId,
              updatedAt,
            },
          }),
      ),
    );

    await db.collection("rooms").doc(roomId).update({
      data: {
        hostMemberId: newHostMemberId,
        playerCount: remainingMembers.length,
        version: _.inc(1),
        updatedAt,
      },
    });

    return ok({
      roomId,
      roomStatus: "lobby",
      memberId,
      leaveMode: "removed_from_lobby",
      newHostMemberId: leavingWasHost ? newHostMemberId : null,
      roomExpired: false,
      routeHint: "home",
    });
  });
}

async function setReady(payload, openid) {
  const roomId = payload && payload.roomId;
  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }

  return withCommandIdempotency(openid, payload, async () => {
    const roomRes = await db.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room) {
      return fail("ROOM_NOT_FOUND", "房间不存在");
    }

    if (room.status !== "lobby") {
      return fail("ACTION_NOT_ALLOWED", "房间已开局");
    }
    if (isRoomExpired(room)) {
      return fail("ROOM_EXPIRED", "房间已过期");
    }

    const member = await getRoomMember(roomId, openid);
    if (!member) {
      return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
    }

    const updatedAt = new Date();
    await db.collection("room_members").doc(getMemberId(member)).update({
      data: {
        isReady: Boolean(payload.isReady),
        updatedAt,
        lastSeenAt: updatedAt,
      },
    });

    await db.collection("rooms").doc(roomId).update({
      data: {
        version: _.inc(1),
        updatedAt,
      },
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    return ok(lobbySnapshot);
  });
}

async function updateRoomSettings(payload, openid) {
  const roomId = payload && payload.roomId;
  const targetPlayerCount = Number(payload && payload.targetPlayerCount);
  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }
  if (
    !Number.isInteger(targetPlayerCount) ||
    targetPlayerCount < MIN_PLAYER_COUNT ||
    targetPlayerCount > MAX_PLAYER_COUNT
  ) {
    return fail("INVALID_PAYLOAD", "人数必须是 5-10 的整数");
  }

  return withCommandIdempotency(openid, payload, async () => {
    const roomRes = await db.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room) {
      return fail("ROOM_NOT_FOUND", "房间不存在");
    }
    if (isRoomExpired(room)) {
      return fail("ROOM_EXPIRED", "房间已过期");
    }
    if (room.status !== "lobby") {
      return fail("GAME_ALREADY_STARTED", "房间已开局");
    }

    const member = await getRoomMember(roomId, openid);
    if (!member) {
      return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
    }
    if (getMemberId(member) !== room.hostMemberId) {
      return fail("NOT_ROOM_HOST", "只有房主可以使用房间设置");
    }

    const activeMembers = await getActiveRoomMembers(roomId);
    if (targetPlayerCount < activeMembers.length) {
      return fail("TARGET_COUNT_BELOW_SEATED", "选择人数小于已落座玩家数");
    }

    const updatedAt = new Date();
    await db.collection("rooms").doc(roomId).update({
      data: {
        targetPlayerCount,
        version: _.inc(1),
        updatedAt,
      },
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    return ok({
      roomId,
      roomStatus: "lobby",
      newVersion: lobbySnapshot && lobbySnapshot.version,
      lobbySnapshot,
    });
  });
}

async function assertSoloRoomHost(roomId, openid) {
  if (!roomId || typeof roomId !== "string") {
    return {
      error: fail("INVALID_PAYLOAD", "缺少 roomId"),
    };
  }

  const roomRes = await db.collection("rooms").doc(roomId).get();
  const room = roomRes.data;
  if (!room) {
    return {
      error: fail("ROOM_NOT_FOUND", "房间不存在"),
    };
  }

  if ((room.mode || ROOM_MODE_NORMAL) !== ROOM_MODE_SOLO) {
    return {
      error: fail("ACTION_NOT_ALLOWED", "当前房间不是单人模式房间"),
    };
  }

  if (room.status !== "lobby") {
    return {
      error: fail("ACTION_NOT_ALLOWED", "房间已开局"),
    };
  }
  if (isRoomExpired(room)) {
    return {
      error: fail("ROOM_EXPIRED", "房间已过期"),
    };
  }

  const member = await getRoomMember(roomId, openid);
  if (!member) {
    return {
      error: fail("NOT_ROOM_MEMBER", "当前用户不在房间中"),
    };
  }

  if (getMemberId(member) !== room.hostMemberId) {
    return {
      error: fail("ACTION_NOT_ALLOWED", "只有房主可以使用单人模式操作"),
    };
  }

  return {
    room,
    member,
  };
}

async function soloCreateRoom(payload, openid) {
  return await createRoom(payload, openid, {
    mode: ROOM_MODE_SOLO,
  });
}

async function soloFillVirtualPlayers(payload, openid) {
  const roomId = payload && payload.roomId;
  return withCommandIdempotency(openid, payload, async () => {
    const resolved = await assertSoloRoomHost(roomId, openid);
    if (resolved.error) {
      return resolved.error;
    }

    const room = resolved.room;
    const members = await getActiveRoomMembers(roomId);
    if (members.length >= room.targetPlayerCount) {
      const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
      return ok(lobbySnapshot);
    }

    const occupiedSeats = members.map((member) => member.seatIndex);
    const createdAt = new Date();
    const virtualMembers = [];

    for (let seatIndex = 1; seatIndex <= room.targetPlayerCount; seatIndex += 1) {
      if (occupiedSeats.includes(seatIndex)) {
        continue;
      }

      const memberId = createId("mem");
      virtualMembers.push({
        memberId,
        roomId,
        openId: "",
        displayName: `虚拟玩家${seatIndex}`,
        avatarUrl: "",
        seatIndex,
        isHost: false,
        isReady: false,
        isVirtual: true,
        controlledByOpenId: openid,
        memberStatus: "active",
        joinedAt: createdAt,
        leftAt: null,
        lastSeenAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
    }

    await Promise.all(
      virtualMembers.map((member) =>
        db.collection("room_members").doc(member.memberId).set({
          data: member,
        }),
      ),
    );

    await db.collection("rooms").doc(roomId).update({
      data: {
        playerCount: members.length + virtualMembers.length,
        version: _.inc(1),
        updatedAt: createdAt,
      },
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    return ok(lobbySnapshot);
  });
}

async function soloSetVirtualReady(payload, openid) {
  const roomId = payload && payload.roomId;
  const memberId = payload && payload.memberId;
  if (!memberId || typeof memberId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 memberId");
  }

  return withCommandIdempotency(openid, payload, async () => {
    const resolved = await assertSoloRoomHost(roomId, openid);
    if (resolved.error) {
      return resolved.error;
    }

    let member = null;
    try {
      const memberRes = await db.collection("room_members").doc(memberId).get();
      member = memberRes.data;
    } catch (err) {
      if (!isDocumentNotFoundError(err)) {
        throw err;
      }
    }

    if (
      !member ||
      member.roomId !== roomId ||
      !isActiveMember(member) ||
      !member.isVirtual ||
      member.controlledByOpenId !== openid
    ) {
      return fail("INVALID_TARGET", "只能设置当前单人模式房间中的虚拟玩家");
    }

    const updatedAt = new Date();
    await db.collection("room_members").doc(getMemberId(member)).update({
      data: {
        isReady: Boolean(payload.isReady),
        updatedAt,
        lastSeenAt: updatedAt,
      },
    });

    await db.collection("rooms").doc(roomId).update({
      data: {
        version: _.inc(1),
        updatedAt,
      },
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    return ok(lobbySnapshot);
  });
}

async function soloReadyAllVirtualPlayers(payload, openid) {
  const roomId = payload && payload.roomId;
  return withCommandIdempotency(openid, payload, async () => {
    const resolved = await assertSoloRoomHost(roomId, openid);
    if (resolved.error) {
      return resolved.error;
    }

    const updatedAt = new Date();
    const members = await getActiveRoomMembers(roomId);
    const readyMembers = members.filter(
      (member) =>
        getMemberId(member) === resolved.room.hostMemberId ||
        (member.isVirtual && member.controlledByOpenId === openid),
    );

    await Promise.all(
      readyMembers.map((member) =>
        db
          .collection("room_members")
          .doc(getMemberId(member))
          .update({
            data: {
              isReady: true,
              updatedAt,
              lastSeenAt: updatedAt,
            },
          }),
      ),
    );

    await db.collection("rooms").doc(roomId).update({
      data: {
        version: _.inc(1),
        updatedAt,
      },
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    return ok(lobbySnapshot);
  });
}

async function dispatchAction(action, payload, openid) {
  switch (action) {
    case "createRoom":
      return await createRoom(payload, openid);
    case "joinRoom":
      return await joinRoom(payload, openid);
    case "leaveRoom":
      return await leaveRoom(payload, openid);
    case "getLobbySnapshot":
      return await getLobbySnapshot(payload, openid);
    case "updateRoomSettings":
      return await updateRoomSettings(payload, openid);
    case "setReady":
      return await setReady(payload, openid);
    case "soloCreateRoom":
      return await soloCreateRoom(payload, openid);
    case "soloFillVirtualPlayers":
      return await soloFillVirtualPlayers(payload, openid);
    case "soloSetVirtualReady":
      return await soloSetVirtualReady(payload, openid);
    case "soloReadyAllVirtualPlayers":
      return await soloReadyAllVirtualPlayers(payload, openid);
    default:
      return fail("INVALID_PAYLOAD", "未知 action");
  }
}

exports.__testHooks = {
  COMMAND_RECORD_DIRECT_ID_ENABLED_AT,
  LAST_SEEN_THROTTLE_MS,
  getCommandRecord,
  getCommandRecordId,
  getCommandTimestamp,
  isDocumentNotFoundError,
  saveCommandRecord,
  shouldQueryLegacyCommandRecord,
};

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const action = event && event.action;
    const payload = (event && event.payload) || {};

    if (!openid) {
      return fail("INTERNAL_ERROR", "无法获取用户身份", true);
    }

    const response = await dispatchAction(action, payload, openid);
    const touchedRoomId = (payload && payload.roomId) || (response && response.data && response.data.roomId);
    if (response && response.success && touchedRoomId && action !== "leaveRoom") {
      await touchRoomMemberLastSeen(openid, touchedRoomId, {
        throttle: action === "getLobbySnapshot",
      });
    }
    return response;
  } catch (err) {
    console.error("roomService error", err);
    return fail("INTERNAL_ERROR", "服务异常，请稍后重试", true);
  }
};
