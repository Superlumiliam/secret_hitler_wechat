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
const ROOM_TTL_ACTIVE_MS = 2 * 60 * 60 * 1000;
const COMMAND_RECORD_TTL_MS = 10 * 60 * 1000;
const MIN_DISPLAY_NAME_LENGTH = 2;
const MAX_DISPLAY_NAME_LENGTH = 12;
const ROOM_MODE_NORMAL = "normal";
const ROOM_MODE_DEV = "dev";
const GAME_INITIAL_VERSION = 1;
const ROLE_PRESET_BY_PLAYER_COUNT = {
  5: ["LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "HITLER"],
  6: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "HITLER"],
  7: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "FASCIST", "HITLER"],
  8: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "FASCIST", "HITLER"],
  9: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "FASCIST", "FASCIST", "HITLER"],
  10: [
    "LIBERAL",
    "LIBERAL",
    "LIBERAL",
    "LIBERAL",
    "LIBERAL",
    "LIBERAL",
    "FASCIST",
    "FASCIST",
    "FASCIST",
    "HITLER",
  ],
};
const INITIAL_POLICY_DECK = [
  "LIBERAL",
  "LIBERAL",
  "LIBERAL",
  "LIBERAL",
  "LIBERAL",
  "LIBERAL",
  "FASCIST",
  "FASCIST",
  "FASCIST",
  "FASCIST",
  "FASCIST",
  "FASCIST",
  "FASCIST",
  "FASCIST",
  "FASCIST",
  "FASCIST",
  "FASCIST",
];

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

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function shuffleCopy(items, pickIndex = randomInt) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1);
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

function getRolePreset(playerCount) {
  return ROLE_PRESET_BY_PLAYER_COUNT[playerCount] || null;
}

function getPartyForRole(role) {
  return role === "LIBERAL" ? "LIBERAL" : "FASCIST";
}

function buildRoleAssignments(members, options = {}) {
  const roles = getRolePreset(members.length);
  if (!roles) {
    throw new Error("INVALID_PLAYER_COUNT");
  }

  const shuffledRoles = shuffleCopy(roles, options.pickIndex);
  const rawAssignments = {};
  members.forEach((member, index) => {
    rawAssignments[getMemberId(member)] = {
      role: shuffledRoles[index],
      party: getPartyForRole(shuffledRoles[index]),
      knownMemberIds: [],
    };
  });

  const fascistMemberIds = Object.keys(rawAssignments).filter(
    (memberId) => rawAssignments[memberId].role === "FASCIST",
  );
  const hitlerMemberIds = Object.keys(rawAssignments).filter((memberId) => rawAssignments[memberId].role === "HITLER");
  const hitlerMemberId = hitlerMemberIds[0] || "";

  Object.keys(rawAssignments).forEach((memberId) => {
    const assignment = rawAssignments[memberId];
    if (assignment.role === "FASCIST") {
      assignment.knownMemberIds = [...fascistMemberIds, hitlerMemberId].filter(
        (knownMemberId) => knownMemberId && knownMemberId !== memberId,
      );
    } else if (assignment.role === "HITLER" && members.length <= 6) {
      assignment.knownMemberIds = fascistMemberIds.filter((knownMemberId) => knownMemberId !== memberId);
    }
  });

  return rawAssignments;
}

function buildInitialPolicyState(options = {}) {
  return {
    drawPile: shuffleCopy(INITIAL_POLICY_DECK, options.pickIndex),
    discardPile: [],
    presidentHand: null,
    chancellorHand: null,
    peekPile: null,
  };
}

function pickInitialPresidentCandidateId(members, options = {}) {
  if (!members.length) {
    return "";
  }
  return getMemberId(members[(options.pickIndex || randomInt)(members.length)]);
}

function getEligibleChancellorIdsFromCore(gameCore) {
  const aliveMemberIds = gameCore.aliveMemberIds || [];
  const aliveCount = aliveMemberIds.length;
  return aliveMemberIds.filter((memberId) => {
    if (memberId === gameCore.currentPresidentCandidateId) {
      return false;
    }
    if (aliveCount > 5 && memberId === gameCore.previousElectedPresidentId) {
      return false;
    }
    if (memberId === gameCore.previousElectedChancellorId) {
      return false;
    }
    return true;
  });
}

