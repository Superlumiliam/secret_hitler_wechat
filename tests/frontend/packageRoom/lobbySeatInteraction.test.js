const assert = require("assert");
const path = require("path");

function loadLobbyPage() {
  const pagePath = path.resolve(__dirname, "../../../frontend/packageRoom/pages/lobby/index.js");
  let pageDefinition = null;
  global.Page = (definition) => {
    pageDefinition = definition;
  };
  delete require.cache[pagePath];
  require(pagePath);
  return pageDefinition;
}

function createContext(lobby, overrides = {}) {
  return {
    ...lobby,
    data: {
      ...lobby.data,
      roomId: "room_1",
      lobby: { roomId: "room_1", roomStatus: "lobby" },
      seats: [
        { seatIndex: 3, isEmpty: true },
        { seatIndex: 4, isEmpty: true },
      ],
      ...overrides.data,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
    ...overrides,
  };
}

function emptySeatEvent(seatIndex) {
  return { currentTarget: { dataset: { seatIndex } } };
}

async function assertDoubleTapClaimsExactlyOnce() {
  const lobby = loadLobbyPage();
  const claims = [];
  const context = createContext(lobby, {
    claimLobbySeat(seatIndex) {
      claims.push(seatIndex);
    },
  });
  const originalNow = Date.now;
  try {
    Date.now = () => 1000;
    lobby.onTapEmptySeat.call(context, emptySeatEvent(3));
    Date.now = () => 1200;
    lobby.onTapEmptySeat.call(context, emptySeatEvent(3));
    Date.now = () => 1300;
    lobby.onTapEmptySeat.call(context, emptySeatEvent(3));

    assert.deepStrictEqual(claims, [3], "only the second tap in the threshold should claim the seat");
  } finally {
    Date.now = originalNow;
  }
}

async function assertEmptySeatsHaveNoInvitationState() {
  const lobby = loadLobbyPage();
  const context = createContext(lobby);
  const seats = lobby.buildSeats.call(context, {
    targetPlayerCount: 1,
    seatOrder: [],
  });

  assert.strictEqual(typeof lobby.onLongPressEmptySeat, "undefined");
  assert.strictEqual("isInviteArmed" in seats[0], false);
}

async function assertClaimUsesReturnedSnapshotAndRefreshesConflict() {
  const lobby = loadLobbyPage();
  let hydratedSnapshot = null;
  const successContext = createContext(lobby, {
    callRoomService: async () => ({ roomId: "room_1", version: 2 }),
    hydrateLobby: async (snapshot) => {
      hydratedSnapshot = snapshot;
    },
  });
  await lobby.claimLobbySeat.call(successContext, 3);
  assert.strictEqual(hydratedSnapshot.version, 2);
  assert.strictEqual(successContext.data.seatChangeSubmitting, false);

  let refreshCount = 0;
  global.wx = { showToast() {} };
  const conflictContext = createContext(lobby, {
    callRoomService: async () => {
      const err = new Error("该座位已被其他玩家占用");
      err.code = "SEAT_OCCUPIED";
      throw err;
    },
    loadLobbySnapshot: async () => {
      refreshCount += 1;
    },
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await lobby.claimLobbySeat.call(conflictContext, 3);
  } finally {
    console.error = originalConsoleError;
  }
  assert.strictEqual(refreshCount, 1, "seat conflicts should refresh the authoritative lobby snapshot");
  assert.strictEqual(conflictContext.data.seatChangeSubmitting, false);
}

async function assertOlderLobbySnapshotCannotOverwriteNewerState() {
  const lobby = loadLobbyPage();
  global.wx = {};
  const context = createContext(lobby, {
    data: {
      lobby: {
        roomId: "room_1",
        roomStatus: "lobby",
        version: 3,
      },
      seats: [],
    },
  });

  const applied = await lobby.hydrateLobby.call(context, {
    roomId: "room_1",
    roomStatus: "lobby",
    version: 2,
    seatOrder: [],
  });

  assert.strictEqual(applied, false);
  assert.strictEqual(context.data.lobby.version, 3, "an older write response must not roll back the lobby view");
}

(async () => {
  await assertDoubleTapClaimsExactlyOnce();
  await assertEmptySeatsHaveNoInvitationState();
  await assertClaimUsesReturnedSnapshotAndRefreshesConflict();
  await assertOlderLobbySnapshotCannotOverwriteNewerState();
  console.log("lobby seat interaction tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
