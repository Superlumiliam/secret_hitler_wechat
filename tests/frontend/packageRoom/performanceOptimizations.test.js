const assert = require("assert");
const path = require("path");

const cachePath = path.resolve(__dirname, "../../../frontend/packageRoom/utils/tempFileUrlCache.js");

async function assertTempFileUrlCache() {
  delete require.cache[cachePath];
  let requestCount = 0;
  let releaseRequest;
  global.wx = {
    cloud: {
      getTempFileURL({ fileList }) {
        requestCount += 1;
        return new Promise((resolve) => {
          releaseRequest = () =>
            resolve({
              fileList: fileList.map((fileID) => ({
                fileID,
                status: 0,
                tempFileURL: `https://temp.example/${encodeURIComponent(fileID)}`,
              })),
            });
        });
      },
    },
  };

  const { clearTempFileUrlCache, resolveTempFileUrls } = require(cachePath);
  clearTempFileUrlCache();
  const first = resolveTempFileUrls(["cloud://avatar-a", "cloud://avatar-a"]);
  const overlapping = resolveTempFileUrls(["cloud://avatar-a"]);
  assert.strictEqual(requestCount, 1, "overlapping requests should share one cloud request");
  releaseRequest();
  const [firstResult, overlappingResult] = await Promise.all([first, overlapping]);
  assert.strictEqual(firstResult["cloud://avatar-a"], overlappingResult["cloud://avatar-a"]);

  const cachedResult = await resolveTempFileUrls(["cloud://avatar-a"]);
  assert.strictEqual(requestCount, 1, "cache hit should not call getTempFileURL");
  assert.strictEqual(cachedResult["cloud://avatar-a"], firstResult["cloud://avatar-a"]);

  wx.cloud.getTempFileURL = async ({ fileList }) => {
    requestCount += 1;
    return {
      fileList: fileList.map((fileID) => ({
        fileID,
        status: 0,
        tempFileURL: `https://temp.example/${encodeURIComponent(fileID)}`,
      })),
    };
  };
  const expiringResult = await resolveTempFileUrls(["cloud://avatar-b"], { ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  wx.cloud.getTempFileURL = async () => {
    requestCount += 1;
    throw new Error("temporary cloud failure");
  };
  const staleResult = await resolveTempFileUrls(["cloud://avatar-b"]);
  assert.strictEqual(
    staleResult["cloud://avatar-b"],
    expiringResult["cloud://avatar-b"],
    "expired cache entry should degrade to its stale URL when refresh fails",
  );
}

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

async function assertStablePollSkipsHydrate() {
  global.wx = {
    cloud: {
      callFunction: async () => ({
        result: {
          success: true,
          data: {
            roomId: "room_1",
            roomStatus: "in_game",
            version: 7,
            myMemberId: "member_1",
            realMemberId: "member_1",
            expireAt: "2099-01-01T00:00:00.000Z",
          },
        },
      }),
    },
  };

  const board = loadPageDefinition("frontend/packageRoom/pages/board/index.js");
  let hydrateCount = 0;
  const context = {
    ...board,
    data: {
      ...board.data,
      roomId: "room_1",
      snapshot: {
        version: 7,
        myMemberId: "member_1",
        realMemberId: "member_1",
      },
    },
    consecutiveSnapshotFailures: 3,
    hydrateSnapshot: async () => {
      hydrateCount += 1;
    },
    redirectToResultIfNeeded: () => false,
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };

  const shouldContinue = await board.loadGameSnapshot.call(context, { silent: true });
  clearTimeout(context.__pageTimeoutTimer);
  assert.strictEqual(shouldContinue, true);
  assert.strictEqual(hydrateCount, 0, "stable silent board poll should skip hydrate");
  assert.strictEqual(context.consecutiveSnapshotFailures, 0, "successful stable poll should reset failure count");

  const lobby = loadPageDefinition("frontend/packageRoom/pages/lobby/index.js");
  let lobbyHydrateCount = 0;
  wx.cloud.callFunction = async () => ({
    result: {
      success: true,
      data: {
        roomId: "room_1",
        roomStatus: "lobby",
        version: 3,
        viewerState: { myMemberId: "member_1" },
        expireAt: "2099-01-01T00:00:00.000Z",
      },
    },
  });
  const lobbyContext = {
    ...lobby,
    data: {
      ...lobby.data,
      roomId: "room_1",
      lobby: {
        version: 3,
        viewerState: { myMemberId: "member_1" },
      },
    },
    hydrateLobby: async () => {
      lobbyHydrateCount += 1;
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
  const lobbyShouldContinue = await lobby.loadLobbySnapshot.call(lobbyContext, { silent: true });
  clearTimeout(lobbyContext.__pageTimeoutTimer);
  assert.strictEqual(lobbyShouldContinue, true);
  assert.strictEqual(lobbyHydrateCount, 0, "stable silent lobby poll should skip hydrate");
  assert.strictEqual(
    lobby.shouldHydrateLobby.call(
      {
        data: {
          lobby: {
            version: 3,
            viewerState: { myMemberId: "member_1" },
          },
        },
      },
      {
        version: 3,
        viewerState: { myMemberId: "member_1" },
      },
      { silent: true },
    ),
    false,
    "stable silent lobby poll should skip hydrate",
  );
}

async function assertPollingDoesNotOverlapAndUsesExpectedIntervals() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
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

  try {
    const board = loadPageDefinition("frontend/packageRoom/pages/board/index.js");
    let releaseRequest;
    let requestCount = 0;
    const context = {
      ...board,
      isPageVisible: true,
      isPageUnloaded: false,
      data: {
        ...board.data,
        roomId: "room_1",
        snapshot: null,
      },
      loadGameSnapshot() {
        requestCount += 1;
        return new Promise((resolve) => {
          releaseRequest = resolve;
        });
      },
    };

    assert.strictEqual(board.getPollIntervalMs.call(context), 4000, "ordinary board wait should poll around four seconds");
    context.data.snapshot = { pendingTask: { taskType: "SUBMIT_VOTE" } };
    assert.strictEqual(board.getPollIntervalMs.call(context), 1000, "pending task should keep one-second polling");
    context.lastCommandSettledAt = Date.now();
    assert.strictEqual(board.getPollIntervalMs.call(context), 800, "recent command should keep fast polling");
    context.lastCommandSettledAt = 0;
    context.data.snapshot = null;

    board.startRefreshTimer.call(context);
    assert.strictEqual(scheduled[0].delay, 4000);
    board.markCommandSettled.call(context);
    assert.strictEqual(scheduled[0].cleared, true, "settled command should replace the existing board timer");
    assert.strictEqual(scheduled[1].delay, 800, "settled command should immediately schedule the fast polling window");
    const callbackPromise = scheduled[1].callback();
    assert.strictEqual(requestCount, 1);
    assert.strictEqual(scheduled.length, 2, "next poll should wait for the current request to settle");
    releaseRequest(true);
    await callbackPromise;
    assert.strictEqual(scheduled.length, 3, "successful poll should schedule exactly one next timeout");
    const hiddenCallbackPromise = scheduled[2].callback();
    context.isPageVisible = false;
    releaseRequest(true);
    await hiddenCallbackPromise;
    assert.strictEqual(scheduled.length, 3, "hidden board page should not schedule another poll");

    let releaseSharedRequest;
    let sharedRequestCount = 0;
    context.fetchGameSnapshot = () => {
      sharedRequestCount += 1;
      return new Promise((resolve) => {
        releaseSharedRequest = resolve;
      });
    };
    context.snapshotRequestInFlight = null;
    const first = board.loadGameSnapshot.call(context, { silent: true });
    const overlapping = board.loadGameSnapshot.call(context, { silent: true });
    assert.strictEqual(sharedRequestCount, 1, "overlapping board loads should share the in-flight request");
    releaseSharedRequest(true);
    assert.strictEqual(await first, true);
    assert.strictEqual(await overlapping, true);

    const requestedContexts = [];
    const requestReleases = [];
    let activeRequestCount = 0;
    let maxActiveRequestCount = 0;
    context.data.controlledMemberId = "virtual_old";
    context.snapshotRequestInFlight = null;
    context.snapshotRequestQueue = [];
    context.fetchGameSnapshot = (options, requestContext) => {
      requestedContexts.push({ ...requestContext });
      activeRequestCount += 1;
      maxActiveRequestCount = Math.max(maxActiveRequestCount, activeRequestCount);
      return new Promise((resolve) => {
        requestReleases.push((value) => {
          activeRequestCount -= 1;
          resolve(value);
        });
      });
    };
    const oldSeatLoad = board.loadGameSnapshot.call(context, { silent: true });
    context.data.controlledMemberId = "virtual_new";
    const newSeatLoad = board.loadGameSnapshot.call(context);
    assert.strictEqual(requestedContexts.length, 1, "new seat request should wait for the old seat request");
    assert.strictEqual(requestedContexts[0].controlledMemberId, "virtual_old");
    requestReleases[0](true);
    await oldSeatLoad;
    await Promise.resolve();
    assert.strictEqual(requestedContexts.length, 2, "new seat request should fetch immediately after old request settles");
    assert.strictEqual(requestedContexts[1].controlledMemberId, "virtual_new");
    assert.strictEqual(maxActiveRequestCount, 1, "different board snapshot keys must not overlap");
    requestReleases[1](true);
    assert.strictEqual(await newSeatLoad, true);

    const lobby = loadPageDefinition("frontend/packageRoom/pages/lobby/index.js");
    const lobbyContext = {
      ...lobby,
      isPageVisible: true,
      isPageUnloaded: false,
      data: { ...lobby.data, roomId: "room_1" },
      loadLobbySnapshot: async () => true,
    };
    lobby.startRefreshTimer.call(lobbyContext);
    assert.strictEqual(scheduled[scheduled.length - 1].delay, 3000, "lobby polling should remain three seconds");

    let releaseLobbyRequest;
    let lobbyRequestCount = 0;
    lobbyContext.fetchLobbySnapshot = () => {
      lobbyRequestCount += 1;
      return new Promise((resolve) => {
        releaseLobbyRequest = resolve;
      });
    };
    lobbyContext.snapshotRequestInFlight = null;
    const firstLobbyLoad = lobby.loadLobbySnapshot.call(lobbyContext, { silent: true });
    const overlappingLobbyLoad = lobby.loadLobbySnapshot.call(lobbyContext, { silent: true });
    assert.strictEqual(lobbyRequestCount, 1, "overlapping lobby loads should share the in-flight request");
    releaseLobbyRequest(true);
    assert.strictEqual(await firstLobbyLoad, true);
    assert.strictEqual(await overlappingLobbyLoad, true);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

async function assertLobbySuccessCommandDoesNotPullAgain() {
  global.wx = {
    cloud: {},
    showToast() {},
  };
  const lobby = loadPageDefinition("frontend/packageRoom/pages/lobby/index.js");
  let hydrateCount = 0;
  let loadCount = 0;
  const snapshot = {
    roomId: "room_1",
    roomStatus: "lobby",
    version: 2,
    viewerState: { myMemberId: "member_1", isHost: false, myIsReady: true },
    seatOrder: [],
    targetPlayerCount: 5,
  };
  const context = {
    ...lobby,
    data: {
      ...lobby.data,
      roomId: "room_1",
      lobby: {
        ...snapshot,
        version: 1,
        viewerState: { ...snapshot.viewerState, myIsReady: false },
      },
    },
    callRoomService: async () => snapshot,
    hydrateLobby: async () => {
      hydrateCount += 1;
    },
    loadLobbySnapshot: async () => {
      loadCount += 1;
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };

  await lobby.onReadyAction.call(context);
  assert.strictEqual(hydrateCount, 1, "successful ready command should hydrate returned snapshot");
  assert.strictEqual(loadCount, 0, "successful ready command should not immediately pull the lobby again");
}

async function assertAppUsesSingleBootstrapCall() {
  const appPath = path.resolve(__dirname, "../../../frontend/app.js");
  const bootstrapServicePath = path.resolve(__dirname, "../../../frontend/services/bootstrapService.js");
  const actions = [];
  let appDefinition;
  global.App = (definition) => {
    appDefinition = definition;
  };
  global.getCurrentPages = () => [];
  global.wx = {
    cloud: {
      callFunction: async ({ data }) => {
        actions.push(data.action);
        return {
          result: {
            success: true,
            data: {
              user: { sessionReady: true },
              activeRoom: null,
            },
          },
        };
      },
    },
  };
  delete require.cache[bootstrapServicePath];
  delete require.cache[appPath];
  require(appPath);

  const context = {
    ...appDefinition,
    globalData: { ...appDefinition.globalData },
  };
  await appDefinition.ensureSessionAndRecover.call(context, { source: "launch" });
  assert.deepStrictEqual(actions, ["recoverActiveRoom"], "normal startup should use one recovery bootstrap call");
  actions.length = 0;
  await appDefinition.ensureSessionAndRecover.call(context, { source: "show", skipRecoverRoute: true });
  assert.deepStrictEqual(actions, ["ensureSession"], "skip-recovery route should only ensure the session");
}

function assertAppCanonicalizesLobbyShareRecovery() {
  const appPath = path.resolve(__dirname, "../../../frontend/app.js");
  const originalWx = global.wx;
  const originalApp = global.App;
  const originalGetCurrentPages = global.getCurrentPages;
  let appDefinition;
  let currentPage = {
    route: "packageRoom/pages/lobby/index",
    options: {
      roomId: "room_shared",
      roomCode: "654321",
    },
  };
  const redirects = [];
  const relaunches = [];

  global.App = (definition) => {
    appDefinition = definition;
  };
  global.getCurrentPages = () => [currentPage];
  global.wx = {
    redirectTo({ url }) {
      redirects.push(url);
    },
    reLaunch({ url }) {
      relaunches.push(url);
    },
  };
  delete require.cache[appPath];
  require(appPath);

  try {
    const activeLobby = {
      roomId: "room_shared",
      roomCode: "654321",
      memberId: "mem_shared",
      routeHint: "lobby",
    };
    appDefinition.routeByActiveRoom(activeLobby);
    assert.deepStrictEqual(redirects, [
      "/packageRoom/pages/lobby/index?roomId=room_shared&memberId=mem_shared",
    ]);

    currentPage = {
      route: "packageRoom/pages/lobby/index",
      options: {
        roomId: "room_shared",
        memberId: "mem_shared",
      },
    };
    appDefinition.routeByActiveRoom(activeLobby);
    assert.strictEqual(redirects.length, 1, "canonical lobby recovery must not navigate again");

    currentPage = {
      route: "packageResult/pages/result/index",
      options: {
        roomId: "room_result",
        roomCode: "654321",
      },
    };
    appDefinition.routeByActiveRoom({
      roomId: "room_result",
      roomCode: "654321",
      memberId: "mem_result",
      routeHint: "result",
    });
    assert.strictEqual(relaunches.length, 0, "result roomCode must not be treated as a lobby share entry");
  } finally {
    global.wx = originalWx;
    global.App = originalApp;
    global.getCurrentPages = originalGetCurrentPages;
  }
}

async function assertAppRetriesFailedOverlappingRecoveryOnce() {
  const appPath = path.resolve(__dirname, "../../../frontend/app.js");
  const bootstrapServicePath = path.resolve(__dirname, "../../../frontend/services/bootstrapService.js");
  const originalConsoleError = console.error;
  let appDefinition;
  let callCount = 0;
  let rejectFirst;
  const routedRooms = [];
  global.App = (definition) => {
    appDefinition = definition;
  };
  global.getCurrentPages = () => [];
  global.wx = {
    cloud: {
      callFunction: ({ data }) => {
        assert.strictEqual(data.action, "recoverActiveRoom");
        callCount += 1;
        if (callCount === 1) {
          return new Promise((resolve, reject) => {
            rejectFirst = reject;
          });
        }
        return Promise.resolve({
          result: {
            success: true,
            data: {
              activeRoom: {
                roomId: "room_recovered",
                roomCode: "654321",
                routeHint: "board",
              },
            },
          },
        });
      },
    },
  };
  console.error = () => {};
  delete require.cache[bootstrapServicePath];
  delete require.cache[appPath];
  require(appPath);

  try {
    const context = {
      ...appDefinition,
      globalData: { ...appDefinition.globalData },
      routeByActiveRoom(activeRoom) {
        routedRooms.push(activeRoom);
      },
    };
    const launchRecovery = appDefinition.ensureSessionAndRecover.call(context, { source: "launch" });
    const showRecovery = appDefinition.ensureSessionAndRecover.call(context, { source: "show" });
    assert.strictEqual(callCount, 1, "overlapping startup recovery should share the first request");

    rejectFirst(new Error("first recovery failed"));
    await Promise.all([launchRecovery, showRecovery]);
    assert.strictEqual(callCount, 2, "a failed startup request with a pending onShow should retry once");
    assert.strictEqual(routedRooms.length, 1);
    assert.strictEqual(routedRooms[0].roomId, "room_recovered");
  } finally {
    console.error = originalConsoleError;
  }
}

async function assertAppDoesNotLoopAfterRetryFailure() {
  const appPath = path.resolve(__dirname, "../../../frontend/app.js");
  const bootstrapServicePath = path.resolve(__dirname, "../../../frontend/services/bootstrapService.js");
  const originalConsoleError = console.error;
  let appDefinition;
  const rejectors = [];
  let callCount = 0;
  global.App = (definition) => {
    appDefinition = definition;
  };
  global.getCurrentPages = () => [];
  global.wx = {
    cloud: {
      callFunction: () => {
        callCount += 1;
        return new Promise((resolve, reject) => {
          rejectors.push(reject);
        });
      },
    },
  };
  console.error = () => {};
  delete require.cache[bootstrapServicePath];
  delete require.cache[appPath];
  require(appPath);

  try {
    const context = {
      ...appDefinition,
      globalData: { ...appDefinition.globalData },
    };
    const launchRecovery = appDefinition.ensureSessionAndRecover.call(context, { source: "launch" });
    const showRecovery = appDefinition.ensureSessionAndRecover.call(context, { source: "show" });
    rejectors[0](new Error("first recovery failed"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(callCount, 2);
    rejectors[1](new Error("retry failed"));
    await Promise.all([launchRecovery, showRecovery]);
    assert.strictEqual(callCount, 2, "a failed retry must not start an unbounded loop");
  } finally {
    console.error = originalConsoleError;
  }
}

(async () => {
  await assertTempFileUrlCache();
  await assertStablePollSkipsHydrate();
  await assertPollingDoesNotOverlapAndUsesExpectedIntervals();
  await assertLobbySuccessCommandDoesNotPullAgain();
  await assertAppUsesSingleBootstrapCall();
  assertAppCanonicalizesLobbyShareRecovery();
  await assertAppRetriesFailedOverlappingRecoveryOnce();
  await assertAppDoesNotLoopAfterRetryFailure();
  console.log("frontend performance optimization tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
