const assert = require("assert");
const path = require("path");
const { buildRoomShare } = require("../../../frontend/utils/share");

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

function assertRoomShareUsesStableRoomId() {
  const share = buildRoomShare("654321", "room new");
  assert.strictEqual(
    share.path,
    "/packageRoom/pages/lobby/index?roomId=room%20new&roomCode=654321",
  );
  assert.strictEqual(share.query, "roomId=room%20new&roomCode=654321");
}

function assertSharedLoadTreatsRoomIdAsJoinTarget() {
  const lobby = loadLobbyPage();
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  let joinTarget = null;
  global.getApp = () => ({
    globalData: {
      initialLobbySnapshots: {},
    },
  });
  global.wx = {
    cloud: {},
    showShareMenu() {},
  };

  try {
    const context = createContext(lobby, {
      data: {
        roomId: "",
        lobby: null,
      },
      joinSharedRoom(roomCode, roomId) {
        joinTarget = { roomCode, roomId };
      },
      loadPageAssets() {},
      loadLobbySnapshot() {
        throw new Error("a share target must not be loaded as an existing membership");
      },
    });

    lobby.onLoad.call(context, {
      roomId: "room_shared",
      roomCode: "654321",
    });
    clearTimeout(context.__pageTimeoutTimer);
    assert.deepStrictEqual(joinTarget, {
      roomCode: "654321",
      roomId: "room_shared",
    });
    assert.strictEqual(context.data.roomId, "");
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
}

async function assertSharedEntryRecoversMatchingActiveRoomBeforeJoin() {
  const lobby = loadLobbyPage();
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalConsoleError = console.error;
  const routedRooms = [];
  const app = {
    globalData: {},
    routeByActiveRoom(activeRoom) {
      routedRooms.push(activeRoom);
    },
  };
  let recoveredActiveRoom = null;
  let recoveryShouldFail = false;
  let joinAttempts = 0;
  const redirects = [];

  global.getApp = () => app;
  global.wx = {
    cloud: {
      callFunction: async ({ name, data }) => {
        assert.strictEqual(name, "bootstrapService");
        assert.strictEqual(data.action, "recoverActiveRoom");
        if (recoveryShouldFail) {
          throw new Error("bootstrap unavailable");
        }
        return {
          result: {
            success: true,
            data: {
              activeRoom: recoveredActiveRoom,
            },
          },
        };
      },
    },
    getStorage({ success }) {
      success({
        data: {
          profileCompleted: true,
          displayName: "分享玩家",
          avatarUrl: "",
        },
      });
    },
    redirectTo({ url }) {
      redirects.push(url);
    },
    showToast() {},
  };
  console.error = () => {};

  try {
    for (const routeHint of ["lobby", "board", "result"]) {
      recoveredActiveRoom = {
        roomId: `room_${routeHint}`,
        roomCode: "654321",
        routeHint,
      };
      const context = createContext(lobby, {
        data: {
          roomId: "",
          lobby: null,
        },
        callRoomService: async () => {
          joinAttempts += 1;
          throw new Error("matching active room must not call joinRoom");
        },
      });

      await lobby.joinSharedRoom.call(context, "654321", recoveredActiveRoom.roomId);
      assert.strictEqual(routedRooms[routedRooms.length - 1], recoveredActiveRoom);
      assert.strictEqual(app.globalData.activeRoom, recoveredActiveRoom);
    }

    assert.strictEqual(joinAttempts, 0, "matching active rooms must route directly without joining again");

    recoveredActiveRoom = {
      roomId: "room_legacy",
      roomCode: "654321",
      routeHint: "board",
    };
    await lobby.joinSharedRoom.call(createContext(lobby), "654321");
    assert.strictEqual(routedRooms[routedRooms.length - 1], recoveredActiveRoom, "legacy roomCode links must still recover");

    recoveredActiveRoom = {
      roomId: "room_old_result",
      roomCode: "654321",
      routeHint: "result",
    };
    const otherRoomContext = createContext(lobby, {
      data: {
        roomId: "",
        lobby: null,
      },
      callRoomService: async (action, payload) => {
        joinAttempts += 1;
        assert.strictEqual(action, "joinRoom");
        assert.strictEqual(payload.roomId, "room_new_lobby");
        assert.strictEqual("roomCode" in payload, false);
        const err = new Error("当前账号已有进行中的房间");
        err.code = "ACTION_NOT_ALLOWED";
        err.isBusinessFailure = true;
        throw err;
      },
    });

    await lobby.joinSharedRoom.call(otherRoomContext, "654321", "room_new_lobby");
    assert.strictEqual(joinAttempts, 1, "a different active room must still defer rejection to joinRoom");
    assert.strictEqual(routedRooms.length, 4, "a reused roomCode must not route to a different roomId");

    recoveryShouldFail = true;
    const fallbackContext = createContext(lobby, {
      data: {
        roomId: "",
        lobby: null,
      },
      callRoomService: async (action, payload) => {
        joinAttempts += 1;
        assert.strictEqual(action, "joinRoom");
        assert.strictEqual(payload.roomId, "room_fallback");
        return {
          roomId: "room_fallback",
          memberId: "mem_fallback",
          lobbySnapshot: {},
        };
      },
      cacheInitialLobbySnapshot() {},
    });

    await lobby.joinSharedRoom.call(fallbackContext, "654321", "room_fallback");
    assert.strictEqual(joinAttempts, 2, "recovery failure must fall back to joinRoom");
    assert.strictEqual(
      redirects[redirects.length - 1],
      "/packageRoom/pages/lobby/index?roomId=room_fallback&memberId=mem_fallback",
    );
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
    console.error = originalConsoleError;
  }
}

(async () => {
  await assertDoubleTapClaimsExactlyOnce();
  await assertEmptySeatsHaveNoInvitationState();
  await assertClaimUsesReturnedSnapshotAndRefreshesConflict();
  await assertOlderLobbySnapshotCannotOverwriteNewerState();
  assertRoomShareUsesStableRoomId();
  assertSharedLoadTreatsRoomIdAsJoinTarget();
  await assertSharedEntryRecoversMatchingActiveRoomBeforeJoin();
  console.log("lobby seat interaction tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
