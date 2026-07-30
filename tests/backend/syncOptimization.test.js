const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createMemoryDb, loadGameService, loadRoomService } = require("./helpers/loadGameService");

const FUTURE_EXPIRE_AT = "2099-01-01T00:00:00.000Z";

function makeMember(overrides = {}) {
  return {
    _id: "mem_1",
    memberId: "mem_1",
    roomId: "room_1",
    openId: "openid_1",
    displayName: "玩家1",
    avatarUrl: "",
    seatIndex: 1,
    isHost: true,
    isReady: false,
    isVirtual: false,
    memberStatus: "active",
    lastSeenAt: "2000-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function assertGameSnapshotPresenceReusesResolvedMember() {
  const db = createMemoryDb({
    rooms: {
      room_1: {
        _id: "room_1",
        roomId: "room_1",
        roomCode: "100001",
        status: "in_game",
        mode: "normal",
        expireAt: FUTURE_EXPIRE_AT,
      },
    },
    room_members: {
      mem_1: makeMember(),
    },
    room_public_snapshots: {
      room_1: {
        _id: "room_1",
        roomId: "room_1",
        snapshotType: "game_public",
        version: 3,
        payload: {
          roomCode: "100001",
          roomStatus: "in_game",
          version: 3,
          round: 1,
          currentPhase: "nomination",
          publicState: {
            history: {
              rounds: [{ round: 1, status: "nominating" }],
            },
            publicHistory: [
              {
                eventId: "evt_internal_1",
                type: "GAME_STARTED",
                summary: "内部公共事件",
              },
            ],
          },
          expireAt: FUTURE_EXPIRE_AT,
        },
      },
    },
    player_private_snapshots: {
      mem_1: {
        _id: "mem_1",
        memberId: "mem_1",
        roomId: "room_1",
        version: 3,
        payload: {
          privateState: {},
          pendingTask: null,
        },
      },
    },
  });
  const { service } = loadGameService({ db, openId: "openid_1" });

  const first = await service.main({
    action: "getGameSnapshot",
    payload: { roomId: "room_1" },
  });
  const afterFirst = db.stats();
  const { service: coldStartedService } = loadGameService({ db, openId: "openid_1" });
  const [touched, concurrentTouch] = await Promise.all([
    service.main({
      action: "getGameSnapshot",
      payload: { roomId: "room_1", touchPresence: true },
    }),
    coldStartedService.main({
      action: "getGameSnapshot",
      payload: { roomId: "room_1", touchPresence: true },
    }),
  ]);
  const afterConcurrentTouch = db.stats();

  assert.strictEqual(first.success, true);
  assert.deepStrictEqual(first.data.publicState.history, {
    rounds: [{ round: 1, status: "nominating" }],
  });
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(first.data.publicState, "publicHistory"),
    false,
    "client game snapshot should omit the server-only raw public history",
  );
  assert.deepStrictEqual(
    db.dump().room_public_snapshots.room_1.payload.publicState.publicHistory,
    [
      {
        eventId: "evt_internal_1",
        type: "GAME_STARTED",
        summary: "内部公共事件",
      },
    ],
    "server snapshot should retain raw public history for projection updates",
  );
  assert.strictEqual(touched.success, true);
  assert.strictEqual(concurrentTouch.success, true);
  assert.strictEqual(afterFirst.docUpdates.room_members || 0, 0, "ordinary snapshots must not write presence");
  assert.strictEqual(
    afterConcurrentTouch.queryGets.room_members,
    afterFirst.queryGets.room_members + 2,
    "each concurrent touch must reuse its snapshot authorization query without adding another member query",
  );
  assert.strictEqual(
    afterConcurrentTouch.docUpdates.room_members,
    (afterFirst.docUpdates.room_members || 0) + 1,
    "concurrent cloud function instances must atomically produce only one presence write",
  );
}

async function assertLobbySnapshotPresenceIsServerThrottled() {
  const db = createMemoryDb({
    rooms: {
      room_1: {
        _id: "room_1",
        roomId: "room_1",
        roomCode: "100001",
        mode: "normal",
        status: "lobby",
        hostMemberId: "mem_1",
        targetPlayerCount: 5,
        playerCount: 1,
        version: 1,
        expireAt: FUTURE_EXPIRE_AT,
      },
    },
    room_members: {
      mem_1: makeMember(),
    },
  });
  const { service } = loadRoomService({ db, openId: "openid_1" });

  const { service: coldStartedService } = loadRoomService({ db, openId: "openid_1" });
  const [firstTouch, concurrentTouch] = await Promise.all([
    service.main({
      action: "getLobbySnapshot",
      payload: { roomId: "room_1", touchPresence: true },
    }),
    coldStartedService.main({
      action: "getLobbySnapshot",
      payload: { roomId: "room_1", touchPresence: true },
    }),
  ]);
  const afterConcurrentTouch = db.stats();

  assert.strictEqual(firstTouch.success, true);
  assert.strictEqual(concurrentTouch.success, true);
  assert.strictEqual(
    afterConcurrentTouch.docUpdates.room_members,
    1,
    "concurrent lobby touches must atomically produce only one presence write",
  );
  assert.strictEqual(
    afterConcurrentTouch.queryGets.room_members,
    2,
    "each lobby touch must reuse its snapshot member query",
  );
}

