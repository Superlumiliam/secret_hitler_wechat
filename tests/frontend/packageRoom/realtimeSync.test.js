const assert = require("assert");
const path = require("path");

const watcherModulePath = path.resolve(__dirname, "../../../frontend/packageRoom/utils/roomSyncSignal.js");

function loadPageDefinition(relativePath) {
  const absolutePath = path.resolve(__dirname, "../../../", relativePath);
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  delete require.cache[absolutePath];
  require(absolutePath);
  return definition;
}

function assertWatcherLifecycleAndFallback() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  const subscriptions = [];
  let closedCount = 0;
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    scheduled.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };

  global.wx = {
    cloud: {
      database() {
        return {
          collection(name) {
            assert.strictEqual(name, "room_sync_signals");
            return {
              where(query) {
                assert.deepStrictEqual(query, { roomId: "room_1" });
                return {
                  watch(handlers) {
                    subscriptions.push(handlers);
                    return {
                      close() {
                        closedCount += 1;
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };

  try {
    delete require.cache[watcherModulePath];
    const { WATCH_RETRY_INTERVAL_MS, createRoomSyncSignalWatcher } = require(watcherModulePath);
    const signals = [];
    let healthyCount = 0;
    let unavailableCount = 0;
    const controller = createRoomSyncSignalWatcher({
      roomId: "room_1",
      onHealthy() {
        healthyCount += 1;
      },
      onUnavailable() {
        unavailableCount += 1;
      },
      onSignal(signal) {
        signals.push(signal);
      },
    });

    controller.start();
    assert.strictEqual(subscriptions.length, 1);
    subscriptions[0].onChange({ docs: [{ roomId: "room_1", roomStatus: "in_game", version: 2 }] });
    assert.strictEqual(controller.isHealthy(), true);
    assert.strictEqual(healthyCount, 1);
    assert.strictEqual(signals.length, 1);

    subscriptions[0].onError(new Error("connection lost"));
    assert.strictEqual(controller.isHealthy(), false);
    assert.strictEqual(unavailableCount, 1);
    assert.strictEqual(scheduled[0].delay, WATCH_RETRY_INTERVAL_MS);
    scheduled[0].callback();
    assert.strictEqual(subscriptions.length, 2, "watcher should retry while the page remains visible");
    subscriptions[1].onChange({ docs: [{ roomId: "room_1", roomStatus: "in_game", version: 3 }] });
    assert.strictEqual(controller.isHealthy(), true);
    assert.strictEqual(healthyCount, 2, "successful retry should leave fallback mode");

    controller.stop();
    assert.strictEqual(controller.isHealthy(), false);
    assert(closedCount >= 2, "failed and stopped watchers should both be closed");
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

function assertPagesUseReconcileIntervalsOnlyWhenHealthy() {
  global.wx = { cloud: {} };
  const board = loadPageDefinition("frontend/packageRoom/pages/board/index.js");
  const boardContext = {
    ...board,
    syncSignalWatcher: { isHealthy: () => true },
    consecutiveSnapshotFailures: 0,
    lastCommandSettledAt: 0,
    data: { ...board.data, snapshot: null },
  };
  assert.strictEqual(board.getPollIntervalMs.call(boardContext), 60000);
  boardContext.syncSignalWatcher = { isHealthy: () => false };
  assert.strictEqual(board.getPollIntervalMs.call(boardContext), 4000);

  const lobby = loadPageDefinition("frontend/packageRoom/pages/lobby/index.js");
  assert.strictEqual(
    lobby.isRealtimeSyncHealthy.call({ syncSignalWatcher: { isHealthy: () => true } }),
    true,
  );
  assert.strictEqual(
    lobby.isRealtimeSyncHealthy.call({ syncSignalWatcher: { isHealthy: () => false } }),
    false,
  );
}

function waitForMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function assertBoardCatchesUpToBurstSignalWithoutConcurrency() {
  global.wx = { cloud: {} };
  const board = loadPageDefinition("frontend/packageRoom/pages/board/index.js");
  const pendingRequests = [];
  let requestCount = 0;
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const context = {
    ...board,
    isPageVisible: true,
    isPageUnloaded: false,
    pendingSyncVersion: 0,
    pendingSyncRoomStatus: "",
    pendingSyncSequence: 0,
    syncSignalCatchUpPromise: null,
    data: {
      ...board.data,
      snapshot: { version: 1, roomStatus: "in_game" },
    },
    loadGameSnapshot() {
      requestCount += 1;
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      return new Promise((resolve) => {
        pendingRequests.push((version) => {
          this.data.snapshot = { version, roomStatus: "in_game" };
          activeRequests -= 1;
          resolve(true);
        });
      });
    },
  };

  board.handleRealtimeSignal.call(context, { version: 2, roomStatus: "in_game" });
  const catchUpPromise = context.syncSignalCatchUpPromise;
  board.handleRealtimeSignal.call(context, { version: 3, roomStatus: "in_game" });
  assert.strictEqual(requestCount, 1, "burst signals must reuse the request already in flight");

  pendingRequests.shift()(2);
  await waitForMicrotasks();
  assert.strictEqual(requestCount, 2, "a newer pending signal must trigger a follow-up snapshot after v2 settles");
  pendingRequests.shift()(3);
  await catchUpPromise;

  assert.strictEqual(context.data.snapshot.version, 3);
  assert.strictEqual(maxActiveRequests, 1, "signal catch-up must never create concurrent snapshot requests");

  board.handleRealtimeSignal.call(context, { version: 3, roomStatus: "in_game" });
  await waitForMicrotasks();
  assert.strictEqual(requestCount, 2, "a signal matching the current version must not fetch again");
}

async function assertLobbyCatchesUpToBurstSignalWithoutConcurrency() {
  global.wx = { cloud: {} };
  const lobby = loadPageDefinition("frontend/packageRoom/pages/lobby/index.js");
  const pendingRequests = [];
  let requestCount = 0;
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const context = {
    ...lobby,
    isPageVisible: true,
    isPageUnloaded: false,
    pendingSyncVersion: 0,
    pendingSyncRoomStatus: "",
    pendingSyncSequence: 0,
    syncSignalCatchUpPromise: null,
    data: {
      ...lobby.data,
      lobby: { version: 4, roomStatus: "lobby" },
    },
    loadLobbySnapshot() {
      requestCount += 1;
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      return new Promise((resolve) => {
        pendingRequests.push((version) => {
          this.data.lobby = { version, roomStatus: "lobby" };
          activeRequests -= 1;
          resolve(true);
        });
      });
    },
  };

  lobby.handleRealtimeSignal.call(context, { version: 5, roomStatus: "lobby" });
  const catchUpPromise = context.syncSignalCatchUpPromise;
  lobby.handleRealtimeSignal.call(context, { version: 6, roomStatus: "lobby" });
  assert.strictEqual(requestCount, 1);

  pendingRequests.shift()(5);
  await waitForMicrotasks();
  assert.strictEqual(requestCount, 2, "lobby must fetch the highest version received during an in-flight request");
  pendingRequests.shift()(6);
  await catchUpPromise;

  assert.strictEqual(context.data.lobby.version, 6);
  assert.strictEqual(maxActiveRequests, 1);
}

async function assertLobbyStatusTransitionIgnoresVersionNamespaceReset() {
  global.wx = { cloud: {} };
  const lobby = loadPageDefinition("frontend/packageRoom/pages/lobby/index.js");
  let requestCount = 0;
  const context = {
    ...lobby,
    isPageVisible: true,
    isPageUnloaded: false,
    pendingSyncVersion: 0,
    pendingSyncRoomStatus: "",
    pendingSyncSequence: 0,
    syncSignalCatchUpPromise: null,
    data: {
      ...lobby.data,
      lobby: { version: 4, roomStatus: "lobby" },
    },
    async loadLobbySnapshot() {
      requestCount += 1;
      return false;
    },
  };

  lobby.handleRealtimeSignal.call(context, { version: 4, roomStatus: "lobby" });
  lobby.handleRealtimeSignal.call(context, { version: 1, roomStatus: "in_game" });
  await waitForMicrotasks();

  assert.strictEqual(
    requestCount,
    1,
    "in_game/v1 must trigger a snapshot even when the last lobby signal used the higher lobby/v4 namespace",
  );
}

(async () => {
  assertWatcherLifecycleAndFallback();
  assertPagesUseReconcileIntervalsOnlyWhenHealthy();
  await assertBoardCatchesUpToBurstSignalWithoutConcurrency();
  await assertLobbyCatchesUpToBurstSignalWithoutConcurrency();
  await assertLobbyStatusTransitionIgnoresVersionNamespaceReset();
  console.log("frontend realtime sync tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
