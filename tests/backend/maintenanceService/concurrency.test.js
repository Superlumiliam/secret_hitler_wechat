const assert = require("assert");
const Module = require("module");
const path = require("path");

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

  assert.deepStrictEqual(createdCollections, ["room_sync_signals"]);
  assert.strictEqual(result.collectionInitSkipped, false);
  assert(savedState.checkedCollections.includes("room_sync_signals"));
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

async function assertUserProfileStatsMigrationIsIdempotent() {
  const profiles = Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => {
      const id = `profile_${String(index + 1).padStart(3, "0")}`;
      return [
        id,
        {
          _id: id,
          openid: id,
          defaultDisplayName: `旧玩家${index + 1}`,
        },
      ];
    }),
  );
  profiles.profile_050 = {
    ...profiles.profile_050,
    multiplayerGameCount: 8,
    multiplayerWinCount: 5,
    multiplayerLossCount: 3,
  };
  let migrationState = null;
  const db = {
    command: {
      gt(value) {
        return { gt: value };
      },
    },
    collection(name) {
      if (name === "maintenance_state") {
        return {
          doc() {
            return {
              async get() {
                if (!migrationState) {
                  const err = new Error("document not exist");
                  err.errCode = -502005;
                  throw err;
                }
                return { data: migrationState };
              },
              async set({ data }) {
                migrationState = data;
              },
            };
          },
        };
      }
      assert.strictEqual(name, "user_profiles");
      const buildQuery = (afterId = "") => ({
        orderBy() {
          return {
            limit(limitCount) {
              return {
                async get() {
                  return {
                    data: Object.values(profiles)
                      .filter((profile) => profile._id > afterId)
                      .sort((left, right) => left._id.localeCompare(right._id))
                      .slice(0, limitCount),
                  };
                },
              };
            },
          };
        },
      });
      return {
        ...buildQuery(),
        where(query) {
          return buildQuery(query._id.gt);
        },
        doc(id) {
          return {
            async update({ data }) {
              profiles[id] = {
                ...profiles[id],
                ...data,
              };
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

  const first = await service.__testHooks.migrateUserProfileStatsBatch(
    new Date("2026-07-30T12:00:00.000Z"),
  );
  assert.strictEqual(first.completed, false);
  assert.strictEqual(first.scannedProfiles, 100);
  assert.strictEqual(first.migratedProfiles, 99);
  assert.deepStrictEqual(
    [
      profiles.profile_001.multiplayerGameCount,
      profiles.profile_001.multiplayerWinCount,
      profiles.profile_001.multiplayerLossCount,
    ],
    [0, 0, 0],
  );
  assert.deepStrictEqual(
    [
      profiles.profile_050.multiplayerGameCount,
      profiles.profile_050.multiplayerWinCount,
      profiles.profile_050.multiplayerLossCount,
    ],
    [8, 5, 3],
    "migration must not overwrite existing statistics",
  );

  const second = await service.__testHooks.migrateUserProfileStatsBatch(
    new Date("2026-07-30T12:01:00.000Z"),
  );
  assert.strictEqual(second.skipped, false);
  assert.strictEqual(second.completed, true);
  assert.strictEqual(second.scannedProfiles, 1);
  assert.strictEqual(second.migratedProfiles, 1);

  const third = await service.__testHooks.migrateUserProfileStatsBatch(
    new Date("2026-07-30T12:02:00.000Z"),
  );
  assert.strictEqual(third.skipped, true);
  assert.strictEqual(third.migratedProfiles, 0);
  assert.deepStrictEqual(
    [
      profiles.profile_101.multiplayerGameCount,
      profiles.profile_101.multiplayerWinCount,
      profiles.profile_101.multiplayerLossCount,
    ],
    [0, 0, 0],
  );
}

(async () => {
  await assertConcurrencyLimit();
  await assertAssetFailurePreservesRoomData();
  await assertNewCollectionIsInitializedWithinSameDay();
  await assertExplicitSyncSignalReleasePreparation();
  await assertIndependentRoomDataCleanupIsBounded();
  await assertCommandRecordCleanupIsBoundedAndOrdered();
  await assertUserProfileStatsMigrationIsIdempotent();
  console.log("maintenance concurrency tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
