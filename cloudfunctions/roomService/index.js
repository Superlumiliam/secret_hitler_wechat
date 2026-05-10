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

async function clearActiveRoomForProfile(profile, updatedAt) {
  if (!profile || !profile._id) {
    return;
  }

  await db.collection("user_profiles").doc(profile._id).update({
    data: {
      activeRoomId: null,
      activeMemberId: null,
      activeRoomStatus: null,
      updatedAt,
    },
  });
}

async function expireLobbyRoom(room, updatedAt) {
  await db.collection("rooms").doc(room.roomId || room._id).update({
    data: {
      status: "expired",
      playerCount: 0,
      hostMemberId: null,
      expireAt: updatedAt,
      updatedAt,
      version: _.inc(1),
    },
  });

  await db.collection("room_public_snapshots").doc(room.roomId || room._id).set({
    data: {
      roomId: room.roomId || room._id,
      roomCode: room.roomCode,
      roomStatus: "expired",
      hostMemberId: null,
      playerCount: 0,
      targetPlayerCount: room.targetPlayerCount,
      minPlayerCount: MIN_PLAYER_COUNT,
      maxPlayerCount: MAX_PLAYER_COUNT,
      seatOrder: [],
      myMemberId: "",
      isHost: false,
      myIsReady: false,
      canStart: false,
      version: (room.version || 1) + 1,
      snapshotType: "lobby",
      updatedAt,
    },
  });
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
      await clearActiveRoomForProfile(profile, new Date());
      return null;
    }

    if (expireAt && new Date(expireAt).getTime() <= Date.now()) {
      await clearActiveRoomForProfile(profile, new Date());
      return null;
    }

    if (room.status === "lobby") {
      const members = await getActiveRoomMembers(profile.activeRoomId);
      const myMember = members.find((member) => getMemberOpenId(member) === openid);
      if (!myMember) {
        await clearActiveRoomForProfile(profile, new Date());
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
        await clearActiveRoomForProfile(profile, updatedAt);
        return null;
      }
    }

    if (room && ["lobby", "in_game"].includes(room.status)) {
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
  const isHost = Boolean(myMember && getMemberId(myMember) === room.hostMemberId);
  const isLobby = room.status === "lobby";
  const isFull = members.length === room.targetPlayerCount;
  const allReady = members.length > 0 && members.every((member) => Boolean(member.isReady));

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
    isHost,
    myIsReady: Boolean(myMember && myMember.isReady),
    canStart: Boolean(isHost && isLobby && isFull && allReady),
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
        isReady: false,
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

async function joinRoom(payload, openid) {
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

    const existingMember = await getRoomMember(roomId, openid);
    if (existingMember) {
      return fail("ACTION_NOT_ALLOWED", "你已在该房间中");
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
        roomId,
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
    const avatarUrl = (profileData && profileData.avatarUrl) || (profile && profile.avatarUrl) || "";
    const memberId = createId("mem");
    const joinedAt = new Date();

    await db.collection("room_members").doc(memberId).set({
      data: {
        memberId,
        roomId,
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

    await db.collection("rooms").doc(roomId).update({
      data: {
        playerCount: members.length + 1,
        version: _.inc(1),
        updatedAt: joinedAt,
      },
    });

    await upsertProfile(openid, {
      ...(profileData || {}),
      activeRoomId: roomId,
      activeMemberId: memberId,
      activeRoomStatus: "lobby",
      updatedAt: joinedAt,
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    await saveLobbySnapshot(lobbySnapshot);

    return ok({
      roomId,
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

async function clearActiveRoomForMember(roomId, memberId, updatedAt) {
  await db
    .collection("user_profiles")
    .where({
      activeRoomId: roomId,
      activeMemberId: memberId,
    })
    .update({
      data: {
        activeRoomId: null,
        activeMemberId: null,
        activeRoomStatus: null,
        updatedAt,
      },
    });
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
      await db.collection("room_members").doc(memberId).update({
        data: {
          memberStatus: "offline",
          updatedAt,
          lastSeenAt: updatedAt,
        },
      });

      await clearActiveRoomForMember(roomId, memberId, updatedAt);

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

    await clearActiveRoomForMember(roomId, memberId, updatedAt);

    const remainingMembers = (await getActiveRoomMembers(roomId)).filter((item) => getMemberId(item) !== memberId);

    if (!remainingMembers.length) {
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

      await db.collection("room_public_snapshots").doc(roomId).set({
        data: {
          roomId,
          roomCode: room.roomCode,
          roomStatus: "expired",
          hostMemberId: null,
          playerCount: 0,
          targetPlayerCount: room.targetPlayerCount,
          minPlayerCount: MIN_PLAYER_COUNT,
          maxPlayerCount: MAX_PLAYER_COUNT,
          seatOrder: [],
          myMemberId: "",
          isHost: false,
          myIsReady: false,
          canStart: false,
          version: (room.version || 1) + 1,
          snapshotType: "lobby",
          updatedAt,
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

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    await saveLobbySnapshot(lobbySnapshot);

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
    await saveLobbySnapshot(lobbySnapshot);
    return ok(lobbySnapshot);
  });
}

async function startGame(payload, openid) {
  const roomId = payload && payload.roomId;
  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }

  return withCommandIdempotency(openid, payload, async () => {
    const snapshot = await buildLobbySnapshot(roomId, openid);
    if (!snapshot) {
      return fail("ROOM_NOT_FOUND", "房间不存在");
    }

    if (!snapshot.myMemberId) {
      return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
    }

    if (!snapshot.isHost) {
      return fail("ACTION_NOT_ALLOWED", "只有房主可以开始游戏");
    }

    if (!snapshot.canStart) {
      return fail("ACTION_NOT_ALLOWED", "房间坐满且全员准备后才能开始");
    }

    const updatedAt = new Date();
    await db.collection("rooms").doc(roomId).update({
      data: {
        status: "in_game",
        startedAt: updatedAt,
        updatedAt,
        version: _.inc(1),
      },
    });

    await Promise.all(
      snapshot.seatOrder.map((member) =>
        db
          .collection("user_profiles")
          .where({
            activeRoomId: roomId,
            activeMemberId: member.memberId,
          })
          .update({
            data: {
              activeRoomStatus: "in_game",
              updatedAt,
            },
          }),
      ),
    );

    return ok({
      roomId,
      roomStatus: "in_game",
      routeHint: "board",
      boardPath: `/packageRoom/pages/board/index?roomId=${encodeURIComponent(roomId)}`,
    });
  });
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
      case "joinRoom":
        return await joinRoom(payload, openid);
      case "leaveRoom":
        return await leaveRoom(payload, openid);
      case "getLobbySnapshot":
        return await getLobbySnapshot(payload, openid);
      case "setReady":
        return await setReady(payload, openid);
      case "startGame":
        return await startGame(payload, openid);
      default:
        return fail("INVALID_ACTION", "未知 action");
    }
  } catch (err) {
    console.error("roomService error", err);
    return fail("INTERNAL_ERROR", "服务异常，请稍后重试", true);
  }
};
