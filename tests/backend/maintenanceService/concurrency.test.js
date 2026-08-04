const assert = require("assert");
const Module = require("module");
const path = require("path");
const { createMemoryDb } = require("../helpers/loadGameService");

const servicePath = path.resolve(__dirname, "../../../cloudfunctions/maintenanceService/index.js");

function loadMaintenanceService({ db, deleteFile }) {
  const originalLoad = Module._load;
  delete require.cache[servicePath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "wx-server-sdk") {
      return {
        DYNAMIC_CURRENT_ENV: "test-env",
        init() {},
        database() {
          return db;
        },
        deleteFile,
      };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

async function assertConcurrencyLimit() {
  const service = loadMaintenanceService({
    db: { command: {} },
    deleteFile: async () => ({ fileList: [] }),
  });
  let active = 0;
  let maxActive = 0;
  const results = await service.__testHooks.mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.deepStrictEqual(results, [2, 4, 6, 8, 10, 12]);
  assert.strictEqual(maxActive, 3);
}

async function assertAssetFailurePreservesRoomData() {
  let collectionAccessCount = 0;
  const service = loadMaintenanceService({
    db: {
      command: {},
      collection() {
        collectionAccessCount += 1;
        throw new Error("database must not be touched after asset deletion failure");
      },
    },
    deleteFile: async ({ fileList }) => ({
      fileList: fileList.map((fileID) => ({ fileID, status: -1 })),
    }),
  });

  const result = await service.__testHooks.removeRoomData({
    roomId: "room_asset_failure",
    assetFileIds: ["cloud://env/room_assets/avatar.webp"],
  });
  assert.strictEqual(result.removed, false);
  assert.strictEqual(collectionAccessCount, 0);
}

async function assertNewCollectionIsInitializedWithinSameDay() {
  const createdCollections = [];
  let savedState = null;
  const now = new Date("2026-07-19T04:00:00.000Z");
  const db = {
    command: {},
    async createCollection(name) {
      createdCollections.push(name);
    },
    collection(name) {
      assert.strictEqual(name, "maintenance_state");
      return {
        doc() {
          return {
            async get() {
              return {
                data: {
                  lastCheckedDate: "2026-07-19",
                  checkedCollections: [
                    "rooms",
                    "room_members",
                    "room_public_snapshots",
                    "room_sync_signals",
                    "user_profiles",
                    "command_records",
                    "game_core",
                    "player_private_snapshots",
                    "game_events",
                    "maintenance_state",
                  ],
                },
              };
            },
            async set({ data }) {
              savedState = data;
            },
          };
        },
      };
    },
  };
  const service = loadMaintenanceService({
    db,
    deleteFile: async () => ({ fileList: [] }),
  });
  const result = await service.__testHooks.ensureCollectionsDaily(now);

  assert.deepStrictEqual(createdCollections, ["multiplayer_stat_events"]);
  assert.strictEqual(result.collectionInitSkipped, false);
  assert(savedState.checkedCollections.includes("multiplayer_stat_events"));
}

async function assertExplicitSyncSignalReleasePreparation() {
  const createdCollections = [];
  const db = {
    command: {},
    async createCollection(name) {
      createdCollections.push(name);
    },
    collection() {
      throw new Error("release preparation must not run cleanup queries");
    },
  };
  const service = loadMaintenanceService({
    db,
    deleteFile: async () => ({ fileList: [] }),
  });

  const result = await service.main({
    action: service.__testHooks.PREPARE_ROOM_SYNC_SIGNALS_ACTION,
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.action, "prepareRoomSyncSignals");
  assert.deepStrictEqual(createdCollections, ["room_sync_signals"]);
  assert.deepStrictEqual(result.collectionResult, {
    name: "room_sync_signals",
    created: true,
    alreadyExists: false,
  });
}

async function assertIndependentRoomDataCleanupIsBounded() {
  let active = 0;
  let maxActive = 0;
  let roomRemoved = false;
  let completedIndependentOperations = 0;
  const db = {
    command: {},
    collection(name) {
      return {
        where() {
          return {
            async remove() {
              active += 1;
              maxActive = Math.max(maxActive, active);
              await new Promise((resolve) => setTimeout(resolve, 5));
              active -= 1;
              completedIndependentOperations += 1;
              return { stats: { removed: 1 } };
            },
            async update() {
              active += 1;
              maxActive = Math.max(maxActive, active);
              await new Promise((resolve) => setTimeout(resolve, 5));
              active -= 1;
              completedIndependentOperations += 1;
              return { stats: { updated: 1 } };
            },
          };
        },
        doc() {
          return {
            async remove() {
              assert.strictEqual(completedIndependentOperations, 7);
              roomRemoved = true;
              return { stats: { removed: 1 } };
            },
          };
        },
      };
    },
  };
  const service = loadMaintenanceService({
    db,
    deleteFile: async () => ({ fileList: [] }),
  });
  const result = await service.__testHooks.removeRoomData({ roomId: "room_success" });
  assert.strictEqual(result.removed, true);
  assert.deepStrictEqual(result.syncSignalStats, { removed: 1 });
  assert.strictEqual(roomRemoved, true);
  assert.strictEqual(maxActive, service.__testHooks.ROOM_DATA_CLEANUP_CONCURRENCY);
}

async function assertCommandRecordCleanupIsBoundedAndOrdered() {
  const records = Array.from({ length: 8 }, (_, index) => ({ _id: `record_${index}` }));
  let active = 0;
  let maxActive = 0;
  const db = {
    command: {
      lte(value) {
        return { lte: value };
      },
    },
    collection(name) {
      assert.strictEqual(name, "command_records");
      return {
        where() {
          return {
            limit() {
              return {
                async get() {
                  return { data: records };
                },
              };
            },
          };
        },
        doc(id) {
          return {
            async remove() {
              active += 1;
              maxActive = Math.max(maxActive, active);
              const index = Number(id.split("_")[1]);
              await new Promise((resolve) => setTimeout(resolve, (records.length - index) * 2));
              active -= 1;
            },
          };
        },
      };
    },
  };
  const service = loadMaintenanceService({
    db,
    deleteFile: async () => ({ fileList: [] }),
  });
  const result = await service.__testHooks.cleanupCommandRecords(new Date());
  assert.strictEqual(maxActive, service.__testHooks.COMMAND_RECORD_CLEANUP_CONCURRENCY);
  assert.deepStrictEqual(result.removedRecordIds, records.map((record) => record._id));
}

function createStatEvent(gameId, players, failureCount = 0) {
  return {
    gameId,
    roomId: `room_${gameId}`,
    status: "pending",
    failureCount,
    players,
    createdAt: new Date("2026-08-02T08:00:00.000Z"),
    updatedAt: new Date("2026-08-02T08:00:00.000Z"),
  };
}

async function assertStatUpdateAndEventDeleteAreAtomic() {
  let failEventDelete = true;
  const db = createMemoryDb(
    {
      multiplayer_stat_events: {
        game_atomic: createStatEvent("game_atomic", [
          { memberId: "mem_atomic", openId: "openid_atomic", party: "LIBERAL", didWin: true },
        ]),
      },
      user_profiles: {
        openid_atomic: {
          openid: "openid_atomic",
          multiplayerGameCount: 4,
          multiplayerWinCount: 2,
          multiplayerLossCount: 2,
        },
      },
    },
    {
      beforeDocOperation({ type, collection }) {
        if (failEventDelete && type === "remove" && collection === "multiplayer_stat_events") {
          const err = new Error("injected event delete failure");
          err.code = "INJECTED_DELETE_FAILURE";
          throw err;
        }
      },
    },
  );
  const service = loadMaintenanceService({ db, deleteFile: async () => ({ fileList: [] }) });
  const now = new Date("2026-08-02T09:00:00.000Z");
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResult = await service.__testHooks.processMultiplayerStatEvent(
      db.dump().multiplayer_stat_events.game_atomic,
      now,
    );
    assert.strictEqual(failedResult.status, "retryScheduled");
  } finally {
    console.error = originalConsoleError;
  }

  let dump = db.dump();
  assert.deepStrictEqual(
    [
      dump.user_profiles.openid_atomic.multiplayerGameCount,
      dump.user_profiles.openid_atomic.multiplayerWinCount,
      dump.user_profiles.openid_atomic.multiplayerLossCount,
      dump.user_profiles.openid_atomic.liberalWinCount,
      dump.user_profiles.openid_atomic.fascistWinCount,
    ],
    [4, 2, 2, undefined, undefined],
    "a failed event delete must roll back profile updates",
  );
  assert.strictEqual(dump.multiplayer_stat_events.game_atomic.failureCount, 1);

  failEventDelete = false;
  const retryResult = await service.__testHooks.processMultiplayerStatEvent(
    dump.multiplayer_stat_events.game_atomic,
    new Date("2026-08-02T10:00:00.000Z"),
  );
  assert.strictEqual(retryResult.status, "processed");
  dump = db.dump();
  assert.deepStrictEqual(
    [
      dump.user_profiles.openid_atomic.multiplayerGameCount,
      dump.user_profiles.openid_atomic.multiplayerWinCount,
      dump.user_profiles.openid_atomic.multiplayerLossCount,
      dump.user_profiles.openid_atomic.liberalWinCount,
      dump.user_profiles.openid_atomic.fascistWinCount,
    ],
    [5, 3, 2, 1, 0],
  );
  assert.strictEqual(dump.multiplayer_stat_events.game_atomic, undefined);
}

async function assertStatEventIsDroppedAfterThreeFailedAttempts() {
  const db = createMemoryDb({
    multiplayer_stat_events: {
      game_invalid: createStatEvent("game_invalid", []),
    },
  });
  const service = loadMaintenanceService({ db, deleteFile: async () => ({ fileList: [] }) });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const first = await service.__testHooks.processMultiplayerStatEvent(
      db.dump().multiplayer_stat_events.game_invalid,
      new Date("2026-08-02T09:00:00.000Z"),
    );
    assert.strictEqual(first.status, "retryScheduled");
    assert.strictEqual(db.dump().multiplayer_stat_events.game_invalid.failureCount, 1);

    const second = await service.__testHooks.processMultiplayerStatEvent(
      db.dump().multiplayer_stat_events.game_invalid,
      new Date("2026-08-02T10:00:00.000Z"),
    );
    assert.strictEqual(second.status, "retryScheduled");
    assert.strictEqual(db.dump().multiplayer_stat_events.game_invalid.failureCount, 2);

    const third = await service.__testHooks.processMultiplayerStatEvent(
      db.dump().multiplayer_stat_events.game_invalid,
      new Date("2026-08-02T11:00:00.000Z"),
    );
    assert.strictEqual(third.status, "dropped");
    assert.strictEqual(db.dump().multiplayer_stat_events.game_invalid, undefined);
  } finally {
    console.error = originalConsoleError;
  }
}

async function assertLegacyStatEventRemainsProcessable() {
  const db = createMemoryDb({
    multiplayer_stat_events: {
      game_legacy: createStatEvent("game_legacy", [
        { memberId: "mem_legacy", openId: "openid_legacy", didWin: true },
      ]),
    },
    user_profiles: {
      openid_legacy: {
        openid: "openid_legacy",
        liberalWinCount: 4,
        fascistWinCount: 2,
      },
    },
  });
  const service = loadMaintenanceService({ db, deleteFile: async () => ({ fileList: [] }) });
  const result = await service.__testHooks.processMultiplayerStatEvent(
    db.dump().multiplayer_stat_events.game_legacy,
    new Date("2026-08-04T09:00:00.000Z"),
  );
  assert.strictEqual(result.status, "processed");
  const profile = db.dump().user_profiles.openid_legacy;
  assert.strictEqual(profile.multiplayerGameCount, 1);
  assert.strictEqual(profile.multiplayerWinCount, 1);
  assert.strictEqual(profile.multiplayerLossCount, 0);
  assert.strictEqual(profile.liberalWinCount, 4, "legacy events cannot infer the winning faction");
  assert.strictEqual(profile.fascistWinCount, 2, "legacy events cannot infer the winning faction");
}

async function assertStatEventBatchIsIsolatedAndIdempotent() {
  const db = createMemoryDb({
    multiplayer_stat_events: {
      game_valid: createStatEvent("game_valid", [
        { memberId: "mem_valid", openId: "openid_valid", party: "FASCIST", didWin: false },
        { memberId: "mem_missing", openId: "openid_missing", party: "LIBERAL", didWin: true },
      ]),
      game_invalid: createStatEvent("game_invalid", []),
    },
    user_profiles: {
      openid_valid: {
        openid: "openid_valid",
      },
    },
  });
  const service = loadMaintenanceService({ db, deleteFile: async () => ({ fileList: [] }) });
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const result = await service.__testHooks.processPendingMultiplayerStatEvents(
      new Date("2026-08-02T09:00:00.000Z"),
    );
    assert.deepStrictEqual(result, {
      scanned: 2,
      processed: 1,
      retryScheduled: 1,
      dropped: 0,
    });
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }

  let dump = db.dump();
  assert.deepStrictEqual(
    [
      dump.user_profiles.openid_valid.multiplayerGameCount,
      dump.user_profiles.openid_valid.multiplayerWinCount,
      dump.user_profiles.openid_valid.multiplayerLossCount,
      dump.user_profiles.openid_valid.liberalWinCount,
      dump.user_profiles.openid_valid.fascistWinCount,
    ],
    [1, 0, 1, 0, 0],
  );
  assert.strictEqual(dump.multiplayer_stat_events.game_valid, undefined);
  assert.strictEqual(dump.multiplayer_stat_events.game_invalid.failureCount, 1);

  const concurrentDb = createMemoryDb({
    multiplayer_stat_events: {
      game_concurrent: createStatEvent("game_concurrent", [
        { memberId: "mem_concurrent", openId: "openid_concurrent", party: "FASCIST", didWin: true },
      ]),
    },
    user_profiles: {
      openid_concurrent: { openid: "openid_concurrent" },
    },
  });
  const concurrentService = loadMaintenanceService({
    db: concurrentDb,
    deleteFile: async () => ({ fileList: [] }),
  });
  const event = concurrentDb.dump().multiplayer_stat_events.game_concurrent;
  const concurrentResults = await Promise.all([
    concurrentService.__testHooks.processMultiplayerStatEvent(event, new Date("2026-08-02T09:00:00.000Z")),
    concurrentService.__testHooks.processMultiplayerStatEvent(event, new Date("2026-08-02T09:00:00.000Z")),
  ]);
  assert.deepStrictEqual(
    concurrentResults.map((result) => result.status).sort(),
    ["missing", "processed"],
  );
  dump = concurrentDb.dump();
  assert.strictEqual(dump.user_profiles.openid_concurrent.multiplayerGameCount, 1);
  assert.strictEqual(dump.user_profiles.openid_concurrent.multiplayerWinCount, 1);
  assert.strictEqual(dump.user_profiles.openid_concurrent.multiplayerLossCount, 0);
  assert.strictEqual(dump.user_profiles.openid_concurrent.liberalWinCount, 0);
  assert.strictEqual(dump.user_profiles.openid_concurrent.fascistWinCount, 1);
  assert.strictEqual(dump.multiplayer_stat_events.game_concurrent, undefined);
}

(async () => {
  await assertConcurrencyLimit();
  await assertAssetFailurePreservesRoomData();
  await assertNewCollectionIsInitializedWithinSameDay();
  await assertExplicitSyncSignalReleasePreparation();
  await assertIndependentRoomDataCleanupIsBounded();
  await assertCommandRecordCleanupIsBoundedAndOrdered();
  await assertStatUpdateAndEventDeleteAreAtomic();
  await assertStatEventIsDroppedAfterThreeFailedAttempts();
  await assertLegacyStatEventRemainsProcessable();
  await assertStatEventBatchIsIsolatedAndIdempotent();
  console.log("maintenance concurrency tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
