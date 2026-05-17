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
    roomStatus: "in_game",
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

function buildCommandAccepted(roomId, previousVersion, gameCore, previousPhase) {
  return ok({
    accepted: true,
    roomId,
    roomStatus: gameCore.status || "in_game",
    previousVersion,
    newVersion: gameCore.version,
    currentPhase: gameCore.phase,
    phaseChanged: previousPhase !== gameCore.phase,
    deduplicated: false,
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
      if (gameCore.status === "game_ended" || gameCore.phase === "game_ended") {
        return fail("GAME_ALREADY_ENDED", "对局已经结束");
      }
      if (gameCore.version !== expectedVersion) {
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
          phaseData: nextGameCore.phaseData,
          updatedAt,
        },
      });

      await transaction.collection("room_public_snapshots").doc(roomId).update({
        data: {
          version: nextGameCore.version,
          payload: publicSnapshotPayload,
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
              payload: snapshot.payload,
              pendingTask: snapshot.payload.pendingTask,
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
  createInitialGameProjection,
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
