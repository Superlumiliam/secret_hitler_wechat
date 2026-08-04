const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const MIN_PLAYER_COUNT = 5;
const MAX_PLAYER_COUNT = 10;
const ROOM_TTL_ACTIVE_MS = 3 * 60 * 60 * 1000;
const ROOM_TTL_RESULT_MS = 30 * 60 * 1000;
const COMMAND_RECORD_TTL_MS = 10 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 20 * 1000;
const ROOM_SYNC_SIGNAL_COLLECTION = "room_sync_signals";
const ROOM_MODE_NORMAL = "normal";
const ROOM_MODE_SOLO = "solo";
const MEMBER_TYPE_PLAYER = "player";
const MEMBER_TYPE_SPECTATOR = "spectator";
const COMMAND_RECORD_DIRECT_ID_ENABLED_AT = Date.now();
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
const EXECUTIVE_POWER_TRACK = {
  5: { 3: "POLICY_PEEK", 4: "EXECUTION", 5: "EXECUTION" },
  6: { 3: "POLICY_PEEK", 4: "EXECUTION", 5: "EXECUTION" },
  7: { 2: "INVESTIGATE", 3: "SPECIAL_ELECTION", 4: "EXECUTION", 5: "EXECUTION" },
  8: { 2: "INVESTIGATE", 3: "SPECIAL_ELECTION", 4: "EXECUTION", 5: "EXECUTION" },
  9: { 1: "INVESTIGATE", 2: "INVESTIGATE", 3: "SPECIAL_ELECTION", 4: "EXECUTION", 5: "EXECUTION" },
  10: { 1: "INVESTIGATE", 2: "INVESTIGATE", 3: "SPECIAL_ELECTION", 4: "EXECUTION", 5: "EXECUTION" },
};
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

function createResultExpireAt(baseTime) {
  return createExpireAt(baseTime, ROOM_TTL_RESULT_MS);
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

function getMemberId(member) {
  return member.memberId || member._id;
}

function getLegislativeHistory(gameCore) {
  return Array.isArray(gameCore && gameCore.legislativeHistory) ? gameCore.legislativeHistory : [];
}

function createLegislativeHistoryRecord(gameCore, presidentDiscardedPolicy) {
  return {
    round: gameCore.round,
    presidentMemberId: gameCore.currentPresidentId,
    chancellorMemberId: gameCore.currentChancellorId,
    presidentDiscardedPolicy,
    chancellorEnactedPolicy: null,
    chancellorDiscardedPolicies: [],
  };
}

function appendLegislativeHistoryRecord(gameCore, presidentDiscardedPolicy) {
  return getLegislativeHistory(gameCore).concat(createLegislativeHistoryRecord(gameCore, presidentDiscardedPolicy));
}

function updateLatestLegislativeHistoryRecord(gameCore, patch) {
  const history = getLegislativeHistory(gameCore).slice();
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (
      item.round === gameCore.round &&
      item.presidentMemberId === gameCore.currentPresidentId &&
      item.chancellorMemberId === gameCore.currentChancellorId
    ) {
      history[index] = {
        ...item,
        ...patch,
      };
      break;
    }
  }
  return history;
}

function buildLegislativeHistoryPayload(gameCore) {
  return getLegislativeHistory(gameCore).map((item) => ({
    round: item.round,
    presidentMemberId: item.presidentMemberId,
    chancellorMemberId: item.chancellorMemberId,
    presidentDiscardedPolicy: item.presidentDiscardedPolicy,
    chancellorEnactedPolicy: item.chancellorEnactedPolicy,
    chancellorDiscardedPolicies: Array.isArray(item.chancellorDiscardedPolicies)
      ? item.chancellorDiscardedPolicies.slice()
      : [],
  }));
}

function getMemberOpenId(member) {
  return member.openId || member.openid;
}

function isActiveMember(member) {
  return (member.memberStatus || member.status) === "active";
}

function isGameParticipantMember(member) {
  const status = member.memberStatus || member.status;
  return status === "active" || status === "offline";
}

function getMemberType(member) {
  return member && member.memberType === MEMBER_TYPE_SPECTATOR
    ? MEMBER_TYPE_SPECTATOR
    : MEMBER_TYPE_PLAYER;
}

function isPlayerMember(member) {
  return getMemberType(member) === MEMBER_TYPE_PLAYER;
}

function replaceFieldValue(value) {
  return _ && typeof _.set === "function" ? _.set(value) : value;
}

