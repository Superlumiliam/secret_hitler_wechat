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
              assert.strictEqual(completedIndependentOperations, 6);
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

(async () => {
  await assertConcurrencyLimit();
  await assertAssetFailurePreservesRoomData();
  await assertIndependentRoomDataCleanupIsBounded();
  await assertCommandRecordCleanupIsBoundedAndOrdered();
  console.log("maintenance concurrency tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
