const assert = require("assert");
const { createMemoryDb, loadRoomService } = require("../helpers/loadGameService");

const FUTURE_EXPIRE_AT = "2099-01-01T00:00:00.000Z";

function createRoomEvent(commandId) {
  return {
    action: "createRoom",
    payload: {
      commandId,
      targetPlayerCount: 5,
      displayName: "并发玩家",
      avatarUrl: "",
    },
  };
}

function makeMember(memberId, openId, seatIndex, isHost = false) {
  return {
    _id: memberId,
    memberId,
    roomId: "room_leave",
    openId,
    displayName: openId,
    avatarUrl: "",
    seatIndex,
    isHost,
    isReady: false,
    isVirtual: false,
    memberStatus: "active",
    joinedAt: "2026-07-20T00:00:00.000Z",
    leftAt: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

function createLeaveFixture() {
  return createMemoryDb({
    rooms: {
      room_leave: {
        _id: "room_leave",
        roomId: "room_leave",
        roomCode: "123456",
        mode: "normal",
        status: "lobby",
        hostMemberId: "mem_a",
        currentGameId: null,
        targetPlayerCount: 5,
        playerCount: 4,
        version: 1,
        createdByOpenId: "openid_a",
        expireAt: FUTURE_EXPIRE_AT,
        assetFileIds: [],
      },
    },
    room_members: {
      mem_a: makeMember("mem_a", "openid_a", 1, true),
      mem_b: makeMember("mem_b", "openid_b", 2),
      mem_c: makeMember("mem_c", "openid_c", 3),
      mem_d: makeMember("mem_d", "openid_d", 4),
    },
    user_profiles: {
      openid_a: {
        _id: "openid_a",
        openid: "openid_a",
        profileCompleted: true,
        activeRoomId: "room_leave",
        activeMemberId: "mem_a",
        activeRoomStatus: "lobby",
      },
      openid_b: {
        _id: "openid_b",
        openid: "openid_b",
        profileCompleted: true,
        activeRoomId: "room_leave",
        activeMemberId: "mem_b",
        activeRoomStatus: "lobby",
      },
    },
  });
}

async function assertSameCommandCreatesOneRoom() {
  const db = createMemoryDb();
  const { service } = loadRoomService({ db, openId: "same_openid" });
  const event = createRoomEvent("cmd_create_same");

  const [first, second] = await Promise.all([service.main(event), service.main(event)]);

  assert.strictEqual(first.success, true);
  assert.strictEqual(second.success, true);
  assert.strictEqual(first.data.roomId, second.data.roomId, "same command must return the same room");
  assert.strictEqual(first.data.memberId, second.data.memberId, "same command must return the same host member");

  const dump = db.dump();
  assert.strictEqual(Object.keys(dump.rooms).length, 1, "same command must create only one room");
  assert.strictEqual(Object.keys(dump.room_members).length, 1, "same command must create only one host member");
  assert.strictEqual(dump.user_profiles.same_openid.activeRoomId, first.data.roomId);
  assert.strictEqual(dump.user_profiles.same_openid.multiplayerGameCount, 0);
  assert.strictEqual(dump.user_profiles.same_openid.multiplayerWinCount, 0);
  assert.strictEqual(dump.user_profiles.same_openid.multiplayerLossCount, 0);
  assert.strictEqual(Object.keys(dump.command_records).length, 1, "command result must be committed once");
}

async function assertDifferentCommandsCreateAtMostOneActiveRoom() {
  const db = createMemoryDb();
  const { service } = loadRoomService({ db, openId: "same_openid" });

  const responses = await Promise.all([
    service.main(createRoomEvent("cmd_create_first")),
    service.main(createRoomEvent("cmd_create_second")),
  ]);

  const succeeded = responses.filter((response) => response.success);
  const rejected = responses.filter((response) => !response.success);
  assert.strictEqual(succeeded.length, 1, "only one concurrent create command may succeed");
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(rejected[0].error.code, "ACTION_NOT_ALLOWED");

  const dump = db.dump();
  assert.strictEqual(Object.keys(dump.rooms).length, 1, "one identity must own at most one active room");
  assert.strictEqual(Object.keys(dump.room_members).length, 1);
  assert.strictEqual(dump.user_profiles.same_openid.activeRoomId, succeeded[0].data.roomId);
}

async function assertConcurrentLeavesKeepRoomConsistent() {
  const db = createLeaveFixture();
  const serviceA = loadRoomService({ db, openId: "openid_a" }).service;
  const serviceB = loadRoomService({ db, openId: "openid_b" }).service;

  const [responseA, responseB] = await Promise.all([
    serviceA.main({
      action: "leaveRoom",
      payload: { commandId: "cmd_leave_a", roomId: "room_leave" },
    }),
    serviceB.main({
      action: "leaveRoom",
      payload: { commandId: "cmd_leave_b", roomId: "room_leave" },
    }),
  ]);

  assert.strictEqual(responseA.success, true);
  assert.strictEqual(responseB.success, true);

  const dump = db.dump();
  const room = dump.rooms.room_leave;
  const activeMembers = Object.values(dump.room_members)
    .filter((member) => member.memberStatus === "active")
    .sort((left, right) => left.seatIndex - right.seatIndex);
  const activeHostMembers = activeMembers.filter((member) => member.isHost);

  assert.strictEqual(activeMembers.length, 2);
  assert.deepStrictEqual(
    activeMembers.map((member) => member.seatIndex),
    [1, 2],
    "remaining seats must be compacted atomically",
  );
  assert.strictEqual(room.playerCount, activeMembers.length, "room count must match active members");
  assert.strictEqual(activeHostMembers.length, 1, "the room must retain exactly one active host");
  assert.strictEqual(room.hostMemberId, activeHostMembers[0].memberId, "host pointer must reference the active host");
  assert.strictEqual(dump.room_members.mem_a.isHost, false);
  assert.strictEqual(dump.room_members.mem_b.isHost, false);
  assert.strictEqual(dump.user_profiles.openid_a.activeRoomId, null);
  assert.strictEqual(dump.user_profiles.openid_b.activeRoomId, null);
}

(async () => {
  await assertSameCommandCreatesOneRoom();
  await assertDifferentCommandsCreateAtMostOneActiveRoom();
  await assertConcurrentLeavesKeepRoomConsistent();
  console.log("roomService lifecycle concurrency tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
