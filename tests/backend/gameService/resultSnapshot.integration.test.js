const assert = require("assert");
const { createMemoryDb, loadGameService } = require("../helpers/loadGameService");

function makeMembers(playerCount, roomId = "room_test") {
  return Array.from({ length: playerCount }, (_, index) => ({
    _id: `mem_${index + 1}`,
    memberId: `mem_${index + 1}`,
    roomId,
    openId: `openid_${index + 1}`,
    displayName: `玩家${index + 1}`,
    avatarUrl: "",
    seatIndex: index + 1,
    memberStatus: "active",
  }));
}

async function assertResultSnapshotBlockedBeforeGameEnds() {
  const db = createMemoryDb({
    rooms: {
      room_1: {
        _id: "room_1",
        roomId: "room_1",
        roomCode: "100001",
        status: "in_game",
        currentGameId: "game_1",
        expireAt: "2099-01-01T00:00:00.000Z",
      },
    },
    room_members: {
      mem_1: makeMembers(1, "room_1")[0],
    },
  });
  const { service } = loadGameService({ db, openId: "openid_1" });

  const response = await service.main({
    action: "getResultSnapshot",
    payload: {
      roomId: "room_1",
    },
  });

  assert.strictEqual(response.success, false, "result snapshot should be blocked before game ends");
  assert.strictEqual(response.error.code, "ACTION_NOT_ALLOWED");
}