async function assertLobbySignalFailureDoesNotFailCommand() {
  const baseDb = createMemoryDb({
    rooms: {
      room_1: {
        _id: "room_1",
        roomId: "room_1",
        roomCode: "100001",
        mode: "normal",
        status: "lobby",
        hostMemberId: "mem_1",
        targetPlayerCount: 5,
        playerCount: 1,
        version: 1,
        expireAt: FUTURE_EXPIRE_AT,
      },
    },
    room_members: {
      mem_1: makeMember(),
    },
  });
  const collection = (name) => {
    if (name === "room_sync_signals") {
      return {
        doc() {
          return {
            async set() {
              throw new Error("signal unavailable");
            },
          };
        },
      };
    }
    return baseDb.collection(name);
  };
  const db = {
    ...baseDb,
    collection,
    async runTransaction(handler) {
      return await handler({ collection });
    },
  };
  const { service } = loadRoomService({ db, openId: "openid_1" });
  const response = await service.main({
    action: "setReady",
    payload: {
      commandId: "cmd_ready_sync_failure",
      roomId: "room_1",
      isReady: true,
    },
  });

  assert.strictEqual(response.success, true, "derived lobby signal failure must not change command success");
  assert.strictEqual(baseDb.dump().room_members.mem_1.isReady, true, "the lobby command must remain committed");
}

async function assertLobbyCommandPublishesSafeSignal() {
  const db = createMemoryDb({
    rooms: {
      room_1: {
        _id: "room_1",
        roomId: "room_1",
        roomCode: "100001",
        mode: "normal",
        status: "lobby",
        hostMemberId: "mem_1",
        targetPlayerCount: 5,
        playerCount: 1,
        version: 1,
        expireAt: FUTURE_EXPIRE_AT,
      },
    },
    room_members: {
      mem_1: makeMember(),
    },
  });
  const { service } = loadRoomService({ db, openId: "openid_1" });
  const transactionCountBeforeCommand = db.stats().transactions;
  const response = await service.main({
    action: "setReady",
    payload: {
      commandId: "cmd_ready_sync_success",
      roomId: "room_1",
      isReady: true,
    },
  });
  const signal = db.dump().room_sync_signals.room_1;

  assert.strictEqual(response.success, true);
  assert.strictEqual(
    db.stats().transactions,
    transactionCountBeforeCommand + 1,
    "lobby signal refresh must re-read the room and write the signal in one transaction",
  );
  assert.strictEqual(signal.roomId, "room_1");
  assert.strictEqual(signal.roomStatus, "lobby");
  assert.strictEqual(signal.signalType, "room_version");
  assert.deepStrictEqual(
    Object.keys(signal).sort(),
    ["_id", "roomId", "roomStatus", "signalType", "updatedAt", "version"].sort(),
    "sync signals must not contain player data or game truth",
  );
}

function assertEveryGameProjectionWritePublishesSignal() {
  const source = fs.readFileSync(path.resolve(__dirname, "../../cloudfunctions/gameService/index.js"), "utf8");
  const publicUpdateCount = (source.match(/room_public_snapshots"\)\.doc\(roomId\)\.update/g) || []).length;
  const signalWriteCallCount = (source.match(/await writeRoomSyncSignal\(/g) || []).length;

  assert.strictEqual(publicUpdateCount, 7, "test must cover every game command projection branch");
  assert.strictEqual(
    signalWriteCallCount,
    publicUpdateCount + 1,
    "startGame and every command projection update must publish a transaction-scoped signal",
  );
}

(async () => {
  await assertGameSnapshotPresenceReusesResolvedMember();
  await assertLobbySnapshotPresenceIsServerThrottled();
  await assertLobbyCommandPublishesSafeSignal();
  await assertLobbySignalFailureDoesNotFailCommand();
  assertEveryGameProjectionWritePublishesSignal();
  console.log("sync optimization tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
