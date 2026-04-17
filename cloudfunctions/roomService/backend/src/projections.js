"use strict";

const { MAX_PLAYER_COUNT, MIN_PLAYER_COUNT, PHASES } = require("./config/constants");
const { sortMembersBySeat } = require("./utils");
const { buildPendingTask } = require("./game-engine");

function buildLobbySnapshot(room, members, myMemberId) {
  const activeMembers = sortMembersBySeat(members.filter((member) => member.memberStatus === "active"));
  const canStart = room.hostMemberId === myMemberId
    && activeMembers.length >= MIN_PLAYER_COUNT
    && activeMembers.length <= MAX_PLAYER_COUNT
    && activeMembers.every((member) => member.isReady);

  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    roomStatus: room.status,
    hostMemberId: room.hostMemberId,
    playerCount: activeMembers.length,
    minPlayerCount: MIN_PLAYER_COUNT,
    maxPlayerCount: MAX_PLAYER_COUNT,
    seatOrder: activeMembers.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      seatIndex: member.seatIndex,
      isHost: member.memberId === room.hostMemberId,
      isReady: !!member.isReady
    })),
    myMemberId,
    canStart,
    version: room.version,
    updatedAt: room.updatedAt
  };
}

function buildGameSnapshot(room, game, members, memberId) {
  const publicSnapshot = buildPublicSnapshot(room, game, members);
  const privateSnapshot = buildPrivateState(game, members, memberId);
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    roomStatus: room.status,
    myMemberId: memberId,
    version: game.version,
    round: game.round,
    currentPhase: game.phase,
    publicState: publicSnapshot,
    privateState: privateSnapshot,
    pendingTask: buildPendingTask(game, memberId),
    serverHints: [],
    updatedAt: game.updatedAt
  };
}

function buildPublicSnapshot(room, game, members) {
  const memberMap = Object.fromEntries(members.map((member) => [member.memberId, member]));
  const ballots = game.phaseData.ballots || {};
  const revealedVotes = game.phase === PHASES.HITLER_CHECK || game.phase === PHASES.LEGISLATIVE_PRESIDENT
    || game.phase === PHASES.LEGISLATIVE_CHANCELLOR || game.phase === PHASES.VETO_RESPONSE
    ? Object.entries(ballots).map(([memberId, vote]) => ({ memberId, vote: vote.vote }))
    : null;
  const publicHistory = (game.publicHistory || []).slice(-20);

  return {
    seatOrder: sortMembersBySeat(members).map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      seatIndex: member.seatIndex,
      isAlive: game.aliveMemberIds.includes(member.memberId),
      isOffline: member.memberStatus === "offline",
      confirmedNotHitler: game.investigatedMemberIds.includes(member.memberId)
        && game.roleAssignments[member.memberId].role !== "HITLER"
    })),
    currentPresidentCandidateId: game.currentPresidentCandidateId,
    currentChancellorCandidateId: game.currentChancellorCandidateId,
    currentPresidentId: game.currentPresidentId,
    currentChancellorId: game.currentChancellorId,
    previousElectedPresidentId: game.previousElectedPresidentId,
    previousElectedChancellorId: game.previousElectedChancellorId,
    electionTracker: game.electionTracker,
    liberalPolicyCount: game.liberalPolicyCount,
    fascistPolicyCount: game.fascistPolicyCount,
    vetoUnlocked: game.vetoUnlocked,
    executiveActionType: game.executiveActionType,
    voteProgress: {
      submittedCount: Object.values(ballots).filter((item) => item.submitted).length,
      requiredCount: Object.keys(ballots).length
    },
    revealedVotes,
    publicHistory
  };
}

function buildPrivateState(game, members, memberId) {
  const memberMap = Object.fromEntries(members.map((member) => [member.memberId, member]));
  const assignment = game.roleAssignments[memberId];
  const insights = game.privateInsights[memberId] || {};

  return {
    identity: {
      role: assignment.role,
      party: assignment.party,
      knownMembers: assignment.knownMemberIds.map((knownMemberId) => ({
        memberId: knownMemberId,
        displayName: memberMap[knownMemberId].displayName
      })),
      acknowledged: assignment.acknowledged
    },
    voting: {
      submitted: Boolean(game.phaseData.ballots && game.phaseData.ballots[memberId] && game.phaseData.ballots[memberId].submitted),
      myVote: game.phaseData.ballots && game.phaseData.ballots[memberId] ? game.phaseData.ballots[memberId].vote : null
    },
    legislative: buildLegislativeState(game, memberId),
    investigationResult: insights.investigationResult
      ? {
        ...insights.investigationResult,
        targetDisplayName: memberMap[insights.investigationResult.targetMemberId].displayName
      }
      : null,
    policyPeek: insights.policyPeek || null
  };
}

function buildLegislativeState(game, memberId) {
  if (game.phase === PHASES.LEGISLATIVE_PRESIDENT && game.phaseData.presidentId === memberId) {
    return {
      hand: [...game.phaseData.cards],
      action: "discard_one",
      canRequestVeto: false
    };
  }

  if ((game.phase === PHASES.LEGISLATIVE_CHANCELLOR || game.phase === PHASES.VETO_RESPONSE) && game.currentChancellorId === memberId) {
    return {
      hand: [...game.phaseData.cards],
      action: "enact_one",
      canRequestVeto: game.phase === PHASES.LEGISLATIVE_CHANCELLOR ? game.phaseData.vetoAllowed : true
    };
  }

  return {
    hand: null,
    action: null,
    canRequestVeto: false
  };
}

function buildResultSnapshot(room, game, members) {
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    roomStatus: room.status,
    version: game.version,
    winner: game.winner,
    winReason: game.winReason,
    endedAt: game.endedAt,
    policySummary: {
      liberal: game.liberalPolicyCount,
      fascist: game.fascistPolicyCount
    },
    finalPlayers: sortMembersBySeat(members).map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      seatIndex: member.seatIndex,
      role: game.roleAssignments[member.memberId].role,
      party: game.roleAssignments[member.memberId].party,
      isAlive: game.aliveMemberIds.includes(member.memberId)
    })),
    timeline: (game.publicHistory || []).slice(-50)
  };
}

function routeHintForRoom(room, game) {
  if (!room) {
    return null;
  }

  if (room.status === "lobby") {
    return "lobby";
  }

  if (room.status === "ended") {
    return "result";
  }

  if (game && game.phase === PHASES.ROLE_REVEAL) {
    return "identity";
  }

  return "board";
}

module.exports = {
  buildGameSnapshot,
  buildLobbySnapshot,
  buildPublicSnapshot,
  buildResultSnapshot,
  routeHintForRoom
};
