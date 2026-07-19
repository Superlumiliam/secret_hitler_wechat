const assert = require("assert");
const { createMemoryDb, loadRoomService } = require("../helpers/loadGameService");

const FUTURE_EXPIRE_AT = "2099-01-01T00:00:00.000Z";

function makeRoom(overrides = {}) {
  const roomId = overrides.roomId || "room_test";
  return {
    _id: roomId,
    roomId,
    roomCode: overrides.roomCode || "100001",
    mode: overrides.mode || "normal",
    status: overrides.status || "lobby",
    hostMemberId: overrides.hostMemberId || "mem_host",
    currentGameId: null,
    targetPlayerCount: overrides.targetPlayerCount || 5,
    playerCount: overrides.playerCount || 1,
    version: 1,
    createdByOpenId: overrides.createdByOpenId || "host_openid",
    expireAt: overrides.expireAt || FUTURE_EXPIRE_AT,
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    assetFileIds: [],
    ...overrides,
  };
}

function makeMember(overrides = {}) {
  const memberId = overrides.memberId || "mem_host";
  return {
    _id: memberId,
    memberId,
    roomId: overrides.roomId || "room_test",
    openId: overrides.openId || "host_openid",
    displayName: overrides.displayName || "房主",
    avatarUrl: "",
    seatIndex: overrides.seatIndex || 1,
    isHost: Boolean(overrides.isHost),
    isReady: Boolean(overrides.isReady),
    isVirtual: Boolean(overrides.isVirtual),
    controlledByOpenId: overrides.controlledByOpenId || "",
    memberStatus: overrides.memberStatus || "active",
    joinedAt: "2026-05-29T00:00:00.000Z",
    leftAt: null,
    lastSeenAt: "2026-05-29T00:00:00.000Z",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    ...overrides,
  };
}