function buildInitialPublicHistory(gameCore, members, createdAt) {
  const president = members.find((member) => getMemberId(member) === gameCore.currentPresidentCandidateId);
  return [
    {
      eventId: `evt_${gameCore.gameId}_1`,
      round: gameCore.round,
      phase: "nomination",
      type: "GAME_STARTED",
      title: "游戏开始",
      summary: `${gameCore.playerCount}人局开始，身份与政策牌库已秘密初始化`,
      createdAt: createdAt.toISOString(),
    },
    {
      eventId: `evt_${gameCore.gameId}_2`,
      round: gameCore.round,
      phase: "nomination",
      type: "PRESIDENT_CANDIDATE_SELECTED",
      title: "首位总统候选人确定",
      summary: `${president ? president.displayName : "一名玩家"} 成为首位总统候选人`,
      createdAt: createdAt.toISOString(),
    },
  ];
}

function buildPublicSnapshotPayload(room, gameCore, members, publicHistory, updatedAt) {
  const roomId = room.roomId || room._id;
  return {
    roomId,
    roomCode: room.roomCode,
    roomStatus: "in_game",
    version: gameCore.version,
    round: gameCore.round,
    currentPhase: gameCore.phase,
    publicState: {
      seatOrder: members.map((member) => ({
        memberId: getMemberId(member),
        displayName: member.displayName,
        avatarUrl: member.avatarUrl || "",
        seatIndex: member.seatIndex,
        isAlive: (gameCore.aliveMemberIds || []).includes(getMemberId(member)),
        isOffline: (member.memberStatus || member.status) === "offline",
        confirmedNotHitler: (gameCore.confirmedNotHitlerMemberIds || []).includes(getMemberId(member)),
      })),
      currentPresidentCandidateId: gameCore.currentPresidentCandidateId,
      currentChancellorCandidateId: gameCore.currentChancellorCandidateId,
      currentPresidentId: gameCore.currentPresidentId,
      currentChancellorId: gameCore.currentChancellorId,
      previousElectedPresidentId: gameCore.previousElectedPresidentId,
      previousElectedChancellorId: gameCore.previousElectedChancellorId,
      electionTracker: gameCore.electionTracker,
      liberalPolicyCount: gameCore.liberalPolicyCount,
      fascistPolicyCount: gameCore.fascistPolicyCount,
      vetoUnlocked: gameCore.vetoUnlocked,
      executiveActionType: null,
      voteProgress: null,
      revealedVotes: null,
      publicHistory,
    },
    updatedAt: updatedAt.toISOString(),
  };
}

function buildPrivateSnapshotPayload(gameCore, member, members, updatedAt) {
  const memberId = getMemberId(member);
  const assignment = gameCore.roleAssignments[memberId];
  const memberById = {};
  members.forEach((item) => {
    memberById[getMemberId(item)] = item;
  });
  const pendingTask =
    memberId === gameCore.currentPresidentCandidateId
      ? {
          taskId: `${gameCore.gameId}:${gameCore.version}:NOMINATE_CHANCELLOR:${memberId}`,
          taskType: "NOMINATE_CHANCELLOR",
          required: true,
          deadline: null,
          allowedTargets: getEligibleChancellorIdsFromCore(gameCore),
          meta: {
            ruleHint: "上一届当选政府成员不能再次组成政府；若仅存活 5 人则放宽总统限制",
          },
        }
      : null;

  return {
    memberId,
    privateState: {
      identity: {
        role: assignment.role,
        party: assignment.party,
        knownMembers: assignment.knownMemberIds.map((knownMemberId) => {
          const knownMember = memberById[knownMemberId] || {};
          const knownAssignment = gameCore.roleAssignments[knownMemberId] || {};
          return {
            memberId: knownMemberId,
            displayName: knownMember.displayName || "",
            avatarUrl: knownMember.avatarUrl || "",
            role: knownAssignment.role || "",
            party: knownAssignment.party || "",
          };
        }),
      },
      voting: null,
      legislative: null,
      investigationResult: null,
      policyPeek: null,
    },
    pendingTask,
    updatedAt: updatedAt.toISOString(),
  };
}

