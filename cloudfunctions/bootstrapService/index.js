const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

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

function getMemberId(member) {
  return member.memberId || member._id;
}

function getMemberOpenId(member) {
  return member.openId || member.openid;
}

function isDocumentNotFoundError(err) {
  const errMessage = String((err && (err.errMsg || err.message)) || "").toLowerCase();
  return (
    errMessage.includes("document not exist") ||
    errMessage.includes("document_not_exist") ||
    errMessage.includes("database_document_not_exist") ||
    errMessage.includes("does not exist") ||
    errMessage.includes("doesn't exist")
  );
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

async function clearActiveRoomForProfile(openid, updatedAt) {
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

function getRouteHint(room) {
  if (!room) {
    return "";
  }
  if (room.status === "lobby") {
    return "lobby";
  }
  if (room.status === "ended") {
    return "result";
  }
  if (room.status === "in_game") {
    return "board";
  }
  return "";
}

function isRecoverableRoom(room) {
  if (!room || !["lobby", "in_game", "ended"].includes(room.status)) {
    return false;
  }
  const expireAt = toDate(room.expireAt || room.expiresAt);
  return !expireAt || expireAt.getTime() > Date.now();
}

function isRecoverableMemberForRoom(room, member, openid) {
  if (!room || !member || getMemberOpenId(member) !== openid) {
    return false;
  }
  const status = member.memberStatus || member.status;
  if (room.status === "lobby") {
    return status === "active";
  }
  return status === "active" || status === "offline";
}

async function getActiveRoomVersion(room) {
  const roomVersion = room.version || 1;
  if (!["in_game", "ended"].includes(room.status) || !room.currentGameId) {
    return roomVersion;
  }

  try {
    const gameCoreRes = await db.collection("game_core").doc(room.currentGameId).get();
    const gameCore = gameCoreRes.data || null;
    if (gameCore && gameCore.roomId === (room.roomId || room._id) && gameCore.version) {
      return gameCore.version;
    }
  } catch (err) {
    if (!isDocumentNotFoundError(err)) {
      console.error("resolve active room game version failed", {
        roomId: room.roomId || room._id,
        gameId: room.currentGameId,
        err,
      });
    }
  }

  return roomVersion;
}

async function buildActiveRoom(room, member) {
  const routeHint = getRouteHint(room);
  if (!routeHint) {
    return null;
  }

  const version = await getActiveRoomVersion(room);

  return {
    roomId: room.roomId || room._id,
    roomCode: room.roomCode || "",
    roomStatus: room.status,
    memberId: getMemberId(member),
    routeHint,
    version,
    updatedAt: toIsoString(room.updatedAt) || nowIso(),
  };
}

async function getActiveRoomFromProfile(openid) {
  const profile = await getProfile(openid);
  if (!profile || !profile.activeRoomId || !profile.activeMemberId) {
    return null;
  }

  let room;
  let member;
  try {
    const roomRes = await db.collection("rooms").doc(profile.activeRoomId).get();
    room = roomRes.data || null;
  } catch (err) {
    if (!isDocumentNotFoundError(err)) {
      throw err;
    }
  }

  try {
    const memberRes = await db.collection("room_members").doc(profile.activeMemberId).get();
    member = memberRes.data || null;
  } catch (err) {
    if (!isDocumentNotFoundError(err)) {
      throw err;
    }
  }

  if (!isRecoverableRoom(room) || !isRecoverableMemberForRoom(room, member, openid)) {
    await clearActiveRoomForProfile(openid, new Date());
    return null;
  }

  return await buildActiveRoom(room, member);
}

async function touchActiveMember(openid, activeRoom) {
  if (!activeRoom || !activeRoom.roomId) {
    return;
  }

  try {
    const membersRes = await db
      .collection("room_members")
      .where({
        roomId: activeRoom.roomId,
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
    await db.collection("user_profiles").doc(openid).update({
      data: {
        activeRoomId: activeRoom.roomId,
        activeMemberId: getMemberId(member),
        activeRoomStatus: activeRoom.roomStatus,
        updatedAt,
      },
    });
  } catch (err) {
    if (!isDocumentNotFoundError(err)) {
      console.error("touch active member failed", {
        roomId: activeRoom.roomId,
        err,
      });
    }
  }
}

async function ensureSession(openid) {
  return ok({
    user: {
      sessionReady: true,
    },
    activeRoom: await getActiveRoomFromProfile(openid),
  });
}

async function recoverActiveRoom(openid) {
  const activeRoom = await getActiveRoomFromProfile(openid);
  if (activeRoom) {
    await touchActiveMember(openid, activeRoom);
  }
  return ok({
    activeRoom,
  });
}

async function dispatchAction(action, payload, openid) {
  switch (action) {
    case "ensureSession":
      return await ensureSession(openid);
    case "recoverActiveRoom":
      return await recoverActiveRoom(openid);
    default:
      return fail("INVALID_PAYLOAD", "未知 action");
  }
}

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const action = event && event.action;
    const payload = (event && event.payload) || {};

    if (!openid) {
      return fail("INTERNAL_ERROR", "无法获取用户身份", true);
    }

    return await dispatchAction(action, payload, openid);
  } catch (err) {
    console.error("bootstrapService error", err);
    return fail("INTERNAL_ERROR", "服务异常，请稍后重试", true);
  }
};
