const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const MIN_PLAYER_COUNT = 5;
const MAX_PLAYER_COUNT = 10;
const ROOM_TTL_ACTIVE_MS = 2 * 60 * 60 * 1000;
const COMMAND_RECORD_TTL_MS = 10 * 60 * 1000;
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

function getMemberId(member) {
  return member.memberId || member._id;
}

function getMemberOpenId(member) {
  return member.openId || member.openid;
}

function isActiveMember(member) {
  return (member.memberStatus || member.status) === "active";
}

function replaceFieldValue(value) {
  return _ && typeof _.set === "function" ? _.set(value) : value;
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

async function saveCommandRecord(scopeKey, commandId, hash, response, requesterOpenId) {
  await db.collection("command_records").add({
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
    .limit(1)
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

  if ((room.mode || ROOM_MODE_NORMAL) !== ROOM_MODE_DEV) {
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
    !controlledMember.isVirtual
  ) {
    return {
      error: fail("INVALID_TARGET", "只能操控当前开发者房间中的虚拟席位"),
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
  const currentIndex = sortedMembers.findIndex((member) => getMemberId(member) === gameCore.currentPresidentCandidateId);
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

function createVoteResult(gameCore, members, passed) {
  const votesByMemberId = (gameCore.phaseData && gameCore.phaseData.votesByMemberId) || {};
  const revealedVotes = getAliveMembers(gameCore, members).map((member) => {
    const memberId = getMemberId(member);
    const ballot = votesByMemberId[memberId] || {};
    return {
      memberId,
      displayName: member.displayName,
      vote: ballot.vote || "",
    };
  });
  const jaCount = revealedVotes.filter((item) => item.vote === "JA").length;
  const neinCount = revealedVotes.filter((item) => item.vote === "NEIN").length;

  return {
    round: gameCore.round,
    presidentCandidateId: gameCore.currentPresidentCandidateId,
    chancellorCandidateId: gameCore.currentChancellorCandidateId,
    revealedVotes,
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
    },
  ];
}

function buildPublicSnapshotPayload(room, gameCore, members, publicHistory, updatedAt) {
  const roomId = room.roomId || room._id;
  const votesByMemberId = (gameCore.phaseData && gameCore.phaseData.votesByMemberId) || {};
  const aliveMemberIds = gameCore.aliveMemberIds || [];
  const voteProgress =
    gameCore.phase === "voting"
      ? {
          submittedCount: aliveMemberIds.filter((memberId) => Boolean(votesByMemberId[memberId])).length,
          requiredCount: aliveMemberIds.length,
          totalCount: aliveMemberIds.length,
        }
      : gameCore.lastVoteResult
        ? {
            submittedCount: aliveMemberIds.length,
            requiredCount: aliveMemberIds.length,
            totalCount: aliveMemberIds.length,
          }
        : null;
  const revealedVotes = gameCore.lastVoteResult ? gameCore.lastVoteResult.revealedVotes || [] : null;
  const voteResult = gameCore.lastVoteResult
    ? {
        jaCount: gameCore.lastVoteResult.jaCount || 0,
        neinCount: gameCore.lastVoteResult.neinCount || 0,
        passed: Boolean(gameCore.lastVoteResult.passed),
        electionTrackerBefore: gameCore.lastVoteResult.electionTrackerBefore || 0,
        electionTrackerAfter: gameCore.lastVoteResult.electionTrackerAfter || 0,
        chaosPolicy: gameCore.lastVoteResult.chaosPolicy || null,
        hitlerCheck: gameCore.lastVoteResult.hitlerCheck || null,
      }
    : null;

  return {
    roomId,
    roomCode: room.roomCode,
    roomStatus: gameCore.status || "in_game",
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
      voteProgress,
      revealedVotes,
      voteResult,
      publicHistory,
    },
    updatedAt: updatedAt.toISOString(),
  };
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
          taskId: `${gameCore.gameId}:${gameCore.version}:NOMINATE_CHANCELLOR:${memberId}`,
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
      taskId: `${gameCore.gameId}:${gameCore.version}:SUBMIT_VOTE:${memberId}`,
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
      taskId: `${gameCore.gameId}:${gameCore.version}:PRESIDENT_DISCARD_POLICY:${memberId}`,
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

  const legislativeHand =
    gameCore.phase === "legislative_president" && memberId === gameCore.currentPresidentId
      ? (gameCore.policyState && gameCore.policyState.presidentHand) ||
        (gameCore.phaseData && gameCore.phaseData.cards) ||
        null
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
              action: "discard_one",
              canRequestVeto: false,
            }
          : null,
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
  const controlledMemberId = payload && payload.controlledMemberId;
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

  const acting = await resolveActingMember(room, openid, controlledMemberId);
  if (acting.error) {
    return acting.error;
  }
  const member = acting.member;

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
    roomStatus: publicPayload.roomStatus || "in_game",
    roomMode: room.mode || ROOM_MODE_NORMAL,
    myMemberId: memberId,
    realMemberId: getMemberId(acting.realMember),
    controlledMemberId: controlledMemberId || "",
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

function validateTaskId(taskId, gameCore, commandType, actorMemberId) {
  if (!taskId) {
    return fail("INVALID_PAYLOAD", "缺少 taskId");
  }

  const expectedTaskId = `${gameCore.gameId}:${gameCore.version}:${commandType}:${actorMemberId}`;
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
  return ok({
    accepted: true,
    roomId,
    roomStatus: gameCore.status || "in_game",
    previousVersion,
    newVersion: gameCore.version,
    currentPhase: gameCore.phase,
    phaseChanged: previousPhase !== gameCore.phase,
    deduplicated: Boolean(options.deduplicated),
    needsRefresh: true,
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
      if (room.status !== "in_game") {
        return fail("GAME_NOT_STARTED", "房间尚未开局");
      }

      const realMemberRes = await transaction
        .collection("room_members")
        .where({
          roomId,
          openId: openid,
        })
        .limit(1)
        .get();
      const realMember = realMemberRes.data.find(isActiveMember) || null;
      if (!realMember) {
        return fail("NOT_ROOM_MEMBER", "当前用户不在房间中");
      }

      let actorMember = realMember;
      if (controlledMemberId) {
        if ((room.mode || ROOM_MODE_NORMAL) !== ROOM_MODE_DEV) {
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
          !controlledMember.isVirtual
        ) {
          return fail("INVALID_TARGET", "只能操控当前开发者房间中的虚拟席位");
        }
        if (controlledMember.controlledByOpenId !== openid) {
          return fail("ACTION_NOT_ALLOWED", "没有该虚拟席位的操控权限");
        }
        actorMember = controlledMember;
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
      if (gameCore.status === "game_ended" || gameCore.phase === "game_ended") {
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
      const members = membersRes.data.filter(isActiveMember).sort((a, b) => a.seatIndex - b.seatIndex);

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
            `政府投票公开：${voteResult.jaCount} 票赞成，${voteResult.neinCount} 票反对，${passed ? "政府通过" : "政府未通过"}`,
            updatedAt,
            {
              votes: voteResult.revealedVotes,
              jaCount: voteResult.jaCount,
              neinCount: voteResult.neinCount,
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
                status = "game_ended";
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
            const nextPresidentCandidateId = getNextAlivePresidentCandidateId(gameCore, members);
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
                status = "game_ended";
                phase = "game_ended";
                winner = "LIBERAL";
                winReason = "LIBERAL_POLICIES";
                endedAt = updatedAt;
              } else if (fascistPolicyCount >= 6) {
                status = "game_ended";
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
              currentPresidentCandidateId: nextPresidentCandidateId,
              currentChancellorCandidateId: null,
              currentPresidentId: null,
              currentChancellorId: null,
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

        const publicSnapshotPayload = buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
        const privateSnapshotPayloads = members.map((member) => ({
          memberId: getMemberId(member),
          ownerOpenId: getMemberOpenId(member),
          payload: buildPrivateSnapshotPayload(nextGameCore, member, members, updatedAt),
        }));

        await transaction.collection("game_core").doc(gameId).update({
          data: {
            status: nextGameCore.status,
            version: nextGameCore.version,
            eventSeq: nextGameCore.eventSeq,
            phase: nextGameCore.phase,
            currentPresidentCandidateId: nextGameCore.currentPresidentCandidateId,
            currentChancellorCandidateId: nextGameCore.currentChancellorCandidateId,
            currentPresidentId: nextGameCore.currentPresidentId,
            currentChancellorId: nextGameCore.currentChancellorId,
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
            roomStatus: nextGameCore.status,
            version: nextGameCore.version,
            payload: replaceFieldValue(publicSnapshotPayload),
            updatedAt,
          },
        });

        for (const snapshot of privateSnapshotPayloads) {
          await transaction
            .collection("player_private_snapshots")
            .doc(snapshot.memberId)
            .update({
              data: {
                roomStatus: nextGameCore.status,
                version: nextGameCore.version,
                payload: replaceFieldValue(snapshot.payload),
                pendingTask: replaceFieldValue(snapshot.payload.pendingTask),
                updatedAt,
              },
            });
        }

        for (const event of publicEvents) {
          await transaction.collection("game_events").doc(event.eventId).set({
            data: event,
          });
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

        const publicSnapshotPayload = buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
        const privateSnapshotPayloads = members.map((member) => ({
          memberId: getMemberId(member),
          ownerOpenId: getMemberOpenId(member),
          payload: buildPrivateSnapshotPayload(nextGameCore, member, members, updatedAt),
        }));

        await transaction.collection("game_core").doc(gameId).update({
          data: {
            version: nextGameCore.version,
            eventSeq: nextGameCore.eventSeq,
            phase: nextGameCore.phase,
            policyState: replaceFieldValue(nextGameCore.policyState),
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
      });

      const publicSnapshotPayload = buildPublicSnapshotPayload(room, nextGameCore, members, publicHistory, updatedAt);
      const privateSnapshotPayloads = members.map((member) => ({
        memberId: getMemberId(member),
        ownerOpenId: getMemberOpenId(member),
        payload: buildPrivateSnapshotPayload(nextGameCore, member, members, updatedAt),
      }));

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

async function getResultSnapshot() {
  return fail("NOT_IMPLEMENTED", "结果快照尚未接入");
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
      return fail("INVALID_ACTION", "未知 action");
  }
}

exports.__testHooks = {
  ROLE_PRESET_BY_PLAYER_COUNT,
  INITIAL_POLICY_DECK,
  buildRoleAssignments,
  buildInitialPolicyState,
  buildPublicSnapshotPayload,
  buildPrivateSnapshotPayload,
  createInitialGameProjection,
  drawPolicyCards,
  getEligibleChancellorIdsFromCore,
  getChancellorTargetOptions,
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
    console.error("gameService error", err);
    return fail("INTERNAL_ERROR", "服务异常，请稍后重试", true);
  }
};