async function assertNormalRoomRejectsSoloActions() {
  const db = createMemoryDb({
    rooms: {
      room_normal: makeRoom({
        roomId: "room_normal",
        roomCode: "200001",
        mode: "normal",
        hostMemberId: "mem_host",
      }),
    },
    room_members: {
      mem_host: makeMember({
        memberId: "mem_host",
        roomId: "room_normal",
        openId: "host_openid",
        isHost: true,
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "host_openid" });

  const cases = [
    {
      action: "soloFillVirtualPlayers",
      payload: {
        commandId: "cmd_normal_solo_fill",
        roomId: "room_normal",
      },
    },
    {
      action: "soloReadyAllVirtualPlayers",
      payload: {
        commandId: "cmd_normal_solo_ready_all",
        roomId: "room_normal",
      },
    },
    {
      action: "soloSetVirtualReady",
      payload: {
        commandId: "cmd_normal_solo_set_ready",
        roomId: "room_normal",
        memberId: "mem_host",
        isReady: true,
      },
    },
  ];

  for (const testCase of cases) {
    const response = await service.main(testCase);
    assert.strictEqual(response.success, false, `${testCase.action} should reject normal rooms`);
    assert.strictEqual(response.error.code, "ACTION_NOT_ALLOWED", `${testCase.action} should fail at mode boundary`);
    assert.match(response.error.message, /单人模式房间/, `${testCase.action} should report solo room requirement`);
  }

  const dump = db.dump();
  assert.strictEqual(Object.keys(dump.room_members).length, 1, "normal room should not gain virtual members");
  assert.strictEqual(dump.room_members.mem_host.isReady, false, "normal room member readiness should not be changed by solo action");
}

async function assertSoloRoomRejectsRealGuestJoin() {
  const db = createMemoryDb({
    rooms: {
      room_solo: makeRoom({
        roomId: "room_solo",
        roomCode: "300001",
        mode: "solo",
        hostMemberId: "mem_host",
        createdByOpenId: "host_openid",
      }),
    },
    room_members: {
      mem_host: makeMember({
        memberId: "mem_host",
        roomId: "room_solo",
        openId: "host_openid",
        isHost: true,
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "guest_openid" });

  const response = await service.main({
    action: "joinRoom",
    payload: {
      commandId: "cmd_join_solo_guest",
      roomCode: "300001",
      displayName: "来宾",
      avatarUrl: "",
    },
  });

  assert.strictEqual(response.success, false, "real guest should not join a solo room");
  assert.strictEqual(response.error.code, "ROOM_NOT_JOINABLE");
  assert.match(response.error.message, /单人模式房间不可加入/);
  assert.strictEqual(Object.keys(db.dump().room_members).length, 1, "solo room should not add guest member");
}

async function assertNonControllerRejectsVirtualSeatReady() {
  const db = createMemoryDb({
    rooms: {
      room_solo: makeRoom({
        roomId: "room_solo",
        roomCode: "400001",
        mode: "solo",
        hostMemberId: "mem_host",
        createdByOpenId: "host_openid",
        playerCount: 2,
      }),
    },
    room_members: {
      mem_host: makeMember({
        memberId: "mem_host",
        roomId: "room_solo",
        openId: "host_openid",
        isHost: true,
      }),
      mem_virtual: makeMember({
        memberId: "mem_virtual",
        roomId: "room_solo",
        openId: "",
        displayName: "虚拟玩家2",
        seatIndex: 2,
        isVirtual: true,
        controlledByOpenId: "other_openid",
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "host_openid" });

  const response = await service.main({
    action: "soloSetVirtualReady",
    payload: {
      commandId: "cmd_non_controller_set_ready",
      roomId: "room_solo",
      memberId: "mem_virtual",
      isReady: true,
    },
  });

  assert.strictEqual(response.success, false, "host should not ready a virtual seat controlled by another openid");
  assert.strictEqual(response.error.code, "INVALID_TARGET");
  assert.match(response.error.message, /虚拟玩家/);
  assert.strictEqual(db.dump().room_members.mem_virtual.isReady, false, "virtual seat readiness should not change");
}

async function assertHostCanUpdateRoomSettingsWithoutChangingSeats() {
  const db = createMemoryDb({
    rooms: {
      room_settings: makeRoom({
        roomId: "room_settings",
        roomCode: "500001",
        targetPlayerCount: 5,
        playerCount: 3,
        hostMemberId: "mem_host",
      }),
    },
    room_members: {
      mem_host: makeMember({
        memberId: "mem_host",
        roomId: "room_settings",
        openId: "host_openid",
        isHost: true,
        seatIndex: 1,
        isReady: true,
      }),
      mem_guest_2: makeMember({
        memberId: "mem_guest_2",
        roomId: "room_settings",
        openId: "guest_2_openid",
        displayName: "玩家2",
        seatIndex: 2,
        isReady: true,
      }),
      mem_guest_3: makeMember({
        memberId: "mem_guest_3",
        roomId: "room_settings",
        openId: "guest_3_openid",
        displayName: "玩家3",
        seatIndex: 3,
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "host_openid" });

  const response = await service.main({
    action: "updateRoomSettings",
    payload: {
      commandId: "cmd_update_room_settings_success",
      roomId: "room_settings",
      targetPlayerCount: 7,
    },
  });

  assert.strictEqual(response.success, true, "host should update room settings");
  assert.strictEqual(response.data.lobbySnapshot.targetPlayerCount, 7, "lobby snapshot should reflect the new target count");

  const dump = db.dump();
  assert.strictEqual(dump.rooms.room_settings.targetPlayerCount, 7, "room target count should be updated");
  assert.strictEqual(dump.rooms.room_settings.roomCode, "500001", "room code should not change");
  assert.strictEqual(dump.rooms.room_settings.hostMemberId, "mem_host", "host should not change");
  assert.strictEqual(dump.room_members.mem_host.seatIndex, 1, "host seat should stay unchanged");
  assert.strictEqual(dump.room_members.mem_guest_2.seatIndex, 2, "guest 2 seat should stay unchanged");
  assert.strictEqual(dump.room_members.mem_guest_3.seatIndex, 3, "guest 3 seat should stay unchanged");
  assert.strictEqual(dump.room_members.mem_host.isReady, true, "ready state should stay unchanged");
}

async function assertNonHostCannotUpdateRoomSettings() {
  const db = createMemoryDb({
    rooms: {
      room_settings: makeRoom({
        roomId: "room_settings",
        roomCode: "500002",
        targetPlayerCount: 5,
        playerCount: 2,
        hostMemberId: "mem_host",
      }),
    },
    room_members: {
      mem_host: makeMember({
        memberId: "mem_host",
        roomId: "room_settings",
        openId: "host_openid",
        isHost: true,
        seatIndex: 1,
      }),
      mem_guest: makeMember({
        memberId: "mem_guest",
        roomId: "room_settings",
        openId: "guest_openid",
        displayName: "玩家2",
        seatIndex: 2,
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "guest_openid" });

  const response = await service.main({
    action: "updateRoomSettings",
    payload: {
      commandId: "cmd_update_room_settings_non_host",
      roomId: "room_settings",
      targetPlayerCount: 7,
    },
  });

  assert.strictEqual(response.success, false, "non-host should not update room settings");
  assert.strictEqual(response.error.code, "NOT_ROOM_HOST");
  assert.strictEqual(db.dump().rooms.room_settings.targetPlayerCount, 5, "target count should not change");
}

async function assertRoomSettingsRejectsTargetBelowSeatedPlayers() {
  const members = {};
  for (let seatIndex = 1; seatIndex <= 6; seatIndex += 1) {
    const memberId = seatIndex === 1 ? "mem_host" : `mem_guest_${seatIndex}`;
    members[memberId] = makeMember({
      memberId,
      roomId: "room_settings",
      openId: seatIndex === 1 ? "host_openid" : `guest_${seatIndex}_openid`,
      displayName: seatIndex === 1 ? "房主" : `玩家${seatIndex}`,
      seatIndex,
      isHost: seatIndex === 1,
    });
  }

  const db = createMemoryDb({
    rooms: {
      room_settings: makeRoom({
        roomId: "room_settings",
        roomCode: "500003",
        targetPlayerCount: 8,
        playerCount: 6,
        hostMemberId: "mem_host",
      }),
    },
    room_members: members,
  });
  const { service } = loadRoomService({ db, openId: "host_openid" });

  const response = await service.main({
    action: "updateRoomSettings",
    payload: {
      commandId: "cmd_update_room_settings_too_small",
      roomId: "room_settings",
      targetPlayerCount: 5,
    },
  });

  assert.strictEqual(response.success, false, "target count below seated players should be rejected");
  assert.strictEqual(response.error.code, "TARGET_COUNT_BELOW_SEATED");
  assert.strictEqual(db.dump().rooms.room_settings.targetPlayerCount, 8, "target count should stay unchanged");
}

async function assertLobbyReadTouchesPresenceOnlyWhenRequested() {
  const db = createMemoryDb({
    rooms: {
      room_polling: makeRoom({
        roomId: "room_polling",
        roomCode: "500004",
      }),
    },
    room_members: {
      mem_host: makeMember({
        memberId: "mem_host",
        roomId: "room_polling",
        openId: "host_openid",
        isHost: true,
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "host_openid" });
  const event = {
    action: "getLobbySnapshot",
    payload: {
      roomId: "room_polling",
    },
  };

  const firstResponse = await service.main(event);
  const statsAfterFirstRead = db.stats();
  const secondResponse = await service.main(event);
  const statsAfterSecondRead = db.stats();

  assert.strictEqual(firstResponse.success, true);
  assert.strictEqual(secondResponse.success, true);
  assert.strictEqual(statsAfterFirstRead.docGets.rooms, 1, "lobby snapshot should read the room only once");
  assert.strictEqual(statsAfterSecondRead.docGets.rooms, 2, "each lobby snapshot should add only one room read");
  assert.strictEqual(
    statsAfterSecondRead.queryGets.room_members,
    statsAfterFirstRead.queryGets.room_members + 1,
    "each lobby snapshot should only query members once",
  );
  assert.strictEqual(
    statsAfterSecondRead.docUpdates.room_members,
    statsAfterFirstRead.docUpdates.room_members,
    "ordinary snapshot reads should not write presence",
  );

  const touchResponse = await service.main({
    ...event,
    payload: {
      ...event.payload,
      touchPresence: true,
    },
  });
  const statsAfterTouch = db.stats();
  assert.strictEqual(touchResponse.success, true);
  assert.strictEqual(
    statsAfterTouch.queryGets.room_members,
    statsAfterSecondRead.queryGets.room_members + 1,
    "presence touch should reuse the lobby member query",
  );
  assert.strictEqual(
    statsAfterTouch.docUpdates.room_members,
    (statsAfterSecondRead.docUpdates.room_members || 0) + 1,
    "explicit presence touch should write the resolved member once",
  );
}

(async () => {
  await assertNormalRoomRejectsSoloActions();
  await assertSoloRoomRejectsRealGuestJoin();
  await assertNonControllerRejectsVirtualSeatReady();
  await assertHostCanUpdateRoomSettingsWithoutChangingSeats();
  await assertNonHostCannotUpdateRoomSettings();
  await assertRoomSettingsRejectsTargetBelowSeatedPlayers();
  await assertLobbyReadTouchesPresenceOnlyWhenRequested();
  console.log("roomService isolation tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
