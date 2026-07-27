const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildRoomShare, enableShareMenu } = require("../../../frontend/utils/share");
const gameMapper = require("../../../frontend/packageRoom/mappers/gameMapper");

function loadBoardPage() {
  const pagePath = path.resolve(__dirname, "../../../frontend/packageRoom/pages/board/index.js");
  let pageDefinition = null;
  global.Page = (definition) => {
    pageDefinition = definition;
  };
  delete require.cache[pagePath];
  require(pagePath);
  return pageDefinition;
}

function createContext(board, overrides = {}) {
  return {
    ...board,
    data: {
      ...board.data,
      roomId: "room_1",
      board: { roomCode: "654321" },
      canNominate: false,
      canExecuteAction: false,
      canAckPolicyPeek: false,
      ...overrides.data,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
    ...overrides,
  };
}

function assertSpectatorIdentityIsBlocked() {
  const board = loadBoardPage();
  const toasts = [];
  let navigationCount = 0;
  global.wx = {
    showToast(options) {
      toasts.push(options);
    },
    navigateTo() {
      navigationCount += 1;
    },
  };
  const context = createContext(board, {
    data: {
      isSpectatorView: true,
    },
  });

  board.onTapIdentity.call(context);
  assert.strictEqual(navigationCount, 0);
  assert.strictEqual(toasts[0].title, "观战视角仅显示公共信息，无法查看玩家身份");
}

async function assertSoloSpectatorCanSwitchViewsWithPrompts() {
  const board = loadBoardPage();
  let loadCount = 0;
  const toastTitles = [];
  global.wx = {
    showToast(options) {
      toastTitles.push(options.title);
    },
  };
  const context = createContext(board, {
    data: {
      isSoloRoom: true,
      controlledMemberId: "",
      snapshot: {
        realMemberId: "host_spectator",
        viewerState: {
          realMemberType: "spectator",
          isSpectatorView: true,
        },
      },
    },
    loadGameSnapshot() {
      loadCount += 1;
      const controlledMemberId = context.data.controlledMemberId;
      context.data.snapshot = {
        realMemberId: "host_spectator",
        myMemberId: controlledMemberId || "host_spectator",
        viewerState: {
          realMemberType: "spectator",
          isSpectatorView: !controlledMemberId,
        },
      };
      return Promise.resolve(true);
    },
  });
  const event = {
    detail: { memberId: "virtual_1" },
    currentTarget: { dataset: {} },
  };
  const originalNow = Date.now;
  try {
    Date.now = () => 1000;
    board.onTapSeat.call(context, event);
    Date.now = () => 1200;
    await board.onTapSeat.call(context, event);
    assert.strictEqual(context.data.controlledMemberId, "virtual_1");
    assert.strictEqual(toastTitles[0], "已切换到玩家位");

    Date.now = () => 2000;
    board.onTapSeat.call(context, event);
    Date.now = () => 2200;
    await board.onTapSeat.call(context, event);
  } finally {
    Date.now = originalNow;
  }

  assert.strictEqual(context.data.controlledMemberId, "");
  assert.strictEqual(loadCount, 2);
  assert.deepStrictEqual(toastTitles, ["已切换到玩家位", "已切换到观战位"]);
}

async function assertPollingContinuationDoesNotConfirmFailedViewSwitch() {
  const board = loadBoardPage();
  const toastTitles = [];
  global.wx = {
    showToast(options) {
      toastTitles.push(options.title);
    },
  };
  const context = createContext(board, {
    data: {
      isSoloRoom: true,
      controlledMemberId: "",
      snapshot: {
        realMemberId: "host_spectator",
        myMemberId: "host_spectator",
        viewerState: {
          realMemberType: "spectator",
          isSpectatorView: true,
        },
      },
    },
    loadGameSnapshot() {
      wx.showToast({
        title: "获取对局数据失败",
        icon: "none",
      });
      return Promise.resolve(true);
    },
  });
  const event = {
    detail: { memberId: "virtual_1" },
    currentTarget: { dataset: {} },
  };
  const originalNow = Date.now;
  try {
    Date.now = () => 1000;
    board.onTapSeat.call(context, event);
    Date.now = () => 1200;
    await board.onTapSeat.call(context, event);
  } finally {
    Date.now = originalNow;
  }

  assert.deepStrictEqual(
    toastTitles,
    ["获取对局数据失败"],
    "continuing to poll after a failed refresh must not show a successful view-switch prompt",
  );
}

function assertIdentityIntroOnlyAppearsDuringOpeningRound() {
  const board = loadBoardPage();
  const writtenStorageKeys = [];
  global.wx = {
    getStorageSync() {
      return false;
    },
    setStorage(options) {
      writtenStorageKeys.push(options.key);
    },
  };
  const context = createContext(board);
  context.identityIntroRevealShownByKey = {};

  const openingReveal = board.createIdentityIntroReveal.call(context, {
    roomId: "room_1",
    myMemberId: "virtual_1",
    round: 1,
    privateState: {
      identity: {
        role: "FASCIST",
      },
    },
  });
  assert.ok(openingReveal, "a newly controlled player may reveal their identity during opening");

  context.data.identityIntroReveal = null;
  const repeatedOpeningReveal = board.createIdentityIntroReveal.call(context, {
    roomId: "room_1",
    myMemberId: "virtual_1",
    round: 1,
    privateState: {
      identity: {
        role: "FASCIST",
      },
    },
  });
  assert.strictEqual(repeatedOpeningReveal, null, "the same seat must reveal at most once");

  const laterRoundReveal = board.createIdentityIntroReveal.call(context, {
    roomId: "room_1",
    myMemberId: "virtual_2",
    round: 2,
    privateState: {
      identity: {
        role: "LIBERAL",
      },
    },
  });
  assert.strictEqual(laterRoundReveal, null, "switching seats in later elections must not show identity cards");
  assert.deepStrictEqual(writtenStorageKeys, ["board_identity_intro_reveal:room_1:virtual_1"]);
}

function assertSpectatorViewLabelsAndShare() {
  assert.strictEqual(
    gameMapper.createControlledSeatText({
      viewerState: { isSpectatorView: true },
      publicState: { seatOrder: [] },
    }),
    "当前视角：公共观战",
  );

  const share = buildRoomShare("654321", "room_1");
  assert.strictEqual(share.path, "/packageRoom/pages/lobby/index?roomId=room_1&roomCode=654321");

  const board = loadBoardPage();
  const context = createContext(board);
  assert.deepStrictEqual(board.onShareAppMessage.call(context), share);
  context.data.board = null;
  assert.strictEqual(
    board.onShareAppMessage.call(context),
    undefined,
    "the board must not generate a fallback home share before roomCode is loaded",
  );
  assert.strictEqual(
    typeof board.onShareTimeline,
    "undefined",
    "the board must not expose timeline sharing because timeline shares reopen the current board path",
  );
}

function assertBoardShareMenuCanExcludeTimeline() {
  let shareMenuOptions = null;
  global.wx = {
    showShareMenu(options) {
      shareMenuOptions = options;
    },
  };
  enableShareMenu({
    includeTimeline: false,
  });
  assert.deepStrictEqual(shareMenuOptions.menus, ["shareAppMessage"]);

  enableShareMenu();
  assert.deepStrictEqual(
    shareMenuOptions.menus,
    ["shareAppMessage", "shareTimeline"],
    "other pages must retain their existing timeline share menu",
  );
}

function assertBoardOnLoadHidesShareUntilSnapshotIsReady() {
  const board = loadBoardPage();
  let shareMenuOptions = null;
  let hiddenMenuOptions = null;
  global.wx = {
    showShareMenu(options) {
      shareMenuOptions = options;
    },
    hideShareMenu(options) {
      hiddenMenuOptions = options;
    },
  };
  const context = createContext(board, {
    loadGameSnapshot: () => Promise.resolve(false),
  });

  board.onLoad.call(context, {
    roomId: "room_1",
  });
  clearTimeout(context.__pageTimeoutTimer);
  assert.strictEqual(shareMenuOptions, null);
  assert.deepStrictEqual(
    hiddenMenuOptions.menus,
    ["shareAppMessage", "shareTimeline"],
  );
}

function assertBoardShareEnablesOnceRoomCodeIsReady() {
  const board = loadBoardPage();
  const shownMenus = [];
  global.wx = {
    showShareMenu(options) {
      shownMenus.push(options.menus);
    },
  };
  const context = createContext(board);
  context.boardShareMenuEnabled = false;

  assert.strictEqual(board.enableBoardShareMenu.call(context, {}), false);
  assert.deepStrictEqual(shownMenus, []);
  assert.strictEqual(
    board.enableBoardShareMenu.call(context, { roomCode: "654321" }),
    true,
  );
  assert.deepStrictEqual(shownMenus, [["shareAppMessage"]]);
  assert.strictEqual(
    board.enableBoardShareMenu.call(context, { roomCode: "654321" }),
    false,
  );
  assert.strictEqual(shownMenus.length, 1);
}

function assertBoardHeaderReservesSeparateActionColumns() {
  const stylePath = path.resolve(__dirname, "../../../frontend/packageRoom/pages/board/index.wxss");
  const markupPath = path.resolve(__dirname, "../../../frontend/packageRoom/pages/board/index.wxml");
  const styles = fs.readFileSync(stylePath, "utf8");
  const markup = fs.readFileSync(markupPath, "utf8");
  const roomMetaRule = styles.match(/\.room-meta-row\s*\{([^}]*)\}/);
  const topActionsRule = styles.match(/\.top-actions\s*\{([^}]*)\}/);
  const toolControlRule = styles.match(/\.tool-control\s*\{([^}]*)\}/);
  const shareTriggerRule = styles.match(/\.tool-share-trigger\s*\{([^}]*)\}/);

  assert.ok(roomMetaRule, "board room meta row style must exist");
  assert.match(roomMetaRule[1], /display:\s*grid/);
  assert.match(roomMetaRule[1], /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+220rpx/);
  assert.ok(topActionsRule, "board top actions style must exist");
  assert.match(topActionsRule[1], /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.ok(toolControlRule, "board tool control style must exist");
  assert.match(toolControlRule[1], /width:\s*100%/);
  assert.match(toolControlRule[1], /min-width:\s*0/);
  assert.ok(shareTriggerRule, "the native share button must have an isolated hit area");
  assert.match(shareTriggerRule[1], /position:\s*absolute/);
  assert.match(shareTriggerRule[1], /inset:\s*0/);
  assert.match(
    markup,
    /<view class="tool-control tool-share-control">\s*<button class="tool-share-trigger"[^>]*><\/button>/,
    "the native share button must not participate directly in the header grid",
  );
}

(async () => {
  assertSpectatorIdentityIsBlocked();
  await assertSoloSpectatorCanSwitchViewsWithPrompts();
  await assertPollingContinuationDoesNotConfirmFailedViewSwitch();
  assertIdentityIntroOnlyAppearsDuringOpeningRound();
  assertSpectatorViewLabelsAndShare();
  assertBoardShareMenuCanExcludeTimeline();
  assertBoardOnLoadHidesShareUntilSnapshotIsReady();
  assertBoardShareEnablesOnceRoomCodeIsReady();
  assertBoardHeaderReservesSeparateActionColumns();
  console.log("spectator UI tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
