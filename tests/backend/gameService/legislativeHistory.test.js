const assert = require("assert");
const { createMemoryDb, loadGameService } = require("../helpers/loadGameService");

const CREATED_AT = new Date("2026-05-12T00:00:00.000Z");

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
    memberType: "player",
  }));
}

function makeRoom(roomId, gameId) {
  return {
    _id: roomId,
    roomId,
    roomCode: "123456",
    status: "in_game",
    currentGameId: gameId,
    expireAt: "2099-01-01T00:00:00.000Z",
  };
}

function makeLegislativeCore(service, room, members, overrides = {}) {
  const projection = service.__testHooks.createInitialGameProjection(room, members, {
    gameId: room.currentGameId,
    createdAt: CREATED_AT,
    pickIndex: () => 0,
  });
  const presidentHand = ["FASCIST", "FASCIST", "LIBERAL"];
  return {
    ...projection.gameCore,
    version: 7,
    eventSeq: 7,
    round: 3,
    phase: "legislative_president",
    currentPresidentCandidateId: "mem_1",
    currentChancellorCandidateId: "mem_4",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_4",
    policyState: {
      drawPile: ["FASCIST", "LIBERAL", "FASCIST"],
      discardPile: [],
      presidentHand,
      chancellorHand: null,
      peekPile: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_4",
      cards: presidentHand,
    },
    ...overrides,
  };
}

async function seedGame(db, service, room, members, gameCore) {
  const publicPayload = service.__testHooks.buildPublicSnapshotPayload(room, gameCore, members, [], CREATED_AT);
  await db.collection("rooms").doc(room.roomId).set({ data: room });
  await db.collection("game_core").doc(gameCore.gameId).set({ data: gameCore });
  await db.collection("room_public_snapshots").doc(room.roomId).set({
    data: {
      _id: room.roomId,
      roomId: room.roomId,
      snapshotType: "game_public",
      version: gameCore.version,
      payload: publicPayload,
    },
  });
  for (const member of members) {
    await db.collection("room_members").doc(member.memberId).set({ data: member });
    await db.collection("user_profiles").doc(member.openId).set({
      data: {
        openid: member.openId,
        activeRoomId: room.roomId,
        activeMemberId: member.memberId,
        activeRoomStatus: "in_game",
        multiplayerGameCount: 0,
        multiplayerWinCount: 0,
        multiplayerLossCount: 0,
      },
    });
  }
}

function taskId(service, gameCore, type, memberId) {
  return service.__testHooks.buildTaskId(gameCore, type, memberId);
}

async function assertNormalEnactmentAndIdempotency() {
  const db = createMemoryDb();
  const { service, setOpenId } = loadGameService({ db, openId: "openid_1" });
  const room = makeRoom("room_legislative_normal", "game_legislative_normal");
  const members = makeMembers(5, room.roomId);
  const gameCore = makeLegislativeCore(service, room, members, {
    liberalPolicyCount: 4,
  });
  await seedGame(db, service, room, members, gameCore);

  const discardPayload = {
    roomId: room.roomId,
    expectedVersion: gameCore.version,
    commandId: "cmd_legislative_normal_discard",
    type: "PRESIDENT_DISCARD_POLICY",
    taskId: taskId(service, gameCore, "PRESIDENT_DISCARD_POLICY", "mem_1"),
    body: { discardPolicyIndex: 0 },
  };
  const discardResponse = await service.main({ action: "submitCommand", payload: discardPayload });
  assert.strictEqual(discardResponse.success, true, "president discard should be accepted");

  const afterDiscard = db.dump().game_core[gameCore.gameId];
  assert.deepStrictEqual(afterDiscard.legislativeHistory, [
    {
      round: 3,
      presidentMemberId: "mem_1",
      chancellorMemberId: "mem_4",
      presidentDiscardedPolicy: "FASCIST",
      chancellorEnactedPolicy: null,
      chancellorDiscardedPolicies: [],
    },
  ], "president discard should append one incomplete legislative record");

  setOpenId("openid_4");
  const enactPayload = {
    roomId: room.roomId,
    expectedVersion: discardResponse.data.newVersion,
    commandId: "cmd_legislative_normal_enact",
    type: "CHANCELLOR_ENACT_POLICY",
    taskId: taskId(service, afterDiscard, "CHANCELLOR_ENACT_POLICY", "mem_4"),
    body: { enactPolicyIndex: 1 },
  };
  const enactResponse = await service.main({ action: "submitCommand", payload: enactPayload });
  assert.strictEqual(enactResponse.success, true, "chancellor enactment should be accepted");
  assert.strictEqual(enactResponse.data.routeHint, "result", "final policy should route to the result page");

  const settled = db.dump();
  const settledCore = settled.game_core[gameCore.gameId];
  assert.deepStrictEqual(settledCore.legislativeHistory, [
    {
      round: 3,
      presidentMemberId: "mem_1",
      chancellorMemberId: "mem_4",
      presidentDiscardedPolicy: "FASCIST",
      chancellorEnactedPolicy: "LIBERAL",
      chancellorDiscardedPolicies: ["FASCIST"],
    },
  ], "normal enactment should complete the existing record");
  const resultPayload = settled.room_public_snapshots[room.roomId].payload;
  assert.deepStrictEqual(resultPayload.legislativeHistory, settledCore.legislativeHistory);
  assert.deepStrictEqual(
    Object.keys(resultPayload.legislativeHistory[0]).sort(),
    [
      "chancellorDiscardedPolicies",
      "chancellorEnactedPolicy",
      "chancellorMemberId",
      "presidentDiscardedPolicy",
      "presidentMemberId",
      "round",
    ].sort(),
    "result records should contain only the required raw facts",
  );
  assert.strictEqual(Object.prototype.hasOwnProperty.call(resultPayload.legislativeHistory[0], "outcome"), false);

  const retryResponse = await service.main({ action: "submitCommand", payload: enactPayload });
  assert.strictEqual(retryResponse.success, true, "same enactment retry should return the idempotent response");
  assert.deepStrictEqual(
    db.dump().game_core[gameCore.gameId].legislativeHistory,
    settledCore.legislativeHistory,
    "idempotent retry must not duplicate the legislative record",
  );
  assert.deepStrictEqual(
    Object.values(db.dump().user_profiles).map((profile) => profile.multiplayerGameCount),
    [0, 0, 0, 0, 0],
    "terminal persistence must defer personal statistics to maintenance",
  );
  const statEvents = db.dump().multiplayer_stat_events;
  assert.deepStrictEqual(Object.keys(statEvents), [gameCore.gameId], "idempotent retry must keep one game event");
  assert.strictEqual(statEvents[gameCore.gameId].players.length, 5);
}

