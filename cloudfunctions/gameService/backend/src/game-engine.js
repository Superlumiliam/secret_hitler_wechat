"use strict";

const {
  COMMAND_TYPES,
  EXECUTIVE_POWER_TRACK,
  INITIAL_POLICY_DECK,
  PHASES,
  ROLE_PRESET_BY_PLAYER_COUNT,
  WIN_REASONS
} = require("./config/constants");
const { ERROR_CODES } = require("./config/error-codes");
const { AppError, assert } = require("./domain/app-error");
const { sortMembersBySeat, unique } = require("./utils");

function roleToParty(role) {
  return role === "LIBERAL" ? "LIBERAL" : "FASCIST";
}

function buildKnownMemberIds(assignments, playerCount) {
  const fascistIds = Object.keys(assignments).filter((memberId) => assignments[memberId].role === "FASCIST");
  const hitlerId = Object.keys(assignments).find((memberId) => assignments[memberId].role === "HITLER");
  const result = {};

  Object.entries(assignments).forEach(([memberId, assignment]) => {
    if (assignment.role === "LIBERAL") {
      result[memberId] = [];
      return;
    }

    if (assignment.role === "FASCIST") {
      result[memberId] = unique([...fascistIds, hitlerId].filter((id) => id && id !== memberId));
      return;
    }

    result[memberId] = playerCount <= 6 ? [...fascistIds] : [];
  });

  return result;
}

function drawPolicies(state, count, randomProvider) {
  let drawPile = [...state.drawPile];
  let discardPile = [...state.discardPile];

  if (drawPile.length < count) {
    drawPile = randomProvider.shuffle([...drawPile, ...discardPile]);
    discardPile = [];
  }

  assert(drawPile.length >= count, ERROR_CODES.INTERNAL_ERROR, "政策牌数量不足");
  const cards = drawPile.slice(0, count);
  return {
    cards,
    drawPile: drawPile.slice(count),
    discardPile
  };
}

function getAliveMemberIds(state) {
  return state.aliveMemberIds.filter((memberId) => !state.deadMemberIds.includes(memberId));
}

function getNextAliveMemberIdFrom(state, startMemberId, membersBySeat) {
  const sorted = sortMembersBySeat(membersBySeat.filter((member) => state.aliveMemberIds.includes(member.memberId)));
  const startIndex = sorted.findIndex((member) => member.memberId === startMemberId);
  if (startIndex === -1) {
    return sorted[0] ? sorted[0].memberId : null;
  }

  const nextIndex = (startIndex + 1) % sorted.length;
  return sorted[nextIndex].memberId;
}

function getNextPresidentCandidateId(state, membersBySeat) {
  if (state.forcedNextPresidentId) {
    return state.forcedNextPresidentId;
  }

  const pivotMemberId = state.specialElectionRecoveryFromId || state.currentPresidentId || state.currentPresidentCandidateId;
  return getNextAliveMemberIdFrom(state, pivotMemberId, membersBySeat);
}

function getEligibleChancellorIds(state, membersBySeat) {
  const aliveIds = new Set(getAliveMemberIds(state));
  const result = sortMembersBySeat(membersBySeat)
    .filter((member) => aliveIds.has(member.memberId))
    .map((member) => member.memberId)
    .filter((memberId) => memberId !== state.currentPresidentCandidateId);

  const aliveCount = aliveIds.size;
  return result.filter((memberId) => {
    if (memberId === state.previousElectedChancellorId) {
      return false;
    }

    if (aliveCount > 5 && memberId === state.previousElectedPresidentId) {
      return false;
    }

    return true;
  });
}

function createEvent(state, type, title, summary, now, extra = {}) {
  return {
    eventId: `evt_${state.gameId}_${state.nextEventSeq}`,
    round: state.round,
    phase: state.phase,
    type,
    title,
    summary,
    createdAt: now,
    ...extra
  };
}