function createInitialGameProjection(room, members, options = {}) {
  const sortedMembers = members.slice().sort((a, b) => a.seatIndex - b.seatIndex);
  const roomId = room.roomId || room._id;
  const gameId = options.gameId || createId("game");
  const createdAt = options.createdAt || new Date();
  const expireAt = createExpireAt(createdAt, ROOM_TTL_ACTIVE_MS);
  const currentPresidentCandidateId = pickInitialPresidentCandidateId(sortedMembers, options);
  const gameCore = {
    gameId,
    roomId,
    status: "in_game",
    version: GAME_INITIAL_VERSION,
    eventSeq: 2,
    round: 1,
    phase: "nomination",
    playerCount: sortedMembers.length,
    currentPresidentCandidateId,
    currentChancellorCandidateId: null,
    currentPresidentId: null,
    currentChancellorId: null,
    previousElectedPresidentId: null,
    previousElectedChancellorId: null,
    specialElectionCallerId: null,
    forcedNextPresidentId: null,
    electionTracker: 0,
    liberalPolicyCount: 0,
    fascistPolicyCount: 0,
    vetoUnlocked: false,
    roleAssignments: buildRoleAssignments(sortedMembers, options),
    aliveMemberIds: sortedMembers.map(getMemberId),
    deadMemberIds: [],
    confirmedNotHitlerMemberIds: [],
    investigatedMemberIds: [],
    roleRevealAckedMemberIds: [],
    policyState: buildInitialPolicyState(options),
    phaseData: {
      presidentCandidateId: currentPresidentCandidateId,
      eligibleChancellorIds: [],
    },
    winner: null,
    winReason: null,
    startedAt: createdAt,
    endedAt: null,
    updatedAt: createdAt,
    expireAt,
  };
  gameCore.phaseData.eligibleChancellorIds = getEligibleChancellorIdsFromCore(gameCore);

  const publicHistory = buildInitialPublicHistory(gameCore, sortedMembers, createdAt);
  const publicSnapshotPayload = buildPublicSnapshotPayload(room, gameCore, sortedMembers, publicHistory, createdAt);
  const privateSnapshotPayloads = sortedMembers.map((member) => ({
    memberId: getMemberId(member),
    ownerOpenId: getMemberOpenId(member),
    payload: buildPrivateSnapshotPayload(gameCore, member, sortedMembers, createdAt),
  }));
  const publicEvents = publicHistory.map((historyItem, index) => ({
    eventId: historyItem.eventId,
    gameId,
    roomId,
    seq: index + 1,
    type: historyItem.type,
    actorMemberId: historyItem.type === "PRESIDENT_CANDIDATE_SELECTED" ? currentPresidentCandidateId : null,
    publicPayload: {
      title: historyItem.title,
      summary: historyItem.summary,
    },
    privatePayload: null,
    createdAt,
  }));

  return {
    gameCore,
    publicSnapshotPayload,
    privateSnapshotPayloads,
    publicEvents,
    expireAt,
  };
}