function toIsoString(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return String(value);
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

function isGameEndedCore(gameCore) {
  return Boolean(gameCore && (gameCore.phase === "game_ended" || gameCore.status === "ended" || gameCore.status === "game_ended"));
}

function getRoomStatusForGameCore(gameCore) {
  return isGameEndedCore(gameCore) ? "ended" : gameCore.status || "in_game";
}

function getPublicSnapshotTypeForGameCore(gameCore) {
  return isGameEndedCore(gameCore) ? "result_public" : "game_public";
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

  let member = options.member || null;
  if (!member) {
    const membersRes = await db
      .collection("room_members")
      .where({
        roomId,
        openId: openid,
        memberStatus: _.in(["active", "offline"]),
      })
      .limit(1)
      .get();
    member = membersRes.data[0];
  }
  if (!member) {
    return;
  }

  const updatedAt = new Date();
  const lastSeenAt = toDate(member.lastSeenAt);
  if (options.throttle && lastSeenAt && updatedAt.getTime() - lastSeenAt.getTime() < LAST_SEEN_THROTTLE_MS) {
    return;
  }

  const presenceData = {
    memberStatus: "active",
    lastSeenAt: updatedAt,
    updatedAt,
  };
  if (options.throttle && lastSeenAt) {
    await db
      .collection("room_members")
      .where({
        _id: getMemberId(member),
        lastSeenAt: _.lte(new Date(updatedAt.getTime() - LAST_SEEN_THROTTLE_MS)),
      })
      .update({
        data: presenceData,
      });
    return;
  }
  if (options.throttle) {
    await db.runTransaction(async (transaction) => {
      const memberRef = transaction.collection("room_members").doc(getMemberId(member));
      const latestMember = (await memberRef.get()).data;
      if (!latestMember || latestMember.roomId !== roomId || getMemberOpenId(latestMember) !== openid) {
        return;
      }
      const latestLastSeenAt = toDate(latestMember.lastSeenAt);
      if (latestLastSeenAt && updatedAt.getTime() - latestLastSeenAt.getTime() < LAST_SEEN_THROTTLE_MS) {
        return;
      }
      await memberRef.update({
        data: presenceData,
      });
    });
    return;
  }

  await db.collection("room_members").doc(getMemberId(member)).update({
    data: presenceData,
  });
}

async function writeRoomSyncSignal(target, roomId, roomStatus, version, updatedAt) {
  await target.collection(ROOM_SYNC_SIGNAL_COLLECTION).doc(roomId).set({
    data: {
      roomId,
      roomStatus,
      version,
      signalType: "room_version",
      updatedAt,
    },
  });
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

async function saveCommandRecord(scopeKey, commandId, hash, response, requesterOpenId) {
  await db.collection("command_records").doc(getCommandRecordId(scopeKey, commandId)).set({
    data: {
      scopeKey,
      commandId,
      requesterOpenId,
      payloadHash: hash,
      response,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + COMMAND_RECORD_TTL_MS),
    },
  });
}

async function withRoomCommandIdempotency(openid, roomId, payload, handler) {
  const commandId = payload && payload.commandId;
  if (!commandId || typeof commandId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 commandId");
  }

  const scopeKey = `room:${roomId}`;
  const hash = payloadHash(payload);
  const existing = await getCommandRecord(scopeKey, commandId);

  if (existing) {
    if (existing.requesterOpenId && existing.requesterOpenId !== openid) {
      return fail("ACTION_NOT_ALLOWED", "commandId 已被其他用户使用");
    }
    if (existing.payloadHash !== hash) {
      return fail("DUPLICATE_COMMAND", "commandId 已被不同请求使用");
    }
    return existing.response;
  }

  const response = await handler();
  if (response.success) {
    await saveCommandRecord(scopeKey, commandId, hash, response, openid);
  }
  return response;
}

async function getRoomMember(roomId, openid) {
  const membersRes = await db
    .collection("room_members")
    .where({
      roomId,
      openId: openid,
    })
    .get();
  return membersRes.data.find(isActiveMember) || null;
}

async function resolveActingMember(room, openid, controlledMemberId) {
  const roomId = room && (room.roomId || room._id);
  const realMember = await getRoomMember(roomId, openid);
  if (!realMember) {
    return {
      error: fail("NOT_ROOM_MEMBER", "当前用户不在房间中"),
    };
  }

  if (!controlledMemberId) {
    return {
      member: realMember,
      realMember,
    };
  }

  if ((room.mode || ROOM_MODE_NORMAL) !== ROOM_MODE_SOLO) {
    return {
      error: fail("ACTION_NOT_ALLOWED", "当前房间不允许切换操控席位"),
    };
  }

  let controlledMember = null;
  try {
    const controlledRes = await db.collection("room_members").doc(controlledMemberId).get();
    controlledMember = controlledRes.data;
  } catch (err) {
    if (!isDocumentNotFoundError(err)) {
      throw err;
    }
  }

  if (
    !controlledMember ||
    controlledMember.roomId !== roomId ||
    !isActiveMember(controlledMember) ||
    !isPlayerMember(controlledMember) ||
    !controlledMember.isVirtual
  ) {
    return {
      error: fail("INVALID_TARGET", "只能操控当前单人模式房间中的虚拟席位"),
    };
  }

  if (controlledMember.controlledByOpenId !== openid) {
    return {
      error: fail("ACTION_NOT_ALLOWED", "没有该虚拟席位的操控权限"),
    };
  }

  return {
    member: controlledMember,
    realMember,
  };
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

function buildPublicPolicyDeck(policyState) {
  return {
    drawCount: Array.isArray(policyState && policyState.drawPile) ? policyState.drawPile.length : 0,
    discardCount: Array.isArray(policyState && policyState.discardPile) ? policyState.discardPile.length : 0,
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

function getChancellorTargetOptions(gameCore, members) {
  const aliveMemberIds = gameCore.aliveMemberIds || [];
  const aliveCount = aliveMemberIds.length;

  return members.map((member) => {
    const memberId = getMemberId(member);
    let disabledReason = "";

    if (!aliveMemberIds.includes(memberId)) {
      disabledReason = "已出局";
    } else if (memberId === gameCore.currentPresidentCandidateId) {
      disabledReason = "不能提名自己";
    } else if (aliveCount > 5 && memberId === gameCore.previousElectedPresidentId) {
      disabledReason = "受上一届总统任期限制影响";
    } else if (memberId === gameCore.previousElectedChancellorId) {
      disabledReason = "受上一届总理任期限制影响";
    }

    return {
      memberId,
      canNominate: !disabledReason,
      disabledReason,
    };
  });
}

function getAliveMembers(gameCore, members) {
  const aliveMemberIds = gameCore.aliveMemberIds || [];
  return members.filter((member) => aliveMemberIds.includes(getMemberId(member)));
}

function getNextAlivePresidentCandidateId(gameCore, members) {
  const aliveMemberIds = gameCore.aliveMemberIds || [];
  const sortedMembers = members.slice().sort((a, b) => a.seatIndex - b.seatIndex);
  const basePresidentId =
    gameCore.specialElectionCallerId && gameCore.currentPresidentCandidateId === gameCore.forcedNextPresidentId
      ? gameCore.specialElectionCallerId
      : gameCore.currentPresidentCandidateId;
  const currentIndex = sortedMembers.findIndex((member) => getMemberId(member) === basePresidentId);
  if (!sortedMembers.length || !aliveMemberIds.length) {
    return "";
  }

  for (let offset = 1; offset <= sortedMembers.length; offset += 1) {
    const candidate = sortedMembers[(Math.max(currentIndex, 0) + offset) % sortedMembers.length];
    const candidateId = getMemberId(candidate);
    if (aliveMemberIds.includes(candidateId)) {
      return candidateId;
    }
  }
  return aliveMemberIds[0] || "";
}

function getNextNominationTransition(gameCore, members) {
  const wasForcedPresident =
    gameCore.specialElectionCallerId && gameCore.currentPresidentCandidateId === gameCore.forcedNextPresidentId;
  return {
    nextPresidentCandidateId: getNextAlivePresidentCandidateId(gameCore, members),
    specialElectionCallerId: wasForcedPresident ? null : gameCore.specialElectionCallerId || null,
    forcedNextPresidentId: wasForcedPresident ? null : gameCore.forcedNextPresidentId || null,
  };
}

function ensurePolicyDrawPile(policyState) {
  const nextPolicyState = {
    drawPile: ((policyState && policyState.drawPile) || []).slice(),
    discardPile: ((policyState && policyState.discardPile) || []).slice(),
    presidentHand: policyState ? policyState.presidentHand || null : null,
    chancellorHand: policyState ? policyState.chancellorHand || null : null,
    peekPile: policyState ? policyState.peekPile || null : null,
  };

  if (!nextPolicyState.drawPile.length && nextPolicyState.discardPile.length) {
    nextPolicyState.drawPile = shuffleCopy(nextPolicyState.discardPile);
    nextPolicyState.discardPile = [];
  }
  return nextPolicyState;
}

function drawPolicyCards(policyState, count) {
  const nextPolicyState = {
    drawPile: ((policyState && policyState.drawPile) || []).slice(),
    discardPile: ((policyState && policyState.discardPile) || []).slice(),
    presidentHand: policyState ? policyState.presidentHand || null : null,
    chancellorHand: policyState ? policyState.chancellorHand || null : null,
    peekPile: policyState ? policyState.peekPile || null : null,
  };

  if (nextPolicyState.drawPile.length < count && nextPolicyState.discardPile.length) {
    nextPolicyState.drawPile = shuffleCopy(nextPolicyState.drawPile.concat(nextPolicyState.discardPile));
    nextPolicyState.discardPile = [];
  }

  if (nextPolicyState.drawPile.length < count) {
    return {
      error: fail("INTERNAL_ERROR", "政策牌库不足，无法进入立法阶段", true),
    };
  }

  const cards = nextPolicyState.drawPile.splice(0, count);
  return {
    policyState: nextPolicyState,
    cards,
  };
}

function reshufflePolicyDeckForNextLegislative(policyState) {
  const nextPolicyState = {
    drawPile: ((policyState && policyState.drawPile) || []).slice(),
    discardPile: ((policyState && policyState.discardPile) || []).slice(),
    presidentHand: policyState ? policyState.presidentHand || null : null,
    chancellorHand: policyState ? policyState.chancellorHand || null : null,
    peekPile: policyState ? policyState.peekPile || null : null,
  };

  if (nextPolicyState.drawPile.length < 3 && nextPolicyState.discardPile.length) {
    nextPolicyState.drawPile = shuffleCopy(nextPolicyState.drawPile.concat(nextPolicyState.discardPile));
    nextPolicyState.discardPile = [];
  }
  return nextPolicyState;
}

function getExecutiveActionType(playerCount, fascistPolicyCount) {
  const track = EXECUTIVE_POWER_TRACK[playerCount] || EXECUTIVE_POWER_TRACK[6];
  return track[fascistPolicyCount] || null;
}

function getExecutiveAllowedTargetIds(gameCore, actionType) {
  const aliveMemberIds = (gameCore.aliveMemberIds || []).slice();
  if (actionType === "SPECIAL_ELECTION") {
    return aliveMemberIds.filter((memberId) => memberId !== gameCore.currentPresidentId);
  }
  if (actionType === "INVESTIGATE") {
    const investigatedMemberIds = gameCore.investigatedMemberIds || [];
    return aliveMemberIds.filter(
      (memberId) => memberId !== gameCore.currentPresidentId && !investigatedMemberIds.includes(memberId),
    );
  }
  if (actionType === "EXECUTION") {
    return aliveMemberIds;
  }
  return [];
}

function getExecutiveTaskType(actionType) {
  if (actionType === "INVESTIGATE") {
    return "EXEC_INVESTIGATE";
  }
  if (actionType === "SPECIAL_ELECTION") {
    return "EXEC_SPECIAL_ELECTION";
  }
  if (actionType === "POLICY_PEEK") {
    return "EXEC_POLICY_PEEK_ACK";
  }
  if (actionType === "EXECUTION") {
    return "EXECUTE_PLAYER";
  }
  return "";
}

function getExecutiveTaskMeta(actionType) {
  if (actionType === "INVESTIGATE") {
    return {
      actionTitle: "调查忠诚",
      actionHint: "选择另一名仍存活且本局未被调查的玩家，只会向你显示其阵营。",
    };
  }
  if (actionType === "SPECIAL_ELECTION") {
    return {
      actionTitle: "特别选举",
      actionHint: "选择另一名存活玩家担任下一任总统候选人，之后总统顺序会回到你下一位。",
    };
  }
  if (actionType === "POLICY_PEEK") {
    return {
      confirmText: "确认已查看",
    };
  }
  if (actionType === "EXECUTION") {
    return {
      actionTitle: "处决玩家",
      actionHint: "选择一名存活玩家立即出局；除非处决独裁者，否则不会公开其身份或阵营。",
      dangerConfirmText: "确认处决",
    };
  }
  return {};
}

function createVoteResult(gameCore, members, passed) {
  const votesByMemberId = (gameCore.phaseData && gameCore.phaseData.votesByMemberId) || {};
  const voteGroups = {
    jaMemberIds: [],
    neinMemberIds: [],
  };
  getAliveMembers(gameCore, members)
    .slice()
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .forEach((member) => {
      const memberId = getMemberId(member);
      const ballot = votesByMemberId[memberId] || {};
      if (ballot.vote === "JA") {
        voteGroups.jaMemberIds.push(memberId);
      } else if (ballot.vote === "NEIN") {
        voteGroups.neinMemberIds.push(memberId);
      }
    });
  const jaCount = voteGroups.jaMemberIds.length;
  const neinCount = voteGroups.neinMemberIds.length;

  return {
    round: gameCore.round,
    presidentCandidateId: gameCore.currentPresidentCandidateId,
    chancellorCandidateId: gameCore.currentChancellorCandidateId,
    voteGroups,
    jaCount,
    neinCount,
    passed,
    electionTrackerBefore: gameCore.electionTracker || 0,
    electionTrackerAfter: passed ? 0 : (gameCore.electionTracker || 0) + 1,
    chaosPolicy: null,
    hitlerCheck: null,
    commandIdsByMemberId: Object.fromEntries(
      Object.keys(votesByMemberId).map((memberId) => [memberId, votesByMemberId[memberId].commandId || ""]),
    ),
  };
}

function copyVoteGroups(voteGroups) {
  return {
    jaMemberIds: Array.isArray(voteGroups && voteGroups.jaMemberIds) ? voteGroups.jaMemberIds.slice() : [],
    neinMemberIds: Array.isArray(voteGroups && voteGroups.neinMemberIds) ? voteGroups.neinMemberIds.slice() : [],
  };
}

function getPolicyLabel(policy) {
  return policy === "LIBERAL" ? "自由派政策" : "极权派政策";
}

function createEmptyHistoryRound(round, aliveMemberIds) {
  return {
    round,
    status: "nominating",
    presidentId: null,
    chancellorId: null,
    voteSummary: {
      jaCount: 0,
      neinCount: 0,
      submittedCount: 0,
      requiredCount: aliveMemberIds.length,
      revealed: false,
      passed: null,
      electionTrackerCount: 0,
    },
    voteGroups: null,
    outcome: {
      type: "pending_nomination",
      label: "等待提名",
    },
    policyResult: null,
    executiveResult: null,
    vetoResult: null,
  };
}

function getOrCreateHistoryRound(roundsByNo, round, aliveMemberIds) {
  if (!roundsByNo[round]) {
    roundsByNo[round] = createEmptyHistoryRound(round, aliveMemberIds);
  }
  return roundsByNo[round];
}

function buildHistoryWinLabel(winner, winReason) {
  if (!winner) {
    return "";
  }
  if (winReason === "HITLER_ELECTED") {
    return "独裁者当选，极权派获胜";
  }
  if (winReason === "HITLER_EXECUTED") {
    return "独裁者被处决，自由派获胜";
  }
  return `${winner === "LIBERAL" ? "自由派" : "极权派"}获胜`;
}

function shouldPreserveExecutiveRoundOutcome(outcome) {
  return Boolean(
    outcome &&
      ["liberal_policy", "fascist_policy", "chaos_policy", "win"].includes(outcome.type),
  );
}

function getHistorySeatIndex(members, memberId) {
  const member = members.find((item) => getMemberId(item) === memberId);
  return member && Number.isFinite(Number(member.seatIndex)) ? Number(member.seatIndex) : null;
}

function buildExecutiveResult(historyItem, members, resultType) {
  const presidentMemberId = historyItem.presidentId || historyItem.presidentCandidateId || null;
  const targetMemberId = historyItem.targetMemberId || historyItem.nextPresidentCandidateId || null;
  const presidentSeatIndex = getHistorySeatIndex(members, presidentMemberId);
  const targetSeatIndex = getHistorySeatIndex(members, targetMemberId);
  const presidentText = presidentSeatIndex ? `${presidentSeatIndex}号总统` : "总统";
  const targetText = targetSeatIndex ? `${targetSeatIndex}号玩家` : "一名玩家";
  const textByType = {
    investigation: `${presidentText}调查了${targetText}`,
    special_election: `${presidentText}特别任命了${targetText}`,
    policy_peek: `${presidentText}查看了政策牌堆顶`,
    execution: `${presidentText}处决了${targetText}`,
  };
  const result = {
    type: resultType,
    text: textByType[resultType] || "",
    presidentMemberId,
    presidentSeatIndex,
  };
  if (targetMemberId) {
    result.targetMemberId = targetMemberId;
  }
  if (targetSeatIndex) {
    result.targetSeatIndex = targetSeatIndex;
  }
  return result;
}

function buildVetoOutcomeLabel(historyItem) {
  if (historyItem.accepted) {
    if (historyItem.chaosPolicy) {
      return `否决通过，混乱政策：${getPolicyLabel(historyItem.chaosPolicy.policy)}`;
    }
    return "否决通过";
  }
  return "否决被拒绝";
}

function applyPublicHistoryEventToRound(roundItem, historyItem, members) {
  const type = historyItem.type;
  if (historyItem.presidentId || historyItem.presidentCandidateId) {
    roundItem.presidentId = historyItem.presidentId || historyItem.presidentCandidateId;
  }
  if (historyItem.chancellorId || historyItem.chancellorCandidateId) {
    roundItem.chancellorId = historyItem.chancellorId || historyItem.chancellorCandidateId;
  }

  if (type === "GAME_STARTED" || type === "PRESIDENT_CANDIDATE_SELECTED") {
    roundItem.status = "nominating";
    roundItem.outcome = {
      type: "pending_nomination",
      label: "等待提名",
    };
    return;
  }

  if (type === "CHANCELLOR_NOMINATED") {
    roundItem.status = "voting";
    roundItem.outcome = {
      type: "pending_vote",
      label: "投票中",
    };
    return;
  }

  if (type === "VOTES_REVEALED") {
    const voteGroups = copyVoteGroups(historyItem.voteGroups);
    const jaCount = voteGroups.jaMemberIds.length;
    const neinCount = voteGroups.neinMemberIds.length;
    roundItem.voteSummary = {
      jaCount,
      neinCount,
      submittedCount: jaCount + neinCount,
      requiredCount: jaCount + neinCount,
      revealed: true,
      passed: Boolean(historyItem.passed),
      electionTrackerCount: historyItem.passed
        ? 0
        : Math.min(3, (historyItem.electionTrackerBefore || 0) + 1),
    };
    roundItem.voteGroups = voteGroups;

    if (historyItem.chaosPolicy) {
      roundItem.status = "chaos";
      roundItem.outcome = {
        type: "chaos_policy",
        label: `混乱政策：${getPolicyLabel(historyItem.chaosPolicy.policy)}`,
      };
    } else if (historyItem.hitlerCheck && historyItem.hitlerCheck.checked && historyItem.hitlerCheck.passed === false) {
      roundItem.status = "game_ended";
      roundItem.outcome = {
        type: "win",
        label: "独裁者当选，极权派获胜",
      };
    } else if (historyItem.passed) {
      roundItem.status = "legislating";
      roundItem.outcome = {
        type: "pending_legislation",
        label: "立法中",
      };
    } else {
      roundItem.status = "vote_failed";
      roundItem.outcome = {
        type: "vote_failed",
        label: "未通过",
      };
    }
    return;
  }

  if (type === "PRESIDENT_DISCARDED_POLICY") {
    roundItem.status = "legislating";
    roundItem.outcome = {
      type: "pending_legislation",
      label: "立法中",
    };
    return;
  }

  if (type === "VETO_REQUESTED") {
    roundItem.status = "legislating";
    roundItem.vetoResult = {
      status: "pending",
      accepted: null,
    };
    roundItem.outcome = {
      type: "vetoed",
      label: "否决待确认",
    };
    return;
  }

  if (type === "VETO_RESPONDED") {
    roundItem.vetoResult = {
      status: historyItem.accepted ? "accepted" : "rejected",
      accepted: Boolean(historyItem.accepted),
    };
    if (historyItem.accepted) {
      roundItem.status = historyItem.winner ? "game_ended" : "completed";
      roundItem.outcome = {
        type: historyItem.winner ? "win" : historyItem.chaosPolicy ? "chaos_policy" : "vetoed",
        label: historyItem.winner
          ? buildHistoryWinLabel(historyItem.winner, historyItem.winReason)
          : buildVetoOutcomeLabel(historyItem),
      };
    } else {
      roundItem.status = "legislating";
      roundItem.outcome = {
        type: "pending_legislation",
        label: "立法中",
      };
    }
    return;
  }

  if (type === "POLICY_ENACTED") {
    const policyType = historyItem.enactedPolicy === "LIBERAL" ? "liberal_policy" : "fascist_policy";
    roundItem.policyResult = {
      type: policyType,
      label: getPolicyLabel(historyItem.enactedPolicy),
    };
    roundItem.status = historyItem.winner ? "game_ended" : historyItem.executiveActionType ? "executing" : "completed";
    roundItem.outcome = {
      type: historyItem.winner ? "win" : policyType,
      label: historyItem.winner
        ? buildHistoryWinLabel(historyItem.winner, historyItem.winReason)
        : getPolicyLabel(historyItem.enactedPolicy),
    };
    return;
  }

  if (type === "EXEC_INVESTIGATED") {
    roundItem.status = "completed";
    roundItem.executiveResult = buildExecutiveResult(historyItem, members, "investigation");
    return;
  }

  if (type === "EXEC_SPECIAL_ELECTION") {
    roundItem.status = "completed";
    roundItem.executiveResult = buildExecutiveResult(historyItem, members, "special_election");
    return;
  }

  if (type === "EXEC_POLICY_PEEK_ACKED") {
    roundItem.status = "completed";
    roundItem.executiveResult = buildExecutiveResult(historyItem, members, "policy_peek");
    return;
  }

  if (type === "EXEC_PLAYER_EXECUTED") {
    roundItem.status = historyItem.winner ? "game_ended" : "completed";
    roundItem.executiveResult = buildExecutiveResult(historyItem, members, "execution");
    if (historyItem.winner) {
      roundItem.outcome = {
        type: "win",
        label: buildHistoryWinLabel(historyItem.winner, historyItem.winReason),
      };
    }
  }
}

function applyCurrentRoundToHistory(roundItem, publicState) {
  const currentPhase = publicState.currentPhase;
  const aliveMemberIds = publicState.aliveMemberIds || [];
  const submittedVoteMemberIds = publicState.submittedVoteMemberIds || [];
  const voteProgress = publicState.voteProgress || null;
  const voteResult = publicState.voteResult || null;
  const currentPresidentId = publicState.currentPresidentId || publicState.currentPresidentCandidateId || null;
  const currentChancellorId = publicState.currentChancellorId || publicState.currentChancellorCandidateId || null;

  roundItem.presidentId = currentPresidentId;
  roundItem.chancellorId = currentChancellorId;

  if (currentPhase === "nomination") {
    roundItem.status = "nominating";
    roundItem.voteSummary = {
      jaCount: 0,
      neinCount: 0,
      submittedCount: 0,
      requiredCount: aliveMemberIds.length,
      revealed: false,
      passed: null,
      electionTrackerCount: 0,
    };
    roundItem.voteGroups = null;
    roundItem.outcome = {
      type: "pending_nomination",
      label: "等待提名",
    };
  } else if (currentPhase === "voting") {
    roundItem.status = "voting";
    const requiredCount = voteProgress
      ? voteProgress.requiredCount || voteProgress.totalCount || aliveMemberIds.length
      : aliveMemberIds.length;
    roundItem.voteSummary = {
      jaCount: 0,
      neinCount: 0,
      submittedCount: submittedVoteMemberIds.length,
      requiredCount,
      revealed: false,
      passed: null,
      electionTrackerCount: 0,
    };
    roundItem.voteGroups = null;
    roundItem.outcome = {
      type: "pending_vote",
      label: "投票中",
    };
  } else if (currentPhase === "legislative_president" || currentPhase === "legislative_chancellor") {
    roundItem.status = "legislating";
    roundItem.outcome = {
      type: "pending_legislation",
      label: "立法中",
    };
  } else if (currentPhase === "veto_response") {
    roundItem.status = "legislating";
    roundItem.outcome = {
      type: "vetoed",
      label: "否决待确认",
    };
  } else if (currentPhase === "executive_action") {
    roundItem.status = "executing";
    if (!shouldPreserveExecutiveRoundOutcome(roundItem.outcome)) {
      roundItem.outcome = {
        type: "pending_legislation",
        label: "立法中",
      };
    }
  } else if (currentPhase === "game_ended" && voteResult && voteResult.hitlerCheck && voteResult.hitlerCheck.checked) {
    roundItem.status = "game_ended";
    roundItem.outcome = {
      type: "win",
      label: "独裁者当选，极权派获胜",
    };
  }
}

function buildPublicHistoryProjection(gameCore, members, publicHistory = []) {
  const sortedMembers = members.slice().sort((a, b) => a.seatIndex - b.seatIndex);
  const aliveMemberIds = (gameCore.aliveMemberIds || sortedMembers.map(getMemberId)).slice();
  const votesByMemberId = gameCore.phase === "voting" && gameCore.phaseData ? gameCore.phaseData.votesByMemberId || {} : {};
  const submittedVoteMemberIds = Object.keys(votesByMemberId).filter((memberId) => Boolean(votesByMemberId[memberId]));
  const maxEventRound = publicHistory.reduce((maxRound, item) => Math.max(maxRound, item.round || 1), 1);
  const roundsStarted = Math.max(gameCore.round || 1, maxEventRound);
  const roundsByNo = {};

  for (let round = 1; round <= roundsStarted; round += 1) {
    roundsByNo[round] = createEmptyHistoryRound(round, aliveMemberIds);
  }

  publicHistory
    .slice()
    .sort((a, b) => {
      if ((a.round || 1) !== (b.round || 1)) {
        return (a.round || 1) - (b.round || 1);
      }
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    })
    .forEach((historyItem) => {
      const roundItem = getOrCreateHistoryRound(roundsByNo, historyItem.round || 1, aliveMemberIds);
      applyPublicHistoryEventToRound(roundItem, historyItem, sortedMembers);
    });

  const currentRound = getOrCreateHistoryRound(roundsByNo, gameCore.round || 1, aliveMemberIds);
  applyCurrentRoundToHistory(currentRound, {
    currentPhase: gameCore.phase,
    aliveMemberIds,
    submittedVoteMemberIds,
    currentPresidentCandidateId: gameCore.currentPresidentCandidateId || null,
    currentChancellorCandidateId: gameCore.currentChancellorCandidateId || null,
    currentPresidentId: gameCore.currentPresidentId || null,
    currentChancellorId: gameCore.currentChancellorId || null,
    executiveActionType:
      gameCore.phase === "executive_action" && gameCore.phaseData ? gameCore.phaseData.actionType || null : null,
    voteProgress:
      gameCore.phase === "voting"
        ? {
            submittedCount: submittedVoteMemberIds.length,
            requiredCount: aliveMemberIds.length,
            totalCount: aliveMemberIds.length,
          }
        : null,
    voteResult: gameCore.lastVoteResult || null,
  });

  const rounds = Object.keys(roundsByNo)
    .map((round) => roundsByNo[round])
    .sort((a, b) => a.round - b.round);
  const roundsCompleted = isGameEndedCore(gameCore)
    ? roundsStarted
    : rounds.filter((round) => round.round < (gameCore.round || 1)).length;

  return {
    roundsStarted,
    roundsCompleted,
    rounds,
  };
}

function appendPublicHistory(publicHistory, gameCore, eventType, title, summary, createdAt, extra = {}) {
  const eventId = `evt_${gameCore.gameId}_${gameCore.eventSeq}`;
  const historyItem = {
    eventId,
    round: gameCore.round,
    phase: gameCore.phase,
    type: eventType,
    title,
    summary,
    createdAt: createdAt.toISOString(),
    ...extra,
  };
  publicHistory.push(historyItem);
  return {
    historyItem,
    event: {
      eventId,
      gameId: gameCore.gameId,
      roomId: gameCore.roomId,
      seq: gameCore.eventSeq,
      type: eventType,
      actorMemberId: null,
      targetMemberId: null,
      publicPayload: {
        title,
        summary,
        ...extra,
      },
      privatePayload: null,
      createdAt,
    },
  };
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
      presidentId: gameCore.currentPresidentCandidateId,
      presidentCandidateId: gameCore.currentPresidentCandidateId,
    },
  ];
}

function shouldExposeLastVoteResult(gameCore) {
  const voteResult = gameCore && gameCore.lastVoteResult;
  if (!voteResult) {
    return false;
  }

  const phase = gameCore.phase;
  if (phase === "legislative_president" || phase === "legislative_chancellor" || phase === "veto_response") {
    return (
      voteResult.passed === true &&
      voteResult.round === gameCore.round &&
      voteResult.presidentCandidateId === gameCore.currentPresidentId &&
      voteResult.chancellorCandidateId === gameCore.currentChancellorId
    );
  }

  if (phase === "nomination") {
    return voteResult.passed === false;
  }

  if (phase === "game_ended") {
    return Boolean(voteResult.hitlerCheck && voteResult.hitlerCheck.checked);
  }

  return false;
}

function buildPublicSnapshotPayload(room, gameCore, members, publicHistory, updatedAt) {
  const roomId = room.roomId || room._id;
  const votesByMemberId = (gameCore.phaseData && gameCore.phaseData.votesByMemberId) || {};
  const aliveMemberIds = gameCore.aliveMemberIds || [];
  const exposedVoteResult = shouldExposeLastVoteResult(gameCore) ? gameCore.lastVoteResult : null;
  const voteProgress =
    gameCore.phase === "voting"
      ? {
          submittedCount: aliveMemberIds.filter((memberId) => Boolean(votesByMemberId[memberId])).length,
          requiredCount: aliveMemberIds.length,
          totalCount: aliveMemberIds.length,
        }
      : exposedVoteResult
        ? {
          submittedCount: aliveMemberIds.length,
          requiredCount: aliveMemberIds.length,
          totalCount: aliveMemberIds.length,
          }
        : null;
  const submittedVoteMemberIds =
    gameCore.phase === "voting"
      ? aliveMemberIds.filter((memberId) => Boolean(votesByMemberId[memberId]))
      : [];
  const exposedVoteGroups = exposedVoteResult ? copyVoteGroups(exposedVoteResult.voteGroups) : null;
  const voteResult = exposedVoteResult
    ? {
        round: exposedVoteResult.round || gameCore.round,
        presidentCandidateId: exposedVoteResult.presidentCandidateId || null,
        chancellorCandidateId: exposedVoteResult.chancellorCandidateId || null,
        voteGroups: exposedVoteGroups,
        jaCount: exposedVoteGroups.jaMemberIds.length,
        neinCount: exposedVoteGroups.neinMemberIds.length,
        passed: Boolean(exposedVoteResult.passed),
        electionTrackerBefore: exposedVoteResult.electionTrackerBefore || 0,
        electionTrackerAfter: exposedVoteResult.electionTrackerAfter || 0,
        chaosPolicy: exposedVoteResult.chaosPolicy || null,
        hitlerCheck: exposedVoteResult.hitlerCheck || null,
      }
    : null;

  return {
    roomId,
    roomCode: room.roomCode,
    roomStatus: getRoomStatusForGameCore(gameCore),
    version: gameCore.version,
    round: gameCore.round,
    currentPhase: gameCore.phase,
    expireAt: toIsoString(gameCore.expireAt || room.expireAt || room.expiresAt),
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
      policyDeck: buildPublicPolicyDeck(gameCore.policyState),
      vetoUnlocked: gameCore.vetoUnlocked,
      executiveActionType:
        gameCore.phase === "executive_action" && gameCore.phaseData ? gameCore.phaseData.actionType || null : null,
      nextSpecialPresidentCandidateId: gameCore.forcedNextPresidentId || null,
      voteProgress,
      submittedVoteMemberIds,
      voteResult,
      history: buildPublicHistoryProjection(gameCore, members, publicHistory),
      publicHistory,
    },
    updatedAt: updatedAt.toISOString(),
  };
}

function buildResultTimeline(publicHistory) {
  return (publicHistory || [])
    .filter((item) =>
      [
        "GAME_STARTED",
        "CHANCELLOR_NOMINATED",
        "VOTES_REVEALED",
        "POLICY_ENACTED",
        "VETO_RESPONDED",
        "EXEC_INVESTIGATED",
        "EXEC_SPECIAL_ELECTION",
        "EXEC_POLICY_PEEK_ACKED",
        "EXEC_PLAYER_EXECUTED",
      ].includes(item.type),
    )
    .map((item) => ({
      eventId: item.eventId || "",
      round: item.round || 1,
      phase: item.phase || "",
      type: item.type || "",
      title: item.title || "",
      summary:
        item.type === "VOTES_REVEALED"
          ? [
              item.passed
                ? "政府通过"
                : `政府未通过${Math.min(3, (item.electionTrackerBefore || 0) + 1)}/3`,
              item.chaosPolicy && item.chaosPolicy.policy
                ? `混乱政府 颁布了 ${item.chaosPolicy.policy === "LIBERAL" ? "自由派法案" : "极权派法案"}`
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          : item.summary || "",
      voteGroups: item.type === "VOTES_REVEALED" ? copyVoteGroups(item.voteGroups) : null,
      createdAt: toIsoString(item.createdAt),
    }));
}

function buildResultSnapshotPayload(room, gameCore, members, publicHistory, updatedAt, viewerMemberId = "") {
  const roomId = room.roomId || room._id;
  const aliveMemberIds = gameCore.aliveMemberIds || [];
  const roleAssignments = gameCore.roleAssignments || {};
  return {
    roomId,
    roomCode: room.roomCode,
    roomStatus: "ended",
    myMemberId: viewerMemberId,
    version: gameCore.version,
    winner: gameCore.winner || "",
    winReason: gameCore.winReason || "",
    endedAt: toIsoString(gameCore.endedAt || updatedAt),
    expireAt: toIsoString(createResultExpireAt(gameCore.endedAt || updatedAt)),
    policySummary: {
      liberal: gameCore.liberalPolicyCount || 0,
      fascist: gameCore.fascistPolicyCount || 0,
    },
    legislativeHistory: buildLegislativeHistoryPayload(gameCore),
    finalPlayers: members.map((member) => {
      const memberId = getMemberId(member);
      const assignment = roleAssignments[memberId] || {};
      return {
        memberId,
        displayName: member.displayName || "",
        avatarUrl: member.avatarUrl || "",
        seatIndex: member.seatIndex,
        role: assignment.role || "",
        party: assignment.party || (assignment.role ? getPartyForRole(assignment.role) : ""),
        isAlive: aliveMemberIds.includes(memberId),
      };
    }),
    timeline: buildResultTimeline(publicHistory),
    updatedAt: updatedAt.toISOString(),
  };
}

function buildCompletedMultiplayerStatEvent(room, gameCore, members, updatedAt) {
  if ((room.mode || ROOM_MODE_NORMAL) !== ROOM_MODE_NORMAL || !isGameEndedCore(gameCore)) {
    return null;
  }
  if (!["LIBERAL", "FASCIST"].includes(gameCore.winner)) {
    throw new Error("COMPLETED_MULTIPLAYER_GAME_MISSING_WINNER");
  }
  if (!gameCore.gameId) {
    throw new Error("COMPLETED_MULTIPLAYER_GAME_MISSING_GAME_ID");
  }

  const players = [];
  const seenOpenIds = new Set();
  for (const member of members) {
    const openid = getMemberOpenId(member);
    if (
      !openid ||
      seenOpenIds.has(openid) ||
      !isGameParticipantMember(member) ||
      !isPlayerMember(member) ||
      member.isVirtual
    ) {
      continue;
    }

    const memberId = getMemberId(member);
    const assignment = (gameCore.roleAssignments || {})[memberId] || {};
    const party = assignment.party || (assignment.role ? getPartyForRole(assignment.role) : "");
    if (!["LIBERAL", "FASCIST"].includes(party)) {
      throw new Error(`COMPLETED_MULTIPLAYER_GAME_MISSING_PARTY:${memberId}`);
    }

    players.push({
      memberId,
      openId: openid,
      party,
      didWin: party === gameCore.winner,
    });
    seenOpenIds.add(openid);
  }
  return {
    gameId: gameCore.gameId,
    roomId: room.roomId || room._id || "",
    status: "pending",
    failureCount: 0,
    players,
    createdAt: updatedAt,
    updatedAt,
  };
}

async function persistEndedRoomProjection(transaction, roomId, endedAt, updatedAt, multiplayerStatEvent = null) {
  const expireAt = createResultExpireAt(endedAt || updatedAt);
  await transaction.collection("rooms").doc(roomId).update({
    data: {
      status: "ended",
      endedAt: endedAt || updatedAt,
      expireAt,
      updatedAt,
      version: _.inc(1),
    },
  });

  await transaction
    .collection("user_profiles")
    .where({
      activeRoomId: roomId,
    })
    .update({
      data: {
        activeRoomStatus: "ended",
        updatedAt,
      },
    });

  if (multiplayerStatEvent) {
    await transaction.collection("multiplayer_stat_events").doc(multiplayerStatEvent.gameId).set({
      data: multiplayerStatEvent,
    });
  }
}

function getTerminalExpirePatch(gameCore, updatedAt) {
  if (!isGameEndedCore(gameCore)) {
    return {};
  }
  return {
    expireAt: createResultExpireAt(gameCore.endedAt || updatedAt),
  };
}

function buildTaskId(gameCore, taskType, memberId) {
  return `${gameCore.gameId}:${gameCore.round}:${gameCore.phase}:${taskType}:${memberId}`;
}

function getComparablePrivateSnapshotPayload(payload) {
  if (!payload) {
    return "";
  }
  const { updatedAt, ...comparablePayload } = payload;
  return JSON.stringify(comparablePayload);
}

function getPrivateSnapshotExpireAt(gameCore, updatedAt) {
  const terminalPatch = getTerminalExpirePatch(gameCore, updatedAt);
  return toIsoString(terminalPatch.expireAt);
}

function buildChangedPrivateSnapshotPayloads(previousGameCore, nextGameCore, members, updatedAt) {
  const previousUpdatedAt = toDate(previousGameCore && previousGameCore.updatedAt) || updatedAt;
  const previousRoomStatus = getRoomStatusForGameCore(previousGameCore);
  const nextRoomStatus = getRoomStatusForGameCore(nextGameCore);
  const previousExpireAt = getPrivateSnapshotExpireAt(previousGameCore, previousUpdatedAt);
  const nextExpireAt = getPrivateSnapshotExpireAt(nextGameCore, updatedAt);

  return members
    .map((member) => {
      const previousPayload = buildPrivateSnapshotPayload(previousGameCore, member, members, previousUpdatedAt);
      const nextPayload = buildPrivateSnapshotPayload(nextGameCore, member, members, updatedAt);
      const payloadChanged =
        getComparablePrivateSnapshotPayload(previousPayload) !== getComparablePrivateSnapshotPayload(nextPayload);
      const statusChanged = previousRoomStatus !== nextRoomStatus || previousExpireAt !== nextExpireAt;

      if (!payloadChanged && !statusChanged) {
        return null;
      }
      return {
        memberId: getMemberId(member),
        ownerOpenId: getMemberOpenId(member),
        payload: nextPayload,
      };
    })
    .filter(Boolean);
}

function buildPrivateSnapshotPayload(gameCore, member, members, updatedAt) {
  const memberId = getMemberId(member);
  const assignment = gameCore.roleAssignments[memberId];
  const votesByMemberId = (gameCore.phaseData && gameCore.phaseData.votesByMemberId) || {};
  const ownBallot = votesByMemberId[memberId] || null;
  const memberById = {};
  members.forEach((item) => {
    memberById[getMemberId(item)] = item;
  });
  let pendingTask =
    gameCore.phase === "nomination" && memberId === gameCore.currentPresidentCandidateId
      ? {
          taskId: buildTaskId(gameCore, "NOMINATE_CHANCELLOR", memberId),
          taskType: "NOMINATE_CHANCELLOR",
          required: true,
          deadline: null,
          allowedTargets: getEligibleChancellorIdsFromCore(gameCore),
          meta: {
            ruleHint: "上一届当选政府成员不能再次组成政府；若仅存活 5 人则放宽总统限制",
            targetOptions: getChancellorTargetOptions(gameCore, members),
          },
        }
      : null;

  if (gameCore.phase === "voting" && (gameCore.aliveMemberIds || []).includes(memberId) && !ownBallot) {
    pendingTask = {
      taskId: buildTaskId(gameCore, "SUBMIT_VOTE", memberId),
      taskType: "SUBMIT_VOTE",
      required: true,
      deadline: null,
      allowedTargets: [],
      meta: {
        options: ["JA", "NEIN"],
      },
    };
  }

  if (gameCore.phase === "legislative_president" && memberId === gameCore.currentPresidentId) {
    const presidentHand =
      (gameCore.policyState && gameCore.policyState.presidentHand) ||
      (gameCore.phaseData && gameCore.phaseData.cards) ||
      null;
    pendingTask = {
      taskId: buildTaskId(gameCore, "PRESIDENT_DISCARD_POLICY", memberId),
      taskType: "PRESIDENT_DISCARD_POLICY",
      required: true,
      deadline: null,
      allowedTargets: [],
      meta: {
        selectionMode: "discard_one",
      },
    };
    if (Array.isArray(presidentHand)) {
      pendingTask.meta.cardCount = presidentHand.length;
    }
  }

  if (gameCore.phase === "legislative_chancellor" && memberId === gameCore.currentChancellorId) {
    const chancellorHand =
      (gameCore.policyState && gameCore.policyState.chancellorHand) ||
      (gameCore.phaseData && gameCore.phaseData.cards) ||
      null;
    pendingTask = {
      taskId: buildTaskId(gameCore, "CHANCELLOR_ENACT_POLICY", memberId),
      taskType: "CHANCELLOR_ENACT_POLICY",
      required: true,
      deadline: null,
      allowedTargets: [],
      meta: {
        selectionMode: "enact_one",
        canRequestVeto: Boolean(gameCore.phaseData && gameCore.phaseData.vetoAllowed),
      },
    };
    if (Array.isArray(chancellorHand)) {
      pendingTask.meta.cardCount = chancellorHand.length;
    }
  }

  if (gameCore.phase === "veto_response" && memberId === gameCore.currentPresidentId) {
    pendingTask = {
      taskId: buildTaskId(gameCore, "PRESIDENT_RESPOND_VETO", memberId),
      taskType: "PRESIDENT_RESPOND_VETO",
      required: true,
      deadline: null,
      allowedTargets: [],
      meta: {
        options: ["accept", "reject"],
        chancellorId: gameCore.currentChancellorId || (gameCore.phaseData && gameCore.phaseData.chancellorId) || null,
        electionTrackerBefore: gameCore.electionTracker || 0,
      },
    };
  }

  if (gameCore.phase === "executive_action" && memberId === gameCore.currentPresidentId) {
    const actionType = gameCore.phaseData && gameCore.phaseData.actionType;
    const taskType = getExecutiveTaskType(actionType);
    if (taskType) {
      pendingTask = {
        taskId: buildTaskId(gameCore, taskType, memberId),
        taskType,
        required: true,
        deadline: null,
        allowedTargets: getExecutiveAllowedTargetIds(gameCore, actionType),
        meta: getExecutiveTaskMeta(actionType),
      };
    }
  }

  const legislativeHand =
    gameCore.phase === "legislative_president" && memberId === gameCore.currentPresidentId
      ? (gameCore.policyState && gameCore.policyState.presidentHand) ||
        (gameCore.phaseData && gameCore.phaseData.cards) ||
        null
      : gameCore.phase === "legislative_chancellor" && memberId === gameCore.currentChancellorId
        ? (gameCore.policyState && gameCore.policyState.chancellorHand) ||
          (gameCore.phaseData && gameCore.phaseData.cards) ||
          null
        : null;
  const legislativeAction = gameCore.phase === "legislative_chancellor" ? "enact_one" : "discard_one";
  const investigationResultsByMemberId = gameCore.investigationResultsByMemberId || {};
  const investigationResult = investigationResultsByMemberId[memberId] || null;
  const investigationMarks = investigationResult
    ? [
        {
          targetMemberId: investigationResult.targetMemberId,
          party: investigationResult.party,
          round: investigationResult.round || null,
          revealedAt: investigationResult.revealedAt || null,
        },
      ]
    : [];
  const policyPeekCards =
    gameCore.phase === "executive_action" &&
    memberId === gameCore.currentPresidentId &&
    gameCore.phaseData &&
    gameCore.phaseData.actionType === "POLICY_PEEK" &&
    gameCore.policyState &&
    Array.isArray(gameCore.policyState.drawPile)
      ? gameCore.policyState.drawPile.slice(0, 3)
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
      voting:
        gameCore.phase === "voting" || ownBallot
          ? {
              submitted: Boolean(ownBallot),
              myVote: ownBallot ? ownBallot.vote : null,
            }
          : null,
      legislative:
        Array.isArray(legislativeHand)
          ? {
              hand: legislativeHand.slice(),
              action: legislativeAction,
              canRequestVeto: Boolean(
                gameCore.phase === "legislative_chancellor" &&
                  gameCore.phaseData &&
                  gameCore.phaseData.vetoAllowed,
              ),
            }
          : null,
      investigationResult,
      investigationMarks,
      policyPeek: policyPeekCards
        ? {
            cards: policyPeekCards,
            viewedAt: updatedAt.toISOString(),
          }
        : null,
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
    legislativeHistory: [],
    roleAssignments: buildRoleAssignments(sortedMembers, options),
    aliveMemberIds: sortedMembers.map(getMemberId),
    deadMemberIds: [],
    confirmedNotHitlerMemberIds: [],
    investigatedMemberIds: [],
    investigationResultsByMemberId: {},
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

async function startGame(payload, openid) {
  const roomId = payload && payload.roomId;
  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }

  return withRoomCommandIdempotency(openid, roomId, payload, async () => {
    return await db.runTransaction(async (transaction) => {
      const roomRes = await transaction.collection("rooms").doc(roomId).get();
      const room = roomRes.data;
      if (!room) {
        return fail("ROOM_NOT_FOUND", "房间不存在");
      }

      if (room.status !== "lobby") {
        return fail("GAME_ALREADY_STARTED", "房间已开局");
      }
      if (isRoomExpired(room)) {
        return fail("ROOM_EXPIRED", "房间已过期");
      }

      const membersRes = await transaction
        .collection("room_members")
        .where({
          roomId,
        })
        .get();
      const activeMembers = membersRes.data.filter(isActiveMember);
      const members = activeMembers.filter(isPlayerMember).sort((a, b) => a.seatIndex - b.seatIndex);
      const member = activeMembers.find((item) => getMemberOpenId(item) === openid) || null;
      if (!member) {
        return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
      }

      if (getMemberId(member) !== room.hostMemberId) {
        return fail("NOT_ROOM_HOST", "只有房主可以开始游戏");
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
        return fail("NOT_ALL_READY", "房间坐满且全员准备后才能开始");
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
      await writeRoomSyncSignal(transaction, roomId, "in_game", gameCore.version, updatedAt);

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

      for (const item of activeMembers) {
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
  const controlledMemberId = payload && payload.controlledMemberId;
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
  if (room.status === "ended") {
    return fail("GAME_ALREADY_ENDED", "对局已经结束");
  }
  if (room.status !== "in_game") {
    return fail("GAME_NOT_STARTED", "房间尚未开局");
  }

  const acting = await resolveActingMember(room, openid, controlledMemberId);
  if (acting.error) {
    return acting.error;
  }
  const member = acting.member;
  const realMemberType = getMemberType(acting.realMember);
  const hasPrivateView = isPlayerMember(member);
  const isSpectatorView = !hasPrivateView;

  const publicRes = await db.collection("room_public_snapshots").doc(roomId).get();
  const publicSnapshot = publicRes.data;
  if (!publicSnapshot || publicSnapshot.snapshotType !== "game_public") {
    return fail("GAME_NOT_STARTED", "对局快照尚未初始化");
  }

  const memberId = getMemberId(member);
  let privateSnapshot = null;
  if (hasPrivateView) {
    const privateRes = await db.collection("player_private_snapshots").doc(memberId).get();
    privateSnapshot = privateRes.data;
    if (!privateSnapshot || privateSnapshot.roomId !== roomId) {
      return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
    }
  }

  if (payload.touchPresence === true) {
    await touchRoomMemberLastSeen(openid, roomId, {
      member: acting.realMember,
      throttle: true,
    });
  }

  const publicPayload = publicSnapshot.payload || {};
  const privatePayload = (privateSnapshot && privateSnapshot.payload) || {};
  const clientPublicState = { ...(publicPayload.publicState || {}) };
  delete clientPublicState.publicHistory;
  return ok({
    roomId,
    roomCode: publicPayload.roomCode || room.roomCode,
    roomStatus: publicPayload.roomStatus || "in_game",
    roomMode: room.mode || ROOM_MODE_NORMAL,
    myMemberId: memberId,
    realMemberId: getMemberId(acting.realMember),
    controlledMemberId: controlledMemberId || "",
    viewerState: {
      realMemberType,
      isSpectatorView,
      hasPrivateView,
    },
    version: publicPayload.version || publicSnapshot.version || GAME_INITIAL_VERSION,
    round: publicPayload.round || 1,
    currentPhase: publicPayload.currentPhase || "nomination",
    publicState: clientPublicState,
    privateState: hasPrivateView ? privatePayload.privateState || {} : {},
    pendingTask: hasPrivateView
      ? privatePayload.pendingTask || (privateSnapshot && privateSnapshot.pendingTask) || null
      : null,
    serverHints: [],
    expireAt: publicPayload.expireAt || toIsoString(room.expireAt || room.expiresAt),
    updatedAt: publicPayload.updatedAt || nowIso(),
  });
}

function validateTaskId(taskId, gameCore, commandType, actorMemberId) {
  if (!taskId) {
    return fail("INVALID_PAYLOAD", "缺少 taskId");
  }

  const expectedTaskId = buildTaskId(gameCore, commandType, actorMemberId);
  if (taskId !== expectedTaskId) {
    return fail("ACTION_NOT_ALLOWED", "待办任务已过期，请刷新后重试");
  }
  return null;
}

function validateOptionalTaskId(taskId, gameCore, commandType, actorMemberId) {
  if (!taskId) {
    return null;
  }
  return validateTaskId(taskId, gameCore, commandType, actorMemberId);
}

function buildCommandAccepted(roomId, previousVersion, gameCore, previousPhase, options = {}) {
  const roomStatus = getRoomStatusForGameCore(gameCore);
  return ok({
    accepted: true,
    roomId,
    roomStatus,
    previousVersion,
    newVersion: gameCore.version,
    currentPhase: gameCore.phase,
    phaseChanged: previousPhase !== gameCore.phase,
    deduplicated: Boolean(options.deduplicated),
    needsRefresh: true,
    routeHint: roomStatus === "ended" || gameCore.phase === "game_ended" ? "result" : "board",
  });
}

async function submitCommand(payload, openid) {
  const roomId = payload && payload.roomId;
  const type = payload && payload.type;
  const expectedVersion = Number(payload && payload.expectedVersion);
  const controlledMemberId = payload && payload.controlledMemberId;

  if (!roomId || typeof roomId !== "string") {
    return fail("INVALID_PAYLOAD", "缺少 roomId");
  }
  if (!type || typeof type !== "string") {
    return fail("INVALID_PAYLOAD", "缺少命令类型");
  }
  if (!Number.isInteger(expectedVersion)) {
    return fail("INVALID_PAYLOAD", "缺少 expectedVersion");
  }

  return withRoomCommandIdempotency(openid, roomId, payload, async () => {
    return await db.runTransaction(async (transaction) => {
      const roomRes = await transaction.collection("rooms").doc(roomId).get();
      const room = roomRes.data;
      if (!room) {
        return fail("ROOM_NOT_FOUND", "房间不存在");
      }
      if (isRoomExpired(room)) {
        return fail("ROOM_EXPIRED", "房间已过期");
      }
      if (room.status === "ended") {
        return fail("GAME_ALREADY_ENDED", "对局已经结束");
      }
      if (room.status !== "in_game") {
        return fail("GAME_NOT_STARTED", "房间尚未开局");
      }

      const realMemberRes = await transaction
        .collection("room_members")
        .where({
          roomId,
          openId: openid,
        })
        .get();
      const realMember = realMemberRes.data.find(isActiveMember) || null;
      if (!realMember) {
        return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
      }

      let actorMember = realMember;
      if (controlledMemberId) {
        if ((room.mode || ROOM_MODE_NORMAL) !== ROOM_MODE_SOLO) {
          return fail("ACTION_NOT_ALLOWED", "当前房间不允许切换操控席位");
        }
        let controlledMember = null;
        try {
          const controlledRes = await transaction.collection("room_members").doc(controlledMemberId).get();
          controlledMember = controlledRes.data;
        } catch (err) {
          if (!isDocumentNotFoundError(err)) {
            throw err;
          }
        }
        if (
          !controlledMember ||
          controlledMember.roomId !== roomId ||
          !isActiveMember(controlledMember) ||
          !isPlayerMember(controlledMember) ||
          !controlledMember.isVirtual
        ) {
          return fail("INVALID_TARGET", "只能操控当前单人模式房间中的虚拟席位");
        }
        if (controlledMember.controlledByOpenId !== openid) {
          return fail("ACTION_NOT_ALLOWED", "没有该虚拟席位的操控权限");
        }
        actorMember = controlledMember;
      }
      if (!isPlayerMember(actorMember)) {
        return fail("ACTION_NOT_ALLOWED", "观战者不能提交游戏操作");
      }
      const actorMemberId = getMemberId(actorMember);

      const gameId = room.currentGameId;
      if (!gameId) {
        return fail("GAME_NOT_STARTED", "对局尚未初始化");
      }

      const gameCoreRes = await transaction.collection("game_core").doc(gameId).get();
      const gameCore = gameCoreRes.data;
      if (!gameCore || gameCore.roomId !== roomId) {
        return fail("GAME_NOT_STARTED", "对局状态不存在");
      }
      if (
        type === "SUBMIT_VOTE" &&
        gameCore.lastVoteResult &&
        gameCore.lastVoteResult.commandIdsByMemberId &&
        gameCore.lastVoteResult.commandIdsByMemberId[actorMemberId] === payload.commandId
      ) {
        return buildCommandAccepted(roomId, expectedVersion, gameCore, gameCore.phase, { deduplicated: true });
      }
      if (isGameEndedCore(gameCore)) {
        return fail("GAME_ALREADY_ENDED", "对局已经结束");
      }
      if (gameCore.version !== expectedVersion) {
        if (type === "SUBMIT_VOTE") {
          const existingBallot =
            gameCore.phase === "voting" && gameCore.phaseData && gameCore.phaseData.votesByMemberId
              ? gameCore.phaseData.votesByMemberId[actorMemberId]
              : null;
          const settledCommandId =
            gameCore.lastVoteResult &&
            gameCore.lastVoteResult.commandIdsByMemberId &&
            gameCore.lastVoteResult.commandIdsByMemberId[actorMemberId];
          if ((existingBallot && existingBallot.commandId === payload.commandId) || settledCommandId === payload.commandId) {
            return buildCommandAccepted(roomId, expectedVersion, gameCore, gameCore.phase, { deduplicated: true });
          }
          if (existingBallot || settledCommandId) {
            return fail("ACTION_NOT_ALLOWED", "该玩家已经提交过投票");
          }
        }
        return fail("VERSION_CONFLICT", "当前局势已更新，请刷新后重试", true);
      }

      const previousVersion = gameCore.version;
      const previousPhase = gameCore.phase;
      const updatedAt = new Date();
      const membersRes = await transaction
        .collection("room_members")
        .where({
          roomId,
        })
        .get();
      const members = membersRes.data
        .filter((member) => isGameParticipantMember(member) && isPlayerMember(member))
        .sort((a, b) => a.seatIndex - b.seatIndex);

      if (type === "SUBMIT_VOTE") {
        if (gameCore.phase !== "voting") {
          return fail("PHASE_MISMATCH", "当前阶段不能提交投票");
        }
        if (!(gameCore.aliveMemberIds || []).includes(actorMemberId)) {
          return fail("ACTION_NOT_ALLOWED", "已出局玩家不能投票");
        }

        const taskError = validateOptionalTaskId(payload.taskId, gameCore, type, actorMemberId);
        if (taskError) {
          return taskError;
        }

        const vote = payload.body && payload.body.vote;
        if (vote !== "JA" && vote !== "NEIN") {
          return fail("INVALID_PAYLOAD", "投票只能选择 JA 或 NEIN");
        }

        const currentPhaseData = gameCore.phaseData || {};
        const votesByMemberId = { ...(currentPhaseData.votesByMemberId || {}) };
        const existingBallot = votesByMemberId[actorMemberId] || null;
        if (existingBallot) {
          if (existingBallot.commandId === payload.commandId) {
            return buildCommandAccepted(roomId, previousVersion, gameCore, previousPhase, { deduplicated: true });
          }
          return fail("ACTION_NOT_ALLOWED", "该玩家已经提交过投票");
        }

        votesByMemberId[actorMemberId] = {
          vote,
          commandId: payload.commandId,
          submittedAt: updatedAt.toISOString(),
        };

        const aliveMemberIds = gameCore.aliveMemberIds || [];
        const allSubmitted = aliveMemberIds.every((memberId) => Boolean(votesByMemberId[memberId]));
        const publicSnapshotRes = await transaction.collection("room_public_snapshots").doc(roomId).get();
        const currentPublicPayload = (publicSnapshotRes.data && publicSnapshotRes.data.payload) || {};
        const publicHistory = (((currentPublicPayload.publicState || {}).publicHistory) || []).slice();
        const publicEvents = [];
        let nextGameCore = {
          ...gameCore,
          version: previousVersion + 1,
          phaseData: {
            ...currentPhaseData,
            votesByMemberId,
          },
          updatedAt,
        };

        if (allSubmitted) {
          const jaCount = aliveMemberIds.filter((memberId) => votesByMemberId[memberId].vote === "JA").length;
          const passed = jaCount > Math.floor(aliveMemberIds.length / 2);
          let voteResult = createVoteResult(nextGameCore, members, passed);
          nextGameCore.eventSeq = (nextGameCore.eventSeq || 0) + 1;
          const voteEvent = appendPublicHistory(
            publicHistory,
            nextGameCore,
            "VOTES_REVEALED",
            "政府投票揭示",
            `政府投票公开：${voteResult.jaCount} 票赞同，${voteResult.neinCount} 票反对，${passed ? "政府通过" : "政府未通过"}`,
            updatedAt,
            {
              presidentId: gameCore.currentPresidentCandidateId,
              chancellorId: gameCore.currentChancellorCandidateId,
              presidentCandidateId: gameCore.currentPresidentCandidateId,
              chancellorCandidateId: gameCore.currentChancellorCandidateId,
              voteGroups: voteResult.voteGroups,
              passed,
              electionTrackerBefore: voteResult.electionTrackerBefore,
              electionTrackerAfter: voteResult.electionTrackerAfter,
            },
          );

          if (passed) {
            const chancellorAssignment = (gameCore.roleAssignments || {})[gameCore.currentChancellorCandidateId] || {};
            const confirmedNotHitlerMemberIds = (gameCore.confirmedNotHitlerMemberIds || []).slice();
            let status = gameCore.status || "in_game";
            let phase = "legislative_president";
            let winner = gameCore.winner || null;
            let winReason = gameCore.winReason || null;
            let endedAt = gameCore.endedAt || null;
            let policyState = gameCore.policyState || buildInitialPolicyState();
            let presidentHand = null;

            if ((gameCore.fascistPolicyCount || 0) >= 3) {
              if (chancellorAssignment.role === "HITLER") {
                status = "ended";
                phase = "game_ended";
                winner = "FASCIST";
                winReason = "HITLER_ELECTED";
                endedAt = updatedAt;
                voteResult.hitlerCheck = {
                  checked: true,
                  chancellorId: gameCore.currentChancellorCandidateId,
                  passed: false,
                };
              } else {
                if (!confirmedNotHitlerMemberIds.includes(gameCore.currentChancellorCandidateId)) {
                  confirmedNotHitlerMemberIds.push(gameCore.currentChancellorCandidateId);
                }
                voteResult.hitlerCheck = {
                  checked: true,
                  chancellorId: gameCore.currentChancellorCandidateId,
                  passed: true,
                };
              }
            }

            if (phase === "legislative_president") {
              const drawResult = drawPolicyCards(policyState, 3);
              if (drawResult.error) {
                return drawResult.error;
              }
              policyState = {
                ...drawResult.policyState,
                presidentHand: drawResult.cards,
                chancellorHand: null,
              };
              presidentHand = drawResult.cards;
            }

            nextGameCore = {
              ...nextGameCore,
              status,
              phase,
              currentPresidentId: gameCore.currentPresidentCandidateId,
              currentChancellorId: gameCore.currentChancellorCandidateId,
              previousElectedPresidentId: gameCore.currentPresidentCandidateId,
              previousElectedChancellorId: gameCore.currentChancellorCandidateId,
              electionTracker: 0,
              confirmedNotHitlerMemberIds,
              policyState,
              phaseData:
                phase === "legislative_president"
                  ? {
                      presidentId: gameCore.currentPresidentCandidateId,
                      chancellorId: gameCore.currentChancellorCandidateId,
                      cards: presidentHand,
                    }
                  : {},
              lastVoteResult: voteResult,
              winner,
              winReason,
              endedAt,
            };
          } else {
            const nextElectionTracker = (gameCore.electionTracker || 0) + 1;
            const nominationTransition = getNextNominationTransition(gameCore, members);
            const nextPresidentCandidateId = nominationTransition.nextPresidentCandidateId;
            let phase = "nomination";
            let status = gameCore.status || "in_game";
            let policyState = gameCore.policyState || buildInitialPolicyState();
            let liberalPolicyCount = gameCore.liberalPolicyCount || 0;
            let fascistPolicyCount = gameCore.fascistPolicyCount || 0;
            let electionTracker = nextElectionTracker;
            let previousElectedPresidentId = gameCore.previousElectedPresidentId || null;
            let previousElectedChancellorId = gameCore.previousElectedChancellorId || null;
            let winner = gameCore.winner || null;
            let winReason = gameCore.winReason || null;
            let endedAt = gameCore.endedAt || null;

            if (nextElectionTracker >= 3) {
              policyState = ensurePolicyDrawPile(policyState);
              if (!policyState.drawPile.length) {
                return fail("INTERNAL_ERROR", "政策牌库为空，无法触发混乱政策", true);
              }
              const chaosPolicy = policyState.drawPile.shift();
              if (chaosPolicy === "LIBERAL") {
                liberalPolicyCount += 1;
              } else {
                fascistPolicyCount += 1;
              }
              voteResult.chaosPolicy = {
                policy: chaosPolicy,
                liberalPolicyCount,
                fascistPolicyCount,
              };
              voteResult.electionTrackerAfter = 0;
              electionTracker = 0;
              previousElectedPresidentId = null;
              previousElectedChancellorId = null;

              if (liberalPolicyCount >= 5) {
                status = "ended";
                phase = "game_ended";
                winner = "LIBERAL";
                winReason = "LIBERAL_POLICIES";
                endedAt = updatedAt;
              } else if (fascistPolicyCount >= 6) {
                status = "ended";
                phase = "game_ended";
                winner = "FASCIST";
                winReason = "FASCIST_POLICIES";
                endedAt = updatedAt;
              }
            }

            nextGameCore = {
              ...nextGameCore,
              status,
              phase,
              round: phase === "nomination" ? (gameCore.round || 1) + 1 : gameCore.round,
              currentPresidentCandidateId: nextPresidentCandidateId,
              currentChancellorCandidateId: null,
              currentPresidentId: null,
              currentChancellorId: null,
              specialElectionCallerId: nominationTransition.specialElectionCallerId,
              forcedNextPresidentId: nominationTransition.forcedNextPresidentId,
              previousElectedPresidentId,
              previousElectedChancellorId,
              electionTracker,
              liberalPolicyCount,
              fascistPolicyCount,
              policyState,
              phaseData:
                phase === "nomination"
                  ? {
                      presidentCandidateId: nextPresidentCandidateId,
                      eligibleChancellorIds: [],
                    }
                  : {},
              lastVoteResult: voteResult,
              winner,
              winReason,
              endedAt,
            };
            if (nextGameCore.phase === "nomination") {
              nextGameCore.phaseData.eligibleChancellorIds = getEligibleChancellorIdsFromCore(nextGameCore);
            }
          }
          voteEvent.historyItem.electionTrackerAfter = voteResult.electionTrackerAfter;
          voteEvent.historyItem.chaosPolicy = voteResult.chaosPolicy || null;
          voteEvent.historyItem.hitlerCheck = voteResult.hitlerCheck || null;
          voteEvent.event.publicPayload.electionTrackerAfter = voteResult.electionTrackerAfter;
          voteEvent.event.publicPayload.chaosPolicy = voteResult.chaosPolicy || null;
          voteEvent.event.publicPayload.hitlerCheck = voteResult.hitlerCheck || null;
          publicEvents.push(voteEvent.event);
        }

        const publicSnapshotPayload = isGameEndedCore(nextGameCore)
          ? buildResultSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt)
          : buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
        const privateSnapshotPayloads = buildChangedPrivateSnapshotPayloads(gameCore, nextGameCore, members, updatedAt);

        const multiplayerStatEvent = buildCompletedMultiplayerStatEvent(room, nextGameCore, members, updatedAt);

        await transaction.collection("game_core").doc(gameId).update({
          data: {
            status: nextGameCore.status,
            version: nextGameCore.version,
            eventSeq: nextGameCore.eventSeq,
            round: nextGameCore.round,
            phase: nextGameCore.phase,
            currentPresidentCandidateId: nextGameCore.currentPresidentCandidateId,
            currentChancellorCandidateId: nextGameCore.currentChancellorCandidateId,
            currentPresidentId: nextGameCore.currentPresidentId,
            currentChancellorId: nextGameCore.currentChancellorId,
            specialElectionCallerId: nextGameCore.specialElectionCallerId,
            forcedNextPresidentId: nextGameCore.forcedNextPresidentId,
            previousElectedPresidentId: nextGameCore.previousElectedPresidentId,
            previousElectedChancellorId: nextGameCore.previousElectedChancellorId,
            electionTracker: nextGameCore.electionTracker,
            liberalPolicyCount: nextGameCore.liberalPolicyCount,
            fascistPolicyCount: nextGameCore.fascistPolicyCount,
            confirmedNotHitlerMemberIds: replaceFieldValue(nextGameCore.confirmedNotHitlerMemberIds),
            policyState: replaceFieldValue(nextGameCore.policyState),
            phaseData: replaceFieldValue(nextGameCore.phaseData),
            lastVoteResult: replaceFieldValue(nextGameCore.lastVoteResult || null),
            winner: nextGameCore.winner,
            winReason: nextGameCore.winReason,
            endedAt: nextGameCore.endedAt,
            updatedAt,
          },
        });

        await transaction.collection("room_public_snapshots").doc(roomId).update({
          data: {
            roomStatus: getRoomStatusForGameCore(nextGameCore),
            snapshotType: getPublicSnapshotTypeForGameCore(nextGameCore),
            version: nextGameCore.version,
            payload: replaceFieldValue(publicSnapshotPayload),
            ...getTerminalExpirePatch(nextGameCore, updatedAt),
            updatedAt,
          },
        });
        await writeRoomSyncSignal(
          transaction,
          roomId,
          getRoomStatusForGameCore(nextGameCore),
          nextGameCore.version,
          updatedAt,
        );

        for (const snapshot of privateSnapshotPayloads) {
          await transaction
            .collection("player_private_snapshots")
            .doc(snapshot.memberId)
            .update({
              data: {
                roomStatus: getRoomStatusForGameCore(nextGameCore),
                version: nextGameCore.version,
                payload: replaceFieldValue(snapshot.payload),
                pendingTask: replaceFieldValue(snapshot.payload.pendingTask),
                ...getTerminalExpirePatch(nextGameCore, updatedAt),
                updatedAt,
              },
            });
        }

        for (const event of publicEvents) {
          await transaction.collection("game_events").doc(event.eventId).set({
            data: event,
          });
        }

        if (isGameEndedCore(nextGameCore)) {
          await persistEndedRoomProjection(
            transaction,
            roomId,
            nextGameCore.endedAt || updatedAt,
            updatedAt,
            multiplayerStatEvent,
          );
        }

        return buildCommandAccepted(roomId, previousVersion, nextGameCore, previousPhase);
      }

      if (type === "PRESIDENT_DISCARD_POLICY") {
        if (gameCore.phase !== "legislative_president") {
          return fail("PHASE_MISMATCH", "当前阶段不能由总统弃牌");
        }
        if (actorMemberId !== gameCore.currentPresidentId) {
          return fail("NOT_CURRENT_ACTOR", "只有当前总统可以处理政策牌");
        }

        const taskError = validateTaskId(payload.taskId, gameCore, type, actorMemberId);
        if (taskError) {
          return taskError;
        }

        const discardPolicyIndex = payload.body && payload.body.discardPolicyIndex;
        if (!Number.isInteger(discardPolicyIndex) || discardPolicyIndex < 0 || discardPolicyIndex > 2) {
          return fail("INVALID_PAYLOAD", "请选择一张要弃掉的政策牌");
        }

        const currentPolicyState = gameCore.policyState || buildInitialPolicyState();
        const presidentHand =
          currentPolicyState.presidentHand || (gameCore.phaseData && gameCore.phaseData.cards) || null;
        if (!Array.isArray(presidentHand) || presidentHand.length !== 3) {
          return fail("INTERNAL_ERROR", "总统政策手牌状态异常，请刷新后重试", true);
        }

        const discardedPolicy = presidentHand[discardPolicyIndex];
        const chancellorHand = presidentHand.filter((_, index) => index !== discardPolicyIndex);
        const legislativeHistory = appendLegislativeHistoryRecord(gameCore, discardedPolicy);
        const nextPolicyState = {
          drawPile: ((currentPolicyState && currentPolicyState.drawPile) || []).slice(),
          discardPile: ((currentPolicyState && currentPolicyState.discardPile) || []).concat(discardedPolicy),
          presidentHand: null,
          chancellorHand,
          peekPile: currentPolicyState ? currentPolicyState.peekPile || null : null,
        };

        const nextGameCore = {
          ...gameCore,
          version: previousVersion + 1,
          eventSeq: (gameCore.eventSeq || 0) + 1,
          phase: "legislative_chancellor",
          policyState: nextPolicyState,
          legislativeHistory,
          phaseData: {
            presidentId: gameCore.currentPresidentId,
            chancellorId: gameCore.currentChancellorId,
            cards: chancellorHand,
            vetoAllowed: Boolean(gameCore.vetoUnlocked),
          },
          updatedAt,
        };

        const publicSnapshotRes = await transaction.collection("room_public_snapshots").doc(roomId).get();
        const currentPublicPayload = (publicSnapshotRes.data && publicSnapshotRes.data.payload) || {};
        const publicHistory = (((currentPublicPayload.publicState || {}).publicHistory) || []).slice();
        const president = members.find((member) => getMemberId(member) === actorMemberId);
        const eventSummary = `${president ? president.displayName : "总统"} 已完成政策筛选，并将剩余政策交给总理`;
        const publicEvent = appendPublicHistory(
          publicHistory,
          nextGameCore,
          "PRESIDENT_DISCARDED_POLICY",
          "总统完成立法选择",
          eventSummary,
          updatedAt,
        );

        const publicSnapshotPayload = isGameEndedCore(nextGameCore)
          ? buildResultSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt)
          : buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
        const privateSnapshotPayloads = buildChangedPrivateSnapshotPayloads(gameCore, nextGameCore, members, updatedAt);

        await transaction.collection("game_core").doc(gameId).update({
          data: {
            version: nextGameCore.version,
            eventSeq: nextGameCore.eventSeq,
            phase: nextGameCore.phase,
            policyState: replaceFieldValue(nextGameCore.policyState),
            legislativeHistory: replaceFieldValue(nextGameCore.legislativeHistory),
            phaseData: replaceFieldValue(nextGameCore.phaseData),
            updatedAt,
          },
        });

        await transaction.collection("room_public_snapshots").doc(roomId).update({
          data: {
            version: nextGameCore.version,
            payload: replaceFieldValue(publicSnapshotPayload),
            updatedAt,
          },
        });
        await writeRoomSyncSignal(
          transaction,
          roomId,
          getRoomStatusForGameCore(nextGameCore),
          nextGameCore.version,
          updatedAt,
        );

        for (const snapshot of privateSnapshotPayloads) {
          await transaction
            .collection("player_private_snapshots")
            .doc(snapshot.memberId)
            .update({
              data: {
                version: nextGameCore.version,
                payload: replaceFieldValue(snapshot.payload),
                pendingTask: replaceFieldValue(snapshot.payload.pendingTask),
                updatedAt,
              },
            });
        }

        await transaction.collection("game_events").doc(publicEvent.event.eventId).set({
          data: {
            ...publicEvent.event,
            actorMemberId,
          },
        });

        return buildCommandAccepted(roomId, previousVersion, nextGameCore, previousPhase);
      }

      if (type === "CHANCELLOR_ENACT_POLICY") {
        if (gameCore.phase !== "legislative_chancellor") {
          return fail("PHASE_MISMATCH", "当前阶段不能由总理颁布政策");
        }
        if (actorMemberId !== gameCore.currentChancellorId) {
          return fail("NOT_CURRENT_ACTOR", "只有当前总理可以颁布政策");
        }

        const taskError = validateTaskId(payload.taskId, gameCore, type, actorMemberId);
        if (taskError) {
          return taskError;
        }

        const enactPolicyIndex = payload.body && payload.body.enactPolicyIndex;
        if (!Number.isInteger(enactPolicyIndex) || enactPolicyIndex < 0 || enactPolicyIndex > 1) {
          return fail("INVALID_PAYLOAD", "请选择一张要颁布的政策牌");
        }

        const currentPolicyState = gameCore.policyState || buildInitialPolicyState();
        const chancellorHand =
          currentPolicyState.chancellorHand || (gameCore.phaseData && gameCore.phaseData.cards) || null;
        if (!Array.isArray(chancellorHand) || chancellorHand.length !== 2) {
          return fail("INTERNAL_ERROR", "总理政策手牌状态异常，请刷新后重试", true);
        }

        const enactedPolicy = chancellorHand[enactPolicyIndex];
        const discardedPolicy = chancellorHand[enactPolicyIndex === 0 ? 1 : 0];
        const legislativeHistory = updateLatestLegislativeHistoryRecord(gameCore, {
          chancellorEnactedPolicy: enactedPolicy,
          chancellorDiscardedPolicies: [discardedPolicy],
        });
        let liberalPolicyCount = gameCore.liberalPolicyCount || 0;
        let fascistPolicyCount = gameCore.fascistPolicyCount || 0;
        if (enactedPolicy === "LIBERAL") {
          liberalPolicyCount += 1;
        } else {
          fascistPolicyCount += 1;
        }

        let status = gameCore.status || "in_game";
        let phase = "nomination";
        let winner = gameCore.winner || null;
        let winReason = gameCore.winReason || null;
        let endedAt = gameCore.endedAt || null;
        const executiveActionType =
          enactedPolicy === "FASCIST" ? getExecutiveActionType(gameCore.playerCount, fascistPolicyCount) : null;

        if (liberalPolicyCount >= 5) {
          status = "ended";
          phase = "game_ended";
          winner = "LIBERAL";
          winReason = "LIBERAL_POLICIES";
          endedAt = updatedAt;
        } else if (fascistPolicyCount >= 6) {
          status = "ended";
          phase = "game_ended";
          winner = "FASCIST";
          winReason = "FASCIST_POLICIES";
          endedAt = updatedAt;
        } else if (executiveActionType) {
          phase = "executive_action";
        }

        const nominationTransition = phase === "nomination" ? getNextNominationTransition(gameCore, members) : null;
        const nextPresidentCandidateId =
          phase === "nomination" ? nominationTransition.nextPresidentCandidateId : gameCore.currentPresidentCandidateId;
        let nextPolicyState = {
          drawPile: ((currentPolicyState && currentPolicyState.drawPile) || []).slice(),
          discardPile: ((currentPolicyState && currentPolicyState.discardPile) || []).concat(discardedPolicy),
          presidentHand: null,
          chancellorHand: null,
          peekPile: currentPolicyState ? currentPolicyState.peekPile || null : null,
        };
        nextPolicyState = reshufflePolicyDeckForNextLegislative(nextPolicyState);

        const nextGameCore = {
          ...gameCore,
          status,
          version: previousVersion + 1,
          eventSeq: (gameCore.eventSeq || 0) + 1,
          round: phase === "nomination" ? (gameCore.round || 1) + 1 : gameCore.round,
          phase,
          currentPresidentCandidateId: nextPresidentCandidateId,
          currentChancellorCandidateId: phase === "nomination" ? null : gameCore.currentChancellorCandidateId,
          currentPresidentId: phase === "nomination" ? null : gameCore.currentPresidentId,
          currentChancellorId: phase === "nomination" ? null : gameCore.currentChancellorId,
          specialElectionCallerId:
            phase === "nomination" ? nominationTransition.specialElectionCallerId : gameCore.specialElectionCallerId || null,
          forcedNextPresidentId:
            phase === "nomination" ? nominationTransition.forcedNextPresidentId : gameCore.forcedNextPresidentId || null,
          electionTracker: 0,
          liberalPolicyCount,
          fascistPolicyCount,
          vetoUnlocked: fascistPolicyCount >= 5,
          policyState: nextPolicyState,
          legislativeHistory,
          phaseData:
            phase === "nomination"
              ? {
                  presidentCandidateId: nextPresidentCandidateId,
                  eligibleChancellorIds: [],
                }
              : phase === "executive_action"
                ? {
                    presidentId: gameCore.currentPresidentId,
                    actionType: executiveActionType,
                    allowedTargetIds: getExecutiveAllowedTargetIds(
                      { ...gameCore, fascistPolicyCount, liberalPolicyCount },
                      executiveActionType,
                    ),
                  }
                : {},
          lastLegislativeResult: {
            round: gameCore.round,
            presidentId: gameCore.currentPresidentId,
            chancellorId: gameCore.currentChancellorId,
            enactedPolicy,
            liberalPolicyCount,
            fascistPolicyCount,
            executiveActionType,
          },
          winner,
          winReason,
          endedAt,
          updatedAt,
        };
        if (nextGameCore.phase === "nomination") {
          nextGameCore.phaseData.eligibleChancellorIds = getEligibleChancellorIdsFromCore(nextGameCore);
        }

        const publicSnapshotRes = await transaction.collection("room_public_snapshots").doc(roomId).get();
        const currentPublicPayload = (publicSnapshotRes.data && publicSnapshotRes.data.payload) || {};
        const publicHistory = (((currentPublicPayload.publicState || {}).publicHistory) || []).slice();
        const chancellor = members.find((member) => getMemberId(member) === actorMemberId);
        const policyText = enactedPolicy === "LIBERAL" ? "自由派政策" : "极权派政策";
        let eventSummary = `${chancellor ? chancellor.displayName : "总理"} 颁布了 1 张${policyText}`;
        if (winner) {
          eventSummary = `${eventSummary}，${winner === "LIBERAL" ? "自由派" : "极权派"}获胜`;
        } else if (executiveActionType) {
          eventSummary = `${eventSummary}，触发总统权力`;
        }
        const publicEvent = appendPublicHistory(
          publicHistory,
          { ...gameCore, eventSeq: nextGameCore.eventSeq },
          "POLICY_ENACTED",
          "政策颁布",
          eventSummary,
          updatedAt,
          {
            presidentId: gameCore.currentPresidentId,
            chancellorId: gameCore.currentChancellorId,
            enactedPolicy,
            liberalPolicyCount,
            fascistPolicyCount,
            executiveActionType,
            winner,
            winReason,
          },
        );

        const publicSnapshotPayload = isGameEndedCore(nextGameCore)
          ? buildResultSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt)
          : buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
        const privateSnapshotPayloads = buildChangedPrivateSnapshotPayloads(gameCore, nextGameCore, members, updatedAt);

        const multiplayerStatEvent = buildCompletedMultiplayerStatEvent(room, nextGameCore, members, updatedAt);

        await transaction.collection("game_core").doc(gameId).update({
          data: {
            status: nextGameCore.status,
            version: nextGameCore.version,
            eventSeq: nextGameCore.eventSeq,
            round: nextGameCore.round,
            phase: nextGameCore.phase,
            currentPresidentCandidateId: nextGameCore.currentPresidentCandidateId,
            currentChancellorCandidateId: nextGameCore.currentChancellorCandidateId,
            currentPresidentId: nextGameCore.currentPresidentId,
            currentChancellorId: nextGameCore.currentChancellorId,
            specialElectionCallerId: nextGameCore.specialElectionCallerId,
            forcedNextPresidentId: nextGameCore.forcedNextPresidentId,
            electionTracker: nextGameCore.electionTracker,
            liberalPolicyCount: nextGameCore.liberalPolicyCount,
            fascistPolicyCount: nextGameCore.fascistPolicyCount,
            vetoUnlocked: nextGameCore.vetoUnlocked,
            policyState: replaceFieldValue(nextGameCore.policyState),
            legislativeHistory: replaceFieldValue(nextGameCore.legislativeHistory),
            phaseData: replaceFieldValue(nextGameCore.phaseData),
            lastLegislativeResult: replaceFieldValue(nextGameCore.lastLegislativeResult),
            winner: nextGameCore.winner,
            winReason: nextGameCore.winReason,
            endedAt: nextGameCore.endedAt,
            updatedAt,
          },
        });

        await transaction.collection("room_public_snapshots").doc(roomId).update({
          data: {
            roomStatus: getRoomStatusForGameCore(nextGameCore),
            snapshotType: getPublicSnapshotTypeForGameCore(nextGameCore),
            version: nextGameCore.version,
            payload: replaceFieldValue(publicSnapshotPayload),
            ...getTerminalExpirePatch(nextGameCore, updatedAt),
            updatedAt,
          },
        });
        await writeRoomSyncSignal(
          transaction,
          roomId,
          getRoomStatusForGameCore(nextGameCore),
          nextGameCore.version,
          updatedAt,
        );

        for (const snapshot of privateSnapshotPayloads) {
          await transaction
            .collection("player_private_snapshots")
            .doc(snapshot.memberId)
            .update({
              data: {
                roomStatus: getRoomStatusForGameCore(nextGameCore),
                version: nextGameCore.version,
                payload: replaceFieldValue(snapshot.payload),
                pendingTask: replaceFieldValue(snapshot.payload.pendingTask),
                ...getTerminalExpirePatch(nextGameCore, updatedAt),
                updatedAt,
              },
            });
        }

        await transaction.collection("game_events").doc(publicEvent.event.eventId).set({
          data: {
            ...publicEvent.event,
            actorMemberId,
          },
        });

        if (isGameEndedCore(nextGameCore)) {
          await persistEndedRoomProjection(
            transaction,
            roomId,
            nextGameCore.endedAt || updatedAt,
            updatedAt,
            multiplayerStatEvent,
          );
        }

        return buildCommandAccepted(roomId, previousVersion, nextGameCore, previousPhase);
      }

      if (type === "CHANCELLOR_REQUEST_VETO") {
        if (gameCore.phase !== "legislative_chancellor") {
          return fail("PHASE_MISMATCH", "当前阶段不能提出否决");
        }
        if (actorMemberId !== gameCore.currentChancellorId) {
          return fail("NOT_CURRENT_ACTOR", "只有当前总理可以提出否决");
        }

        const taskError = validateTaskId(payload.taskId, gameCore, "CHANCELLOR_ENACT_POLICY", actorMemberId);
        if (taskError) {
          return taskError;
        }

        if (!gameCore.vetoUnlocked || !gameCore.phaseData || gameCore.phaseData.vetoAllowed !== true) {
          return fail("ACTION_NOT_ALLOWED", "当前立法阶段尚不能提出否决");
        }

        const currentPolicyState = gameCore.policyState || buildInitialPolicyState();
        const chancellorHand =
          currentPolicyState.chancellorHand || (gameCore.phaseData && gameCore.phaseData.cards) || null;
        if (!Array.isArray(chancellorHand) || chancellorHand.length !== 2) {
          return fail("INTERNAL_ERROR", "总理政策手牌状态异常，请刷新后重试", true);
        }

        const nextGameCore = {
          ...gameCore,
          version: previousVersion + 1,
          eventSeq: (gameCore.eventSeq || 0) + 1,
          phase: "veto_response",
          phaseData: {
            presidentId: gameCore.currentPresidentId,
            chancellorId: gameCore.currentChancellorId,
            cards: chancellorHand,
            requestedBy: actorMemberId,
            requestedAt: updatedAt.toISOString(),
          },
          updatedAt,
        };

        const publicSnapshotRes = await transaction.collection("room_public_snapshots").doc(roomId).get();
        const currentPublicPayload = (publicSnapshotRes.data && publicSnapshotRes.data.payload) || {};
        const publicHistory = (((currentPublicPayload.publicState || {}).publicHistory) || []).slice();
        const chancellor = members.find((member) => getMemberId(member) === actorMemberId);
        const publicEvent = appendPublicHistory(
          publicHistory,
          nextGameCore,
          "VETO_REQUESTED",
          "总理提出否决",
          `${chancellor ? chancellor.displayName : "总理"} 提出否决本届议程，等待总统回应`,
          updatedAt,
          {
            presidentId: gameCore.currentPresidentId,
            chancellorId: gameCore.currentChancellorId,
          },
        );

        const publicSnapshotPayload = isGameEndedCore(nextGameCore)
          ? buildResultSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt)
          : buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
        const privateSnapshotPayloads = buildChangedPrivateSnapshotPayloads(gameCore, nextGameCore, members, updatedAt);

        await transaction.collection("game_core").doc(gameId).update({
          data: {
            version: nextGameCore.version,
            eventSeq: nextGameCore.eventSeq,
            phase: nextGameCore.phase,
            phaseData: replaceFieldValue(nextGameCore.phaseData),
            updatedAt,
          },
        });

        await transaction.collection("room_public_snapshots").doc(roomId).update({
          data: {
            version: nextGameCore.version,
            payload: replaceFieldValue(publicSnapshotPayload),
            updatedAt,
          },
        });
        await writeRoomSyncSignal(
          transaction,
          roomId,
          getRoomStatusForGameCore(nextGameCore),
          nextGameCore.version,
          updatedAt,
        );

        for (const snapshot of privateSnapshotPayloads) {
          await transaction
            .collection("player_private_snapshots")
            .doc(snapshot.memberId)
            .update({
              data: {
                version: nextGameCore.version,
                payload: replaceFieldValue(snapshot.payload),
                pendingTask: replaceFieldValue(snapshot.payload.pendingTask),
                updatedAt,
              },
            });
        }

        await transaction.collection("game_events").doc(publicEvent.event.eventId).set({
          data: {
            ...publicEvent.event,
            actorMemberId,
          },
        });

        return buildCommandAccepted(roomId, previousVersion, nextGameCore, previousPhase);
      }

      if (type === "PRESIDENT_RESPOND_VETO") {
        if (gameCore.phase !== "veto_response") {
          return fail("PHASE_MISMATCH", "当前阶段不能回应否决");
        }
        if (actorMemberId !== gameCore.currentPresidentId) {
          return fail("NOT_CURRENT_ACTOR", "只有当前总统可以回应否决");
        }

        const taskError = validateTaskId(payload.taskId, gameCore, type, actorMemberId);
        if (taskError) {
          return taskError;
        }

        const accepted = payload.body && payload.body.accepted;
        if (typeof accepted !== "boolean") {
          return fail("INVALID_PAYLOAD", "请选择同意或拒绝否决");
        }

        const currentPolicyState = gameCore.policyState || buildInitialPolicyState();
        const chancellorHand =
          currentPolicyState.chancellorHand || (gameCore.phaseData && gameCore.phaseData.cards) || null;
        if (!Array.isArray(chancellorHand) || chancellorHand.length !== 2) {
          return fail("INTERNAL_ERROR", "总理政策手牌状态异常，请刷新后重试", true);
        }

        const publicSnapshotRes = await transaction.collection("room_public_snapshots").doc(roomId).get();
        const currentPublicPayload = (publicSnapshotRes.data && publicSnapshotRes.data.payload) || {};
        const publicHistory = (((currentPublicPayload.publicState || {}).publicHistory) || []).slice();
        const president = members.find((member) => getMemberId(member) === actorMemberId);
        let nextGameCore = null;
        let eventSummary = "";
        const eventExtra = {
          presidentId: gameCore.currentPresidentId,
          chancellorId: gameCore.currentChancellorId,
          accepted,
          electionTrackerBefore: gameCore.electionTracker || 0,
          electionTrackerAfter: gameCore.electionTracker || 0,
        };

        if (!accepted) {
          nextGameCore = {
            ...gameCore,
            version: previousVersion + 1,
            eventSeq: (gameCore.eventSeq || 0) + 1,
            phase: "legislative_chancellor",
            phaseData: {
              presidentId: gameCore.currentPresidentId,
              chancellorId: gameCore.currentChancellorId,
              cards: chancellorHand,
              vetoAllowed: false,
              vetoRejected: true,
            },
            updatedAt,
          };
          eventSummary = `${president ? president.displayName : "总统"} 拒绝否决，总理必须继续颁布 1 张政策`;
        } else {
          let status = gameCore.status || "in_game";
          let phase = "nomination";
          let winner = gameCore.winner || null;
          let winReason = gameCore.winReason || null;
          let endedAt = gameCore.endedAt || null;
          let liberalPolicyCount = gameCore.liberalPolicyCount || 0;
          let fascistPolicyCount = gameCore.fascistPolicyCount || 0;
          let electionTracker = (gameCore.electionTracker || 0) + 1;
          let previousElectedPresidentId = gameCore.previousElectedPresidentId || null;
          let previousElectedChancellorId = gameCore.previousElectedChancellorId || null;
          const nominationTransition = getNextNominationTransition(gameCore, members);
          let nextPresidentCandidateId = nominationTransition.nextPresidentCandidateId;
          let nextPolicyState = {
            drawPile: ((currentPolicyState && currentPolicyState.drawPile) || []).slice(),
            discardPile: ((currentPolicyState && currentPolicyState.discardPile) || []).concat(chancellorHand),
            presidentHand: null,
            chancellorHand: null,
            peekPile: currentPolicyState ? currentPolicyState.peekPile || null : null,
          };

          eventExtra.electionTrackerAfter = electionTracker;

          if (electionTracker >= 3) {
            nextPolicyState = ensurePolicyDrawPile(nextPolicyState);
            if (!nextPolicyState.drawPile.length) {
              return fail("INTERNAL_ERROR", "政策牌库为空，无法触发混乱政策", true);
            }
            const chaosPolicy = nextPolicyState.drawPile.shift();
            if (chaosPolicy === "LIBERAL") {
              liberalPolicyCount += 1;
            } else {
              fascistPolicyCount += 1;
            }
            electionTracker = 0;
            previousElectedPresidentId = null;
            previousElectedChancellorId = null;
            eventExtra.electionTrackerAfter = 0;
            eventExtra.chaosPolicy = {
              policy: chaosPolicy,
              liberalPolicyCount,
              fascistPolicyCount,
            };

            if (liberalPolicyCount >= 5) {
              status = "ended";
              phase = "game_ended";
              winner = "LIBERAL";
              winReason = "LIBERAL_POLICIES";
              endedAt = updatedAt;
            } else if (fascistPolicyCount >= 6) {
              status = "ended";
              phase = "game_ended";
              winner = "FASCIST";
              winReason = "FASCIST_POLICIES";
              endedAt = updatedAt;
            }
          }

          nextPolicyState = reshufflePolicyDeckForNextLegislative(nextPolicyState);
          if (phase === "game_ended") {
            nextPresidentCandidateId = gameCore.currentPresidentCandidateId;
          }

          nextGameCore = {
            ...gameCore,
            status,
            version: previousVersion + 1,
            eventSeq: (gameCore.eventSeq || 0) + 1,
            round: phase === "nomination" ? (gameCore.round || 1) + 1 : gameCore.round,
            phase,
            currentPresidentCandidateId: nextPresidentCandidateId,
            currentChancellorCandidateId: phase === "nomination" ? null : gameCore.currentChancellorCandidateId,
            currentPresidentId: phase === "nomination" ? null : gameCore.currentPresidentId,
            currentChancellorId: phase === "nomination" ? null : gameCore.currentChancellorId,
            specialElectionCallerId:
              phase === "nomination" ? nominationTransition.specialElectionCallerId : gameCore.specialElectionCallerId || null,
            forcedNextPresidentId:
              phase === "nomination" ? nominationTransition.forcedNextPresidentId : gameCore.forcedNextPresidentId || null,
            previousElectedPresidentId,
            previousElectedChancellorId,
            electionTracker,
            liberalPolicyCount,
            fascistPolicyCount,
            vetoUnlocked: Boolean(gameCore.vetoUnlocked || fascistPolicyCount >= 5),
            policyState: nextPolicyState,
            legislativeHistory: updateLatestLegislativeHistoryRecord(gameCore, {
              chancellorEnactedPolicy: null,
              chancellorDiscardedPolicies: chancellorHand.slice(),
            }),
            phaseData:
              phase === "nomination"
                ? {
                    presidentCandidateId: nextPresidentCandidateId,
                    eligibleChancellorIds: [],
                  }
                : {},
            lastLegislativeResult: {
              round: gameCore.round,
              presidentId: gameCore.currentPresidentId,
              chancellorId: gameCore.currentChancellorId,
              vetoed: true,
              accepted: true,
              electionTrackerBefore: eventExtra.electionTrackerBefore,
              electionTrackerAfter: eventExtra.electionTrackerAfter,
              chaosPolicy: eventExtra.chaosPolicy || null,
            },
            winner,
            winReason,
            endedAt,
            updatedAt,
          };
          if (nextGameCore.phase === "nomination") {
            nextGameCore.phaseData.eligibleChancellorIds = getEligibleChancellorIdsFromCore(nextGameCore);
          }

          eventExtra.winner = winner;
          eventExtra.winReason = winReason;
          eventSummary = `${president ? president.displayName : "总统"} 同意否决，本轮不颁布政策，选举计数器 ${eventExtra.electionTrackerBefore} → ${eventExtra.electionTrackerAfter}`;
          if (eventExtra.chaosPolicy) {
            eventSummary = `${eventSummary}，触发混乱政策：${getPolicyLabel(eventExtra.chaosPolicy.policy)}`;
          }
          if (winner) {
            eventSummary = `${eventSummary}，${winner === "LIBERAL" ? "自由派" : "极权派"}获胜`;
          }
        }

        const publicEvent = appendPublicHistory(
          publicHistory,
          { ...nextGameCore, round: gameCore.round, phase: gameCore.phase },
          "VETO_RESPONDED",
          accepted ? "总统同意否决" : "总统拒绝否决",
          eventSummary,
          updatedAt,
          eventExtra,
        );

        const publicSnapshotPayload = isGameEndedCore(nextGameCore)
          ? buildResultSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt)
          : buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
        const privateSnapshotPayloads = buildChangedPrivateSnapshotPayloads(gameCore, nextGameCore, members, updatedAt);

        const multiplayerStatEvent = buildCompletedMultiplayerStatEvent(room, nextGameCore, members, updatedAt);

        await transaction.collection("game_core").doc(gameId).update({
          data: {
            status: nextGameCore.status,
            version: nextGameCore.version,
            eventSeq: nextGameCore.eventSeq,
            round: nextGameCore.round,
            phase: nextGameCore.phase,
            currentPresidentCandidateId: nextGameCore.currentPresidentCandidateId,
            currentChancellorCandidateId: nextGameCore.currentChancellorCandidateId,
            currentPresidentId: nextGameCore.currentPresidentId,
            currentChancellorId: nextGameCore.currentChancellorId,
            specialElectionCallerId: nextGameCore.specialElectionCallerId,
            forcedNextPresidentId: nextGameCore.forcedNextPresidentId,
            previousElectedPresidentId: nextGameCore.previousElectedPresidentId,
            previousElectedChancellorId: nextGameCore.previousElectedChancellorId,
            electionTracker: nextGameCore.electionTracker,
            liberalPolicyCount: nextGameCore.liberalPolicyCount,
            fascistPolicyCount: nextGameCore.fascistPolicyCount,
            vetoUnlocked: nextGameCore.vetoUnlocked,
            policyState: replaceFieldValue(nextGameCore.policyState),
            legislativeHistory: replaceFieldValue(nextGameCore.legislativeHistory),
            phaseData: replaceFieldValue(nextGameCore.phaseData),
            lastLegislativeResult: replaceFieldValue(nextGameCore.lastLegislativeResult || gameCore.lastLegislativeResult || null),
            winner: nextGameCore.winner,
            winReason: nextGameCore.winReason,
            endedAt: nextGameCore.endedAt,
            updatedAt,
          },
        });

        await transaction.collection("room_public_snapshots").doc(roomId).update({
          data: {
            roomStatus: getRoomStatusForGameCore(nextGameCore),
            snapshotType: getPublicSnapshotTypeForGameCore(nextGameCore),
            version: nextGameCore.version,
            payload: replaceFieldValue(publicSnapshotPayload),
            ...getTerminalExpirePatch(nextGameCore, updatedAt),
            updatedAt,
          },
        });
        await writeRoomSyncSignal(
          transaction,
          roomId,
          getRoomStatusForGameCore(nextGameCore),
          nextGameCore.version,
          updatedAt,
        );

        for (const snapshot of privateSnapshotPayloads) {
          await transaction
            .collection("player_private_snapshots")
            .doc(snapshot.memberId)
            .update({
              data: {
                roomStatus: getRoomStatusForGameCore(nextGameCore),
                version: nextGameCore.version,
                payload: replaceFieldValue(snapshot.payload),
                pendingTask: replaceFieldValue(snapshot.payload.pendingTask),
                ...getTerminalExpirePatch(nextGameCore, updatedAt),
                updatedAt,
              },
            });
        }

        await transaction.collection("game_events").doc(publicEvent.event.eventId).set({
          data: {
            ...publicEvent.event,
            actorMemberId,
          },
        });

        if (isGameEndedCore(nextGameCore)) {
          await persistEndedRoomProjection(
            transaction,
            roomId,
            nextGameCore.endedAt || updatedAt,
            updatedAt,
            multiplayerStatEvent,
          );
        }

        return buildCommandAccepted(roomId, previousVersion, nextGameCore, previousPhase);
      }

      if (["EXEC_INVESTIGATE", "EXEC_SPECIAL_ELECTION", "EXEC_POLICY_PEEK_ACK", "EXECUTE_PLAYER"].includes(type)) {
        if (gameCore.phase !== "executive_action") {
          return fail("PHASE_MISMATCH", "当前阶段不能执行总统权力");
        }
        if (actorMemberId !== gameCore.currentPresidentId) {
          return fail("NOT_CURRENT_ACTOR", "只有当前总统可以执行总统权力");
        }

        const actionType = gameCore.phaseData && gameCore.phaseData.actionType;
        const expectedCommandType = getExecutiveTaskType(actionType);
        if (type !== expectedCommandType) {
          return fail("PHASE_MISMATCH", "当前总统权力与命令类型不匹配");
        }

        const taskError = validateTaskId(payload.taskId, gameCore, type, actorMemberId);
        if (taskError) {
          return taskError;
        }

        const targetMemberId = payload.body && payload.body.targetMemberId;
        const allowedTargetIds =
          (gameCore.phaseData && gameCore.phaseData.allowedTargetIds) || getExecutiveAllowedTargetIds(gameCore, actionType);
        if (type !== "EXEC_POLICY_PEEK_ACK" && (!targetMemberId || !allowedTargetIds.includes(targetMemberId))) {
          return fail("INVALID_TARGET", "该玩家不是当前总统权力的合法目标");
        }
        if (type === "EXEC_POLICY_PEEK_ACK" && (!payload.body || payload.body.acknowledged !== true)) {
          return fail("INVALID_PAYLOAD", "请确认已查看政策牌");
        }

        const publicSnapshotRes = await transaction.collection("room_public_snapshots").doc(roomId).get();
        const currentPublicPayload = (publicSnapshotRes.data && publicSnapshotRes.data.payload) || {};
        const publicHistory = (((currentPublicPayload.publicState || {}).publicHistory) || []).slice();
        const publicEvents = [];
        const president = members.find((member) => getMemberId(member) === actorMemberId);
        const targetMember = members.find((member) => getMemberId(member) === targetMemberId);
        const nominationTransition =
          type === "EXEC_SPECIAL_ELECTION"
            ? {
                nextPresidentCandidateId: targetMemberId,
                specialElectionCallerId: actorMemberId,
                forcedNextPresidentId: targetMemberId,
              }
            : getNextNominationTransition(gameCore, members);

        let status = gameCore.status || "in_game";
        let phase = "nomination";
        let winner = gameCore.winner || null;
        let winReason = gameCore.winReason || null;
        let endedAt = gameCore.endedAt || null;
        let aliveMemberIds = (gameCore.aliveMemberIds || []).slice();
        let deadMemberIds = (gameCore.deadMemberIds || []).slice();
        let investigatedMemberIds = (gameCore.investigatedMemberIds || []).slice();
        let investigationResultsByMemberId = { ...(gameCore.investigationResultsByMemberId || {}) };
        let nextPresidentCandidateId = nominationTransition.nextPresidentCandidateId;
        let specialElectionCallerId = nominationTransition.specialElectionCallerId;
        let forcedNextPresidentId = nominationTransition.forcedNextPresidentId;
        let eventType = "EXECUTIVE_ACTION_COMPLETED";
        let eventTitle = "总统权力完成";
        let eventSummary = `${president ? president.displayName : "总统"} 已完成总统权力`;
        const eventExtra = {
          executiveActionType: actionType,
          presidentId: actorMemberId,
          chancellorId: gameCore.currentChancellorId || null,
        };

        if (type === "EXEC_INVESTIGATE") {
          const assignment = (gameCore.roleAssignments || {})[targetMemberId] || {};
          if (!assignment.party) {
            return fail("INVALID_TARGET", "目标玩家身份不存在");
          }
          if (!investigatedMemberIds.includes(targetMemberId)) {
            investigatedMemberIds.push(targetMemberId);
          }
          investigationResultsByMemberId[actorMemberId] = {
            targetMemberId,
            targetDisplayName: targetMember ? targetMember.displayName : "",
            party: assignment.party,
            round: gameCore.round || null,
            revealedAt: updatedAt.toISOString(),
          };
          eventType = "EXEC_INVESTIGATED";
          eventTitle = "总统完成忠诚调查";
          eventSummary = `${president ? president.displayName : "总统"} 调查了 ${
            targetMember ? targetMember.displayName : "一名玩家"
          } 的忠诚`;
          eventExtra.targetMemberId = targetMemberId;
        } else if (type === "EXEC_SPECIAL_ELECTION") {
          eventType = "EXEC_SPECIAL_ELECTION";
          eventTitle = "特别选举发动";
          eventSummary = `${president ? president.displayName : "总统"} 指定 ${
            targetMember ? targetMember.displayName : "一名玩家"
          } 成为下一任特别总统候选人`;
          eventExtra.targetMemberId = targetMemberId;
          eventExtra.nextPresidentCandidateId = targetMemberId;
          eventExtra.callerMemberId = actorMemberId;
        } else if (type === "EXEC_POLICY_PEEK_ACK") {
          eventType = "EXEC_POLICY_PEEK_ACKED";
          eventTitle = "总统完成政策预览";
          eventSummary = `${president ? president.displayName : "总统"} 已秘密查看政策牌堆顶`;
        } else if (type === "EXECUTE_PLAYER") {
          const assignment = (gameCore.roleAssignments || {})[targetMemberId] || {};
          aliveMemberIds = aliveMemberIds.filter((memberId) => memberId !== targetMemberId);
          if (!deadMemberIds.includes(targetMemberId)) {
            deadMemberIds.push(targetMemberId);
          }
          eventType = "EXEC_PLAYER_EXECUTED";
          eventTitle = "总统完成处决";
          eventSummary = `${president ? president.displayName : "总统"} 处决了 ${
            targetMember ? targetMember.displayName : "一名玩家"
          }`;
          eventExtra.targetMemberId = targetMemberId;
          if (assignment.role === "HITLER") {
            status = "ended";
            phase = "game_ended";
            winner = "LIBERAL";
            winReason = "HITLER_EXECUTED";
            endedAt = updatedAt;
            nextPresidentCandidateId = gameCore.currentPresidentCandidateId;
            specialElectionCallerId = gameCore.specialElectionCallerId || null;
            forcedNextPresidentId = gameCore.forcedNextPresidentId || null;
            eventSummary = `${eventSummary}，独裁者被处决，自由派获胜`;
            eventExtra.winner = winner;
            eventExtra.winReason = winReason;
          } else if (!aliveMemberIds.includes(nextPresidentCandidateId)) {
            nextPresidentCandidateId = getNextAlivePresidentCandidateId(
              {
                ...gameCore,
                aliveMemberIds,
                currentPresidentCandidateId: nextPresidentCandidateId,
                specialElectionCallerId,
                forcedNextPresidentId,
              },
              members,
            );
          }
        }

        const nextGameCore = {
          ...gameCore,
          status,
          version: previousVersion + 1,
          eventSeq: (gameCore.eventSeq || 0) + 1,
          round: phase === "nomination" ? (gameCore.round || 1) + 1 : gameCore.round,
          phase,
          currentPresidentCandidateId: nextPresidentCandidateId,
          currentChancellorCandidateId: phase === "nomination" ? null : gameCore.currentChancellorCandidateId,
          currentPresidentId: phase === "nomination" ? null : gameCore.currentPresidentId,
          currentChancellorId: phase === "nomination" ? null : gameCore.currentChancellorId,
          specialElectionCallerId,
          forcedNextPresidentId,
          aliveMemberIds,
          deadMemberIds,
          investigatedMemberIds,
          investigationResultsByMemberId,
          phaseData:
            phase === "nomination"
              ? {
                  presidentCandidateId: nextPresidentCandidateId,
                  eligibleChancellorIds: [],
                }
              : {},
          winner,
          winReason,
          endedAt,
          updatedAt,
        };
        if (nextGameCore.phase === "nomination") {
          nextGameCore.phaseData.eligibleChancellorIds = getEligibleChancellorIdsFromCore(nextGameCore);
        }

        const publicEvent = appendPublicHistory(
          publicHistory,
          { ...nextGameCore, round: gameCore.round, phase: gameCore.phase },
          eventType,
          eventTitle,
          eventSummary,
          updatedAt,
          eventExtra,
        );
        publicEvents.push({
          ...publicEvent.event,
          actorMemberId,
          targetMemberId: targetMemberId || null,
        });

        const publicSnapshotPayload = isGameEndedCore(nextGameCore)
          ? buildResultSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt)
          : buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
        const privateSnapshotPayloads = buildChangedPrivateSnapshotPayloads(gameCore, nextGameCore, members, updatedAt);

        const multiplayerStatEvent = buildCompletedMultiplayerStatEvent(room, nextGameCore, members, updatedAt);

        await transaction.collection("game_core").doc(gameId).update({
          data: {
            status: nextGameCore.status,
            version: nextGameCore.version,
            eventSeq: nextGameCore.eventSeq,
            round: nextGameCore.round,
            phase: nextGameCore.phase,
            currentPresidentCandidateId: nextGameCore.currentPresidentCandidateId,
            currentChancellorCandidateId: nextGameCore.currentChancellorCandidateId,
            currentPresidentId: nextGameCore.currentPresidentId,
            currentChancellorId: nextGameCore.currentChancellorId,
            specialElectionCallerId: nextGameCore.specialElectionCallerId,
            forcedNextPresidentId: nextGameCore.forcedNextPresidentId,
            aliveMemberIds: replaceFieldValue(nextGameCore.aliveMemberIds),
            deadMemberIds: replaceFieldValue(nextGameCore.deadMemberIds),
            investigatedMemberIds: replaceFieldValue(nextGameCore.investigatedMemberIds),
            investigationResultsByMemberId: replaceFieldValue(nextGameCore.investigationResultsByMemberId),
            phaseData: replaceFieldValue(nextGameCore.phaseData),
            winner: nextGameCore.winner,
            winReason: nextGameCore.winReason,
            endedAt: nextGameCore.endedAt,
            updatedAt,
          },
        });

        await transaction.collection("room_public_snapshots").doc(roomId).update({
          data: {
            roomStatus: getRoomStatusForGameCore(nextGameCore),
            snapshotType: getPublicSnapshotTypeForGameCore(nextGameCore),
            version: nextGameCore.version,
            payload: replaceFieldValue(publicSnapshotPayload),
            ...getTerminalExpirePatch(nextGameCore, updatedAt),
            updatedAt,
          },
        });
        await writeRoomSyncSignal(
          transaction,
          roomId,
          getRoomStatusForGameCore(nextGameCore),
          nextGameCore.version,
          updatedAt,
        );

        for (const snapshot of privateSnapshotPayloads) {
          await transaction
            .collection("player_private_snapshots")
            .doc(snapshot.memberId)
            .update({
              data: {
                roomStatus: getRoomStatusForGameCore(nextGameCore),
                version: nextGameCore.version,
                payload: replaceFieldValue(snapshot.payload),
                pendingTask: replaceFieldValue(snapshot.payload.pendingTask),
                ...getTerminalExpirePatch(nextGameCore, updatedAt),
                updatedAt,
              },
            });
        }

        for (const event of publicEvents) {
          await transaction.collection("game_events").doc(event.eventId).set({
            data: event,
          });
        }

        if (isGameEndedCore(nextGameCore)) {
          await persistEndedRoomProjection(
            transaction,
            roomId,
            nextGameCore.endedAt || updatedAt,
            updatedAt,
            multiplayerStatEvent,
          );
        }

        return buildCommandAccepted(roomId, previousVersion, nextGameCore, previousPhase);
      }

      if (type !== "NOMINATE_CHANCELLOR") {
        return fail("PHASE_MISMATCH", "当前暂未接入该游戏命令");
      }
      if (gameCore.phase !== "nomination") {
        return fail("PHASE_MISMATCH", "当前阶段不能提名总理");
      }
      if (actorMemberId !== gameCore.currentPresidentCandidateId) {
        return fail("NOT_CURRENT_ACTOR", "只有当前总统候选人可以提名总理");
      }

      const taskError = validateTaskId(payload.taskId, gameCore, type, actorMemberId);
      if (taskError) {
        return taskError;
      }

      const targetMemberId = payload.body && payload.body.targetMemberId;
      const eligibleChancellorIds =
        (gameCore.phaseData && gameCore.phaseData.eligibleChancellorIds) || getEligibleChancellorIdsFromCore(gameCore);
      if (!targetMemberId || !eligibleChancellorIds.includes(targetMemberId)) {
        return fail("INVALID_TARGET", "该玩家不能被提名为总理");
      }

      const targetMember = members.find((member) => getMemberId(member) === targetMemberId);
      const publicActorMember = members.find((member) => getMemberId(member) === actorMemberId);
      if (!targetMember) {
        return fail("INVALID_TARGET", "目标玩家不存在");
      }

      const newVersion = previousVersion + 1;
      const nextGameCore = {
        ...gameCore,
        version: newVersion,
        eventSeq: (gameCore.eventSeq || 0) + 1,
        phase: "voting",
        currentChancellorCandidateId: targetMemberId,
        phaseData: {
          presidentCandidateId: actorMemberId,
          chancellorCandidateId: targetMemberId,
          votesByMemberId: {},
        },
        lastVoteResult: null,
        updatedAt,
      };

      const publicSnapshotRes = await transaction.collection("room_public_snapshots").doc(roomId).get();
      const currentPublicPayload = (publicSnapshotRes.data && publicSnapshotRes.data.payload) || {};
      const publicHistory = (((currentPublicPayload.publicState || {}).publicHistory) || []).slice();
      const eventId = `evt_${gameId}_${nextGameCore.eventSeq}`;
      const eventSummary = `${publicActorMember ? publicActorMember.displayName : "总统候选人"} 提名 ${
        targetMember.displayName
      } 为总理候选人`;
      publicHistory.push({
        eventId,
        round: nextGameCore.round,
        phase: "nomination",
        type: "CHANCELLOR_NOMINATED",
        title: "总理候选人提名",
        summary: eventSummary,
        createdAt: updatedAt.toISOString(),
        presidentId: actorMemberId,
        chancellorId: targetMemberId,
        presidentCandidateId: actorMemberId,
        chancellorCandidateId: targetMemberId,
      });

      const publicSnapshotPayload = buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
      const privateSnapshotPayloads = buildChangedPrivateSnapshotPayloads(gameCore, nextGameCore, members, updatedAt);

      await transaction.collection("game_core").doc(gameId).update({
        data: {
          version: nextGameCore.version,
          eventSeq: nextGameCore.eventSeq,
          phase: nextGameCore.phase,
          currentChancellorCandidateId: nextGameCore.currentChancellorCandidateId,
          phaseData: replaceFieldValue(nextGameCore.phaseData),
          lastVoteResult: replaceFieldValue(nextGameCore.lastVoteResult),
          updatedAt,
        },
      });

      await transaction.collection("room_public_snapshots").doc(roomId).update({
        data: {
          version: nextGameCore.version,
          payload: replaceFieldValue(publicSnapshotPayload),
          updatedAt,
        },
      });
      await writeRoomSyncSignal(
        transaction,
        roomId,
        getRoomStatusForGameCore(nextGameCore),
        nextGameCore.version,
        updatedAt,
      );

      for (const snapshot of privateSnapshotPayloads) {
        await transaction
          .collection("player_private_snapshots")
          .doc(snapshot.memberId)
          .update({
            data: {
              version: nextGameCore.version,
              payload: replaceFieldValue(snapshot.payload),
              pendingTask: replaceFieldValue(snapshot.payload.pendingTask),
              updatedAt,
            },
          });
      }

      await transaction.collection("game_events").doc(eventId).set({
        data: {
          eventId,
          gameId,
          roomId,
          seq: nextGameCore.eventSeq,
          type: "CHANCELLOR_NOMINATED",
          actorMemberId,
          targetMemberId,
          publicPayload: {
            title: "总理候选人提名",
            summary: eventSummary,
          },
          privatePayload: null,
          createdAt: updatedAt,
        },
      });

      return buildCommandAccepted(roomId, previousVersion, nextGameCore, previousPhase);
    });
  });
}

async function getResultSnapshot(payload, openid) {
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
  if (room.status !== "ended") {
    return fail(room.status === "lobby" ? "GAME_NOT_STARTED" : "ACTION_NOT_ALLOWED", "对局尚未结束");
  }

  const membersRes = await db
    .collection("room_members")
    .where({
      roomId,
    })
    .get();
  const roomMembers = membersRes.data.filter(isGameParticipantMember);
  const members = roomMembers.filter(isPlayerMember).sort((a, b) => a.seatIndex - b.seatIndex);
  const member = roomMembers.find((item) => getMemberOpenId(item) === openid) || null;
  if (!member) {
    return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
  }
  await touchRoomMemberLastSeen(openid, roomId, {
    member,
    throttle: true,
  });

  const publicRes = await db.collection("room_public_snapshots").doc(roomId).get();
  const publicSnapshot = publicRes.data;
  if (publicSnapshot && publicSnapshot.snapshotType === "result_public" && publicSnapshot.payload) {
    return ok({
      ...publicSnapshot.payload,
      roomStatus: "ended",
      myMemberId: getMemberId(member),
      expireAt: publicSnapshot.payload.expireAt || toIsoString(room.expireAt || room.expiresAt),
    });
  }

  const gameId = room.currentGameId;
  if (!gameId) {
    return fail("GAME_NOT_STARTED", "对局尚未初始化");
  }

  const gameCoreRes = await db.collection("game_core").doc(gameId).get();
  const gameCore = gameCoreRes.data;
  if (!gameCore || gameCore.roomId !== roomId) {
    return fail("GAME_NOT_STARTED", "对局状态不存在");
  }
  if (!isGameEndedCore(gameCore)) {
    return fail("ACTION_NOT_ALLOWED", "对局尚未结束");
  }

  const currentPublicPayload = (publicSnapshot && publicSnapshot.payload) || {};
  const publicHistory = (((currentPublicPayload.publicState || {}).publicHistory) || currentPublicPayload.timeline || []).slice();
  return ok(buildResultSnapshotPayload(room, gameCore, members, publicHistory, new Date(), getMemberId(member)));
}

async function dispatchAction(action, payload, openid) {
  switch (action) {
    case "startGame":
      return await startGame(payload, openid);
    case "getGameSnapshot":
      return await getGameSnapshot(payload, openid);
    case "submitCommand":
      return await submitCommand(payload, openid);
    case "getResultSnapshot":
      return await getResultSnapshot(payload, openid);
    default:
      return fail("INVALID_PAYLOAD", "未知 action");
  }
}

exports.__testHooks = {
  COMMAND_RECORD_DIRECT_ID_ENABLED_AT,
  LAST_SEEN_THROTTLE_MS,
  ROOM_TTL_ACTIVE_MS,
  ROOM_TTL_RESULT_MS,
  ROLE_PRESET_BY_PLAYER_COUNT,
  INITIAL_POLICY_DECK,
  buildRoleAssignments,
  buildInitialPolicyState,
  buildPublicHistoryProjection,
  buildPublicSnapshotPayload,
  buildResultSnapshotPayload,
  buildPrivateSnapshotPayload,
  buildTaskId,
  buildChangedPrivateSnapshotPayloads,
  createInitialGameProjection,
  createResultExpireAt,
  createVoteResult,
  drawPolicyCards,
  getExecutiveAllowedTargetIds,
  getExecutiveTaskType,
  getNextNominationTransition,
  getEligibleChancellorIdsFromCore,
  getChancellorTargetOptions,
  getCommandRecord,
  getCommandRecordId,
  getCommandTimestamp,
  getRoomMember,
  isDocumentNotFoundError,
  buildCompletedMultiplayerStatEvent,
  persistEndedRoomProjection,
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

    const response = await dispatchAction(action, payload, openid, wxContext);
    const touchedRoomId = (payload && payload.roomId) || (response && response.data && response.data.roomId);
    if (response && response.success && touchedRoomId && !["getGameSnapshot", "getResultSnapshot"].includes(action)) {
      await touchRoomMemberLastSeen(openid, touchedRoomId, {
        throttle: false,
      });
    }
    return response;
  } catch (err) {
    console.error("gameService error", err);
    return fail("INTERNAL_ERROR", "服务异常，请稍后重试", true);
  }
};
