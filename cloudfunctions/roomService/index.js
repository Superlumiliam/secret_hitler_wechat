const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = [
  "rooms",
  "room_members",
  "room_public_snapshots",
  "user_profiles",
  "command_records",
];
const MIN_PLAYER_COUNT = 5;
const MAX_PLAYER_COUNT = 10;
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_RETRY_LIMIT = 10;
const ROOM_TTL_LOBBY_MS = 2 * 60 * 60 * 1000;
const MIN_DISPLAY_NAME_LENGTH = 2;
const MAX_DISPLAY_NAME_LENGTH = 12;

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

function normalizeProfilePayload(payload) {
  const displayName = String((payload && payload.displayName) || "").trim();
  const avatarUrl = String((payload && payload.avatarUrl) || "").trim();

  if (displayName.length < MIN_DISPLAY_NAME_LENGTH || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      error: fail("INVALID_PAYLOAD", "用户名需为 2-12 个字符"),
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

async function ensureCollections() {
  await Promise.all(
    COLLECTIONS.map(async (name) => {
      try {
        await db.createCollection(name);
      } catch (err) {
        if (!isCollectionAlreadyExistsError(err)) {
          throw err;
        }
      }
    }),
  );
}

async function getCommandRecord(scopeKey, commandId) {
  const res = await db
    .collection("command_records")
    .where({
      scopeKey,
      commandId,
    })
    .limit(1)
    .get();
  return res.data[0] || null;
}

async function saveCommandRecord(scopeKey, commandId, hash, response) {
  await db.collection("command_records").add({
    data: {
      scopeKey,
      commandId,
      payloadHash: hash,
      response,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
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
  const res = await db
    .collection("user_profiles")
    .where({
      openid,
    })
    .limit(1)
    .get();
  return res.data[0] || null;
}

async function upsertProfile(openid, data) {
  const profile = await getProfile(openid);
  if (profile) {
    await db.collection("user_profiles").doc(profile._id).update({
      data,
    });
    return profile._id;
  }

  const addRes = await db.collection("user_profiles").add({
    data: {
      openid,
      defaultDisplayName: `玩家${openid.slice(-4)}`,
      ...data,
      createdAt: new Date(),
    },
  });
  return addRes._id;
}

function buildProfileDto(profile, openid) {
  const fallbackName = `玩家${openid.slice(-4)}`;
  return {
    profileCompleted: Boolean(profile && profile.profileCompleted),
    displayName: (profile && (profile.defaultDisplayName || profile.displayName)) || fallbackName,
    avatarUrl: (profile && profile.avatarUrl) || "",
    updatedAt: profile && profile.updatedAt ? new Date(profile.updatedAt).toISOString() : "",
  };
}

async function getSavedProfile(openid) {
  const profile = await getProfile(openid);
  return ok(buildProfileDto(profile, openid));
}

async function saveUserProfile(payload, openid) {
  return withCommandIdempotency(openid, payload, async () => {
    const normalized = normalizeProfilePayload(payload);
    if (normalized.error) {
      return normalized.error;
    }

    await upsertProfile(openid, normalized.data);
    const profile = await getProfile(openid);
    return ok(buildProfileDto(profile, openid));
  });
}

async function assertNoActiveRoom(profile) {
  if (!profile || !profile.activeRoomId) {
    return null;
  }

  try {
    const roomRes = await db.collection("rooms").doc(profile.activeRoomId).get();
    const room = roomRes.data;
    const expireAt = room && (room.expireAt || room.expiresAt);
    if (
      room &&
      ["lobby", "in_game"].includes(room.status) &&
      (!expireAt || new Date(expireAt).getTime() > Date.now())
    ) {
      return fail("ACTION_NOT_ALLOWED", "当前账号已有进行中的房间");
    }
  } catch (err) {
    return null;
  }

  return null;
}

async function buildLobbySnapshot(roomId, openid) {
  const roomRes = await db.collection("rooms").doc(roomId).get();
  const room = roomRes.data;
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
  const members = membersRes.data.filter(isActiveMember);
  const myMember = members.find((member) => getMemberOpenId(member) === openid) || null;

  return {
    roomId,
    roomCode: room.roomCode,
    roomStatus: room.status,
    hostMemberId: room.hostMemberId,
    playerCount: members.length,
    targetPlayerCount: room.targetPlayerCount,
    minPlayerCount: MIN_PLAYER_COUNT,
    maxPlayerCount: MAX_PLAYER_COUNT,
    seatOrder: members.map((member) => ({
      memberId: getMemberId(member),
      displayName: member.displayName,
      avatarUrl: member.avatarUrl || "",
      seatIndex: member.seatIndex,
      isHost: Boolean(member.isHost || getMemberId(member) === room.hostMemberId),
      isReady: member.isReady,
    })),
    myMemberId: myMember ? getMemberId(myMember) : "",
    canStart: Boolean(myMember && getMemberId(myMember) === room.hostMemberId && members.length >= MIN_PLAYER_COUNT),
    version: room.version || 1,
    updatedAt: room.updatedAt ? new Date(room.updatedAt).toISOString() : nowIso(),
  };
}

async function saveLobbySnapshot(snapshot) {
  await db.collection("room_public_snapshots").doc(snapshot.roomId).set({
    data: {
      ...snapshot,
      snapshotType: "lobby",
      updatedAt: new Date(snapshot.updatedAt),
    },
  });
}

async function createRoom(payload, openid) {
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
    const activeRoomError = await assertNoActiveRoom(profile);
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
    const avatarUrl = (profileData && profileData.avatarUrl) || (profile && profile.avatarUrl) || "";
    const createdAt = new Date();
    const expireAt = new Date(Date.now() + ROOM_TTL_LOBBY_MS);

    await db.collection("rooms").doc(roomId).set({
      data: {
        roomId,
        roomCode,
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
      },
    });

    await db.collection("room_members").doc(memberId).set({
      data: {
        memberId,
        roomId,
        openId: openid,
        displayName,
        avatarUrl,
        seatIndex: 1,
        isHost: true,
        isReady: true,
        memberStatus: "active",
        joinedAt: createdAt,
        leftAt: null,
        lastSeenAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    });

    await upsertProfile(openid, {
      ...(profileData || {}),
      activeRoomId: roomId,
      activeMemberId: memberId,
      activeRoomStatus: "lobby",
      updatedAt: createdAt,
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    await saveLobbySnapshot(lobbySnapshot);

    return ok({
      roomId,
      roomCode,
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

  const snapshot = await buildLobbySnapshot(roomId, openid);
  if (!snapshot) {
    return fail("ROOM_NOT_FOUND", "房间不存在");
  }

  if (!snapshot.myMemberId) {
    return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
  }

  if (snapshot.roomStatus !== "lobby") {
    return fail("GAME_ALREADY_STARTED", "房间已开局");
  }

  return ok(snapshot);
}

exports.main = async (event) => {
  try {
    await ensureCollections();
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const action = event && event.action;
    const payload = (event && event.payload) || {};

    if (!openid) {
      return fail("UNAUTHORIZED", "无法获取用户身份");
    }

    switch (action) {
      case "getProfile":
        return await getSavedProfile(openid);
      case "saveProfile":
        return await saveUserProfile(payload, openid);
      case "createRoom":
        return await createRoom(payload, openid);
      case "getLobbySnapshot":
        return await getLobbySnapshot(payload, openid);
      default:
        return fail("INVALID_ACTION", "未知 action");
    }
  } catch (err) {
    console.error("roomService error", err);
    return fail("INTERNAL_ERROR", "服务异常，请稍后重试", true);
  }
};
