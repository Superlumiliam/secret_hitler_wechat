const assert = require("assert");
const { createMemoryDb, loadGameService, loadRoomService } = require("./helpers/loadGameService");

const FUTURE_EXPIRE_AT = "2099-01-01T00:00:00.000Z";

function makeRoom(overrides = {}) {
  return {
    _id: "room_spectator",
    roomId: "room_spectator",
    roomCode: "424242",
    mode: "normal",
    status: "lobby",
    hostMemberId: "mem_1",
    currentGameId: null,
    targetPlayerCount: 5,
    playerCount: 5,
    version: 1,
    createdByOpenId: "openid_1",
    expireAt: FUTURE_EXPIRE_AT,
    assetFileIds: [],
    ...overrides,
  };
}

function makeMember(index, overrides = {}) {
  const memberId = overrides.memberId || `mem_${index}`;
  return {
    _id: memberId,
    memberId,
    roomId: overrides.roomId || "room_spectator",
    openId: overrides.openId === undefined ? `openid_${index}` : overrides.openId,
    displayName: overrides.displayName || `玩家${index}`,
    avatarUrl: "",
    seatIndex: index,
    memberType: "player",
    isHost: index === 1,
    isReady: true,
    isVirtual: false,
    memberStatus: "active",
    joinedAt: `2026-07-27T00:00:0${Math.min(index, 9)}.000Z`,
    lastSeenAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function createFullLobbyDb(extra = {}) {
  const targetPlayerCount = Number(extra.room && extra.room.targetPlayerCount) || 5;
  const members = {};
  for (let index = 1; index <= targetPlayerCount; index += 1) {
    const member = makeMember(index);
    members[member.memberId] = member;
  }
  return createMemoryDb({
    rooms: {
      room_spectator: makeRoom({
        playerCount: targetPlayerCount,
        ...(extra.room || {}),
      }),
    },
    room_members: {
      ...members,
      ...(extra.members || {}),
    },
  });
}

function joinEvent(commandId) {
  return {
    action: "joinRoom",
    payload: {
      commandId,
      roomCode: "424242",
      displayName: "观战来宾",
      avatarUrl: "",
    },
  };
}

async function assertLobbyJoinFillsThreeSpectatorSeats() {
  const db = createFullLobbyDb({
    room: {
      targetPlayerCount: 10,
      playerCount: 10,
    },
  });
  const joinPromises = [];
  for (let index = 1; index <= 4; index += 1) {
    const { service } = loadRoomService({ db, openId: `spectator_${index}` });
    joinPromises.push(service.main(joinEvent(`cmd_join_spectator_${index}`)));
  }
  const responses = await Promise.all(joinPromises);
  const successfulResponses = responses.filter((response) => response.success);
  const rejectedResponses = responses.filter((response) => !response.success);
  const assignedSeats = successfulResponses.map(
    (response) => db.dump().room_members[response.data.memberId].seatIndex,
  );

  for (const response of successfulResponses) {
    assert.strictEqual(response.data.memberType, "spectator");
    assert.strictEqual(response.data.routeHint, "lobby");
  }
  assert.strictEqual(successfulResponses.length, 3);
  assert.strictEqual(rejectedResponses.length, 1);
  assert.strictEqual(rejectedResponses[0].error.code, "SPECTATOR_SEATS_FULL");

  const dump = db.dump();
  assert.deepStrictEqual(assignedSeats, [1, 2, 3]);
  assert.strictEqual(dump.rooms.room_spectator.playerCount, 10);
  const spectatorMembers = Object.values(dump.room_members).filter(
    (member) => member.memberStatus === "active" && member.memberType === "spectator",
  );
  assert.strictEqual(spectatorMembers.length, 3);
  assert.strictEqual(
    Object.values(dump.room_members).filter((member) => member.memberStatus === "active").length,
    13,
  );
}

async function assertLobbyJoinPrefersPlayerGapOverExistingSpectator() {
  const room = makeRoom({
    playerCount: 4,
  });
  const members = {};
  for (let index = 1; index <= 4; index += 1) {
    const member = makeMember(index);
    members[member.memberId] = member;
  }
  members.mem_existing_spectator = makeMember(1, {
    memberId: "mem_existing_spectator",
    openId: "existing_spectator",
    memberType: "spectator",
    isHost: false,
    isReady: false,
  });
  const db = createMemoryDb({
    rooms: {
      room_spectator: room,
    },
    room_members: members,
  });

  const playerService = loadRoomService({ db, openId: "new_player" }).service;
  const playerResponse = await playerService.main(joinEvent("cmd_join_player_gap"));
  assert.strictEqual(playerResponse.success, true);
  assert.strictEqual(playerResponse.data.memberType, "player");
  assert.strictEqual(db.dump().room_members[playerResponse.data.memberId].seatIndex, 5);
  assert.strictEqual(
    db.dump().room_members.mem_existing_spectator.memberType,
    "spectator",
    "existing spectators must not be promoted into a player gap",
  );

  const spectatorService = loadRoomService({ db, openId: "next_spectator" }).service;
  const spectatorResponse = await spectatorService.main(joinEvent("cmd_join_after_players_full"));
  assert.strictEqual(spectatorResponse.success, true);
  assert.strictEqual(spectatorResponse.data.memberType, "spectator");
  assert.strictEqual(db.dump().room_members[spectatorResponse.data.memberId].seatIndex, 2);
}

async function assertConcurrentCrossTypeClaimsCannotDuplicateSeat() {
  const db = createMemoryDb({
    rooms: {
      room_spectator: makeRoom({
        hostMemberId: "mem_1",
        playerCount: 2,
      }),
    },
    room_members: {
      mem_1: makeMember(1),
      mem_2: makeMember(2),
    },
  });
  const firstService = loadRoomService({ db, openId: "openid_1" }).service;
  const secondService = loadRoomService({ db, openId: "openid_2" }).service;
  const responses = await Promise.all([
    firstService.main({
      action: "claimLobbySeat",
      payload: {
        commandId: "cmd_claim_same_spectator_1",
        roomId: "room_spectator",
        targetMemberType: "spectator",
        targetSeatIndex: 1,
      },
    }),
    secondService.main({
      action: "claimLobbySeat",
      payload: {
        commandId: "cmd_claim_same_spectator_2",
        roomId: "room_spectator",
        targetMemberType: "spectator",
        targetSeatIndex: 1,
      },
    }),
  ]);

  assert.strictEqual(responses.filter((response) => response.success).length, 1);
  assert.strictEqual(
    responses.filter((response) => !response.success)[0].error.code,
    "SEAT_OCCUPIED",
  );
  const dump = db.dump();
  assert.strictEqual(
    Object.values(dump.room_members).filter(
      (member) =>
        member.memberStatus === "active" &&
        member.memberType === "spectator" &&
        member.seatIndex === 1,
    ).length,
    1,
  );
  assert.strictEqual(dump.rooms.room_spectator.playerCount, 1);
}

async function assertCrossTypeClaimResetsReadyAndPlayerCount() {
  const db = createMemoryDb({
    rooms: {
      room_spectator: makeRoom({
        hostMemberId: "mem_1",
        playerCount: 1,
      }),
    },
    room_members: {
      mem_1: makeMember(1),
    },
  });
  const { service } = loadRoomService({ db, openId: "openid_1" });

  const spectatorResponse = await service.main({
    action: "claimLobbySeat",
    payload: {
      commandId: "cmd_claim_spectator",
      roomId: "room_spectator",
      targetMemberType: "spectator",
      targetSeatIndex: 2,
    },
  });
  assert.strictEqual(spectatorResponse.success, true);
  assert.strictEqual(spectatorResponse.data.playerCount, 0);
  assert.strictEqual(spectatorResponse.data.spectatorCount, 1);
  assert.strictEqual(spectatorResponse.data.viewerState.myMemberType, "spectator");
  assert.strictEqual(db.dump().room_members.mem_1.isReady, false);

  const playerResponse = await service.main({
    action: "claimLobbySeat",
    payload: {
      commandId: "cmd_claim_player",
      roomId: "room_spectator",
      targetMemberType: "player",
      targetSeatIndex: 3,
    },
  });
  assert.strictEqual(playerResponse.success, true);
  assert.strictEqual(playerResponse.data.playerCount, 1);
  assert.strictEqual(playerResponse.data.spectatorCount, 0);
  assert.strictEqual(playerResponse.data.viewerState.myMemberType, "player");
  assert.strictEqual(db.dump().room_members.mem_1.isReady, false);
}

async function assertInGameJoinCreatesSpectatorAndRestoresOfflinePlayer() {
  const db = createFullLobbyDb({
    room: {
      status: "in_game",
      currentGameId: "game_spectator",
      version: 11,
    },
    members: {
      mem_offline: makeMember(6, {
        memberId: "mem_offline",
        openId: "returning_openid",
        seatIndex: 4,
        memberStatus: "offline",
      }),
    },
  });
  await db.collection("room_public_snapshots").doc("room_spectator").set({
    data: {
      roomId: "room_spectator",
      version: 1,
      payload: {
        version: 1,
      },
    },
  });

  const newViewerService = loadRoomService({ db, openId: "late_viewer" }).service;
  const viewerResponse = await newViewerService.main(joinEvent("cmd_join_late_viewer"));
  assert.strictEqual(viewerResponse.success, true);
  assert.strictEqual(viewerResponse.data.memberType, "spectator");
  assert.strictEqual(viewerResponse.data.routeHint, "board");
  assert.strictEqual(viewerResponse.data.lobbySnapshot, null);
  assert.strictEqual(db.dump().rooms.room_spectator.version, 11);
  assert.strictEqual(
    db.dump().room_sync_signals.room_spectator.version,
    1,
    "in-game signals must follow the public game snapshot instead of the independent room version",
  );

  const returningService = loadRoomService({ db, openId: "returning_openid" }).service;
  const returningResponse = await returningService.main(joinEvent("cmd_rejoin_player"));
  assert.strictEqual(returningResponse.success, true);
  assert.strictEqual(returningResponse.data.memberId, "mem_offline");
  assert.strictEqual(returningResponse.data.memberType, "player");
  assert.strictEqual(returningResponse.data.routeHint, "board");
  assert.strictEqual(db.dump().room_members.mem_offline.memberStatus, "active");
  assert.strictEqual(db.dump().room_sync_signals.room_spectator.version, 1);
}

async function assertSoloFillOnlyCreatesPlayers() {
  const room = makeRoom({
    mode: "solo",
    hostMemberId: "mem_host",
    createdByOpenId: "solo_host",
    playerCount: 0,
  });
  const db = createMemoryDb({
    rooms: {
      room_spectator: room,
    },
    room_members: {
      mem_host: makeMember(1, {
        memberId: "mem_host",
        openId: "solo_host",
        memberType: "spectator",
        seatIndex: 1,
        isHost: true,
        isReady: false,
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "solo_host" });

  const response = await service.main({
    action: "soloFillVirtualPlayers",
    payload: {
      commandId: "cmd_solo_fill_spectator_host",
      roomId: room.roomId,
    },
  });

  assert.strictEqual(response.success, true);
  assert.strictEqual(response.data.playerCount, 5);
  assert.strictEqual(response.data.spectatorCount, 1);
  const activeMembers = Object.values(db.dump().room_members).filter(
    (member) => member.memberStatus === "active",
  );
  assert.strictEqual(activeMembers.filter((member) => member.memberType === "player").length, 5);
  assert.strictEqual(activeMembers.filter((member) => member.memberType === "spectator").length, 1);
}

async function assertActiveSpectatorLeaveReleasesSeat() {
  const db = createFullLobbyDb({
    room: {
      status: "in_game",
      currentGameId: "game_leave",
    },
    members: {
      mem_viewer: makeMember(1, {
        memberId: "mem_viewer",
        openId: "viewer_openid",
        memberType: "spectator",
        seatIndex: 1,
        isHost: false,
        isReady: false,
      }),
    },
  });
  const leavingService = loadRoomService({ db, openId: "viewer_openid" }).service;
  const leaveResponse = await leavingService.main({
    action: "leaveRoom",
    payload: {
      commandId: "cmd_leave_spectator",
      roomId: "room_spectator",
    },
  });
  assert.strictEqual(leaveResponse.success, true);
  assert.strictEqual(leaveResponse.data.leaveMode, "removed_spectator");
  assert.strictEqual(db.dump().room_members.mem_viewer.memberStatus, "left");
  assert.strictEqual(
    db.dump().room_sync_signals.room_spectator.version,
    db.dump().rooms.room_spectator.version,
    "in-game signals may fall back to the room version only when the public snapshot is missing",
  );

  const joiningService = loadRoomService({ db, openId: "replacement_viewer" }).service;
  const joinResponse = await joiningService.main(joinEvent("cmd_join_replacement_viewer"));
  assert.strictEqual(joinResponse.success, true);
  assert.strictEqual(joinResponse.data.memberType, "spectator");
  assert.strictEqual(db.dump().room_members[joinResponse.data.memberId].seatIndex, 1);
}

async function assertLobbySpectatorHostTransfersToLowestPlayer() {
  const db = createMemoryDb({
    rooms: {
      room_spectator: makeRoom({
        hostMemberId: "mem_spectator_host",
        playerCount: 2,
      }),
    },
    room_members: {
      mem_player_1: makeMember(1, {
        memberId: "mem_player_1",
        openId: "player_1",
        isHost: false,
      }),
      mem_player_3: makeMember(3, {
        memberId: "mem_player_3",
        openId: "player_3",
        isHost: false,
      }),
      mem_spectator_host: makeMember(1, {
        memberId: "mem_spectator_host",
        openId: "spectator_host",
        memberType: "spectator",
        isHost: true,
        isReady: false,
      }),
      mem_spectator_3: makeMember(3, {
        memberId: "mem_spectator_3",
        openId: "spectator_3",
        memberType: "spectator",
        isHost: false,
        isReady: false,
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "spectator_host" });
  const response = await service.main({
    action: "leaveRoom",
    payload: {
      commandId: "cmd_leave_lobby_spectator_host",
      roomId: "room_spectator",
    },
  });

  assert.strictEqual(response.success, true);
  assert.strictEqual(response.data.newHostMemberId, "mem_player_1");
  const dump = db.dump();
  assert.strictEqual(dump.rooms.room_spectator.hostMemberId, "mem_player_1");
  assert.strictEqual(dump.room_members.mem_player_1.isHost, true);
  assert.strictEqual(dump.room_members.mem_player_3.seatIndex, 2);
  assert.strictEqual(
    dump.room_members.mem_spectator_3.seatIndex,
    3,
    "spectator seats must remain sparse when another spectator leaves",
  );
}

async function assertSpectatorHostStartsWithoutPrivateSnapshot() {
  const room = makeRoom({
    hostMemberId: "mem_host",
    createdByOpenId: "host_openid",
  });
  const members = {};
  for (let index = 1; index <= 5; index += 1) {
    const member = makeMember(index);
    members[member.memberId] = member;
  }
  members.mem_host = makeMember(1, {
    memberId: "mem_host",
    openId: "host_openid",
    memberType: "spectator",
    seatIndex: 1,
    isHost: true,
    isReady: false,
  });
  const db = createMemoryDb({
    rooms: {
      room_spectator: room,
    },
    room_members: members,
  });
  const { service } = loadGameService({ db, openId: "host_openid" });

  const response = await service.main({
    action: "startGame",
    payload: {
      commandId: "cmd_start_spectator_host",
      roomId: room.roomId,
    },
  });
  assert.strictEqual(response.success, true);

  const dump = db.dump();
  const gameCore = Object.values(dump.game_core)[0];
  assert.strictEqual(gameCore.playerCount, 5);
  assert.strictEqual(Object.keys(gameCore.roleAssignments).length, 5);
  assert.strictEqual(Object.keys(dump.player_private_snapshots).length, 5);
  assert.strictEqual(dump.player_private_snapshots.mem_host, undefined);
  assert.strictEqual(dump.room_public_snapshots[room.roomId].payload.publicState.seatOrder.length, 5);

  const snapshotResponse = await service.main({
    action: "getGameSnapshot",
    payload: {
      roomId: room.roomId,
    },
  });
  assert.strictEqual(snapshotResponse.success, true);
  assert.strictEqual(snapshotResponse.data.viewerState.realMemberType, "spectator");
  assert.strictEqual(snapshotResponse.data.viewerState.isSpectatorView, true);
  assert.strictEqual(snapshotResponse.data.viewerState.hasPrivateView, false);
  assert.deepStrictEqual(snapshotResponse.data.privateState, {});
  assert.strictEqual(snapshotResponse.data.pendingTask, null);

  const forgedSnapshotResponse = await service.main({
    action: "getGameSnapshot",
    payload: {
      roomId: room.roomId,
      controlledMemberId: "mem_1",
    },
  });
  assert.strictEqual(forgedSnapshotResponse.success, false);
  assert.strictEqual(forgedSnapshotResponse.error.code, "ACTION_NOT_ALLOWED");

  const commandResponse = await service.main({
    action: "submitCommand",
    payload: {
      commandId: "cmd_spectator_vote",
      roomId: room.roomId,
      expectedVersion: snapshotResponse.data.version,
      type: "SUBMIT_VOTE",
      body: {
        vote: "JA",
      },
    },
  });
  assert.strictEqual(commandResponse.success, false);
  assert.strictEqual(commandResponse.error.code, "ACTION_NOT_ALLOWED");
}

async function assertSoloSpectatorCanControlVirtualPlayer() {
  const room = makeRoom({
    mode: "solo",
    hostMemberId: "mem_host",
    createdByOpenId: "solo_host",
    playerCount: 5,
  });
  const members = {
    mem_host: makeMember(1, {
      memberId: "mem_host",
      openId: "solo_host",
      memberType: "spectator",
      seatIndex: 1,
      isHost: true,
      isReady: false,
    }),
  };
  for (let index = 1; index <= 5; index += 1) {
    const memberId = `mem_virtual_${index}`;
    members[memberId] = makeMember(index, {
      memberId,
      openId: "",
      displayName: `虚拟玩家${index}`,
      memberType: "player",
      isHost: false,
      isReady: true,
      isVirtual: true,
      controlledByOpenId: "solo_host",
    });
  }
  const db = createMemoryDb({
    rooms: {
      room_spectator: room,
    },
    room_members: members,
  });
  const { service } = loadGameService({ db, openId: "solo_host" });
  const startResponse = await service.main({
    action: "startGame",
    payload: {
      commandId: "cmd_start_solo_spectator",
      roomId: room.roomId,
    },
  });
  assert.strictEqual(startResponse.success, true);

  const publicResponse = await service.main({
    action: "getGameSnapshot",
    payload: {
      roomId: room.roomId,
    },
  });
  assert.strictEqual(publicResponse.success, true);
  assert.strictEqual(publicResponse.data.viewerState.isSpectatorView, true);

  const controlledResponse = await service.main({
    action: "getGameSnapshot",
    payload: {
      roomId: room.roomId,
      controlledMemberId: "mem_virtual_1",
    },
  });
  assert.strictEqual(controlledResponse.success, true);
  assert.strictEqual(controlledResponse.data.viewerState.realMemberType, "spectator");
  assert.strictEqual(controlledResponse.data.viewerState.isSpectatorView, false);
  assert.strictEqual(controlledResponse.data.viewerState.hasPrivateView, true);
  assert.strictEqual(controlledResponse.data.myMemberId, "mem_virtual_1");
  assert(controlledResponse.data.privateState.identity.role);
}

async function assertSpectatorCanReadPlayerOnlyResult() {
  const db = createMemoryDb();
  const { service } = loadGameService({ db, openId: "result_viewer" });
  const room = makeRoom({
    status: "ended",
    currentGameId: "game_result",
  });
  const players = Array.from({ length: 5 }, (_, index) => makeMember(index + 1));
  const projection = service.__testHooks.createInitialGameProjection(room, players, {
    gameId: "game_result",
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const endedCore = {
    ...projection.gameCore,
    status: "ended",
    phase: "game_ended",
    winner: "LIBERAL",
    winReason: "HITLER_EXECUTED",
    endedAt: new Date("2026-07-27T00:10:00.000Z"),
  };
  const resultPayload = service.__testHooks.buildResultSnapshotPayload(
    room,
    endedCore,
    players,
    [],
    new Date("2026-07-27T00:10:00.000Z"),
  );

  await db.collection("rooms").doc(room.roomId).set({ data: room });
  for (const player of players) {
    await db.collection("room_members").doc(player.memberId).set({ data: player });
  }
  await db.collection("room_members").doc("mem_result_viewer").set({
    data: makeMember(1, {
      memberId: "mem_result_viewer",
      openId: "result_viewer",
      memberType: "spectator",
      seatIndex: 1,
      isHost: false,
      isReady: false,
    }),
  });
  await db.collection("room_public_snapshots").doc(room.roomId).set({
    data: {
      roomId: room.roomId,
      snapshotType: "result_public",
      payload: resultPayload,
    },
  });

  const response = await service.main({
    action: "getResultSnapshot",
    payload: {
      roomId: room.roomId,
    },
  });
  assert.strictEqual(response.success, true);
  assert.strictEqual(response.data.myMemberId, "mem_result_viewer");
  assert.strictEqual(response.data.finalPlayers.length, 5);
  assert(response.data.finalPlayers.every((player) => player.memberId !== "mem_result_viewer"));
}

(async () => {
  await assertLobbyJoinFillsThreeSpectatorSeats();
  await assertLobbyJoinPrefersPlayerGapOverExistingSpectator();
  await assertConcurrentCrossTypeClaimsCannotDuplicateSeat();
  await assertCrossTypeClaimResetsReadyAndPlayerCount();
  await assertInGameJoinCreatesSpectatorAndRestoresOfflinePlayer();
  await assertSoloFillOnlyCreatesPlayers();
  await assertActiveSpectatorLeaveReleasesSeat();
  await assertLobbySpectatorHostTransfersToLowestPlayer();
  await assertSpectatorHostStartsWithoutPrivateSnapshot();
  await assertSoloSpectatorCanControlVirtualPlayer();
  await assertSpectatorCanReadPlayerOnlyResult();
  console.log("spectator mode tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