function createIdentityAssignments(members, randomProvider) {
  const roles = randomProvider.shuffle([...ROLE_PRESET_BY_PLAYER_COUNT[members.length]]);
  const assignments = {};

  sortMembersBySeat(members).forEach((member, index) => {
    assignments[member.memberId] = {
      role: roles[index],
      party: roleToParty(roles[index]),
      acknowledged: false
    };
  });

  const knownMemberIds = buildKnownMemberIds(assignments, members.length);
  Object.keys(assignments).forEach((memberId) => {
    assignments[memberId].knownMemberIds = knownMemberIds[memberId];
  });

  return assignments;
}

function createGame(room, members, randomProvider, now) {
  const assignments = createIdentityAssignments(members, randomProvider);
  const firstPresidentMemberId = sortMembersBySeat(members)[randomProvider.randomInt(members.length)].memberId;
  const drawPile = randomProvider.shuffle([...INITIAL_POLICY_DECK]);

  return {
    gameId: room.gameId,
    roomId: room.roomId,
    roomCode: room.roomCode,
    status: "in_game",
    version: 1,
    round: 1,
    phase: PHASES.ROLE_REVEAL,
    phaseData: {
      pendingAckMemberIds: sortMembersBySeat(members).map((member) => member.memberId)
    },
    roleAssignments: assignments,
    aliveMemberIds: sortMembersBySeat(members).map((member) => member.memberId),
    deadMemberIds: [],
    currentPresidentCandidateId: firstPresidentMemberId,
    currentChancellorCandidateId: null,
    currentPresidentId: null,
    currentChancellorId: null,
    previousElectedPresidentId: null,
    previousElectedChancellorId: null,
    liberalPolicyCount: 0,
    fascistPolicyCount: 0,
    electionTracker: 0,
    drawPile,
    discardPile: [],
    investigatedMemberIds: [],
    privateInsights: {},
    vetoUnlocked: false,
    executiveActionType: null,
    forcedNextPresidentId: null,
    specialElectionCallerId: null,
    specialElectionRecoveryFromId: null,
    winner: null,
    winReason: null,
    endedAt: null,
    nextEventSeq: 1,
    updatedAt: now
  };
}

function ensurePhase(state, phase) {
  assert(state.phase === phase, ERROR_CODES.PHASE_MISMATCH, "当前阶段不允许该操作");
}

function ensureActor(actorMemberId, expectedMemberId) {
  assert(actorMemberId === expectedMemberId, ERROR_CODES.NOT_CURRENT_ACTOR, "当前不是该玩家行动");
}

function requireLiveActor(state, actorMemberId) {
  assert(state.aliveMemberIds.includes(actorMemberId), ERROR_CODES.ACTION_NOT_ALLOWED, "只有存活玩家可以执行该操作");
}

function ensureTaskMatch(state, actorMemberId, taskId) {
  if (!taskId) {
    return;
  }

  const pendingTask = buildPendingTask(state, actorMemberId);
  assert(pendingTask && pendingTask.taskId === taskId, ERROR_CODES.PHASE_MISMATCH, "任务卡已失效");
}

