const assert = require("assert");
const { createMemoryDb, loadBootstrapService } = require("../helpers/loadGameService");

const FUTURE_EXPIRE_AT = "2099-01-01T00:00:00.000Z";
const PAST_EXPIRE_AT = "2000-01-01T00:00:00.000Z";

function createRoom(roomId, status, expireAt = FUTURE_EXPIRE_AT) {
  return {
    _id: roomId,
    roomId,
    roomCode: roomId.slice(-6).padStart(6, "0"),
    status,
    version: 3,
    currentGameId: null,
    expireAt,
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
}

function createMember(memberId, roomId, memberStatus = "active") {
  return {
    _id: memberId,
    memberId,
    roomId,
    openId: "openid_1",
    memberStatus,
    isVirtual: false,
    lastSeenAt: "2026-07-26T00:00:00.000Z",
  };
}

function createProfile(overrides = {}) {
  return {
    _id: "openid_1",
    openid: "openid_1",
    profileCompleted: true,
    activeRoomId: null,
    activeMemberId: null,
    activeRoomStatus: null,
    ...overrides,
  };
}

async function recover(initialData) {
  const db = createMemoryDb(initialData);
  const { service } = loadBootstrapService({ db, openId: "openid_1" });
  const response = await service.main({
    action: "recoverActiveRoom",
    payload: {},
  });
  return { db, response, service };
}

function blockFirstRecoveryWrite(db) {
  const originalCollection = db.collection.bind(db);
  const originalRunTransaction = db.runTransaction.bind(db);
  let isBlocked = false;
  let releaseWrite;
  let reportBlocked;
  const blocked = new Promise((resolve) => {
    reportBlocked = resolve;
  });
  const release = new Promise((resolve) => {
    releaseWrite = resolve;
  });

  async function blockOnce() {
    if (isBlocked) {
      return;
    }
    isBlocked = true;
    reportBlocked();
    await release;
  }

  db.collection = (name) => {
    const collection = originalCollection(name);
    if (name !== "user_profiles") {
      return collection;
    }
    return {
      ...collection,
      doc(id) {
        const document = collection.doc(id);
        return {
          ...document,
          async update({ data }) {
            if (data && data.activeRoomId) {
              await blockOnce();
            }
            return await document.update({ data });
          },
        };
      },
    };
  };
  db.runTransaction = async (handler) => {
    await blockOnce();
    return await originalRunTransaction(handler);
  };

  return {
    blocked,
    release() {
      releaseWrite();
    },
  };
}

async function assertEmptyRecovery() {
  const { response } = await recover({});
  assert.strictEqual(response.success, true);
  assert.deepStrictEqual(response.data.user, { sessionReady: true });
  assert.strictEqual(response.data.activeRoom, null);
}

async function assertExistingEndedAnchorStillRecovers() {
  const room = createRoom("room_ended", "ended");
  const member = createMember("mem_ended", room.roomId);
  const { response } = await recover({
    rooms: { [room.roomId]: room },
    room_members: { [member.memberId]: member },
    user_profiles: {
      openid_1: createProfile({
        activeRoomId: room.roomId,
        activeMemberId: member.memberId,
        activeRoomStatus: "ended",
      }),
    },
  });
  assert.strictEqual(response.data.activeRoom.roomId, room.roomId);
  assert.strictEqual(response.data.activeRoom.routeHint, "result");
}

async function assertUniqueActiveMembershipRepairsMissingAnchor() {
  const room = createRoom("room_active", "in_game");
  const member = createMember("mem_active", room.roomId);
  const { db, response } = await recover({
    rooms: { [room.roomId]: room },
    room_members: { [member.memberId]: member },
    user_profiles: { openid_1: createProfile() },
  });
  assert.strictEqual(response.data.activeRoom.roomId, room.roomId);
  assert.strictEqual(response.data.activeRoom.routeHint, "board");
  const profile = db.dump().user_profiles.openid_1;
  assert.strictEqual(profile.activeRoomId, room.roomId);
  assert.strictEqual(profile.activeMemberId, member.memberId);
  assert.strictEqual(profile.activeRoomStatus, "in_game");
  assert(db.stats().transactions >= 1, "anchor repair must revalidate inside a transaction");
}

async function assertInvalidAnchorRepairsToUniqueActiveMembership() {
  const room = createRoom("room_repaired", "lobby");
  const member = createMember("mem_repaired", room.roomId);
  const { db, response } = await recover({
    rooms: { [room.roomId]: room },
    room_members: { [member.memberId]: member },
    user_profiles: {
      openid_1: createProfile({
        activeRoomId: "room_missing",
        activeMemberId: "mem_missing",
        activeRoomStatus: "in_game",
      }),
    },
  });
  assert.strictEqual(response.data.activeRoom.roomId, room.roomId);
  assert.strictEqual(response.data.activeRoom.routeHint, "lobby");
  assert.strictEqual(db.dump().user_profiles.openid_1.activeRoomId, room.roomId);
}

async function assertUnsafeCandidatesAreNotRepaired() {
  const cases = [
    {
      label: "offline member",
      room: createRoom("room_offline", "in_game"),
      member: createMember("mem_offline", "room_offline", "offline"),
    },
    {
      label: "ended room",
      room: createRoom("room_result", "ended"),
      member: createMember("mem_result", "room_result"),
    },
    {
      label: "expired room",
      room: createRoom("room_expired", "in_game", PAST_EXPIRE_AT),
      member: createMember("mem_expired", "room_expired"),
    },
    {
      label: "virtual member",
      room: createRoom("room_virtual", "in_game"),
      member: {
        ...createMember("mem_virtual", "room_virtual"),
        isVirtual: true,
      },
    },
  ];

  for (const item of cases) {
    const { db, response } = await recover({
      rooms: { [item.room.roomId]: item.room },
      room_members: { [item.member.memberId]: item.member },
      user_profiles: { openid_1: createProfile() },
    });
    assert.strictEqual(response.data.activeRoom, null, `${item.label} must not be repaired`);
    assert.strictEqual(db.dump().user_profiles.openid_1.activeRoomId, null);
  }
}

async function assertMultipleCandidatesAreNotRepaired() {
  const firstRoom = createRoom("room_first", "lobby");
  const secondRoom = createRoom("room_second", "in_game");
  const firstMember = createMember("mem_first", firstRoom.roomId);
  const secondMember = createMember("mem_second", secondRoom.roomId);
  const { db, response } = await recover({
    rooms: {
      [firstRoom.roomId]: firstRoom,
      [secondRoom.roomId]: secondRoom,
    },
    room_members: {
      [firstMember.memberId]: firstMember,
      [secondMember.memberId]: secondMember,
    },
    user_profiles: { openid_1: createProfile() },
  });
  assert.strictEqual(response.data.activeRoom, null);
  assert.strictEqual(db.dump().user_profiles.openid_1.activeRoomId, null);
}

async function assertExplicitClearCannotBeRepaired() {
  for (const roomStatus of ["lobby", "in_game"]) {
    const room = createRoom(`room_clear_${roomStatus}`, roomStatus);
    const member = createMember(`mem_clear_${roomStatus}`, room.roomId);
    const db = createMemoryDb({
      rooms: { [room.roomId]: room },
      room_members: { [member.memberId]: member },
      user_profiles: {
        openid_1: createProfile({
          activeRoomId: room.roomId,
          activeMemberId: member.memberId,
          activeRoomStatus: roomStatus,
        }),
      },
    });
    const { service } = loadBootstrapService({ db, openId: "openid_1" });

    const clearResponse = await service.main({
      action: "clearActiveRoom",
      payload: { roomId: room.roomId },
    });
    assert.strictEqual(clearResponse.success, true);

    const recoverResponse = await service.main({
      action: "recoverActiveRoom",
      payload: {},
    });
    assert.strictEqual(
      recoverResponse.data.activeRoom,
      null,
      `explicitly cleared ${roomStatus} room must not be repaired`,
    );
    const dump = db.dump();
    assert.strictEqual(dump.user_profiles.openid_1.activeRoomId, null);
    assert.strictEqual(dump.user_profiles.openid_1.activeMemberId, null);
    assert.strictEqual(dump.user_profiles.openid_1.activeRoomStatus, "recovery_suppressed");
    assert.strictEqual(dump.room_members[member.memberId].memberStatus, "active");
  }
}

async function assertNoDiagnosticLogForNormalEmptyCandidateSet() {
  const originalConsoleInfo = console.info;
  const logs = [];
  console.info = (...args) => {
    logs.push(args);
  };
  try {
    const { response } = await recover({
      user_profiles: {
        openid_1: createProfile(),
      },
    });
    assert.strictEqual(response.data.activeRoom, null);
    assert.deepStrictEqual(logs, [], "normal empty recovery must not emit diagnostic logs");
  } finally {
    console.info = originalConsoleInfo;
  }
}

async function assertClearWinsAgainstInFlightAnchoredRecovery() {
  const room = createRoom("room_racing_anchor", "in_game");
  const member = createMember("mem_racing_anchor", room.roomId);
  const db = createMemoryDb({
    rooms: { [room.roomId]: room },
    room_members: { [member.memberId]: member },
    user_profiles: {
      openid_1: createProfile({
        activeRoomId: room.roomId,
        activeMemberId: member.memberId,
        activeRoomStatus: "in_game",
      }),
    },
  });
  const writeGate = blockFirstRecoveryWrite(db);
  const { service } = loadBootstrapService({ db, openId: "openid_1" });

  const recovering = service.main({
    action: "recoverActiveRoom",
    payload: {},
  });
  await writeGate.blocked;
  const clearResponse = await service.main({
    action: "clearActiveRoom",
    payload: { roomId: room.roomId },
  });
  assert.strictEqual(clearResponse.success, true);
  writeGate.release();

  const recoverResponse = await recovering;
  assert.strictEqual(recoverResponse.data.activeRoom, null);
  const profile = db.dump().user_profiles.openid_1;
  assert.strictEqual(profile.activeRoomId, null);
  assert.strictEqual(profile.activeRoomStatus, "recovery_suppressed");
}

async function assertClearWinsAgainstInFlightAnchorRepair() {
  const room = createRoom("room_racing_repair", "lobby");
  const member = createMember("mem_racing_repair", room.roomId);
  const db = createMemoryDb({
    rooms: { [room.roomId]: room },
    room_members: { [member.memberId]: member },
    user_profiles: {
      openid_1: createProfile(),
    },
  });
  const writeGate = blockFirstRecoveryWrite(db);
  const { service } = loadBootstrapService({ db, openId: "openid_1" });

  const recovering = service.main({
    action: "recoverActiveRoom",
    payload: {},
  });
  await writeGate.blocked;
  const clearResponse = await service.main({
    action: "clearActiveRoom",
    payload: {},
  });
  assert.strictEqual(clearResponse.success, true);
  writeGate.release();

  const recoverResponse = await recovering;
  assert.strictEqual(recoverResponse.data.activeRoom, null);
  const profile = db.dump().user_profiles.openid_1;
  assert.strictEqual(profile.activeRoomId, null);
  assert.strictEqual(profile.activeRoomStatus, "recovery_suppressed");
}

async function assertTouchTransactionFailureIsRetryable() {
  const room = createRoom("room_touch_failure", "in_game");
  const member = createMember("mem_touch_failure", room.roomId);
  const db = createMemoryDb({
    rooms: { [room.roomId]: room },
    room_members: { [member.memberId]: member },
    user_profiles: {
      openid_1: createProfile({
        activeRoomId: room.roomId,
        activeMemberId: member.memberId,
        activeRoomStatus: "in_game",
      }),
    },
  });
  const originalRunTransaction = db.runTransaction.bind(db);
  let shouldFailTransaction = true;
  db.runTransaction = async (handler) => {
    if (shouldFailTransaction) {
      shouldFailTransaction = false;
      throw new Error("temporary transaction failure");
    }
    return await originalRunTransaction(handler);
  };
  const { service } = loadBootstrapService({ db, openId: "openid_1" });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const failedRecovery = await service.main({
      action: "recoverActiveRoom",
      payload: {},
    });
    assert.strictEqual(failedRecovery.success, false);
    assert.strictEqual(failedRecovery.error.code, "INTERNAL_ERROR");
    assert.strictEqual(failedRecovery.error.retryable, true);
    assert.strictEqual(db.dump().user_profiles.openid_1.activeRoomId, room.roomId);

    const retriedRecovery = await service.main({
      action: "recoverActiveRoom",
      payload: {},
    });
    assert.strictEqual(retriedRecovery.success, true);
    assert.strictEqual(retriedRecovery.data.activeRoom.roomId, room.roomId);
  } finally {
    console.error = originalConsoleError;
  }
}