async function assertVetoRequestAndRejectionDoNotCompleteRecord() {
  const db = createMemoryDb();
  const { service, setOpenId } = loadGameService({ db, openId: "openid_1" });
  const room = makeRoom("room_legislative_rejected", "game_legislative_rejected");
  const members = makeMembers(5, room.roomId);
  const gameCore = makeLegislativeCore(service, room, members, {
    vetoUnlocked: true,
  });
  await seedGame(db, service, room, members, gameCore);

  const discardResponse = await service.main({
    action: "submitCommand",
    payload: {
      roomId: room.roomId,
      expectedVersion: gameCore.version,
      commandId: "cmd_legislative_rejected_discard",
      type: "PRESIDENT_DISCARD_POLICY",
      taskId: taskId(service, gameCore, "PRESIDENT_DISCARD_POLICY", "mem_1"),
      body: { discardPolicyIndex: 0 },
    },
  });
  setOpenId("openid_4");
  const afterDiscard = db.dump().game_core[gameCore.gameId];
  const requestPayload = {
    roomId: room.roomId,
    expectedVersion: discardResponse.data.newVersion,
    commandId: "cmd_legislative_rejected_request",
    type: "CHANCELLOR_REQUEST_VETO",
    taskId: taskId(service, afterDiscard, "CHANCELLOR_ENACT_POLICY", "mem_4"),
    body: {},
  };
  const requestResponse = await service.main({ action: "submitCommand", payload: requestPayload });
  assert.strictEqual(requestResponse.success, true, "veto request should be accepted");
  const afterRequest = db.dump().game_core[gameCore.gameId];
  assert.deepStrictEqual(
    afterRequest.legislativeHistory,
    afterDiscard.legislativeHistory,
    "veto request must not change the legislative record",
  );

  setOpenId("openid_1");
  const rejectPayload = {
    roomId: room.roomId,
    expectedVersion: requestResponse.data.newVersion,
    commandId: "cmd_legislative_rejected_response",
    type: "PRESIDENT_RESPOND_VETO",
    taskId: taskId(service, afterRequest, "PRESIDENT_RESPOND_VETO", "mem_1"),
    body: { accepted: false },
  };
  const rejectResponse = await service.main({ action: "submitCommand", payload: rejectPayload });
  assert.strictEqual(rejectResponse.success, true, "veto rejection should be accepted");
  assert.deepStrictEqual(
    db.dump().game_core[gameCore.gameId].legislativeHistory,
    afterDiscard.legislativeHistory,
    "president rejection must leave the incomplete record unchanged",
  );
}

