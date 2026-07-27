const assert = require("assert");
const { createMemoryDb, loadGameService } = require("../helpers/loadGameService");

function makeMembers(playerCount, roomId) {
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

function makeVotingCore(projection) {
  return {
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
    updatedAt: new Date("2026-05-12T00:01:00.000Z"),
  };
}

async function assertStableTaskIdsAndStrictLegacyRejection() {
  const room = {
    roomId: "room_task_id",
    roomCode: "200001",
  };
  const members = makeMembers(5, room.roomId);
  const { service } = loadGameService();
  const projection = service.__testHooks.createInitialGameProjection(room, members, {
    gameId: "game_task_id",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const hooks = service.__testHooks;
  const votingCore = makeVotingCore(projection);
  const first = hooks.buildPrivateSnapshotPayload(votingCore, members[0], members, votingCore.updatedAt);
  const nextVersion = hooks.buildPrivateSnapshotPayload(
    { ...votingCore, version: votingCore.version + 1 },
    members[0],
    members,
    new Date("2026-05-12T00:02:00.000Z"),
  );
  const nextRound = hooks.buildPrivateSnapshotPayload(
    { ...votingCore, round: votingCore.round + 1 },
    members[0],
    members,
    new Date("2026-05-12T00:03:00.000Z"),
  );
  const otherMember = hooks.buildPrivateSnapshotPayload(votingCore, members[1], members, votingCore.updatedAt);

  assert.strictEqual(first.pendingTask.taskId, "game_task_id:1:voting:SUBMIT_VOTE:mem_1");
  assert.strictEqual(
    first.pendingTask.taskId,
    nextVersion.pendingTask.taskId,
    "task id should not change when only the game version changes",
  );
  assert.notStrictEqual(first.pendingTask.taskId, nextRound.pendingTask.taskId, "task id should include the round");
  assert.notStrictEqual(first.pendingTask.taskId, otherMember.pendingTask.taskId, "task id should include the member");
}

function assertChangedProjectionCoverage() {
  const room = {
    roomId: "room_projection_diff",
    roomCode: "200003",
  };
  const members = makeMembers(5, room.roomId);
  const { service } = loadGameService();
  const hooks = service.__testHooks;
  const projection = hooks.createInitialGameProjection(room, members, {
    gameId: "game_projection_diff",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const baseCore = projection.gameCore;
  const previousLegislativeCore = {
    ...baseCore,
    version: 4,
    phase: "legislative_president",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_2",
    policyState: {
      ...baseCore.policyState,
      presidentHand: ["LIBERAL", "FASCIST", "FASCIST"],
      chancellorHand: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: ["LIBERAL", "FASCIST", "FASCIST"],
    },
    updatedAt: new Date("2026-05-12T00:04:00.000Z"),
  };
  const nextLegislativeCore = {
    ...previousLegislativeCore,
    version: 5,
    phase: "legislative_chancellor",
    policyState: {
      ...previousLegislativeCore.policyState,
      presidentHand: null,
      chancellorHand: ["LIBERAL", "FASCIST"],
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: ["LIBERAL", "FASCIST"],
      vetoAllowed: false,
    },
    updatedAt: new Date("2026-05-12T00:05:00.000Z"),
  };
  const handChanges = hooks.buildChangedPrivateSnapshotPayloads(
    previousLegislativeCore,
    nextLegislativeCore,
    members,
    nextLegislativeCore.updatedAt,
  );
  assert.deepStrictEqual(
    handChanges.map((snapshot) => snapshot.memberId),
    ["mem_1", "mem_2"],
    "hand transfer should update only the president and chancellor private projections",
  );

  const previousExecutiveCore = {
    ...baseCore,
    version: 6,
    phase: "executive_action",
    currentPresidentId: "mem_1",
    phaseData: {
      actionType: "INVESTIGATE",
      allowedTargetIds: ["mem_2"],
    },
    updatedAt: new Date("2026-05-12T00:06:00.000Z"),
  };
  const nextExecutiveCore = {
    ...previousExecutiveCore,
    version: 7,
    round: 2,
    phase: "nomination",
    currentPresidentCandidateId: "mem_2",
    phaseData: {
      presidentCandidateId: "mem_2",
      eligibleChancellorIds: ["mem_1", "mem_3", "mem_4", "mem_5"],
    },
    investigationResultsByMemberId: {
      mem_1: {
        targetMemberId: "mem_2",
        targetDisplayName: "玩家2",
        party: "LIBERAL",
        round: 1,
        revealedAt: "2026-05-12T00:07:00.000Z",
      },
    },
    updatedAt: new Date("2026-05-12T00:07:00.000Z"),
  };
  const executiveChanges = hooks.buildChangedPrivateSnapshotPayloads(
    previousExecutiveCore,
    nextExecutiveCore,
    members,
    nextExecutiveCore.updatedAt,
  );
  assert.deepStrictEqual(
    executiveChanges.map((snapshot) => snapshot.memberId),
    ["mem_1", "mem_2"],
    "executive result and next nomination task should update only affected seats",
  );

  const terminalCore = {
    ...baseCore,
    version: 8,
    status: "ended",
    phase: "game_ended",
    winner: "LIBERAL",
    winReason: "HITLER_EXECUTED",
    endedAt: new Date("2026-05-12T00:08:00.000Z"),
    updatedAt: new Date("2026-05-12T00:08:00.000Z"),
  };
  const terminalChanges = hooks.buildChangedPrivateSnapshotPayloads(
    baseCore,
    terminalCore,
    members,
    terminalCore.updatedAt,
  );
  assert.deepStrictEqual(
    terminalChanges.map((snapshot) => snapshot.memberId),
    members.map((member) => member.memberId),
    "terminal status changes should update every private projection",
  );
}

async function assertTenPlayerVotingWritesOnlyChangedPrivateSnapshots() {
  const room = {
    _id: "room_private_optimization",
    roomId: "room_private_optimization",
    roomCode: "200002",
    status: "in_game",
    currentGameId: "game_private_optimization",
    expireAt: "2099-01-01T00:00:00.000Z",
  };
  const members = makeMembers(10, room.roomId);
  const { service, db, setOpenId } = loadGameService({ openId: members[0].openId });
  const hooks = service.__testHooks;
  const projection = hooks.createInitialGameProjection(room, members, {
    gameId: room.currentGameId,
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const votingCore = makeVotingCore(projection);
  const publicPayload = hooks.buildPublicSnapshotPayload(
    room,
    votingCore,
    members,
    projection.publicSnapshotPayload.publicState.publicHistory,
    votingCore.updatedAt,
  );

  await db.collection("rooms").doc(room.roomId).set({ data: room });
  await db.collection("game_core").doc(room.currentGameId).set({ data: votingCore });
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
    const privatePayload = hooks.buildPrivateSnapshotPayload(votingCore, member, members, votingCore.updatedAt);
    await db.collection("room_members").doc(member.memberId).set({ data: member });
    await db.collection("player_private_snapshots").doc(member.memberId).set({
      data: {
        _id: member.memberId,
        memberId: member.memberId,
        roomId: room.roomId,
        gameId: room.currentGameId,
        ownerOpenId: member.openId,
        roomStatus: "in_game",
        version: votingCore.version,
        payload: privatePayload,
        pendingTask: privatePayload.pendingTask,
      },
    });
  }

  const oldTaskResponse = await service.main({
    action: "submitCommand",
    payload: {
      roomId: room.roomId,
      type: "SUBMIT_VOTE",
      expectedVersion: votingCore.version,
      taskId: `${votingCore.gameId}:${votingCore.version}:SUBMIT_VOTE:mem_1`,
      commandId: "cmd_private_optimization_old_task",
      body: { vote: "JA" },
    },
  });
  assert.strictEqual(oldTaskResponse.success, false, "legacy task ids should be rejected");
  assert.strictEqual(oldTaskResponse.error.code, "ACTION_NOT_ALLOWED");

  const beforeCommands = db.stats();
  const ballots = ["JA", "JA", "JA", "JA", "JA", "NEIN", "NEIN", "NEIN", "NEIN", "NEIN"];
  let expectedVersion = votingCore.version;
  for (let index = 0; index < members.length; index += 1) {
    setOpenId(members[index].openId);
    const before = db.stats();
    const response = await service.main({
      action: "submitCommand",
      payload: {
        roomId: room.roomId,
        type: "SUBMIT_VOTE",
        expectedVersion,
        commandId: `cmd_private_optimization_${index + 1}`,
        body: { vote: ballots[index] },
      },
    });
    assert.strictEqual(response.success, true, `vote ${index + 1} should be accepted`);
    const after = db.stats();
    const privateUpdates = (after.docUpdates.player_private_snapshots || 0) - (before.docUpdates.player_private_snapshots || 0);
    assert.strictEqual(
      privateUpdates,
      index === members.length - 1 ? members.length : 1,
      index === members.length - 1
        ? "the final vote should update every changed private projection"
        : "a partial vote should update only the voter private projection",
    );
    assert.strictEqual(
      after.docGets.player_private_snapshots || 0,
      before.docGets.player_private_snapshots || 0,
      "command processing should not read private snapshots",
    );
    expectedVersion = response.data.newVersion;
  }

  const afterCommands = db.stats();
  assert.strictEqual(
    (afterCommands.docUpdates.player_private_snapshots || 0) - (beforeCommands.docUpdates.player_private_snapshots || 0),
    19,
    "ten-player voting should use nine partial writes plus one final full transition",
  );
  assert.strictEqual(
    afterCommands.docGets.player_private_snapshots || 0,
    beforeCommands.docGets.player_private_snapshots || 0,
    "the optimization must not add private snapshot reads",
  );
}

(async () => {
  await assertStableTaskIdsAndStrictLegacyRejection();
  assertChangedProjectionCoverage();
  await assertTenPlayerVotingWritesOnlyChangedPrivateSnapshots();
  console.log("private snapshot optimization tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
