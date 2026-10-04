const assert = require("assert");
const path = require("path");
const { createMemoryDb, loadRoomService, loadBootstrapService } = require("../backend/helpers/loadGameService");

function loadPage(relativePath) {
  const filename = path.resolve(__dirname, "../../frontend", relativePath);
  let definition;
  global.Page = (page) => { definition = page; };
  delete require.cache[filename];
  require(filename);
  return {
    ...definition,
    data: { ...definition.data },
    setData(update) { Object.assign(this.data, update); },
  };
}

function setupRuntime() {
  const db = createMemoryDb();
  const roomService = loadRoomService({ db, openId: "navigation_user" }).service;
  const bootstrapService = loadBootstrapService({ db, openId: "navigation_user" }).service;
  const calls = [];
  const toasts = [];
  const profile = { profileCompleted: true, displayName: "导航测试用户", avatarUrl: "" };
  let stack = ["/pages/home/index"];
  global.getCurrentPages = () => stack.map((url) => {
    const [route, query] = url.split("?");
    return { route: route.replace(/^\//, ""), options: Object.fromEntries(new URLSearchParams(query)) };
  });
  global.wx = {
    getStorageSync: () => profile,
    getStorage: ({ success }) => success({ data: profile }),
    navigateTo: ({ url }) => { stack.push(url); },
    redirectTo: ({ url }) => { stack[stack.length - 1] = url; },
    reLaunch: ({ url }) => { stack = [url]; },
    navigateBack: () => { if (stack.length > 1) stack.pop(); },
    showToast: ({ title }) => { toasts.push(title); },
    showShareMenu() {},
    cloud: {
      async callFunction({ name, data }) {
        calls.push({ name, ...data });
        return { result: await (name === "roomService" ? roomService : bootstrapService).main(data) };
      },
    },
  };
  let app;
  global.App = (definition) => { app = definition; };
  const appPath = path.resolve(__dirname, "../../frontend/app.js");
  delete require.cache[appPath];
  require(appPath);
  global.getApp = () => app;
  return { db, calls, toasts, app, getStack: () => stack.slice() };
}

async function assertCreateHideRecoverAndLeave() {
  for (const mode of ["solo", "normal"]) {
    const runtime = setupRuntime();
    const home = loadPage("pages/home/index.js");
    const create = loadPage("pages/create-room/index.js");
    create.data.mode = mode;
    create.data.selectedCount = 5;
    if (mode === "solo") await home.onCreateSoloRoom();
    else await home.onCreateRoom();
    await create.onCreateRoom();

    const profile = runtime.db.dump().user_profiles.navigation_user;
    assert(profile.activeRoomId);
    assert.strictEqual(runtime.getStack().length, 1, "created lobby must not retain home underneath");
    assert.strictEqual(getCurrentPages()[0].route, "packageRoom/pages/lobby/index");
    wx.navigateBack();
    assert.strictEqual(getCurrentPages()[0].route, "packageRoom/pages/lobby/index", "native back must have no home page to reveal");

    const lobby = loadPage("packageRoom/pages/lobby/index.js");
    lobby.data.roomId = profile.activeRoomId;
    const before = JSON.stringify(runtime.db.dump());
    lobby.onHide();
    lobby.onUnload();
    assert.strictEqual(JSON.stringify(runtime.db.dump()), before, "hide/unload must preserve membership and recovery anchor");
    assert(!runtime.calls.some((call) => call.action === "leaveRoom"));

    wx.reLaunch({ url: "/pages/home/index" });
    await runtime.app.ensureSessionAndRecover();
    assert.strictEqual(runtime.getStack().length, 1);
    assert.strictEqual(getCurrentPages()[0].options.roomId, profile.activeRoomId, "recovery must restore the same lobby");

    // A stale creation page must explain the conflict without changing the room.
    create.data.isSubmitting = false;
    const originalError = console.error;
    console.error = () => {};
    try { await create.onCreateRoom(); } finally { console.error = originalError; }
    assert.strictEqual(runtime.toasts.at(-1), "已有房间，请先退出再创建");
    assert.strictEqual(runtime.db.dump().user_profiles.navigation_user.activeRoomId, profile.activeRoomId);

    await lobby.onBackHome();
    assert.strictEqual(getCurrentPages()[0].route, "pages/home/index");
    assert.strictEqual(runtime.db.dump().user_profiles.navigation_user.activeRoomId, null);
    create.data.isSubmitting = false;
    await create.onCreateRoom();
    assert.notStrictEqual(runtime.db.dump().user_profiles.navigation_user.activeRoomId, profile.activeRoomId);
    assert.strictEqual(runtime.getStack().length, 1, "creating after explicit leave must work");
  }
}

async function assertStackGuardPreservesEntryAndInitialSnapshot() {
  for (const options of [
    { roomId: "room test", memberId: "member test", joinedAs: "spectator" },
    { roomId: "room test", roomCode: "654321" },
  ]) {
    const runtime = setupRuntime();
    const snapshot = { memberId: "member test", lobbySnapshot: { roomId: "room test" }, expiresAt: Date.now() + 30000 };
    runtime.app.globalData.initialLobbySnapshots = { "room test": snapshot };
    wx.navigateTo({ url: "/packageRoom/pages/lobby/index" });
    const lobby = loadPage("packageRoom/pages/lobby/index.js");
    let loads = 0;
    lobby.loadPageAssets = () => { loads += 1; };
    lobby.loadLobbySnapshot = async () => { loads += 1; return false; };
    lobby.joinSharedRoom = async () => { loads += 1; };
    lobby.onLoad(options);
    assert.strictEqual(runtime.getStack().length, 1, "stacked share/legacy entry must reset before initialization");
    assert.deepStrictEqual(getCurrentPages()[0].options, options);
    assert.strictEqual(loads, 0, "old page must not start joins, asset loads or snapshot requests");
    assert.strictEqual(runtime.app.globalData.initialLobbySnapshots["room test"], snapshot, "stack reset must not consume the initial snapshot");
    lobby.onUnload();

    const rootLobby = loadPage("packageRoom/pages/lobby/index.js");
    rootLobby.loadPageAssets = () => {};
    rootLobby.hydrateLobby = async () => {};
    rootLobby.loadLobbySnapshot = async () => false;
    let shareJoins = 0;
    rootLobby.joinSharedRoom = async () => { shareJoins += 1; };
    rootLobby.onLoad(options);
    await Promise.resolve();
    rootLobby.onUnload();
    assert.strictEqual(runtime.getStack().length, 1, "root lobby must not relaunch in a loop");
    assert.strictEqual(shareJoins, options.roomCode ? 1 : 0);
    if (!options.roomCode) {
      assert(!runtime.app.globalData.initialLobbySnapshots["room test"], "new root page must consume cached snapshot");
      assert.strictEqual(rootLobby.data.memberId, "member test");
      assert(runtime.toasts.includes("玩家席已满，已进入观战席"));
    }
  }
}

async function assertAuxiliaryPagesReturnToLobby() {
  const runtime = setupRuntime();
  wx.reLaunch({ url: "/packageRoom/pages/lobby/index?roomId=room_test" });
  const lobby = loadPage("packageRoom/pages/lobby/index.js");
  lobby.data.roomId = "room_test";
  lobby.data.lobby = { viewerState: { isHost: true } };
  for (const open of ["onTapRoomSettings", "onTapRules"]) {
    lobby[open]();
    assert.strictEqual(runtime.getStack().length, 2);
    lobby.onHide();
    wx.navigateBack();
    lobby.onShow();
    lobby.onHide();
    assert.strictEqual(getCurrentPages()[0].route, "packageRoom/pages/lobby/index");
    assert.strictEqual(runtime.getStack().length, 1);
    assert.strictEqual(runtime.calls.length, 0, "auxiliary navigation must not leave or clear the room");
  }
}

(async () => {
  await assertCreateHideRecoverAndLeave();
  await assertStackGuardPreservesEntryAndInitialSnapshot();
  await assertAuxiliaryPagesReturnToLobby();
  console.log("lobby navigation tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