async function assertResultSnapshotUsesEndedPublicProjection() {
  const db = createMemoryDb();
  const { service } = loadGameService({ db, openId: "openid_1" });
  const members = makeMembers(5, "room_2");
  const room = {
    _id: "room_2",
    roomId: "room_2",
    roomCode: "100002",
    status: "ended",
    currentGameId: "game_2",
    expireAt: "2099-01-01T00:00:00.000Z",
  };
  const projection = service.__testHooks.createInitialGameProjection(room, members, {
    gameId: "game_2",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const endedCore = {
    ...projection.gameCore,
    status: "ended",
    phase: "game_ended",
    winner: "LIBERAL",
    winReason: "HITLER_EXECUTED",
    endedAt: new Date("2026-05-12T00:10:00.000Z"),
  };
  const resultPayload = service.__testHooks.buildResultSnapshotPayload(
    room,
    endedCore,
    members,
    [],
    new Date("2026-05-12T00:10:00.000Z"),
    "mem_1",
  );

  await db.collection("rooms").doc("room_2").set({ data: room });
  for (const member of members) {
    await db.collection("room_members").doc(member.memberId).set({ data: member });
  }
  await db.collection("room_public_snapshots").doc("room_2").set({
    data: {
      _id: "room_2",
      roomId: "room_2",
      snapshotType: "result_public",
      payload: resultPayload,
    },
  });

  const response = await service.main({
    action: "getResultSnapshot",
    payload: {
      roomId: "room_2",
    },
  });

  assert.strictEqual(response.success, true, "ended room should return result snapshot");
  assert.strictEqual(response.data.roomStatus, "ended");
  assert.strictEqual(response.data.myMemberId, "mem_1");
  assert.strictEqual(response.data.winner, "LIBERAL");
  assert.strictEqual(response.data.finalPlayers.length, 5);
  assert(response.data.finalPlayers.every((player) => player.role && player.party), "final identities should be revealed");

  const updatedMember = db.dump().room_members.mem_1;
  assert.strictEqual(updatedMember.memberStatus, "active", "successful cloud function call should touch last seen member");
  assert(updatedMember.lastSeenAt, "successful cloud function call should update lastSeenAt");

  const statsAfterFirstRead = db.stats();
  const secondResponse = await service.main({
    action: "getResultSnapshot",
    payload: {
      roomId: "room_2",
    },
  });
  const statsAfterSecondRead = db.stats();

  assert.strictEqual(secondResponse.success, true);
  assert.strictEqual(
    statsAfterSecondRead.queryGets.room_members,
    statsAfterFirstRead.queryGets.room_members + 1,
    "throttled read should skip the extra lastSeen member query",
  );
  assert.strictEqual(
    statsAfterSecondRead.docUpdates.room_members,
    statsAfterFirstRead.docUpdates.room_members,
    "throttled read should skip the lastSeen member write",
  );
}

async function assertFailedElectionKeepsRevealedBallotsInHistory() {
  const db = createMemoryDb();
  const { service, setOpenId } = loadGameService({ db, openId: "openid_1" });
  const members = makeMembers(5, "room_failed_vote");
  const room = {
    _id: "room_failed_vote",
    roomId: "room_failed_vote",
    roomCode: "100003",
    status: "in_game",
    currentGameId: "game_failed_vote",
    expireAt: "2099-01-01T00:00:00.000Z",
  };
  const projection = service.__testHooks.createInitialGameProjection(room, members, {
    gameId: "game_failed_vote",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const votingCore = {
    ...projection.gameCore,
    version: 2,
    eventSeq: 3,
    phase: "voting",
    currentPresidentCandidateId: "mem_1",
    currentChancellorCandidateId: "mem_2",
    phaseData: {
      presidentCandidateId: "mem_1",
      chancellorCandidateId: "mem_2",
      votesByMemberId: {},
    },
  };
  const publicHistory = projection.publicSnapshotPayload.publicState.publicHistory.concat({
    eventId: "evt_game_failed_vote_3",
    round: 1,
    phase: "nomination",
    type: "CHANCELLOR_NOMINATED",
    title: "总理候选人提名",
    summary: "玩家1 提名 玩家2 为总理候选人",
    createdAt: "2026-05-12T00:01:00.000Z",
    presidentId: "mem_1",
    chancellorId: "mem_2",
  });
  const publicPayload = service.__testHooks.buildPublicSnapshotPayload(
    room,
    votingCore,
    members,
    publicHistory,
    new Date("2026-05-12T00:01:00.000Z"),
  );

  await db.collection("rooms").doc(room.roomId).set({ data: room });
  await db.collection("game_core").doc(votingCore.gameId).set({ data: votingCore });
  await db.collection("room_public_snapshots").doc(room.roomId).set({
    data: {
      _id: room.roomId,
      roomId: room.roomId,
      snapshotType: "game_public",
      version: votingCore.version,
      payload: publicPayload,
    },
  });
  for (const member of members) {
    await db.collection("room_members").doc(member.memberId).set({ data: member });
    await db.collection("player_private_snapshots").doc(member.memberId).set({
      data: {
        _id: member.memberId,
        roomId: room.roomId,
        version: votingCore.version,
        payload: {},
      },
    });
  }

  const ballots = ["JA", "JA", "NEIN", "NEIN", "NEIN"];
  let expectedVersion = votingCore.version;
  for (let index = 0; index < members.length; index += 1) {
    setOpenId(members[index].openId);
    const response = await service.main({
      action: "submitCommand",
      payload: {
        roomId: room.roomId,
        type: "SUBMIT_VOTE",
        expectedVersion,
        commandId: `cmd_failed_vote_${index + 1}`,
        body: {
          vote: ballots[index],
        },
      },
    });
    assert.strictEqual(response.success, true, `ballot ${index + 1} should be accepted`);
    expectedVersion = response.data.newVersion;
  }

  const stored = db.dump();
  const settledCore = stored.game_core[votingCore.gameId];
  const settledPublicState = stored.room_public_snapshots[room.roomId].payload.publicState;
  const failedRound = settledPublicState.history.rounds.find((round) => round.round === 1);
  const nextRound = settledPublicState.history.rounds.find((round) => round.round === 2);

  assert.strictEqual(settledCore.round, 2, "failed election should advance to the next round");
  assert.strictEqual(settledCore.phase, "nomination", "failed election should return to nomination");
  assert.strictEqual(failedRound.status, "vote_failed", "failed government should remain in round history");
  assert.strictEqual(failedRound.voteSummary.revealed, true, "failed election ballots should stay revealed");
  assert.deepStrictEqual(
    failedRound.voteGroups,
    {
      jaMemberIds: ["mem_1", "mem_2"],
      neinMemberIds: ["mem_3", "mem_4", "mem_5"],
    },
    "failed election history should preserve grouped ballots in seat order",
  );
  assert.strictEqual(failedRound.voteSummary.jaCount, 2);
  assert.strictEqual(failedRound.voteSummary.neinCount, 3);
  assert.strictEqual(failedRound.voteSummary.submittedCount, 5);
  assert.strictEqual(failedRound.voteSummary.requiredCount, 5);
  assert.strictEqual(failedRound.voteSummary.passed, false);
  assert.strictEqual(failedRound.voteSummary.electionTrackerCount, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(failedRound, "votes"), false);
  assert.deepStrictEqual(settledCore.lastVoteResult.voteGroups, failedRound.voteGroups);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(settledCore.lastVoteResult, "revealedVotes"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(settledPublicState, "revealedVotes"), false);
  assert.strictEqual(nextRound.status, "nominating", "the next nomination should use a separate round record");
}

async function assertAcceptedVetoChaosClearsTermLimits() {
  const db = createMemoryDb();
  const { service } = loadGameService({ db, openId: "openid_1" });
  const members = makeMembers(7, "room_veto_chaos");
  const room = {
    _id: "room_veto_chaos",
    roomId: "room_veto_chaos",
    roomCode: "100004",
    mode: "normal",
    status: "in_game",
    currentGameId: "game_veto_chaos",
    expireAt: "2099-01-01T00:00:00.000Z",
  };
  const projection = service.__testHooks.createInitialGameProjection(room, members, {
    gameId: "game_veto_chaos",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const chancellorHand = ["FASCIST", "LIBERAL"];
  const vetoCore = {
    ...projection.gameCore,
    version: 9,
    eventSeq: 12,
    round: 4,
    phase: "veto_response",
    currentPresidentCandidateId: "mem_1",
    currentChancellorCandidateId: "mem_3",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_3",
    previousElectedPresidentId: "mem_1",
    previousElectedChancellorId: "mem_3",
    electionTracker: 2,
    fascistPolicyCount: 5,
    vetoUnlocked: true,
    policyState: {
      drawPile: ["LIBERAL", "FASCIST", "LIBERAL", "FASCIST"],
      discardPile: [],
      presidentHand: null,
      chancellorHand,
      peekPile: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_3",
      cards: chancellorHand,
      requestedBy: "mem_3",
    },
  };
  const publicHistory = projection.publicSnapshotPayload.publicState.publicHistory;
  const publicPayload = service.__testHooks.buildPublicSnapshotPayload(
    room,
    vetoCore,
    members,
    publicHistory,
    new Date("2026-05-12T00:09:00.000Z"),
  );

  await db.collection("rooms").doc(room.roomId).set({ data: room });
  await db.collection("game_core").doc(vetoCore.gameId).set({ data: vetoCore });
  await db.collection("room_public_snapshots").doc(room.roomId).set({
    data: {
      _id: room.roomId,
      roomId: room.roomId,
      snapshotType: "game_public",
      version: vetoCore.version,
      payload: publicPayload,
    },
  });
  for (const member of members) {
    const privatePayload = service.__testHooks.buildPrivateSnapshotPayload(
      vetoCore,
      member,
      members,
      new Date("2026-05-12T00:09:00.000Z"),
    );
    await db.collection("room_members").doc(member.memberId).set({ data: member });
    await db.collection("player_private_snapshots").doc(member.memberId).set({
      data: {
        _id: member.memberId,
        memberId: member.memberId,
        roomId: room.roomId,
        version: vetoCore.version,
        payload: privatePayload,
        pendingTask: privatePayload.pendingTask,
      },
    });
  }

  const response = await service.main({
    action: "submitCommand",
    payload: {
      commandId: "cmd_veto_chaos_accept",
      roomId: room.roomId,
      expectedVersion: vetoCore.version,
      type: "PRESIDENT_RESPOND_VETO",
      taskId: `${vetoCore.gameId}:${vetoCore.round}:${vetoCore.phase}:PRESIDENT_RESPOND_VETO:mem_1`,
      body: {
        accepted: true,
      },
    },
  });

  assert.strictEqual(response.success, true, "president should be able to accept the veto");
  const settledCore = db.dump().game_core[vetoCore.gameId];
  assert.strictEqual(settledCore.electionTracker, 0, "accepted veto at tracker 2 should trigger chaos");
  assert.strictEqual(
    settledCore.previousElectedPresidentId,
    null,
    "chaos policy after an accepted veto should clear the previous president term limit",
  );
  assert.strictEqual(
    settledCore.previousElectedChancellorId,
    null,
    "chaos policy after an accepted veto should clear the previous chancellor term limit",
  );
  assert(
    settledCore.phaseData.eligibleChancellorIds.includes("mem_1"),
    "the previous president should be eligible after chaos clears term limits",
  );
  assert(
    settledCore.phaseData.eligibleChancellorIds.includes("mem_3"),
    "the previous chancellor should be eligible after chaos clears term limits",
  );
}

(async () => {
  await assertResultSnapshotBlockedBeforeGameEnds();
  await assertResultSnapshotUsesEndedPublicProjection();
  await assertFailedElectionKeepsRevealedBallotsInHistory();
  await assertAcceptedVetoChaosClearsTermLimits();
  console.log("gameService result snapshot integration tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