function buildPendingTask(state, memberId) {
  const actorAssignment = state.roleAssignments[memberId];
  if (!actorAssignment) {
    return null;
  }

  switch (state.phase) {
    case PHASES.ROLE_REVEAL: {
      if (!state.phaseData.pendingAckMemberIds.includes(memberId) || !state.aliveMemberIds.includes(memberId)) {
        return null;
      }
      return {
        taskId: `${state.gameId}:${state.version}:ACK_ROLE_REVEAL:${memberId}`,
        taskType: COMMAND_TYPES.ACK_ROLE_REVEAL,
        required: true,
        deadline: null,
        allowedTargets: [],
        meta: {}
      };
    }
    case PHASES.NOMINATION: {
      if (state.phaseData.presidentCandidateId !== memberId) {
        return null;
      }
      return {
        taskId: `${state.gameId}:${state.version}:NOMINATE_CHANCELLOR:${memberId}`,
        taskType: COMMAND_TYPES.NOMINATE_CHANCELLOR,
        required: true,
        deadline: null,
        allowedTargets: [...state.phaseData.eligibleChancellorIds],
        meta: {
          ruleHint: "上一届当选政府成员不能再次组成政府；若仅存活 5 人则放宽总统限制"
        }
      };
    }
    case PHASES.VOTING: {
      if (!state.aliveMemberIds.includes(memberId) || state.phaseData.ballots[memberId].submitted) {
        return null;
      }
      return {
        taskId: `${state.gameId}:${state.version}:SUBMIT_VOTE:${memberId}`,
        taskType: COMMAND_TYPES.SUBMIT_VOTE,
        required: true,
        deadline: null,
        allowedTargets: [],
        meta: {
          options: ["JA", "NEIN"]
        }
      };
    }
    case PHASES.LEGISLATIVE_PRESIDENT: {
      if (state.phaseData.presidentId !== memberId) {
        return null;
      }
      return {
        taskId: `${state.gameId}:${state.version}:PRESIDENT_DISCARD_POLICY:${memberId}`,
        taskType: COMMAND_TYPES.PRESIDENT_DISCARD_POLICY,
        required: true,
        deadline: null,
        allowedTargets: [],
        meta: {
          selectionMode: "discard_one"
        }
      };
    }
    case PHASES.LEGISLATIVE_CHANCELLOR: {
      if (state.phaseData.chancellorId !== memberId) {
        return null;
      }
      return {
        taskId: `${state.gameId}:${state.version}:CHANCELLOR_ENACT_POLICY:${memberId}`,
        taskType: COMMAND_TYPES.CHANCELLOR_ENACT_POLICY,
        required: true,
        deadline: null,
        allowedTargets: [],
        meta: {
          selectionMode: "enact_one",
          canRequestVeto: state.phaseData.vetoAllowed
        }
      };
    }
    case PHASES.VETO_RESPONSE: {
      if (state.phaseData.presidentId !== memberId) {
        return null;
      }
      return {
        taskId: `${state.gameId}:${state.version}:PRESIDENT_RESPOND_VETO:${memberId}`,
        taskType: COMMAND_TYPES.PRESIDENT_RESPOND_VETO,
        required: true,
        deadline: null,
        allowedTargets: [],
        meta: {
          options: [true, false],
          requestedByMemberId: state.phaseData.chancellorId
        }
      };
    }
    case PHASES.EXECUTIVE_ACTION: {
      if (state.phaseData.presidentId !== memberId) {
        return null;
      }

      const actionMap = {
        INVESTIGATE: COMMAND_TYPES.EXEC_INVESTIGATE,
        SPECIAL_ELECTION: COMMAND_TYPES.EXEC_SPECIAL_ELECTION,
        POLICY_PEEK: COMMAND_TYPES.EXEC_POLICY_PEEK_ACK,
        EXECUTION: COMMAND_TYPES.EXECUTE_PLAYER
      };

      const metaByAction = {
        INVESTIGATE: {
          actionTitle: "调查阵营",
          actionHint: "选择一名仍存活且尚未被调查的玩家"
        },
        SPECIAL_ELECTION: {
          actionTitle: "特别选举",
          actionHint: "指定下一轮的总统候选人"
        },
        POLICY_PEEK: {},
        EXECUTION: {
          actionTitle: "处决玩家",
          actionHint: "处决后若目标是希特勒则自由派立即获胜",
          dangerConfirmText: "确认要处决该玩家吗？"
        }
      };

      return {
        taskId: `${state.gameId}:${state.version}:${actionMap[state.phaseData.actionType]}:${memberId}`,
        taskType: actionMap[state.phaseData.actionType],
        required: true,
        deadline: null,
        allowedTargets: [...(state.phaseData.allowedTargetIds || [])],
        meta: metaByAction[state.phaseData.actionType]
      };
    }
    default:
      return null;
  }
}

function startNomination(state, members) {
  const nextPresidentId = getNextPresidentCandidateId(state, members);
  const eligibleChancellorIds = getEligibleChancellorIds(
    { ...state, currentPresidentCandidateId: nextPresidentId },
    members
  );
  return {
    ...state,
    round: state.phase === PHASES.ROLE_REVEAL ? state.round : state.round + 1,
    phase: PHASES.NOMINATION,
    currentPresidentCandidateId: nextPresidentId,
    currentChancellorCandidateId: null,
    currentPresidentId: null,
    currentChancellorId: null,
    executiveActionType: null,
    specialElectionRecoveryFromId: state.forcedNextPresidentId ? state.currentPresidentCandidateId : null,
    forcedNextPresidentId: null,
    phaseData: {
      presidentCandidateId: nextPresidentId,
      eligibleChancellorIds
    }
  };
}