async function assertConditionalClearOnlyClearsMatchingRoom() {
  const db = createMemoryDb({
    user_profiles: {
      openid_1: createProfile({
        activeRoomId: "room_new",
        activeMemberId: "mem_new",
        activeRoomStatus: "in_game",
      }),
    },
  });
  const { service } = loadBootstrapService({ db, openId: "openid_1" });

  const staleResponse = await service.main({
    action: "clearActiveRoom",
    payload: { roomId: "room_old" },
  });
  assert.strictEqual(staleResponse.success, true);
  assert.strictEqual(db.dump().user_profiles.openid_1.activeRoomId, "room_new");

  const matchingResponse = await service.main({
    action: "clearActiveRoom",
    payload: { roomId: "room_new" },
  });
  assert.strictEqual(matchingResponse.success, true);
  assert.strictEqual(db.dump().user_profiles.openid_1.activeRoomId, null);
  assert.strictEqual(
    db.dump().user_profiles.openid_1.activeRoomStatus,
    "recovery_suppressed",
  );
}

async function assertLegacyClearRemainsSupported() {
  const db = createMemoryDb({
    user_profiles: {
      openid_1: createProfile({
        activeRoomId: "room_legacy",
        activeMemberId: "mem_legacy",
        activeRoomStatus: "lobby",
      }),
    },
  });
  const { service } = loadBootstrapService({ db, openId: "openid_1" });
  const response = await service.main({
    action: "clearActiveRoom",
    payload: {},
  });
  assert.strictEqual(response.success, true);
  assert.strictEqual(db.dump().user_profiles.openid_1.activeRoomId, null);
  assert.strictEqual(
    db.dump().user_profiles.openid_1.activeRoomStatus,
    "recovery_suppressed",
  );
}

