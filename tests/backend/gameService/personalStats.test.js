const assert = require("assert");
const { createMemoryDb, loadGameService } = require("../helpers/loadGameService");

function makeMember(memberId, openId, overrides = {}) {
  return {
    memberId,
    openId,
    roomId: "room_stats",
    memberType: "player",
    memberStatus: "active",
    isVirtual: false,
    seatIndex: Number(memberId.replace(/\D/g, "")) || 1,
    ...overrides,
  };
}

async function assertCompletedNormalGameWritesOneEventWithoutUpdatingProfiles() {
  const db = createMemoryDb({
    rooms: {
      room_stats: {
        roomId: "room_stats",
        mode: "normal",
        status: "in_game",
        version: 4,
      },
    },
    user_profiles: {
      openid_1: {
        openid: "openid_1",
        activeRoomId: "room_stats",
        multiplayerGameCount: 4,
        multiplayerWinCount: 3,
        multiplayerLossCount: 1,
      },
      openid_2: {
        openid: "openid_2",
        activeRoomId: null,
      },
      openid_spectator: {
        openid: "openid_spectator",
      },
      openid_virtual: {
        openid: "openid_virtual",
      },
    },
  });
  const { service } = loadGameService({ db });
  const members = [
    makeMember("mem_1", "openid_1"),
    makeMember("mem_2", "openid_2", { memberStatus: "offline" }),
    makeMember("mem_3", "openid_spectator", { memberType: "spectator" }),
    makeMember("mem_4", "openid_virtual", { isVirtual: true }),
  ];
  const room = db.dump().rooms.room_stats;
  const gameCore = {
    gameId: "game_stats",
    status: "ended",
    phase: "game_ended",
    winner: "LIBERAL",
    roleAssignments: {
      mem_1: { role: "LIBERAL", party: "LIBERAL" },
      mem_2: { role: "FASCIST", party: "FASCIST" },
      mem_3: { role: "LIBERAL", party: "LIBERAL" },
      mem_4: { role: "FASCIST", party: "FASCIST" },
    },
  };
  const updatedAt = new Date("2026-07-30T12:00:00.000Z");
  const statEvent = service.__testHooks.buildCompletedMultiplayerStatEvent(room, gameCore, members, updatedAt);

  await db.runTransaction(async (transaction) => {
    await service.__testHooks.persistEndedRoomProjection(
      transaction,
      room.roomId,
      updatedAt,
      updatedAt,
      statEvent,
    );
  });

  const profiles = db.dump().user_profiles;
  assert.deepStrictEqual(
    [
      profiles.openid_1.multiplayerGameCount,
      profiles.openid_1.multiplayerWinCount,
      profiles.openid_1.multiplayerLossCount,
    ],
    [4, 3, 1],
    "terminal persistence must not update existing personal statistics",
  );
  assert.deepStrictEqual(
    [
      profiles.openid_2.multiplayerGameCount,
      profiles.openid_2.multiplayerWinCount,
      profiles.openid_2.multiplayerLossCount,
    ],
    [undefined, undefined, undefined],
    "offline players must be deferred to the maintenance event",
  );
  assert.strictEqual(profiles.openid_spectator.multiplayerGameCount, undefined);
  assert.strictEqual(profiles.openid_virtual.multiplayerGameCount, undefined);
  assert.strictEqual(db.stats().docGets.user_profiles || 0, 0, "terminal persistence must not read profile documents");

  const storedEvent = db.dump().multiplayer_stat_events.game_stats;
  assert.strictEqual(storedEvent.gameId, "game_stats");
  assert.strictEqual(storedEvent.roomId, "room_stats");
  assert.strictEqual(storedEvent.status, "pending");
  assert.strictEqual(storedEvent.failureCount, 0);
  assert.deepStrictEqual(storedEvent.players, [
    { memberId: "mem_1", openId: "openid_1", didWin: true },
    { memberId: "mem_2", openId: "openid_2", didWin: false },
  ]);
}

async function assertSoloAndUnfinishedGamesDoNotBuildEvents() {
  const db = createMemoryDb();
  const { service } = loadGameService({ db });
  const member = makeMember("mem_1", "openid_1");
  const endedCore = {
    gameId: "game_stats",
    status: "ended",
    phase: "game_ended",
    winner: "LIBERAL",
    roleAssignments: {
      mem_1: { role: "LIBERAL", party: "LIBERAL" },
    },
  };

  const now = new Date("2026-07-30T12:00:00.000Z");
  const soloEvent = service.__testHooks.buildCompletedMultiplayerStatEvent(
    { roomId: "room_solo", mode: "solo" },
    endedCore,
    [member],
    now,
  );
  const unfinishedEvent = service.__testHooks.buildCompletedMultiplayerStatEvent(
    { roomId: "room_normal", mode: "normal" },
    { ...endedCore, status: "in_game", phase: "nomination", winner: null },
    [member],
    now,
  );
  assert.strictEqual(soloEvent, null);
  assert.strictEqual(unfinishedEvent, null);
}

(async () => {
  await assertCompletedNormalGameWritesOneEventWithoutUpdatingProfiles();
  await assertSoloAndUnfinishedGamesDoNotBuildEvents();
  console.log("personal stats tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
