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

async function assertCompletedNormalGameUpdatesOnlyRealPlayers() {
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

  await db.runTransaction(async (transaction) => {
    const statUpdates = await service.__testHooks.prepareCompletedMultiplayerStatUpdates(
      transaction,
      room,
      gameCore,
      members,
    );
    assert.strictEqual(statUpdates.length, 2);
    await service.__testHooks.persistEndedRoomProjection(
      transaction,
      room.roomId,
      updatedAt,
      updatedAt,
      statUpdates,
    );
  });

  const profiles = db.dump().user_profiles;
  assert.deepStrictEqual(
    [
      profiles.openid_1.multiplayerGameCount,
      profiles.openid_1.multiplayerWinCount,
      profiles.openid_1.multiplayerLossCount,
    ],
    [5, 4, 1],
  );
  assert.deepStrictEqual(
    [
      profiles.openid_2.multiplayerGameCount,
      profiles.openid_2.multiplayerWinCount,
      profiles.openid_2.multiplayerLossCount,
    ],
    [1, 0, 1],
    "offline players must still receive the completed-game result",
  );
  assert.strictEqual(profiles.openid_spectator.multiplayerGameCount, undefined);
  assert.strictEqual(profiles.openid_virtual.multiplayerGameCount, undefined);
}

async function assertSoloAndUnfinishedGamesDoNotPrepareStats() {
  const db = createMemoryDb();
  const { service } = loadGameService({ db });
  const member = makeMember("mem_1", "openid_1");
  const endedCore = {
    status: "ended",
    phase: "game_ended",
    winner: "LIBERAL",
    roleAssignments: {
      mem_1: { role: "LIBERAL", party: "LIBERAL" },
    },
  };

  await db.runTransaction(async (transaction) => {
    const soloUpdates = await service.__testHooks.prepareCompletedMultiplayerStatUpdates(
      transaction,
      { roomId: "room_solo", mode: "solo" },
      endedCore,
      [member],
    );
    const unfinishedUpdates = await service.__testHooks.prepareCompletedMultiplayerStatUpdates(
      transaction,
      { roomId: "room_normal", mode: "normal" },
      { ...endedCore, status: "in_game", phase: "nomination", winner: null },
      [member],
    );
    assert.deepStrictEqual(soloUpdates, []);
    assert.deepStrictEqual(unfinishedUpdates, []);
  });
}

(async () => {
  await assertCompletedNormalGameUpdatesOnlyRealPlayers();
  await assertSoloAndUnfinishedGamesDoNotPrepareStats();
  console.log("personal stats tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