async function assertAcceptedVetoCompletesRecordAndEndsGame() {
  const db = createMemoryDb();
  const { service, setOpenId } = loadGameService({ db, openId: "openid_1" });
  const room = makeRoom("room_legislative_veto", "game_legislative_veto");
  const members = makeMembers(7, room.roomId);
  const gameCore = makeLegislativeCore(service, room, members, {
    fascistPolicyCount: 5,
    electionTracker: 2,
    vetoUnlocked: true,
  });
  await seedGame(db, service, room, members, gameCore);

  const discardResponse = await service.main({
    action: "submitCommand",
    payload: {
      roomId: room.roomId,
      expectedVersion: gameCore.version,
      commandId: "cmd_legislative_veto_discard",
      type: "PRESIDENT_DISCARD_POLICY",
      taskId: taskId(service, gameCore, "PRESIDENT_DISCARD_POLICY", "mem_1"),
      body: { discardPolicyIndex: 2 },
    },
  });
  const afterDiscard = db.dump().game_core[gameCore.gameId];
  assert.deepStrictEqual(afterDiscard.legislativeHistory[0].chancellorDiscardedPolicies, []);

  setOpenId("openid_4");
  const requestResponse = await service.main({
    action: "submitCommand",
    payload: {
      roomId: room.roomId,
      expectedVersion: discardResponse.data.newVersion,
      commandId: "cmd_legislative_veto_request",
      type: "CHANCELLOR_REQUEST_VETO",
      taskId: taskId(service, afterDiscard, "CHANCELLOR_ENACT_POLICY", "mem_4"),
      body: {},
    },
  });
  const afterRequest = db.dump().game_core[gameCore.gameId];
  assert.deepStrictEqual(
    afterRequest.legislativeHistory,
    afterDiscard.legislativeHistory,
    "veto request should not write either hidden card",
  );

  setOpenId("openid_1");
  const responsePayload = {
    roomId: room.roomId,
    expectedVersion: requestResponse.data.newVersion,
    commandId: "cmd_legislative_veto_response",
    type: "PRESIDENT_RESPOND_VETO",
    taskId: taskId(service, afterRequest, "PRESIDENT_RESPOND_VETO", "mem_1"),
    body: { accepted: true },
  };
  const response = await service.main({ action: "submitCommand", payload: responsePayload });
  assert.strictEqual(response.success, true, "accepted veto should be accepted");
  assert.strictEqual(response.data.routeHint, "result", "chaos policy victory should route to result");

  const settled = db.dump();
  const settledCore = settled.game_core[gameCore.gameId];
  assert.deepStrictEqual(settledCore.legislativeHistory[0], {
    round: 3,
    presidentMemberId: "mem_1",
    chancellorMemberId: "mem_4",
    presidentDiscardedPolicy: "LIBERAL",
    chancellorEnactedPolicy: null,
    chancellorDiscardedPolicies: ["FASCIST", "FASCIST"],
  }, "accepted veto should record both chancellor discards and no enactment");
  assert.strictEqual(settled.room_public_snapshots[room.roomId].payload.legislativeHistory[0].chancellorEnactedPolicy, null);
}

function assertResultAndPublicSnapshotBoundaries(service) {
  const room = makeRoom("room_legislative_projection", "game_legislative_projection");
  const members = makeMembers(5, room.roomId);
  const legislativeHistory = [
    {
      round: 3,
      presidentMemberId: "mem_1",
      chancellorMemberId: "mem_4",
      presidentDiscardedPolicy: "FASCIST",
      chancellorEnactedPolicy: "LIBERAL",
      chancellorDiscardedPolicies: ["FASCIST"],
      outcome: "must not escape",
    },
  ];
  const gameCore = {
    ...service.__testHooks.createInitialGameProjection(room, members, {
      gameId: room.currentGameId,
      createdAt: CREATED_AT,
      pickIndex: () => 0,
    }).gameCore,
    phase: "legislative_chancellor",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_4",
    policyState: {
      drawPile: ["FASCIST", "LIBERAL"],
      discardPile: [],
      presidentHand: null,
      chancellorHand: ["FASCIST", "LIBERAL"],
      peekPile: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_4",
      cards: ["FASCIST", "LIBERAL"],
      vetoAllowed: true,
    },
    legislativeHistory,
  };
  const publicPayload = service.__testHooks.buildPublicSnapshotPayload(room, gameCore, members, [], CREATED_AT);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicPayload, "legislativeHistory"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicPayload.publicState, "legislativeHistory"), false);

  const resultPayload = service.__testHooks.buildResultSnapshotPayload(
    room,
    { ...gameCore, status: "ended", phase: "game_ended", winner: "LIBERAL", winReason: "LIBERAL_POLICIES" },
    members,
    [],
    CREATED_AT,
    "mem_1",
  );
  assert.deepStrictEqual(resultPayload.legislativeHistory, [
    {
      round: 3,
      presidentMemberId: "mem_1",
      chancellorMemberId: "mem_4",
      presidentDiscardedPolicy: "FASCIST",
      chancellorEnactedPolicy: "LIBERAL",
      chancellorDiscardedPolicies: ["FASCIST"],
    },
  ], "result projection should strip non-contract fields from stored records");

  const legacyResultPayload = service.__testHooks.buildResultSnapshotPayload(
    room,
    { ...gameCore, legislativeHistory: [], status: "ended", phase: "game_ended" },
    members,
    [],
    CREATED_AT,
    "mem_1",
  );
  assert.deepStrictEqual(legacyResultPayload.legislativeHistory, [], "legacy games should return an empty history");
}

(async () => {
  await assertNormalEnactmentAndIdempotency();
  await assertVetoRequestAndRejectionDoNotCompleteRecord();
  await assertAcceptedVetoCompletesRecordAndEndsGame();
  const { service } = loadGameService();
  assertResultAndPublicSnapshotBoundaries(service);
  console.log("legislative history tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