function splitEnvList(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedDevEnvIds() {
  return Array.from(
    new Set([
      ...splitEnvList(process.env.DEV_CLOUD_ENV_IDS),
      ...splitEnvList(process.env.DEV_CLOUD_ENV_ID),
      ...splitEnvList(process.env.CURRENT_DEV_CLOUD_ENV_ID),
    ]),
  );
}

function getCurrentCloudEnvId(wxContext) {
  return (
    (wxContext && (wxContext.ENV || wxContext.TCB_ENV || wxContext.SCF_NAMESPACE)) ||
    process.env.TCB_ENV ||
    process.env.SCF_NAMESPACE ||
    process.env.WX_CLOUD_ENV ||
    process.env.CURRENT_CLOUD_ENV_ID ||
    ""
  );
}

function assertDevModeAvailable(wxContext) {
  const currentEnvId = getCurrentCloudEnvId(wxContext);
  const allowedEnvIds = getAllowedDevEnvIds();
  if (!currentEnvId || !allowedEnvIds.includes(currentEnvId)) {
    return fail("DEV_MODE_DISABLED", "开发者模式未启用");
  }
  return null;
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
  return (
    errMessage.includes("document not exist") ||
    errMessage.includes("document_not_exist") ||
    errMessage.includes("database_document_not_exist") ||
    errMessage.includes("does not exist") ||
    errMessage.includes("doesn't exist")
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

function buildProfileDto(profile, openid) {
  const fallbackName = `玩家${openid.slice(-4)}`;
  return {
    profileCompleted: Boolean(profile && profile.profileCompleted),
    displayName: (profile && (profile.defaultDisplayName || profile.displayName)) || fallbackName,
    avatarUrl: "",
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

    await upsertProfile(openid, {
      defaultDisplayName: normalized.data.defaultDisplayName,
      profileCompleted: normalized.data.profileCompleted,
      updatedAt: normalized.data.updatedAt,
    });
    const profile = await getProfile(openid);
    return ok(buildProfileDto(profile, openid));
  });
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

async function expireDevRoomWithVirtualMembers(room, members, openid, updatedAt) {
  const roomId = room.roomId || room._id;
  const canExpireDevRoom =
    (room.mode || ROOM_MODE_NORMAL) === ROOM_MODE_DEV &&
    room.createdByOpenId === openid &&
    members.length > 0 &&
    members.every((member) => getMemberOpenId(member) === openid || member.isVirtual);

  if (!canExpireDevRoom) {
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

    if ((room.mode || ROOM_MODE_NORMAL) === ROOM_MODE_DEV) {
      const members = await getActiveRoomMembers(profile.activeRoomId);
      const updatedAt = new Date();
      const expiredDevRoom = await expireDevRoomWithVirtualMembers(room, members, openid, updatedAt);
      if (expiredDevRoom) {
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
    return null;
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
    isDevRoom: roomMode === ROOM_MODE_DEV,
    hostMemberId: room.hostMemberId,
    playerCount: activeMembers.length,
    targetPlayerCount: room.targetPlayerCount,
    minPlayerCount: MIN_PLAYER_COUNT,
    maxPlayerCount: MAX_PLAYER_COUNT,
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
  return buildLobbySnapshotFromData(room, membersRes.data, openid);
}

async function createRoom(payload, openid, options = {}) {
  const roomMode = options.mode === ROOM_MODE_DEV ? ROOM_MODE_DEV : ROOM_MODE_NORMAL;
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
    const expireAt = room.expireAt || room.expiresAt;
    if (expireAt && new Date(expireAt).getTime() <= Date.now()) {
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
        expireAt: createExpireAt(joinedAt, ROOM_TTL_LOBBY_MS),
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

  const snapshot = await buildLobbySnapshot(roomId, openid);
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
      const isDevRoom = (room.mode || ROOM_MODE_NORMAL) === ROOM_MODE_DEV;
      const leavingDevHost = isDevRoom && (memberId === room.hostMemberId || room.createdByOpenId === openid);

      if (leavingDevHost) {
        const activeMembers = await getActiveRoomMembers(roomId);
        const expiredDevRoom = await expireDevRoomWithVirtualMembers(room, activeMembers, openid, updatedAt);

        if (expiredDevRoom) {
          await clearActiveRoomForProfile(openid, updatedAt);

          return ok({
            roomId,
            roomStatus: "expired",
            memberId,
            leaveMode: "expired_dev_room",
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
        expireAt: createExpireAt(updatedAt, ROOM_TTL_LOBBY_MS),
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
        expireAt: createExpireAt(updatedAt, ROOM_TTL_LOBBY_MS),
        version: _.inc(1),
        updatedAt,
      },
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    return ok(lobbySnapshot);
  });
}

async function startGame(payload, openid) {
  const roomId = payload && payload.roomId;
  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }

  return withCommandIdempotency(openid, payload, async () => {
    return await db.runTransaction(async (transaction) => {
      const roomRes = await transaction.collection("rooms").doc(roomId).get();
      const room = roomRes.data;
      if (!room) {
        return fail("ROOM_NOT_FOUND", "房间不存在");
      }

      if (room.status !== "lobby") {
        return fail("ACTION_NOT_ALLOWED", "房间已开局");
      }

      const membersRes = await transaction
        .collection("room_members")
        .where({
          roomId,
        })
        .get();
      const members = membersRes.data.filter(isActiveMember).sort((a, b) => a.seatIndex - b.seatIndex);
      const member = members.find((item) => getMemberOpenId(item) === openid) || null;
      if (!member) {
        return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
      }

      if (getMemberId(member) !== room.hostMemberId) {
        return fail("ACTION_NOT_ALLOWED", "只有房主可以开始游戏");
      }

      const isFull = members.length === room.targetPlayerCount;
      const allReady = members.length > 0 && members.every((item) => Boolean(item.isReady));
      const hasValidPlayerCount =
        Number.isInteger(members.length) &&
        members.length >= MIN_PLAYER_COUNT &&
        members.length <= MAX_PLAYER_COUNT &&
        Number.isInteger(room.targetPlayerCount) &&
        room.targetPlayerCount >= MIN_PLAYER_COUNT &&
        room.targetPlayerCount <= MAX_PLAYER_COUNT &&
        Boolean(getRolePreset(members.length));
      if (!hasValidPlayerCount) {
        return fail("INVALID_PLAYER_COUNT", "玩家人数不符合开局条件");
      }

      if (!isFull || !allReady) {
        return fail("ACTION_NOT_ALLOWED", "房间坐满且全员准备后才能开始");
      }

      const updatedAt = new Date();
      const projection = createInitialGameProjection(room, members, {
        createdAt: updatedAt,
      });
      const { gameCore, publicSnapshotPayload, privateSnapshotPayloads, publicEvents, expireAt } = projection;

      await transaction.collection("game_core").doc(gameCore.gameId).set({
        data: gameCore,
      });
      await transaction.collection("room_public_snapshots").doc(roomId).set({
        data: {
          roomId,
          roomCode: room.roomCode,
          roomStatus: "in_game",
          snapshotType: "game_public",
          version: gameCore.version,
          payload: publicSnapshotPayload,
          updatedAt,
          expireAt,
        },
      });

      for (const snapshot of privateSnapshotPayloads) {
        await transaction
          .collection("player_private_snapshots")
          .doc(snapshot.memberId)
          .set({
            data: {
              memberId: snapshot.memberId,
              roomId,
              gameId: gameCore.gameId,
              ownerOpenId: snapshot.ownerOpenId,
              roomStatus: "in_game",
              version: gameCore.version,
              payload: snapshot.payload,
              pendingTask: snapshot.payload.pendingTask,
              updatedAt,
              expireAt,
            },
          });
      }

      for (const event of publicEvents) {
        await transaction.collection("game_events").doc(event.eventId).set({
          data: event,
        });
      }

      await transaction.collection("rooms").doc(roomId).update({
        data: {
          status: "in_game",
          currentGameId: gameCore.gameId,
          playerCount: members.length,
          startedAt: updatedAt,
          expireAt,
          updatedAt,
          version: _.inc(1),
        },
      });

      for (const item of members) {
        const memberOpenId = getMemberOpenId(item);
        if (!memberOpenId) {
          continue;
        }
        await transaction
          .collection("user_profiles")
          .where({
            activeRoomId: roomId,
            activeMemberId: getMemberId(item),
          })
          .update({
            data: {
              activeRoomStatus: "in_game",
              updatedAt,
            },
          });
      }

      return ok({
        roomId,
        roomCode: room.roomCode,
        roomStatus: "in_game",
        version: gameCore.version,
        needsRefresh: true,
        routeHint: "board",
        boardPath: `/packageRoom/pages/board/index?roomId=${encodeURIComponent(roomId)}`,
      });
    });
  });
}

async function getGameSnapshot(payload, openid) {
  const roomId = payload && payload.roomId;
  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }

  const roomRes = await db.collection("rooms").doc(roomId).get();
  const room = roomRes.data;
  if (!room) {
    return fail("ROOM_NOT_FOUND", "房间不存在");
  }

  if (room.status !== "in_game") {
    return fail("GAME_NOT_STARTED", "房间尚未开局");
  }

  const member = await getRoomMember(roomId, openid);
  if (!member) {
    return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
  }

  const publicRes = await db.collection("room_public_snapshots").doc(roomId).get();
  const publicSnapshot = publicRes.data;
  if (!publicSnapshot || publicSnapshot.snapshotType !== "game_public") {
    return fail("GAME_NOT_STARTED", "对局快照尚未初始化");
  }

  const memberId = getMemberId(member);
  const privateRes = await db.collection("player_private_snapshots").doc(memberId).get();
  const privateSnapshot = privateRes.data;
  if (!privateSnapshot || privateSnapshot.roomId !== roomId) {
    return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
  }

  const publicPayload = publicSnapshot.payload || {};
  const privatePayload = privateSnapshot.payload || {};
  return ok({
    roomId,
    roomCode: publicPayload.roomCode || room.roomCode,
    roomStatus: "in_game",
    myMemberId: memberId,
    version: publicPayload.version || publicSnapshot.version || GAME_INITIAL_VERSION,
    round: publicPayload.round || 1,
    currentPhase: publicPayload.currentPhase || "nomination",
    publicState: publicPayload.publicState || {},
    privateState: privatePayload.privateState || {},
    pendingTask: privatePayload.pendingTask || privateSnapshot.pendingTask || null,
    serverHints: [],
    updatedAt: publicPayload.updatedAt || nowIso(),
  });
}

async function assertDevRoomHost(roomId, openid) {
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

  if ((room.mode || ROOM_MODE_NORMAL) !== ROOM_MODE_DEV) {
    return {
      error: fail("ACTION_NOT_ALLOWED", "当前房间不是开发者房间"),
    };
  }

  if (room.status !== "lobby") {
    return {
      error: fail("ACTION_NOT_ALLOWED", "房间已开局"),
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
      error: fail("ACTION_NOT_ALLOWED", "只有房主可以使用开发者操作"),
    };
  }

  return {
    room,
    member,
  };
}

async function devCreateRoom(payload, openid, wxContext) {
  const disabled = assertDevModeAvailable(wxContext);
  if (disabled) {
    return disabled;
  }

  return await createRoom(payload, openid, {
    mode: ROOM_MODE_DEV,
  });
}

async function devFillVirtualPlayers(payload, openid, wxContext) {
  const disabled = assertDevModeAvailable(wxContext);
  if (disabled) {
    return disabled;
  }

  const roomId = payload && payload.roomId;
  return withCommandIdempotency(openid, payload, async () => {
    const resolved = await assertDevRoomHost(roomId, openid);
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
        expireAt: createExpireAt(createdAt, ROOM_TTL_LOBBY_MS),
        version: _.inc(1),
        updatedAt: createdAt,
      },
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    return ok(lobbySnapshot);
  });
}

async function devReadyAllVirtualPlayers(payload, openid, wxContext) {
  const disabled = assertDevModeAvailable(wxContext);
  if (disabled) {
    return disabled;
  }

  const roomId = payload && payload.roomId;
  return withCommandIdempotency(openid, payload, async () => {
    const resolved = await assertDevRoomHost(roomId, openid);
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
        expireAt: createExpireAt(updatedAt, ROOM_TTL_LOBBY_MS),
        version: _.inc(1),
        updatedAt,
      },
    });

    const lobbySnapshot = await buildLobbySnapshot(roomId, openid);
    return ok(lobbySnapshot);
  });
}

async function dispatchAction(action, payload, openid, wxContext) {
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
    case "getGameSnapshot":
      return await getGameSnapshot(payload, openid);
    case "setReady":
      return await setReady(payload, openid);
    case "startGame":
      return await startGame(payload, openid);
    case "devCreateRoom":
      return await devCreateRoom(payload, openid, wxContext);
    case "devFillVirtualPlayers":
      return await devFillVirtualPlayers(payload, openid, wxContext);
    case "devReadyAllVirtualPlayers":
      return await devReadyAllVirtualPlayers(payload, openid, wxContext);
    default:
      return fail("INVALID_ACTION", "未知 action");
  }
}

exports.__testHooks = {
  ROLE_PRESET_BY_PLAYER_COUNT,
  INITIAL_POLICY_DECK,
  buildRoleAssignments,
  buildInitialPolicyState,
  createInitialGameProjection,
  getEligibleChancellorIdsFromCore,
};

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const action = event && event.action;
    const payload = (event && event.payload) || {};

    if (!openid) {
      return fail("UNAUTHORIZED", "无法获取用户身份");
    }

    return await dispatchAction(action, payload, openid, wxContext);
  } catch (err) {
    console.error("roomService error", err);
    return fail("INTERNAL_ERROR", "服务异常，请稍后重试", true);
  }
};
