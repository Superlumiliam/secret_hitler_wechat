const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const ACTIVE_ROOM_RECOVERY_SUPPRESSED = "recovery_suppressed";

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

async function getTransactionDocument(documentRef) {
  try {
    return (await documentRef.get()).data || null;
  } catch (err) {
    if (isDocumentNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

async function clearActiveRoomForProfile(openid, updatedAt, expectations = {}, options = {}) {
  const hasExpectedRoomId = Object.prototype.hasOwnProperty.call(expectations, "roomId");
  const hasExpectedMemberId = Object.prototype.hasOwnProperty.call(expectations, "memberId");
  const nextActiveRoomStatus = options.suppressRecovery
    ? ACTIVE_ROOM_RECOVERY_SUPPRESSED
    : null;
  await db.runTransaction(async (transaction) => {
    const profileRef = transaction.collection("user_profiles").doc(openid);
    const profile = await getTransactionDocument(profileRef);
    if (!profile) {
      return;
    }
    if (hasExpectedRoomId && (profile.activeRoomId || null) !== (expectations.roomId || null)) {
      return;
    }
    if (hasExpectedMemberId && (profile.activeMemberId || null) !== (expectations.memberId || null)) {
      return;
    }

    await profileRef.update({
      data: {
        openid,
        activeRoomId: null,
        activeMemberId: null,
        activeRoomStatus: nextActiveRoomStatus,
        updatedAt,
      },
    });
  });
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
  const roomId = room.roomId || room._id;
  if (!roomId || member.roomId !== roomId || member.isVirtual) {
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

function isRepairableActiveRoom(room) {
  return Boolean(room && ["lobby", "in_game"].includes(room.status) && isRecoverableRoom(room));
}

async function findRepairableActiveRoomCandidates(openid) {
  const membersRes = await db
    .collection("room_members")
    .where({
      openId: openid,
      memberStatus: "active",
    })
    .limit(100)
    .get();
  const candidates = [];

  for (const member of membersRes.data) {
    if (!member || member.isVirtual || !member.roomId) {
      continue;
    }

    const room = await getTransactionDocument(db.collection("rooms").doc(member.roomId));
    if (
      isRepairableActiveRoom(room) &&
      isRecoverableMemberForRoom(room, member, openid)
    ) {
      candidates.push({
        room,
        member,
      });
    }
  }

  return candidates;
}

async function repairActiveRoomAnchor(openid) {
  const candidates = await findRepairableActiveRoomCandidates(openid);
  if (!candidates.length) {
    return null;
  }
  if (candidates.length > 1) {
    console.info("active room anchor repair skipped", {
      candidateCount: candidates.length,
      reason: "ambiguous_candidates",
    });
    return null;
  }

  const candidate = candidates[0];
  const repaired = await db.runTransaction(async (transaction) => {
    const profileRef = transaction.collection("user_profiles").doc(openid);
    const profile = await getTransactionDocument(profileRef);
    if (
      !profile ||
      profile.activeRoomId ||
      profile.activeMemberId ||
      profile.activeRoomStatus === ACTIVE_ROOM_RECOVERY_SUPPRESSED
    ) {
      return null;
    }

    const roomId = candidate.room.roomId || candidate.room._id;
    const memberId = getMemberId(candidate.member);
    const room = await getTransactionDocument(transaction.collection("rooms").doc(roomId));
    const member = await getTransactionDocument(transaction.collection("room_members").doc(memberId));
    if (
      !isRepairableActiveRoom(room) ||
      !isRecoverableMemberForRoom(room, member, openid) ||
      (member.memberStatus || member.status) !== "active"
    ) {
      return null;
    }

    const updatedAt = new Date();
    await profileRef.update({
      data: {
        openid,
        activeRoomId: roomId,
        activeMemberId: memberId,
        activeRoomStatus: room.status,
        updatedAt,
      },
    });
    return {
      room,
      member,
    };
  });

  if (!repaired) {
    console.info("active room anchor repair skipped", {
      candidateCount: 1,
      reason: "transaction_revalidation_failed",
    });
    return null;
  }
  return await buildActiveRoom(repaired.room, repaired.member);
}

async function getActiveRoomFromProfile(openid) {
  const profile = await getProfile(openid);
  if (!profile) {
    return null;
  }
  if (
    !profile.activeRoomId &&
    !profile.activeMemberId &&
    profile.activeRoomStatus === ACTIVE_ROOM_RECOVERY_SUPPRESSED
  ) {
    return null;
  }

  if (profile.activeRoomId && profile.activeMemberId) {
    const room = await getTransactionDocument(db.collection("rooms").doc(profile.activeRoomId));
    const member = await getTransactionDocument(
      db.collection("room_members").doc(profile.activeMemberId),
    );
    if (isRecoverableRoom(room) && isRecoverableMemberForRoom(room, member, openid)) {
      return await buildActiveRoom(room, member);
    }

    await clearActiveRoomForProfile(openid, new Date(), {
      roomId: profile.activeRoomId,
      memberId: profile.activeMemberId,
    });
  } else if (profile.activeRoomId || profile.activeMemberId) {
    await clearActiveRoomForProfile(openid, new Date(), {
      roomId: profile.activeRoomId || null,
      memberId: profile.activeMemberId || null,
    });
  }

  return await repairActiveRoomAnchor(openid);
}

async function touchActiveMember(openid, activeRoom) {
  if (!activeRoom || !activeRoom.roomId || !activeRoom.memberId) {
    return false;
  }

  return await db.runTransaction(async (transaction) => {
    const profileRef = transaction.collection("user_profiles").doc(openid);
    const profile = await getTransactionDocument(profileRef);
    if (
      !profile ||
      profile.activeRoomStatus === ACTIVE_ROOM_RECOVERY_SUPPRESSED ||
      profile.activeRoomId !== activeRoom.roomId ||
      profile.activeMemberId !== activeRoom.memberId
    ) {
      return false;
    }

    const room = await getTransactionDocument(
      transaction.collection("rooms").doc(activeRoom.roomId),
    );
    const memberRef = transaction.collection("room_members").doc(activeRoom.memberId);
    const member = await getTransactionDocument(memberRef);
    if (
      !isRecoverableRoom(room) ||
      !isRecoverableMemberForRoom(room, member, openid)
    ) {
      return false;
    }

    const updatedAt = new Date();
    await memberRef.update({
      data: {
        memberStatus: "active",
        lastSeenAt: updatedAt,
        updatedAt,
      },
    });
    await profileRef.update({
      data: {
        activeRoomId: activeRoom.roomId,
        activeMemberId: activeRoom.memberId,
        activeRoomStatus: room.status,
        updatedAt,
      },
    });
    return true;
  });
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
  let activeRoom = await getActiveRoomFromProfile(openid);
  if (activeRoom && !(await touchActiveMember(openid, activeRoom))) {
    activeRoom = null;
  }
  return ok({
    user: {
      sessionReady: true,
    },
    activeRoom,
  });
}

async function clearActiveRoom(payload, openid) {
  if (
    Object.prototype.hasOwnProperty.call(payload, "roomId") &&
    (typeof payload.roomId !== "string" || !payload.roomId.trim())
  ) {
    return fail("INVALID_PAYLOAD", "roomId 参数无效");
  }

  const roomId = typeof payload.roomId === "string" ? payload.roomId.trim() : "";
  await clearActiveRoomForProfile(
    openid,
    new Date(),
    roomId
      ? {
          roomId,
        }
      : {},
    {
      suppressRecovery: true,
    },
  );
  return ok({
    activeRoom: null,
  });
}

async function dispatchAction(action, payload, openid) {
  switch (action) {
    case "ensureSession":
      return await ensureSession(openid);
    case "recoverActiveRoom":
      return await recoverActiveRoom(openid);
    case "clearActiveRoom":
      return await clearActiveRoom(payload, openid);
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