function markEnded(state, winner, winReason, now) {
  return {
    ...state,
    status: "ended",
    phase: PHASES.GAME_ENDED,
    winner,
    winReason,
    endedAt: now,
    phaseData: {}
  };
}

function maybeCheckPolicyWin(state, now) {
  if (state.liberalPolicyCount >= 5) {
    return markEnded(state, "LIBERAL", WIN_REASONS.LIBERAL_FIVE_POLICIES, now);
  }

  if (state.fascistPolicyCount >= 6) {
    return markEnded(state, "FASCIST", WIN_REASONS.FASCIST_SIX_POLICIES, now);
  }

  return state;
}

function enactPolicy(state, policy, now, source, actorNames) {
  let nextState = {
    ...state,
    liberalPolicyCount: state.liberalPolicyCount + (policy === "LIBERAL" ? 1 : 0),
    fascistPolicyCount: state.fascistPolicyCount + (policy === "FASCIST" ? 1 : 0),
    vetoUnlocked: policy === "FASCIST" ? state.fascistPolicyCount + 1 >= 5 : state.vetoUnlocked
  };

  const event = createEvent(
    nextState,
    "POLICY_ENACTED",
    "政策颁布",
    `${actorNames} 颁布了一项${policy === "LIBERAL" ? "自由派" : "法西斯"}政策`,
    now,
    { lastPolicy: policy, source }
  );

  nextState.nextEventSeq += 1;
  nextState = maybeCheckPolicyWin(nextState, now);
  if (nextState.status === "ended") {
    return { nextState, events: [event] };
  }

  const powerType = policy === "FASCIST"
    ? (EXECUTIVE_POWER_TRACK[nextState.aliveMemberIds.length] || {})[nextState.fascistPolicyCount]
    : null;

  if (powerType) {
    const allowedTargetIds = getAliveMemberIds(nextState).filter((memberId) => {
      if (powerType === "INVESTIGATE") {
        return memberId !== nextState.currentPresidentId && !nextState.investigatedMemberIds.includes(memberId);
      }
      if (powerType === "SPECIAL_ELECTION") {
        return memberId !== nextState.currentPresidentId;
      }
      if (powerType === "EXECUTION") {
        return true;
      }
      return false;
    });

    nextState.phase = PHASES.EXECUTIVE_ACTION;
    nextState.executiveActionType = powerType;
    nextState.phaseData = {
      presidentId: nextState.currentPresidentId,
      actionType: powerType,
      allowedTargetIds
    };

    if (powerType === "POLICY_PEEK") {
      nextState.privateInsights[nextState.currentPresidentId] = {
        ...(nextState.privateInsights[nextState.currentPresidentId] || {}),
        policyPeek: {
          cards: nextState.drawPile.slice(0, 3),
          viewedAt: now
        }
      };
    }

    return { nextState, events: [event] };
  }

  nextState.phase = PHASES.ROUND_RESULT;
  nextState.phaseData = {
    reason: "POLICY_ENACTED",
    lastPolicy: policy
  };
  return { nextState, events: [event] };
}

function resolveFailedElection(state, members, now) {
  let nextState = {
    ...state,
    currentPresidentId: null,
    currentChancellorId: null,
    currentChancellorCandidateId: null,
    electionTracker: state.electionTracker + 1,
    phase: PHASES.ROUND_RESULT,
    phaseData: {
      reason: "ELECTION_FAILED",
      lastPolicy: null
    }
  };

  const events = [
    createEvent(
      nextState,
      "VOTES_REVEALED",
      "投票揭示",
      "本轮政府未获通过，进入下一次轮换",
      now
    )
  ];
  nextState.nextEventSeq += 1;

  if (nextState.electionTracker === 3) {
    const draw = drawPolicies(nextState, 1, members.randomProvider || { shuffle: (items) => items });
    nextState.drawPile = draw.drawPile;
    nextState.discardPile = draw.discardPile;
    nextState.electionTracker = 0;
    nextState.previousElectedPresidentId = null;
    nextState.previousElectedChancellorId = null;
    const enacted = enactPolicy(nextState, draw.cards[0], now, "chaos", "系统");
    nextState = enacted.nextState;
    events.push(...enacted.events);
  }

  return {
    nextState,
    events
  };
}

