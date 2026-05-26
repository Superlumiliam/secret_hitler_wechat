const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "wx-server-sdk") {
    return {
      DYNAMIC_CURRENT_ENV: "test-env",
      init() {},
      getWXContext() {
        return {
          OPENID: "test_openid",
        };
      },
      database() {
        return {
          command: {
            in(value) {
              return value;
            },
            inc(value) {
              return value;
            },
          },
          collection() {
            return {};
          },
        };
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { __testHooks } = require("../../../cloudfunctions/gameService/index");
Module._load = originalLoad;

const {
  ROOM_TTL_ACTIVE_MS,
  ROOM_TTL_RESULT_MS,
  ROLE_PRESET_BY_PLAYER_COUNT,
  buildPrivateSnapshotPayload,
  buildPublicHistoryProjection,
  buildPublicSnapshotPayload,
  buildResultSnapshotPayload,
  createInitialGameProjection,
  createResultExpireAt,
  drawPolicyCards,
  getExecutiveAllowedTargetIds,
  getExecutiveTaskType,
  getNextNominationTransition,
  getChancellorTargetOptions,
} = __testHooks;

function makeMembers(playerCount) {
  return Array.from({ length: playerCount }, (_, index) => ({
    memberId: `mem_${index + 1}`,
    openId: `openid_${index + 1}`,
    displayName: `玩家${index + 1}`,
    avatarUrl: "",
    seatIndex: index + 1,
    memberStatus: "active",
  }));
}

function countBy(items) {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function hasSecretKey(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.keys(value).some((key) => {
    if (["roleAssignments", "policyState", "drawPile", "discardPile"].includes(key)) {
      return true;
    }
    return hasSecretKey(value[key]);
  });
}

function assertPolicyDeck(policyState) {
  assert.strictEqual(policyState.drawPile.length, 17, "drawPile should contain 17 cards");
  assert.deepStrictEqual(policyState.discardPile, [], "discardPile should start empty");
  const policyCounts = countBy(policyState.drawPile);
  assert.strictEqual(policyCounts.LIBERAL, 6, "drawPile should contain 6 liberal policies");
  assert.strictEqual(policyCounts.FASCIST, 11, "drawPile should contain 11 fascist policies");
}

function assertPrivateVisibility(projection, playerCount) {
  const assignments = projection.gameCore.roleAssignments;
  const fascistIds = Object.keys(assignments).filter((memberId) => assignments[memberId].role === "FASCIST");
  const hitlerId = Object.keys(assignments).find((memberId) => assignments[memberId].role === "HITLER");

  fascistIds.forEach((memberId) => {
    const known = assignments[memberId].knownMemberIds.slice().sort();
    const expected = fascistIds.concat(hitlerId).filter((knownMemberId) => knownMemberId !== memberId).sort();
    assert.deepStrictEqual(known, expected, `${playerCount}p fascist should know teammates and dictator`);
  });

  const hitlerKnown = assignments[hitlerId].knownMemberIds.slice().sort();
  const expectedHitlerKnown = playerCount <= 6 ? fascistIds.slice().sort() : [];
  assert.deepStrictEqual(hitlerKnown, expectedHitlerKnown, `${playerCount}p dictator visibility mismatch`);

  projection.privateSnapshotPayloads.forEach((snapshot) => {
    const identity = snapshot.payload.privateState.identity;
    assert.strictEqual(identity.role, assignments[snapshot.memberId].role, "private identity should match assignment");
    assert.strictEqual(identity.party, assignments[snapshot.memberId].party, "private party should match assignment");
    assert.deepStrictEqual(
      identity.knownMembers.map((member) => member.memberId).sort(),
      assignments[snapshot.memberId].knownMemberIds.slice().sort(),
      "private knownMembers should mirror allowed visibility",
    );
    identity.knownMembers.forEach((knownMember) => {
      assert.strictEqual(
        knownMember.role,
        assignments[knownMember.memberId].role,
        "private knownMembers should include known role",
      );
      assert.strictEqual(
        knownMember.party,
        assignments[knownMember.memberId].party,
        "private knownMembers should include known party",
      );
    });
  });
}

function assertPublicSnapshotSafe(projection) {
  assert.strictEqual(hasSecretKey(projection.publicSnapshotPayload), false, "public snapshot should not contain secrets");
  const publicState = projection.publicSnapshotPayload.publicState;
  assert.strictEqual(publicState.liberalPolicyCount, 0, "liberal track should start at 0");
  assert.strictEqual(publicState.fascistPolicyCount, 0, "fascist track should start at 0");
  assert.strictEqual(publicState.electionTracker, 0, "election tracker should start at 0");
  assert.deepStrictEqual(
    publicState.policyDeck,
    { drawCount: 17, discardCount: 0 },
    "public snapshot should expose only policy deck counts",
  );
  assert.strictEqual(Boolean(publicState.history), true, "public snapshot should include history projection");
  assert.strictEqual(publicState.history.roundsStarted, 1, "initial history should start round one");
  assert.strictEqual(publicState.history.roundsCompleted, 0, "initial history should not complete current round");
  assert.strictEqual(
    publicState.history.rounds[0].outcome.type,
    "pending_nomination",
    "initial history should show pending nomination",
  );
}

function assertEventsSafe(projection) {
  assert.strictEqual(projection.publicEvents.length, 2, "should write two initial public events");
  projection.publicEvents.forEach((event) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(event, "_id"), false, "event data should not write reserved _id");
    assert.strictEqual(event.privatePayload, null, "initial public events should not carry private payload");
    assert.strictEqual(hasSecretKey(event), false, "initial events should not contain secrets");
  });
}

function assertNominationTargetOptions() {
  const members = makeMembers(7);
  const baseCore = {
    aliveMemberIds: members.map((member) => member.memberId),
    currentPresidentCandidateId: "mem_1",
    previousElectedPresidentId: "mem_2",
    previousElectedChancellorId: "mem_3",
  };

  const options = getChancellorTargetOptions(baseCore, members);
  const byMemberId = Object.fromEntries(options.map((option) => [option.memberId, option]));
  assert.strictEqual(byMemberId.mem_1.canNominate, false, "president candidate should not nominate self");
  assert.strictEqual(byMemberId.mem_1.disabledReason, "不能提名自己");
  assert.strictEqual(byMemberId.mem_2.canNominate, false, "previous president should be blocked above five alive players");
  assert.strictEqual(byMemberId.mem_2.disabledReason, "受上一届总统任期限制影响");
  assert.strictEqual(byMemberId.mem_3.canNominate, false, "previous chancellor should be blocked");
  assert.strictEqual(byMemberId.mem_3.disabledReason, "受上一届总理任期限制影响");
  assert.strictEqual(byMemberId.mem_4.canNominate, true, "other alive players should be eligible");

  const fiveAliveCore = {
    ...baseCore,
    aliveMemberIds: ["mem_1", "mem_2", "mem_3", "mem_4", "mem_5"],
  };
  const fiveAliveOptions = getChancellorTargetOptions(fiveAliveCore, members);
  const fiveAliveByMemberId = Object.fromEntries(fiveAliveOptions.map((option) => [option.memberId, option]));
  assert.strictEqual(
    fiveAliveByMemberId.mem_2.canNominate,
    true,
    "previous president should be eligible when only five players are alive",
  );
  assert.strictEqual(fiveAliveByMemberId.mem_3.canNominate, false, "previous chancellor should still be blocked");
  assert.strictEqual(fiveAliveByMemberId.mem_6.disabledReason, "已出局", "dead players should show dead reason");
}

function assertLegislativePresidentVisibility() {
  const members = makeMembers(5);
  const room = {
    roomId: "room_legislative",
    roomCode: "778899",
  };
  const projection = createInitialGameProjection(room, members, {
    gameId: "game_legislative",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const drawResult = drawPolicyCards(projection.gameCore.policyState, 3);
  assert.strictEqual(Boolean(drawResult.error), false, "legislative draw should succeed");

  const gameCore = {
    ...projection.gameCore,
    version: 2,
    phase: "legislative_president",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_2",
    policyState: {
      ...drawResult.policyState,
      presidentHand: drawResult.cards,
      chancellorHand: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: drawResult.cards,
    },
  };

  const publicPayload = buildPublicSnapshotPayload(room, gameCore, members, [], new Date("2026-05-12T00:01:00.000Z"));
  assert.strictEqual(hasSecretKey(publicPayload), false, "public legislative snapshot should not contain secrets");
  assert.strictEqual(
    JSON.stringify(publicPayload).includes(drawResult.cards.join(",")),
    false,
    "public legislative snapshot should not reveal policy hand",
  );

  const presidentPrivate = buildPrivateSnapshotPayload(gameCore, members[0], members, new Date("2026-05-12T00:01:00.000Z"));
  assert.strictEqual(
    presidentPrivate.pendingTask.taskType,
    "PRESIDENT_DISCARD_POLICY",
    "president should receive discard task",
  );
  assert.strictEqual(presidentPrivate.privateState.legislative.hand.length, 3, "president should see three policies");
  assert.deepStrictEqual(
    presidentPrivate.privateState.legislative.hand,
    drawResult.cards,
    "president should see the drawn policy hand",
  );

  members.slice(1).forEach((member) => {
    const privatePayload = buildPrivateSnapshotPayload(gameCore, member, members, new Date("2026-05-12T00:01:00.000Z"));
    assert.strictEqual(privatePayload.pendingTask, null, "non-president should not receive discard task");
    assert.strictEqual(privatePayload.privateState.legislative, null, "non-president should not see president hand");
  });
}

function assertLegislativeChancellorVisibility() {
  const members = makeMembers(5);
  const room = {
    roomId: "room_chancellor_legislative",
    roomCode: "778900",
  };
  const chancellorHand = ["LIBERAL", "FASCIST"];
  const gameCore = {
    ...createInitialGameProjection(room, members, {
      gameId: "game_chancellor_legislative",
      createdAt: new Date("2026-05-12T00:00:00.000Z"),
      pickIndex: () => 0,
    }).gameCore,
    version: 3,
    phase: "legislative_chancellor",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_2",
    policyState: {
      drawPile: ["FASCIST", "LIBERAL", "FASCIST"],
      discardPile: ["LIBERAL"],
      presidentHand: null,
      chancellorHand,
      peekPile: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: chancellorHand,
      vetoAllowed: false,
    },
  };

  const publicPayload = buildPublicSnapshotPayload(room, gameCore, members, [], new Date("2026-05-12T00:02:00.000Z"));
  assert.strictEqual(hasSecretKey(publicPayload), false, "public chancellor snapshot should not contain secrets");
  assert.deepStrictEqual(
    publicPayload.publicState.policyDeck,
    { drawCount: 3, discardCount: 1 },
    "public chancellor snapshot should expose only deck counts",
  );
  assert.strictEqual(
    JSON.stringify(publicPayload).includes(chancellorHand.join(",")),
    false,
    "public chancellor snapshot should not reveal policy hand",
  );

  const chancellorPrivate = buildPrivateSnapshotPayload(
    gameCore,
    members[1],
    members,
    new Date("2026-05-12T00:02:00.000Z"),
  );
  assert.strictEqual(
    chancellorPrivate.pendingTask.taskType,
    "CHANCELLOR_ENACT_POLICY",
    "chancellor should receive enact task",
  );
  assert.strictEqual(
    chancellorPrivate.privateState.legislative.action,
    "enact_one",
    "chancellor legislative action should be enact_one",
  );
  assert.deepStrictEqual(
    chancellorPrivate.privateState.legislative.hand,
    chancellorHand,
    "chancellor should see the two remaining policy cards",
  );

  [members[0], ...members.slice(2)].forEach((member) => {
    const privatePayload = buildPrivateSnapshotPayload(gameCore, member, members, new Date("2026-05-12T00:02:00.000Z"));
    assert.strictEqual(privatePayload.pendingTask, null, "non-chancellor should not receive enact task");
    assert.strictEqual(privatePayload.privateState.legislative, null, "non-chancellor should not see chancellor hand");
  });
}

function assertVetoPrivateAndHistoryProjection() {
  const members = makeMembers(7);
  const room = {
    roomId: "room_veto",
    roomCode: "778901",
  };
  const chancellorHand = ["LIBERAL", "FASCIST"];
  const baseCore = createInitialGameProjection(room, members, {
    gameId: "game_veto",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  }).gameCore;
  const chancellorCore = {
    ...baseCore,
    version: 9,
    round: 4,
    phase: "legislative_chancellor",
    currentPresidentCandidateId: "mem_1",
    currentChancellorCandidateId: "mem_2",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_2",
    fascistPolicyCount: 5,
    vetoUnlocked: true,
    previousElectedPresidentId: "mem_1",
    previousElectedChancellorId: "mem_2",
    policyState: {
      drawPile: ["FASCIST", "LIBERAL", "FASCIST"],
      discardPile: ["LIBERAL"],
      presidentHand: null,
      chancellorHand,
      peekPile: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: chancellorHand,
      vetoAllowed: true,
    },
  };

  const chancellorPrivate = buildPrivateSnapshotPayload(
    chancellorCore,
    members[1],
    members,
    new Date("2026-05-12T00:08:00.000Z"),
  );
  assert.strictEqual(
    chancellorPrivate.pendingTask.meta.canRequestVeto,
    true,
    "chancellor enact task should advertise veto availability",
  );
  assert.strictEqual(
    chancellorPrivate.privateState.legislative.canRequestVeto,
    true,
    "chancellor private legislative state should allow veto request",
  );

  const vetoCore = {
    ...chancellorCore,
    version: 10,
    phase: "veto_response",
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: chancellorHand,
      requestedBy: "mem_2",
    },
  };
  const publicPayload = buildPublicSnapshotPayload(room, vetoCore, members, [], new Date("2026-05-12T00:09:00.000Z"));
  assert.strictEqual(hasSecretKey(publicPayload), false, "public veto snapshot should not contain secrets");
  assert.strictEqual(
    JSON.stringify(publicPayload).includes(chancellorHand.join(",")),
    false,
    "public veto snapshot should not reveal chancellor hand",
  );

  const presidentPrivate = buildPrivateSnapshotPayload(vetoCore, members[0], members, new Date("2026-05-12T00:09:00.000Z"));
  assert.strictEqual(
    presidentPrivate.pendingTask.taskType,
    "PRESIDENT_RESPOND_VETO",
    "president should receive veto response task",
  );
  assert.strictEqual(
    presidentPrivate.privateState.legislative,
    null,
    "president should not see chancellor cards while responding to veto",
  );

  const chancellorDuringVeto = buildPrivateSnapshotPayload(
    vetoCore,
    members[1],
    members,
    new Date("2026-05-12T00:09:00.000Z"),
  );
  assert.strictEqual(chancellorDuringVeto.pendingTask, null, "chancellor waits while president responds to veto");
  assert.strictEqual(
    chancellorDuringVeto.privateState.legislative,
    null,
    "chancellor hand should not remain projected during veto response",
  );

  const requestedHistory = buildPublicHistoryProjection(vetoCore, members, [
    {
      eventId: "evt_game_veto_1",
      round: 4,
      phase: "legislative_chancellor",
      type: "VETO_REQUESTED",
      title: "总理提出否决",
      summary: "玩家2 提出否决本届议程，等待总统回应",
      createdAt: "2026-05-12T00:09:00.000Z",
      presidentId: "mem_1",
      chancellorId: "mem_2",
    },
  ]);
  assert.strictEqual(requestedHistory.rounds[3].outcome.type, "vetoed", "veto request should be public as pending veto");
  assert.strictEqual(requestedHistory.rounds[3].outcome.label, "否决待确认");

  const acceptedHistory = buildPublicHistoryProjection(
    {
      ...vetoCore,
      version: 11,
      round: 5,
      phase: "nomination",
      currentPresidentCandidateId: "mem_3",
      currentChancellorCandidateId: null,
      currentPresidentId: null,
      currentChancellorId: null,
      electionTracker: 2,
    },
    members,
    [
      {
        eventId: "evt_game_veto_2",
        round: 4,
        phase: "veto_response",
        type: "VETO_RESPONDED",
        title: "总统同意否决",
        summary: "玩家1 同意否决，本轮不颁布政策，选举计数器 1 → 2",
        createdAt: "2026-05-12T00:10:00.000Z",
        presidentId: "mem_1",
        chancellorId: "mem_2",
        accepted: true,
        electionTrackerBefore: 1,
        electionTrackerAfter: 2,
      },
    ],
  );
  assert.strictEqual(acceptedHistory.rounds[3].status, "completed", "accepted veto should complete elected government round");
  assert.strictEqual(acceptedHistory.rounds[3].outcome.type, "vetoed", "accepted veto should be a veto outcome");
  assert.strictEqual(
    acceptedHistory.rounds[3].outcome.label,
    "否决通过",
    "accepted veto should use compact public label",
  );
}

function makeExecutiveCore(actionType, overrides = {}) {
  const members = makeMembers(7);
  const room = {
    roomId: `room_exec_${actionType}`,
    roomCode: "700001",
  };
  const baseCore = createInitialGameProjection(room, members, {
    gameId: `game_exec_${actionType}`,
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  }).gameCore;
  return {
    room,
    members,
    gameCore: {
      ...baseCore,
      version: 8,
      round: 3,
      phase: "executive_action",
      currentPresidentCandidateId: "mem_1",
      currentPresidentId: "mem_1",
      currentChancellorId: "mem_2",
      fascistPolicyCount: actionType === "EXECUTION" ? 4 : 2,
      phaseData: {
        presidentId: "mem_1",
        actionType,
        allowedTargetIds: getExecutiveAllowedTargetIds(
          {
            ...baseCore,
            currentPresidentId: "mem_1",
            investigatedMemberIds: ["mem_3"],
          },
          actionType,
        ),
      },
      investigatedMemberIds: ["mem_3"],
      ...overrides,
    },
  };
}

function assertExecutivePrivateAndPublicProjection() {
  const investigate = makeExecutiveCore("INVESTIGATE");
  const publicPayload = buildPublicSnapshotPayload(
    investigate.room,
    investigate.gameCore,
    investigate.members,
    [],
    new Date("2026-05-12T00:03:00.000Z"),
  );
  assert.strictEqual(publicPayload.publicState.executiveActionType, "INVESTIGATE", "public should show action type");
  assert.strictEqual(hasSecretKey(publicPayload), false, "public executive snapshot should not contain secrets");

  const presidentPrivate = buildPrivateSnapshotPayload(
    investigate.gameCore,
    investigate.members[0],
    investigate.members,
    new Date("2026-05-12T00:03:00.000Z"),
  );
  assert.strictEqual(presidentPrivate.pendingTask.taskType, "EXEC_INVESTIGATE", "president should receive investigate task");
  assert.strictEqual(
    presidentPrivate.pendingTask.allowedTargets.includes("mem_3"),
    false,
    "already investigated player should not be targetable",
  );

  const withResult = {
    ...investigate.gameCore,
    phase: "nomination",
    investigationResultsByMemberId: {
      mem_1: {
        targetMemberId: "mem_4",
        targetDisplayName: "玩家4",
        party: "FASCIST",
        revealedAt: "2026-05-12T00:04:00.000Z",
      },
    },
  };
  const resultPrivate = buildPrivateSnapshotPayload(
    withResult,
    investigate.members[0],
    investigate.members,
    new Date("2026-05-12T00:04:00.000Z"),
  );
  assert.deepStrictEqual(
    Object.keys(resultPrivate.privateState.investigationResult).sort(),
    ["party", "revealedAt", "targetDisplayName", "targetMemberId"].sort(),
    "investigation result should only expose party-level result",
  );
  assert.deepStrictEqual(
    resultPrivate.privateState.investigationMarks,
    [
      {
        targetMemberId: "mem_4",
        party: "FASCIST",
        round: null,
        revealedAt: "2026-05-12T00:04:00.000Z",
      },
    ],
    "investigation marks should project private stamp data for the investigator",
  );
  const otherPrivate = buildPrivateSnapshotPayload(
    withResult,
    investigate.members[1],
    investigate.members,
    new Date("2026-05-12T00:04:00.000Z"),
  );
  assert.strictEqual(otherPrivate.privateState.investigationResult, null, "other players should not see investigation");

  const peek = makeExecutiveCore("POLICY_PEEK", {
    policyState: {
      drawPile: ["FASCIST", "LIBERAL", "FASCIST", "LIBERAL"],
      discardPile: [],
      presidentHand: null,
      chancellorHand: null,
      peekPile: null,
    },
  });
  const peekPublic = buildPublicSnapshotPayload(peek.room, peek.gameCore, peek.members, [], new Date("2026-05-12T00:05:00.000Z"));
  assert.strictEqual(JSON.stringify(peekPublic).includes("FASCIST,LIBERAL,FASCIST"), false, "public should not reveal peek cards");
  const peekPrivate = buildPrivateSnapshotPayload(
    peek.gameCore,
    peek.members[0],
    peek.members,
    new Date("2026-05-12T00:05:00.000Z"),
  );
  assert.strictEqual(peekPrivate.pendingTask.taskType, "EXEC_POLICY_PEEK_ACK", "president should ack policy peek");
  assert.deepStrictEqual(peekPrivate.privateState.policyPeek.cards, ["FASCIST", "LIBERAL", "FASCIST"]);
  assert.deepStrictEqual(peek.gameCore.policyState.drawPile, ["FASCIST", "LIBERAL", "FASCIST", "LIBERAL"], "peek should not mutate deck");

  const special = makeExecutiveCore("SPECIAL_ELECTION");
  assert.strictEqual(getExecutiveTaskType("SPECIAL_ELECTION"), "EXEC_SPECIAL_ELECTION");
  assert.strictEqual(
    getExecutiveAllowedTargetIds(special.gameCore, "SPECIAL_ELECTION").includes("mem_1"),
    false,
    "special election cannot target current president",
  );
  const forcedTransition = getNextNominationTransition({
    ...special.gameCore,
    currentPresidentCandidateId: "mem_4",
    specialElectionCallerId: "mem_1",
    forcedNextPresidentId: "mem_4",
  }, special.members);
  assert.strictEqual(forcedTransition.nextPresidentCandidateId, "mem_2", "after forced president, order should resume left of caller");
  assert.strictEqual(forcedTransition.specialElectionCallerId, null, "special election should clear after forced round");

  const execution = makeExecutiveCore("EXECUTION");
  const execPrivate = buildPrivateSnapshotPayload(
    execution.gameCore,
    execution.members[0],
    execution.members,
    new Date("2026-05-12T00:06:00.000Z"),
  );
  assert.strictEqual(execPrivate.pendingTask.taskType, "EXECUTE_PLAYER", "president should receive execution task");
  assert.strictEqual(
    execPrivate.pendingTask.allowedTargets.includes("mem_1"),
    true,
    "execution should allow targeting self",
  );
}

function assertHistoryProjectionPrivacyAndCurrentRound() {
  const members = makeMembers(7);
  const room = {
    roomId: "room_history",
    roomCode: "909001",
  };
  const projection = createInitialGameProjection(room, members, {
    gameId: "game_history",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const baseHistory = projection.publicSnapshotPayload.publicState.publicHistory;
  const votingCore = {
    ...projection.gameCore,
    version: 4,
    phase: "voting",
    currentPresidentCandidateId: "mem_1",
    currentChancellorCandidateId: "mem_3",
    phaseData: {
      presidentCandidateId: "mem_1",
      chancellorCandidateId: "mem_3",
      votesByMemberId: {
        mem_1: { vote: "JA", commandId: "cmd_1" },
        mem_2: { vote: "NEIN", commandId: "cmd_2" },
      },
    },
  };
  const votingPayload = buildPublicSnapshotPayload(
    room,
    votingCore,
    members,
    baseHistory.concat({
      eventId: "evt_game_history_3",
      round: 1,
      phase: "nomination",
      type: "CHANCELLOR_NOMINATED",
      title: "总理候选人提名",
      summary: "1号玩家 提名 3号玩家 为总理候选人",
      createdAt: "2026-05-12T00:01:00.000Z",
      presidentId: "mem_1",
      chancellorId: "mem_3",
    }),
    new Date("2026-05-12T00:02:00.000Z"),
  );
  const currentRound = votingPayload.publicState.history.rounds[0];
  assert.strictEqual(currentRound.status, "voting", "current voting round should be marked voting");
  assert.strictEqual(currentRound.voteSummary.revealed, false, "unrevealed vote summary should remain hidden");
  assert.strictEqual(currentRound.voteSummary.ja, 0, "unrevealed vote summary should not count JA");
  assert.strictEqual(currentRound.voteSummary.nein, 0, "unrevealed vote summary should not count NEIN");
  assert.strictEqual(
    currentRound.votes.some((vote) => vote.state === "ja"),
    false,
    "unrevealed history should not expose JA state",
  );
  assert.strictEqual(
    currentRound.votes.some((vote) => vote.state === "nein"),
    false,
    "unrevealed history should not expose NEIN state",
  );
  assert.strictEqual(
    currentRound.votes.filter((vote) => vote.state === "pending").length,
    2,
    "submitted unrevealed ballots should only show pending",
  );

  const legislativeCore = {
    ...projection.gameCore,
    version: 5,
    phase: "legislative_president",
    currentPresidentCandidateId: "mem_1",
    currentChancellorCandidateId: "mem_3",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_3",
    policyState: {
      drawPile: ["LIBERAL", "FASCIST"],
      discardPile: [],
      presidentHand: ["FASCIST", "LIBERAL", "FASCIST"],
      chancellorHand: null,
      peekPile: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_3",
      cards: ["FASCIST", "LIBERAL", "FASCIST"],
    },
  };
  const legislativeHistory = buildPublicHistoryProjection(legislativeCore, members, []);
  assert.strictEqual(
    legislativeHistory.rounds[0].outcome.type,
    "pending_legislation",
    "legislative round should show pending legislation",
  );
  assert.strictEqual(
    JSON.stringify(legislativeHistory).includes("FASCIST") || JSON.stringify(legislativeHistory).includes("LIBERAL"),
    false,
    "history projection should not expose legislative hand",
  );

  const passedVoteResult = {
    round: 1,
    presidentCandidateId: "mem_1",
    chancellorCandidateId: "mem_3",
    revealedVotes: members.map((member) => ({
      memberId: member._id,
      displayName: member.displayName,
      vote: "JA",
    })),
    jaCount: members.length,
    neinCount: 0,
    passed: true,
    electionTrackerBefore: 0,
    electionTrackerAfter: 0,
    chaosPolicy: null,
    hitlerCheck: null,
  };
  const legislativeVotePayload = buildPublicSnapshotPayload(
    room,
    {
      ...legislativeCore,
      lastVoteResult: passedVoteResult,
    },
    members,
    baseHistory,
    new Date("2026-05-12T00:02:30.000Z"),
  );
  assert.strictEqual(
    legislativeVotePayload.publicState.voteResult.presidentCandidateId,
    "mem_1",
    "active legislative snapshot should expose the just-revealed vote result",
  );

  const executionCore = {
    ...projection.gameCore,
    version: 6,
    phase: "executive_action",
    currentPresidentCandidateId: "mem_1",
    currentChancellorCandidateId: "mem_3",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_3",
    fascistPolicyCount: 4,
    phaseData: {
      presidentId: "mem_1",
      actionType: "EXECUTION",
      allowedTargetIds: ["mem_1", "mem_2", "mem_3"],
    },
  };
  const executionHistory = buildPublicHistoryProjection(executionCore, members, []);
  assert.strictEqual(executionHistory.rounds[0].status, "executing", "executive round should be marked executing");
  assert.strictEqual(
    executionHistory.rounds[0].outcome.type,
    "pending_legislation",
    "executive round without policy event should not expose action type in outcome",
  );
  assert.strictEqual(
    executionHistory.rounds[0].executiveResult,
    null,
    "pending executive action should not create executive result",
  );
  const executionVotePayload = buildPublicSnapshotPayload(
    room,
    {
      ...executionCore,
      lastVoteResult: passedVoteResult,
    },
    members,
    baseHistory,
    new Date("2026-05-12T00:03:30.000Z"),
  );
  assert.strictEqual(
    executionVotePayload.publicState.voteResult,
    null,
    "policy-enacted snapshot should not keep exposing the previous vote result",
  );
  assert.strictEqual(
    executionVotePayload.publicState.revealedVotes,
    null,
    "policy-enacted snapshot should not keep exposing the previous revealed votes",
  );

  const enactedExecutionCore = {
    ...executionCore,
    fascistPolicyCount: 4,
  };
  const policyEnactedEvent = {
    eventId: "evt_game_history_4",
    round: 1,
    phase: "legislative_chancellor",
    type: "POLICY_ENACTED",
    title: "政策颁布",
    summary: "3号玩家 颁布了 1 张极权派政策，触发总统权力",
    createdAt: "2026-05-12T00:03:00.000Z",
    presidentId: "mem_1",
    chancellorId: "mem_3",
    enactedPolicy: "FASCIST",
    liberalPolicyCount: 0,
    fascistPolicyCount: 4,
    executiveActionType: "EXECUTION",
    winner: null,
    winReason: null,
  };
  const enactedExecutionHistory = buildPublicHistoryProjection(enactedExecutionCore, members, [policyEnactedEvent]);
  assert.strictEqual(
    enactedExecutionHistory.rounds[0].status,
    "executing",
    "policy-enacted executive round should still show executing status",
  );
  assert.strictEqual(
    enactedExecutionHistory.rounds[0].outcome.type,
    "fascist_policy",
    "executive action should preserve enacted policy outcome",
  );
  assert.strictEqual(
    enactedExecutionHistory.rounds[0].outcome.label,
    "极权派政策",
    "executive action should preserve enacted policy label",
  );
  assert.strictEqual(
    enactedExecutionHistory.rounds[0].executiveResult,
    null,
    "POLICY_ENACTED should not create executive result before action completes",
  );

  const nextRoundCore = {
    ...projection.gameCore,
    version: 7,
    round: 2,
    phase: "nomination",
    currentPresidentCandidateId: "mem_2",
    currentChancellorCandidateId: null,
    currentPresidentId: null,
    currentChancellorId: null,
    fascistPolicyCount: 4,
    phaseData: {
      presidentCandidateId: "mem_2",
      eligibleChancellorIds: ["mem_1", "mem_3"],
    },
  };

  const executedHistory = buildPublicHistoryProjection(nextRoundCore, members, [
    policyEnactedEvent,
    {
      eventId: "evt_game_history_5",
      round: 1,
      phase: "executive_action",
      type: "EXEC_PLAYER_EXECUTED",
      title: "总统完成处决",
      summary: "1号玩家 处决了 6号玩家",
      createdAt: "2026-05-12T00:04:00.000Z",
      presidentId: "mem_1",
      chancellorId: "mem_3",
      targetMemberId: "mem_6",
      executiveActionType: "EXECUTION",
      winner: null,
      winReason: null,
    },
  ]);
  assert.strictEqual(executedHistory.rounds[0].status, "completed", "completed execution should finish the round");
  assert.strictEqual(
    executedHistory.rounds[0].outcome.type,
    "fascist_policy",
    "execution should not replace policy outcome",
  );
  assert.strictEqual(
    executedHistory.rounds[0].executiveResult.text,
    "1号总统处决了6号玩家",
    "execution result should be shown as a public result line",
  );

  const investigatedHistory = buildPublicHistoryProjection(nextRoundCore, members, [
    policyEnactedEvent,
    {
      eventId: "evt_game_history_6",
      round: 1,
      phase: "executive_action",
      type: "EXEC_INVESTIGATED",
      title: "总统完成忠诚调查",
      summary: "1号玩家 调查了 4号玩家 的忠诚",
      createdAt: "2026-05-12T00:04:30.000Z",
      presidentId: "mem_1",
      chancellorId: "mem_3",
      targetMemberId: "mem_4",
      executiveActionType: "INVESTIGATE",
      party: "LIBERAL",
    },
  ]);
  assert.strictEqual(
    investigatedHistory.rounds[0].outcome.type,
    "fascist_policy",
    "investigation should not replace policy outcome",
  );
  assert.strictEqual(
    investigatedHistory.rounds[0].executiveResult.text,
    "1号总统调查了4号玩家",
    "investigation result should only show public target",
  );
  assert.strictEqual(
    JSON.stringify(investigatedHistory).includes("LIBERAL"),
    false,
    "history projection should not expose investigation party",
  );

  const policyPeekHistory = buildPublicHistoryProjection(nextRoundCore, members, [
    policyEnactedEvent,
    {
      eventId: "evt_game_history_7",
      round: 1,
      phase: "executive_action",
      type: "EXEC_POLICY_PEEK_ACKED",
      title: "总统完成政策预览",
      summary: "1号玩家 已秘密查看政策牌堆顶",
      createdAt: "2026-05-12T00:05:00.000Z",
      presidentId: "mem_1",
      chancellorId: "mem_3",
      executiveActionType: "POLICY_PEEK",
      peekedPolicies: ["LIBERAL", "FASCIST", "FASCIST"],
    },
  ]);
  assert.strictEqual(
    policyPeekHistory.rounds[0].executiveResult.text,
    "1号总统查看了政策牌堆顶",
    "policy peek result should not reveal cards",
  );
  assert.strictEqual(
    JSON.stringify(policyPeekHistory).includes("LIBERAL") || JSON.stringify(policyPeekHistory).includes("FASCIST"),
    false,
    "history projection should not expose policy peek cards",
  );

  const specialElectionHistory = buildPublicHistoryProjection(nextRoundCore, members, [
    policyEnactedEvent,
    {
      eventId: "evt_game_history_8",
      round: 1,
      phase: "executive_action",
      type: "EXEC_SPECIAL_ELECTION",
      title: "特别选举发动",
      summary: "1号玩家 指定 6号玩家 成为下一任特别总统候选人",
      createdAt: "2026-05-12T00:05:30.000Z",
      presidentId: "mem_1",
      chancellorId: "mem_3",
      targetMemberId: "mem_6",
      nextPresidentCandidateId: "mem_6",
      executiveActionType: "SPECIAL_ELECTION",
    },
  ]);
  assert.strictEqual(
    specialElectionHistory.rounds[0].executiveResult.text,
    "1号总统特别任命了6号玩家",
    "special election result should show appointed player",
  );

  const nextRoundHistory = buildPublicHistoryProjection(nextRoundCore, members, [
    policyEnactedEvent,
    {
      eventId: "evt_game_history_9",
      round: 1,
      phase: "executive_action",
      type: "EXEC_PLAYER_EXECUTED",
      title: "总统完成处决",
      summary: "1号玩家 处决了 6号玩家",
      createdAt: "2026-05-12T00:06:00.000Z",
      presidentId: "mem_1",
      chancellorId: "mem_3",
      targetMemberId: "mem_6",
      executiveActionType: "EXECUTION",
      winner: null,
      winReason: null,
    },
  ]);
  assert.strictEqual(nextRoundHistory.rounds[0].status, "completed", "previous round should not remain executing");
  assert.strictEqual(
    nextRoundHistory.rounds[0].outcome.type,
    "fascist_policy",
    "previous round should keep policy outcome after next nomination starts",
  );
  assert.strictEqual(
    nextRoundHistory.rounds[0].executiveResult.text,
    "1号总统处决了6号玩家",
    "previous round should keep completed executive result",
  );
  assert.strictEqual(nextRoundHistory.rounds[1].status, "nominating", "next round should show nomination state");

  const gameEndedCore = {
    ...enactedExecutionCore,
    status: "ended",
    phase: "game_ended",
    winner: "LIBERAL",
    winReason: "HITLER_EXECUTED",
  };
  const hitlerExecutedHistory = buildPublicHistoryProjection(gameEndedCore, members, [
    policyEnactedEvent,
    {
      eventId: "evt_game_history_10",
      round: 1,
      phase: "executive_action",
      type: "EXEC_PLAYER_EXECUTED",
      title: "总统完成处决",
      summary: "1号玩家 处决了 6号玩家，独裁者被处决，自由派获胜",
      createdAt: "2026-05-12T00:07:00.000Z",
      presidentId: "mem_1",
      chancellorId: "mem_3",
      targetMemberId: "mem_6",
      executiveActionType: "EXECUTION",
      winner: "LIBERAL",
      winReason: "HITLER_EXECUTED",
    },
  ]);
  assert.strictEqual(hitlerExecutedHistory.rounds[0].outcome.type, "win", "execution win should use win outcome");
  assert.strictEqual(
    hitlerExecutedHistory.rounds[0].executiveResult.text,
    "1号总统处决了6号玩家",
    "execution win should still keep public execution result",
  );
}

function assertResultSnapshotProjection() {
  const members = makeMembers(5);
  const room = {
    roomId: "room_result",
    roomCode: "482615",
  };
  const projection = createInitialGameProjection(room, members, {
    gameId: "game_result",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const endedCore = {
    ...projection.gameCore,
    status: "ended",
    phase: "game_ended",
    version: 9,
    liberalPolicyCount: 3,
    fascistPolicyCount: 5,
    winner: "LIBERAL",
    winReason: "HITLER_EXECUTED",
    endedAt: new Date("2026-05-12T00:08:00.000Z"),
    aliveMemberIds: members.slice(0, 4).map((member) => member.memberId),
  };
  const result = buildResultSnapshotPayload(
    room,
    endedCore,
    members,
    [
      {
        eventId: "evt_result_1",
        round: 6,
        phase: "executive_action",
        type: "EXEC_PLAYER_EXECUTED",
        title: "总统完成处决",
        summary: "玩家1 处决了 玩家5，独裁者被处决，自由派获胜",
        createdAt: "2026-05-12T00:07:59.000Z",
      },
    ],
    new Date("2026-05-12T00:08:00.000Z"),
    "mem_1",
  );

  assert.strictEqual(result.roomStatus, "ended", "result snapshot should expose ended room status");
  assert.strictEqual(result.myMemberId, "mem_1", "result snapshot should include viewer member id");
  assert.strictEqual(result.winner, "LIBERAL", "result snapshot should include winner enum");
  assert.strictEqual(result.policySummary.fascist, 5, "result snapshot should include final policy track");
  assert.strictEqual(result.finalPlayers.length, 5, "result snapshot should include all final players");
  assert(result.finalPlayers.every((player) => player.role && player.party), "result snapshot should reveal final identities");
  assert.strictEqual(result.timeline[0].type, "EXEC_PLAYER_EXECUTED", "result snapshot should include key timeline events");
}

function assertRoomTtlPolicies() {
  const createdAt = new Date("2026-05-12T00:00:00.000Z");
  const room = {
    roomId: "room_ttl",
    roomCode: "112233",
  };
  const projection = createInitialGameProjection(room, makeMembers(5), {
    gameId: "game_ttl",
    createdAt,
    pickIndex: () => 0,
  });
  assert.strictEqual(
    projection.expireAt.getTime() - createdAt.getTime(),
    ROOM_TTL_ACTIVE_MS,
    "active game projection should keep active-room ttl",
  );

  const endedAt = new Date("2026-05-12T00:15:00.000Z");
  assert.strictEqual(
    createResultExpireAt(endedAt).getTime() - endedAt.getTime(),
    ROOM_TTL_RESULT_MS,
    "ended result projection should use 30-minute result ttl",
  );
  assert.strictEqual(ROOM_TTL_RESULT_MS, 30 * 60 * 1000, "result ttl should be 30 minutes");
}

Object.keys(ROLE_PRESET_BY_PLAYER_COUNT).forEach((playerCountKey) => {
  const playerCount = Number(playerCountKey);
  const room = {
    roomId: `room_${playerCount}`,
    roomCode: `${playerCount}`.padStart(6, "0"),
  };
  const projection = createInitialGameProjection(room, makeMembers(playerCount), {
    gameId: `game_${playerCount}`,
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });

  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(projection.gameCore, "_id"),
    false,
    "game core data should not write reserved _id",
  );
  const roleCounts = countBy(Object.values(projection.gameCore.roleAssignments).map((assignment) => assignment.role));
  const expectedCounts = countBy(ROLE_PRESET_BY_PLAYER_COUNT[playerCount]);
  assert.deepStrictEqual(roleCounts, expectedCounts, `${playerCount}p role counts should match preset`);
  assertPolicyDeck(projection.gameCore.policyState);
  assertPrivateVisibility(projection, playerCount);
  assertPublicSnapshotSafe(projection);
  assertEventsSafe(projection);
});

assertNominationTargetOptions();
assertLegislativePresidentVisibility();
assertLegislativeChancellorVisibility();
assertVetoPrivateAndHistoryProjection();
assertExecutivePrivateAndPublicProjection();
assertHistoryProjectionPrivacyAndCurrentRound();
assertResultSnapshotProjection();
assertRoomTtlPolicies();

console.log("startGame initialization tests passed");