async function assertPersonalStatsComeFromCurrentUsersProfile() {
  const db = createMemoryDb({
    user_profiles: {
      openid_1: createProfile({
        multiplayerGameCount: 7,
        multiplayerWinCount: 4,
        multiplayerLossCount: 3,
        liberalWinCount: 3,
        fascistWinCount: 1,
      }),
      openid_other: {
        _id: "openid_other",
        openid: "openid_other",
        multiplayerGameCount: 99,
      },
    },
  });
  const { service } = loadBootstrapService({ db, openId: "openid_1" });
  const response = await service.main({
    action: "getPersonalStats",
    payload: { openid: "openid_other" },
  });

  assert.strictEqual(response.success, true);
  assert.deepStrictEqual(response.data, {
    multiplayerGameCount: 7,
    multiplayerWinCount: 4,
    multiplayerLossCount: 3,
    liberalWinCount: 3,
    fascistWinCount: 1,
  });
}

async function assertMissingAndInvalidPersonalStatsDefaultToZero() {
  const db = createMemoryDb({
    user_profiles: {
      openid_1: createProfile({
        multiplayerGameCount: -1,
        multiplayerWinCount: "2",
        multiplayerLossCount: 1.5,
      }),
    },
  });
  const { service, setOpenId } = loadBootstrapService({ db, openId: "openid_1" });
  const invalidResponse = await service.main({ action: "getPersonalStats", payload: {} });
  assert.deepStrictEqual(invalidResponse.data, {
    multiplayerGameCount: 0,
    multiplayerWinCount: 0,
    multiplayerLossCount: 0,
    liberalWinCount: 0,
    fascistWinCount: 0,
  });

  setOpenId("openid_missing");
  const missingResponse = await service.main({ action: "getPersonalStats", payload: {} });
  assert.deepStrictEqual(missingResponse.data, invalidResponse.data);
}

(async () => {
  await assertEmptyRecovery();
  await assertExistingEndedAnchorStillRecovers();
  await assertUniqueActiveMembershipRepairsMissingAnchor();
  await assertInvalidAnchorRepairsToUniqueActiveMembership();
  await assertUnsafeCandidatesAreNotRepaired();
  await assertMultipleCandidatesAreNotRepaired();
  await assertExplicitClearCannotBeRepaired();
  await assertNoDiagnosticLogForNormalEmptyCandidateSet();
  await assertClearWinsAgainstInFlightAnchoredRecovery();
  await assertClearWinsAgainstInFlightAnchorRepair();
  await assertTouchTransactionFailureIsRetryable();
  await assertConditionalClearOnlyClearsMatchingRoom();
  await assertLegacyClearRemainsSupported();
  await assertPersonalStatsComeFromCurrentUsersProfile();
  await assertMissingAndInvalidPersonalStatsDefaultToZero();
  console.log("bootstrap recovery tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