function applyCommand(input) {
  const {
    command,
    actorMemberId,
    members,
    now,
    randomProvider
  } = input;
  let state = input.state;
  const events = [];

  ensureTaskMatch(state, actorMemberId, command.taskId);

  switch (command.type) {
    case COMMAND_TYPES.ACK_ROLE_REVEAL: {
      ensurePhase(state, PHASES.ROLE_REVEAL);
      requireLiveActor(state, actorMemberId);
      assert(command.body && command.body.acknowledged === true, ERROR_CODES.INVALID_PAYLOAD, "acknowledged 必须为 true");
      assert(state.phaseData.pendingAckMemberIds.includes(actorMemberId), ERROR_CODES.ACTION_NOT_ALLOWED, "身份已确认");

      state = {
        ...state,
        roleAssignments: {
          ...state.roleAssignments,
          [actorMemberId]: {
            ...state.roleAssignments[actorMemberId],
            acknowledged: true
          }
        },
        phaseData: {
          pendingAckMemberIds: state.phaseData.pendingAckMemberIds.filter((memberId) => memberId !== actorMemberId)
        }
      };

      events.push(createEvent(state, "ROLE_REVEALED", "身份确认", `玩家确认了自己的身份信息`, now));
      state.nextEventSeq += 1;

      if (state.phaseData.pendingAckMemberIds.length === 0) {
        state = startNomination(state, members);
      }
      break;
    }
    case COMMAND_TYPES.NOMINATE_CHANCELLOR: {
      ensurePhase(state, PHASES.NOMINATION);
      ensureActor(actorMemberId, state.phaseData.presidentCandidateId);
      const targetMemberId = command.body && command.body.targetMemberId;
      assert(state.phaseData.eligibleChancellorIds.includes(targetMemberId), ERROR_CODES.INVALID_TARGET, "总理提名目标非法");

      state = {
        ...state,
        currentChancellorCandidateId: targetMemberId,
        phase: PHASES.VOTING,
        phaseData: {
          presidentCandidateId: state.currentPresidentCandidateId,
          chancellorCandidateId: targetMemberId,
          ballots: Object.fromEntries(
            getAliveMemberIds(state).map((memberId) => [memberId, { submitted: false, vote: null }])
          )
        }
      };
      events.push(createEvent(
        state,
        "GOVERNMENT_NOMINATED",
        "总统提名总理",
        `玩家提名 ${targetMemberId} 为总理候选人`,
        now
      ));
      state.nextEventSeq += 1;
      break;
    }
    case COMMAND_TYPES.SUBMIT_VOTE: {
      ensurePhase(state, PHASES.VOTING);
      requireLiveActor(state, actorMemberId);
      const ballot = state.phaseData.ballots[actorMemberId];
      assert(ballot, ERROR_CODES.NOT_CURRENT_ACTOR, "当前玩家不参与本轮投票");
      assert(!ballot.submitted, ERROR_CODES.ACTION_NOT_ALLOWED, "当前玩家已完成投票");

      const vote = command.body && command.body.vote;
      assert(vote === "JA" || vote === "NEIN", ERROR_CODES.INVALID_PAYLOAD, "投票值非法");
      const ballots = {
        ...state.phaseData.ballots,
        [actorMemberId]: {
          submitted: true,
          vote
        }
      };
      state = {
        ...state,
        phaseData: {
          ...state.phaseData,
          ballots
        }
      };

      const allSubmitted = Object.values(ballots).every((item) => item.submitted);
      if (!allSubmitted) {
        break;
      }

      const revealedVotes = Object.entries(ballots).map(([memberId, value]) => ({ memberId, vote: value.vote }));
      const jaCount = revealedVotes.filter((item) => item.vote === "JA").length;
      const passed = jaCount > Math.floor(revealedVotes.length / 2);
      events.push(createEvent(
        state,
        "VOTES_REVEALED",
        "投票揭示",
        passed ? "政府投票通过" : "政府投票未通过",
        now,
        { revealedVotes }
      ));
      state.nextEventSeq += 1;

      if (!passed) {
        const failedResult = resolveFailedElection(state, { ...members, randomProvider }, now);
        state = failedResult.nextState;
        events.push(...failedResult.events.slice(1));
        break;
      }

      state = {
        ...state,
        currentPresidentId: state.currentPresidentCandidateId,
        currentChancellorId: state.currentChancellorCandidateId,
        previousElectedPresidentId: state.currentPresidentCandidateId,
        previousElectedChancellorId: state.currentChancellorCandidateId,
        electionTracker: 0,
        phase: PHASES.HITLER_CHECK,
        phaseData: {
          presidentCandidateId: state.currentPresidentCandidateId,
          chancellorCandidateId: state.currentChancellorCandidateId,
          ballots,
          revealedVotes
        }
      };
      break;
    }
    case COMMAND_TYPES.PRESIDENT_DISCARD_POLICY: {
      ensurePhase(state, PHASES.LEGISLATIVE_PRESIDENT);
      ensureActor(actorMemberId, state.phaseData.presidentId);
      const discardIndex = command.body && command.body.discardPolicyIndex;
      assert([0, 1, 2].includes(discardIndex), ERROR_CODES.INVALID_PAYLOAD, "弃牌下标非法");

      const cards = [...state.phaseData.cards];
      assert(cards[discardIndex], ERROR_CODES.INVALID_PAYLOAD, "弃牌下标超出范围");
      const [discarded] = cards.splice(discardIndex, 1);
      state = {
        ...state,
        discardPile: [...state.discardPile, discarded],
        phase: PHASES.LEGISLATIVE_CHANCELLOR,
        phaseData: {
          chancellorId: state.currentChancellorId,
          cards,
          vetoAllowed: state.vetoUnlocked
        }
      };
      events.push(createEvent(state, "PRESIDENT_DISCARDED_POLICY", "总统弃牌", "总统已弃置一张政策牌", now));
      state.nextEventSeq += 1;
      break;
    }
    case COMMAND_TYPES.CHANCELLOR_REQUEST_VETO: {
      ensurePhase(state, PHASES.LEGISLATIVE_CHANCELLOR);
      ensureActor(actorMemberId, state.phaseData.chancellorId);
      assert(state.phaseData.vetoAllowed, ERROR_CODES.ACTION_NOT_ALLOWED, "当前阶段尚未解锁否决权");
      state = {
        ...state,
        phase: PHASES.VETO_RESPONSE,
        phaseData: {
          presidentId: state.currentPresidentId,
          chancellorId: state.currentChancellorId,
          cards: [...state.phaseData.cards]
        }
      };
      events.push(createEvent(state, "VETO_REQUESTED", "总理请求否决", "总理请求总统同意本轮否决", now));
      state.nextEventSeq += 1;
      break;
    }
    case COMMAND_TYPES.PRESIDENT_RESPOND_VETO: {
      ensurePhase(state, PHASES.VETO_RESPONSE);
      ensureActor(actorMemberId, state.phaseData.presidentId);
      assert(typeof command.body.accepted === "boolean", ERROR_CODES.INVALID_PAYLOAD, "accepted 必须为布尔值");
      if (!command.body.accepted) {
        state = {
          ...state,
          phase: PHASES.LEGISLATIVE_CHANCELLOR,
          phaseData: {
            chancellorId: state.currentChancellorId,
            cards: [...state.phaseData.cards],
            vetoAllowed: true
          }
        };
        events.push(createEvent(state, "VETO_REJECTED", "总统拒绝否决", "总统拒绝了本轮否决请求", now));
        state.nextEventSeq += 1;
        break;
      }

      state = {
        ...state,
        discardPile: [...state.discardPile, ...state.phaseData.cards],
        electionTracker: state.electionTracker + 1,
        phase: PHASES.ROUND_RESULT,
        phaseData: {
          reason: "VETO_ACCEPTED",
          lastPolicy: null
        }
      };
      events.push(createEvent(state, "VETO_ACCEPTED", "总统同意否决", "本轮立法被双方否决", now));
      state.nextEventSeq += 1;
      if (state.electionTracker === 3) {
        const draw = drawPolicies(state, 1, randomProvider);
        state.drawPile = draw.drawPile;
        state.discardPile = draw.discardPile;
        state.electionTracker = 0;
        state.previousElectedPresidentId = null;
        state.previousElectedChancellorId = null;
        const enacted = enactPolicy(state, draw.cards[0], now, "chaos", "系统");
        state = enacted.nextState;
        events.push(...enacted.events);
      }
      break;
    }
    case COMMAND_TYPES.CHANCELLOR_ENACT_POLICY: {
      ensurePhase(state, PHASES.LEGISLATIVE_CHANCELLOR);
      ensureActor(actorMemberId, state.phaseData.chancellorId);
      const enactIndex = command.body && command.body.enactPolicyIndex;
      assert([0, 1].includes(enactIndex), ERROR_CODES.INVALID_PAYLOAD, "颁布下标非法");
      const cards = [...state.phaseData.cards];
      assert(cards[enactIndex], ERROR_CODES.INVALID_PAYLOAD, "颁布下标超出范围");
      const enactedPolicy = cards[enactIndex];
      const discarded = cards[1 - enactIndex];
      state.discardPile = [...state.discardPile, discarded];
      const enacted = enactPolicy(state, enactedPolicy, now, "government", "当选政府");
      state = enacted.nextState;
      events.push(...enacted.events);
      break;
    }
    case COMMAND_TYPES.EXEC_INVESTIGATE: {
      ensurePhase(state, PHASES.EXECUTIVE_ACTION);
      ensureActor(actorMemberId, state.phaseData.presidentId);
      assert(state.phaseData.actionType === "INVESTIGATE", ERROR_CODES.PHASE_MISMATCH, "当前不是调查阶段");
      const targetMemberId = command.body && command.body.targetMemberId;
      assert(state.phaseData.allowedTargetIds.includes(targetMemberId), ERROR_CODES.INVALID_TARGET, "调查目标非法");
      assert(!state.investigatedMemberIds.includes(targetMemberId), ERROR_CODES.TARGET_ALREADY_INVESTIGATED, "该目标已被调查");

      state = {
        ...state,
        investigatedMemberIds: [...state.investigatedMemberIds, targetMemberId],
        privateInsights: {
          ...state.privateInsights,
          [actorMemberId]: {
            ...(state.privateInsights[actorMemberId] || {}),
            investigationResult: {
              targetMemberId,
              party: state.roleAssignments[targetMemberId].party,
              revealedAt: now
            }
          }
        },
        phase: PHASES.ROUND_RESULT,
        phaseData: {
          reason: "EXECUTIVE_ACTION_COMPLETED",
          lastPolicy: null
        }
      };
      events.push(createEvent(state, "PLAYER_INVESTIGATED", "总统调查玩家", `总统调查了 ${targetMemberId}`, now));
      state.nextEventSeq += 1;
      break;
    }
    case COMMAND_TYPES.EXEC_SPECIAL_ELECTION: {
      ensurePhase(state, PHASES.EXECUTIVE_ACTION);
      ensureActor(actorMemberId, state.phaseData.presidentId);
      assert(state.phaseData.actionType === "SPECIAL_ELECTION", ERROR_CODES.PHASE_MISMATCH, "当前不是特别选举阶段");
      const targetMemberId = command.body && command.body.targetMemberId;
      assert(state.phaseData.allowedTargetIds.includes(targetMemberId), ERROR_CODES.INVALID_TARGET, "特别选举目标非法");

      state = {
        ...state,
        forcedNextPresidentId: targetMemberId,
        specialElectionCallerId: actorMemberId,
        phase: PHASES.ROUND_RESULT,
        phaseData: {
          reason: "EXECUTIVE_ACTION_COMPLETED",
          lastPolicy: null
        }
      };
      events.push(createEvent(state, "SPECIAL_ELECTION_SET", "总统指定特别选举", `下一轮总统候选人被指定为 ${targetMemberId}`, now));
      state.nextEventSeq += 1;
      break;
    }
    case COMMAND_TYPES.EXEC_POLICY_PEEK_ACK: {
      ensurePhase(state, PHASES.EXECUTIVE_ACTION);
      ensureActor(actorMemberId, state.phaseData.presidentId);
      assert(state.phaseData.actionType === "POLICY_PEEK", ERROR_CODES.PHASE_MISMATCH, "当前不是政策预览阶段");
      assert(command.body && command.body.acknowledged === true, ERROR_CODES.INVALID_PAYLOAD, "acknowledged 必须为 true");
      state = {
        ...state,
        phase: PHASES.ROUND_RESULT,
        phaseData: {
          reason: "EXECUTIVE_ACTION_COMPLETED",
          lastPolicy: null
        }
      };
      events.push(createEvent(state, "POLICY_PEEKED", "总统查看牌顶", "总统完成了政策预览", now));
      state.nextEventSeq += 1;
      break;
    }
    case COMMAND_TYPES.EXECUTE_PLAYER: {
      ensurePhase(state, PHASES.EXECUTIVE_ACTION);
      ensureActor(actorMemberId, state.phaseData.presidentId);
      assert(state.phaseData.actionType === "EXECUTION", ERROR_CODES.PHASE_MISMATCH, "当前不是处决阶段");
      const targetMemberId = command.body && command.body.targetMemberId;
      assert(state.phaseData.allowedTargetIds.includes(targetMemberId), ERROR_CODES.INVALID_TARGET, "处决目标非法");
      assert(state.aliveMemberIds.includes(targetMemberId), ERROR_CODES.TARGET_ALREADY_DEAD, "目标已死亡");

      state = {
        ...state,
        aliveMemberIds: state.aliveMemberIds.filter((memberId) => memberId !== targetMemberId),
        deadMemberIds: unique([...state.deadMemberIds, targetMemberId]),
        phase: PHASES.ROUND_RESULT,
        phaseData: {
          reason: "EXECUTIVE_ACTION_COMPLETED",
          lastPolicy: null
        }
      };
      events.push(createEvent(state, "PLAYER_EXECUTED", "总统处决玩家", `总统处决了 ${targetMemberId}`, now));
      state.nextEventSeq += 1;

      if (state.roleAssignments[targetMemberId].role === "HITLER") {
        state = markEnded(state, "LIBERAL", WIN_REASONS.HITLER_EXECUTED, now);
      }
      break;
    }
    default:
      throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "未知命令类型");
  }

  state.version += 1;
  state.updatedAt = now;
  return { nextState: state, events };
}

