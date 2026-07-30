const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
      ...overrides.data,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
    ...overrides,
  };
}

function assertSeatSectionDefaultsToExpandedAndToggles() {
  const board = loadBoardPage();
  const context = createContext(board);

  assert.strictEqual(context.data.seatSectionCollapsed, false, "seat section should default to expanded");
  board.onToggleSeatSection.call(context);
  assert.strictEqual(context.data.seatSectionCollapsed, true, "first tap should collapse every seat");
  board.onToggleSeatSection.call(context);
  assert.strictEqual(context.data.seatSectionCollapsed, false, "second tap should expand every seat");
}

function assertSeatRefreshPreservesCollapseState() {
  const board = loadBoardPage();
  const snapshot = {
    currentPhase: "nomination",
    publicState: {
      seatOrder: [],
    },
  };
  const context = createContext(board, {
    data: {
      seatSectionCollapsed: true,
      snapshot,
    },
    createSeats() {
      return [];
    },
    resolveSelectedNominationTargetId() {
      return "";
    },
    createSelectedNominationTargetLabel() {
      return "";
    },
    resolveSelectedExecutiveTargetId() {
      return "";
    },
    createSelectedExecutiveTargetLabel() {
      return "";
    },
    createActiveIdentityPickerOptions() {
      return [];
    },
  });

  board.refreshSeatViews.call(context);
  assert.strictEqual(context.data.seatSectionCollapsed, true, "seat refresh must not reopen a collapsed section");
}

function assertMarkupGatesSeatListAndPreservesEvents() {
  const markupPath = path.resolve(__dirname, "../../../frontend/packageRoom/pages/board/index.wxml");
  const markup = fs.readFileSync(markupPath, "utf8");

  assert.match(markup, /bindtap="onToggleSeatSection"/, "seat section should expose a toggle control");
  assert.match(markup, /aria-label="\{\{seatSectionCollapsed \? '展开玩家席位' : '收起玩家席位'\}\}"/);
  assert.match(markup, /<seat-list\s+wx:if="\{\{!seatSectionCollapsed\}\}"/);
  assert.match(markup, /bind:tapseat="onTapSeat"/);
  assert.match(markup, /bind:tapavatar="onTapAvatar"/);
  assert.match(markup, /bind:tapidentitymark="onTapIdentityMark"/);
}

assertSeatSectionDefaultsToExpandedAndToggles();
assertSeatRefreshPreservesCollapseState();
assertMarkupGatesSeatListAndPreservesEvents();

console.log("seat collapse UI tests passed");
