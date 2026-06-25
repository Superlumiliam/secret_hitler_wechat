const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const cachePath = path.join(repoRoot, "frontend/utils/gameSnapshotCache.js");
const pageTimeoutPath = path.join(repoRoot, "frontend/utils/pageTimeout.js");
const protectedPageRoutePath = path.join(repoRoot, "frontend/utils/protectedPageRoute.js");

function loadPageDefinition(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  delete require.cache[absolutePath];
  require(absolutePath);
  return definition;
}

function createPageContext(definition, data, hydrateMethod) {
  return {
    ...definition,
    data: {
      ...definition.data,
      ...data,
    },
    [hydrateMethod]: async function hydrate(snapshot) {
      this.hydratedSnapshot = snapshot;
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
}

function assertProtectedPageRouteHelpers() {
  delete require.cache[protectedPageRoutePath];
  const { buildPageUrl, reLaunchIfPageStacked, reLaunchPage } = require(protectedPageRoutePath);
  const originalGetCurrentPages = global.getCurrentPages;
  const originalWx = global.wx;
  const launches = [];
  try {
    global.wx = {
      reLaunch({ url }) {
        launches.push(url);
      },
    };
    global.getCurrentPages = () => [{ route: "pages/home/index" }];
    assert.strictEqual(
      buildPageUrl("packageRoom/pages/board/index", {
        roomId: "room 1",
        controlledMemberId: "virtual&1",
        empty: "",
      }),
      "/packageRoom/pages/board/index?roomId=room%201&controlledMemberId=virtual%261",
    );
    assert.strictEqual(reLaunchIfPageStacked("/packageRoom/pages/board/index", {}), false);
    assert.strictEqual(launches.length, 0);

    global.getCurrentPages = () => [{ route: "pages/home/index" }, { route: "packageRoom/pages/board/index" }];
    const page = {};
    assert.strictEqual(reLaunchIfPageStacked("packageRoom/pages/board/index?roomId=room_1", page), true);
    assert.strictEqual(page.__isResettingPageStack, true);
    assert.strictEqual(launches[0], "/packageRoom/pages/board/index?roomId=room_1");

    assert.strictEqual(reLaunchPage("packageResult/pages/result/index?roomId=room_1"), true);
    assert.strictEqual(launches[1], "/packageResult/pages/result/index?roomId=room_1");
  } finally {
    global.getCurrentPages = originalGetCurrentPages;
    global.wx = originalWx;
  }
}

function assertProtectedPagesResetStackBeforeLoading() {
  const originalGetCurrentPages = global.getCurrentPages;
  const originalWx = global.wx;
  const launches = [];
  try {
    global.wx = {
      reLaunch({ url }) {
        launches.push(url);
      },
    };
    global.getCurrentPages = () => [{ route: "pages/home/index" }, { route: "packageRoom/pages/board/index" }];

    const board = loadPageDefinition("frontend/packageRoom/pages/board/index.js");
    let boardLoaded = false;
    const boardContext = {
      ...board,
      data: { ...board.data },
      loadGameSnapshot() {
        boardLoaded = true;
        return Promise.resolve(false);
      },
      setData(update) {
        this.data = { ...this.data, ...update };
      },
    };
    board.onLoad.call(boardContext, {
      roomId: "room 1",
      controlledMemberId: "virtual&1",
    });
    assert.strictEqual(boardLoaded, false, "stacked board load should stop before fetching snapshots");
    assert.strictEqual(boardContext.__isResettingPageStack, true);
    assert.strictEqual(
      launches[0],
      "/packageRoom/pages/board/index?roomId=room%201&controlledMemberId=virtual%261",
    );

    const result = loadPageDefinition("frontend/packageResult/pages/result/index.js");
    let resultLoaded = false;
    let activeRoomCleared = false;
    const resultContext = {
      ...result,
      data: { ...result.data },
      loadResult() {
        resultLoaded = true;
      },
      clearResultActiveRoom() {
        activeRoomCleared = true;
      },
      setData(update) {
        this.data = { ...this.data, ...update };
      },
    };
    result.onLoad.call(resultContext, {
      roomId: "room 1",
      roomCode: "123 456",
    });
    assert.strictEqual(resultLoaded, false, "stacked result load should stop before fetching result data");
    assert.strictEqual(resultContext.__isResettingPageStack, true);
    assert.strictEqual(launches[1], "/packageResult/pages/result/index?roomId=room%201&roomCode=123%20456");

    result.onUnload.call(resultContext);
    assert.strictEqual(activeRoomCleared, false, "self relaunching result page must not clear active room");
  } finally {
    global.getCurrentPages = originalGetCurrentPages;
    global.wx = originalWx;
  }
}

async function assertCacheKeyTtlAndClear() {
  delete require.cache[cachePath];
  const cache = require(cachePath);
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    cache.clearGameSnapshotCache();
    cache.setGameSnapshotCache("room_1", "", { viewer: "real" }, { ttlMs: 50 });
    cache.setGameSnapshotCache("room_1", "virtual_1", { viewer: "virtual" }, { ttlMs: 50 });
    assert.notStrictEqual(
      cache.createGameSnapshotCacheKey("room_1", ""),
      cache.createGameSnapshotCacheKey("room_1", "virtual_1"),
    );
    assert.strictEqual(cache.getGameSnapshotCache("room_1", "").viewer, "real");
    assert.strictEqual(cache.getGameSnapshotCache("room_1", "virtual_1").viewer, "virtual");
    assert.strictEqual(cache.getGameSnapshotCache("room_1", "virtual_2"), null);

    now = 1050;
    assert.strictEqual(cache.getGameSnapshotCache("room_1", ""), null, "cache should expire at its TTL");

    cache.setGameSnapshotCache("room_1", "", { viewer: "real" });
    cache.setGameSnapshotCache("room_2", "", { viewer: "other" });
    cache.clearGameSnapshotCache("room_1");
    assert.strictEqual(cache.getGameSnapshotCache("room_1", ""), null);
    assert.strictEqual(cache.getGameSnapshotCache("room_2", "").viewer, "other");
    cache.clearGameSnapshotCache();
    assert.strictEqual(cache.getGameSnapshotCache("room_2", ""), null);
  } finally {
    Date.now = originalNow;
  }
}

async function assertSnapshotPagesUseExactCacheKey() {
  const cache = require(cachePath);
  cache.clearGameSnapshotCache();
  const cachedSnapshot = {
    roomId: "room_cache",
    version: 4,
    expireAt: "2099-01-01T00:00:00.000Z",
    privateState: { identity: { role: "LIBERAL", party: "LIBERAL" } },
    publicState: { seatOrder: [], history: { rounds: [] } },
  };
  cache.setGameSnapshotCache("room_cache", "virtual_1", cachedSnapshot);

  let cloudCallCount = 0;
  global.wx = {
    cloud: {
      callFunction: async () => {
        cloudCallCount += 1;
        return {
          result: {
            success: true,
            data: { ...cachedSnapshot, version: 5 },
          },
        };
      },
    },
    showToast() {},
  };

  for (const pageInfo of [
    ["frontend/packageRoom/pages/identity/index.js", "hydrateIdentity", "loadIdentitySnapshot"],
    ["frontend/packageRoom/pages/history/index.js", "hydrateHistory", "loadHistorySnapshot"],
  ]) {
    const [relativePath, hydrateMethod, loadMethod] = pageInfo;
    const definition = loadPageDefinition(relativePath);
    const callsBeforeHit = cloudCallCount;
    const hitContext = createPageContext(
      definition,
      { roomId: "room_cache", controlledMemberId: "virtual_1" },
      hydrateMethod,
    );
    await definition[loadMethod].call(hitContext);
    clearTimeout(hitContext.__pageTimeoutTimer);
    assert.strictEqual(hitContext.hydratedSnapshot, cachedSnapshot);
    assert.strictEqual(cloudCallCount, callsBeforeHit, `${relativePath} cache hit should not call the cloud function`);

    const missContext = createPageContext(
      definition,
      { roomId: "room_cache", controlledMemberId: "virtual_2" },
      hydrateMethod,
    );
    await definition[loadMethod].call(missContext);
    clearTimeout(missContext.__pageTimeoutTimer);
    assert.strictEqual(
      cloudCallCount,
      callsBeforeHit + 1,
      `${relativePath} must not reuse another controlled member's cache`,
    );
  }
}

async function assertCachedHydrateFailureIsHandled() {
  const cache = require(cachePath);
  const cachedSnapshot = {
    roomId: "room_hydrate_failure",
    expireAt: "2099-01-01T00:00:00.000Z",
  };
  cache.clearGameSnapshotCache();
  cache.setGameSnapshotCache("room_hydrate_failure", "virtual_1", cachedSnapshot);

  let cloudCallCount = 0;
  let toastCount = 0;
  global.wx = {
    cloud: {
      callFunction: async () => {
        cloudCallCount += 1;
        throw new Error("cache hit must not call gameService");
      },
    },
    showToast() {
      toastCount += 1;
    },
  };

  for (const pageInfo of [
    ["frontend/packageRoom/pages/identity/index.js", "hydrateIdentity", "loadIdentitySnapshot"],
    ["frontend/packageRoom/pages/history/index.js", "hydrateHistory", "loadHistorySnapshot"],
  ]) {
    const [relativePath, hydrateMethod, loadMethod] = pageInfo;
    const definition = loadPageDefinition(relativePath);
    const context = createPageContext(
      definition,
      { roomId: "room_hydrate_failure", controlledMemberId: "virtual_1", isLoading: true },
      hydrateMethod,
    );
    context[hydrateMethod] = async () => {
      throw new Error("素材映射失败");
    };

    await definition[loadMethod].call(context);
    clearTimeout(context.__pageTimeoutTimer);
    assert.strictEqual(context.data.isLoading, false, `${relativePath} should finish loading after cached hydrate failure`);
    assert.strictEqual(context.data.errorText, "素材映射失败", `${relativePath} should expose cached hydrate failure`);
  }

  assert.strictEqual(cloudCallCount, 0, "cached hydrate failures must not trigger gameService");
  assert.strictEqual(toastCount, 2, "cached hydrate failures should retain the existing toast behavior");
}

async function assertBoardCachesStableSilentSnapshot() {
  const cache = require(cachePath);
  cache.clearGameSnapshotCache();
  const snapshot = {
    roomId: "room_board",
    roomStatus: "in_game",
    version: 8,
    myMemberId: "virtual_1",
    realMemberId: "real_1",
    expireAt: "2099-01-01T00:00:00.000Z",
  };
  let hydrateCount = 0;
  global.wx = {
    cloud: {
      callFunction: async () => ({
        result: {
          success: true,
          data: snapshot,
        },
      }),
    },
  };
  const board = loadPageDefinition("frontend/packageRoom/pages/board/index.js");
  const context = {
    ...board,
    data: {
      ...board.data,
      roomId: "room_board",
      controlledMemberId: "virtual_1",
      snapshot: { ...snapshot },
    },
    hydrateSnapshot: async () => {
      hydrateCount += 1;
    },
    redirectToResultIfNeeded: () => false,
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
  await board.fetchGameSnapshot.call(context, { silent: true }, context.getSnapshotRequestContext());
  clearTimeout(context.__pageTimeoutTimer);
  assert.strictEqual(hydrateCount, 0, "stable silent snapshot should still skip hydrate");
  assert.strictEqual(
    cache.getGameSnapshotCache("room_board", "virtual_1"),
    snapshot,
    "stable silent snapshot should refresh the memory cache",
  );
}

async function assertPageTimeoutClearsSnapshotCache() {
  const cache = require(cachePath);
  delete require.cache[pageTimeoutPath];
  const pageTimeout = require(pageTimeoutPath);
  cache.setGameSnapshotCache("room_timeout", "", { roomId: "room_timeout" });
  global.getApp = () => ({
    globalData: {
      activeRoom: { roomId: "room_timeout" },
      initialLobbySnapshots: { room_timeout: {} },
    },
  });
  global.wx = {
    cloud: null,
    reLaunch() {},
  };
  await pageTimeout.handlePageTimeout({}, { reasonCode: "ROOM_EXPIRED" });
  assert.strictEqual(cache.getGameSnapshotCache("room_timeout", ""), null);
}

function assertPackageConfiguration() {
  const appConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "frontend/app.json"), "utf8"));
  assert.deepStrictEqual(appConfig.preloadRule["pages/home/index"].packages, ["packageRoom"]);
  assert.deepStrictEqual(appConfig.preloadRule["packageRoom/pages/board/index"].packages, ["packageResult"]);
  assert.strictEqual(appConfig.lazyCodeLoading, "requiredComponents");

  const projectConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "project.config.json"), "utf8"));
  assert(
    projectConfig.packOptions.ignore.some((rule) => rule.type === "suffix" && rule.value === ".DS_Store"),
    "project config should exclude .DS_Store files from packaging",
  );
}

(async () => {
  assertProtectedPageRouteHelpers();
  assertProtectedPagesResetStackBeforeLoading();
  await assertCacheKeyTtlAndClear();
  await assertSnapshotPagesUseExactCacheKey();
  await assertCachedHydrateFailureIsHandled();
  await assertBoardCachesStableSilentSnapshot();
  await assertPageTimeoutClearsSnapshotCache();
  assertPackageConfiguration();
  console.log("frontend snapshot cache tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