function advanceSystemPhases(state, members, now, randomProvider) {
  const events = [];
  let nextState = state;

  while (true) {
    if (nextState.status === "ended") {
      break;
    }

    if (nextState.phase === PHASES.HITLER_CHECK) {
      if (nextState.fascistPolicyCount >= 3 && nextState.roleAssignments[nextState.currentChancellorId].role === "HITLER") {
        nextState = markEnded(nextState, "FASCIST", WIN_REASONS.HITLER_ELECTED_CHANCELLOR, now);
        break;
      }

      const draw = drawPolicies(nextState, 3, randomProvider);
      nextState = {
        ...nextState,
        drawPile: draw.drawPile,
        discardPile: draw.discardPile,
        phase: PHASES.LEGISLATIVE_PRESIDENT,
        phaseData: {
          presidentId: nextState.currentPresidentId,
          cards: draw.cards
        }
      };
      continue;
    }

    if (nextState.phase === PHASES.ROUND_RESULT) {
      nextState = startNomination(nextState, members);
      continue;
    }

    break;
  }

  return {
    nextState: {
      ...nextState,
      updatedAt: now
    },
    events
  };
}

module.exports = {
  advanceSystemPhases,
  applyCommand,
  buildPendingTask,
  createGame,
  getEligibleChancellorIds,
  getNextPresidentCandidateId
};
