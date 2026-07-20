const assert = require("assert");
const { createMemoryDb, loadGameService, loadRoomService } = require("../helpers/loadGameService");

const FUTURE_EXPIRE_AT = "2099-01-01T00:00:00.000Z";

function createLobbyFixture(extraMembers = {}) {
  return createMemoryDb({
    rooms: {
      room_join: {
        _id: "room_join",
        roomId: "room_join",
        roomCode: "654321",
        mode: "normal",
        status: "lobby",
        hostMemberId: "mem_host",
        currentGameId: null,
        targetPlayerCount: 10,
        playerCount:
          1 + Object.values(extraMembers).filter((member) => member.memberStatus === "active").length,
        version: 1,
        createdByOpenId: "host_openid",
        expireAt: FUTURE_EXPIRE_AT,
        assetFileIds: [],
      },
    },
    room_members: {
      mem_host: {
        _id: "mem_host",
        memberId: "mem_host",
        roomId: "room_join",
        openId: "host_openid",
        displayName: "房主",
        avatarUrl: "",
        seatIndex: 1,
        isHost: true,
        isReady: false,
        memberStatus: "active",
      },
      ...extraMembers,
    },
  });
}

function joinEvent(commandId) {
  return {
    action: "joinRoom",
    payload: {
      commandId,
      roomCode: "654321",
      displayName: "维委柯",
      avatarUrl: "",
    },
  };
}

async function assertConcurrentJoinCreatesOneMember() {
  const db = createLobbyFixture();
  const { service } = loadRoomService({ db, openId: "friend_openid" });

  const [first, second] = await Promise.all([
    service.main(joinEvent("cmd_join_first")),
    service.main(joinEvent("cmd_join_second")),
  ]);

  assert.strictEqual(first.success, true);
  assert.strictEqual(second.success, true);
  assert.strictEqual(first.data.memberId, second.data.memberId, "concurrent joins must resolve to the same member");

  const dump = db.dump();
  const friendMembers = Object.values(dump.room_members).filter(
    (member) => member.openId === "friend_openid" && member.memberStatus === "active",
  );
  assert.strictEqual(friendMembers.length, 1, "one WeChat identity must occupy only one active seat");
  assert.strictEqual(dump.rooms.room_join.playerCount, 2, "room player count must match active members");
  assert.strictEqual(dump.user_profiles.friend_openid.activeMemberId, friendMembers[0].memberId);
  assert.strictEqual(dump.user_profiles.friend_openid.activeRoomId, "room_join");
}

async function assertExistingMemberRepairsMissingProfileAnchor() {
  const db = createLobbyFixture({
    mem_existing: {
      _id: "mem_existing",
      memberId: "mem_existing",
      roomId: "room_join",
      openId: "friend_openid",
      displayName: "维委柯",
      avatarUrl: "",
      seatIndex: 2,
      isHost: false,
      isReady: false,
      memberStatus: "active",
    },
  });
  const { service } = loadRoomService({ db, openId: "friend_openid" });

  const response = await service.main(joinEvent("cmd_join_recover"));

  assert.strictEqual(response.success, true);
  assert.strictEqual(response.data.memberId, "mem_existing");
  const dump = db.dump();
  assert.strictEqual(dump.user_profiles.friend_openid.activeRoomId, "room_join");
  assert.strictEqual(dump.user_profiles.friend_openid.activeMemberId, "mem_existing");
  assert.strictEqual(Object.keys(dump.room_members).length, 2, "recovery must not create another member");
}

async function assertExistingDuplicatesAreCollapsed() {
  const db = createLobbyFixture({
    mem_duplicate_1: {
      _id: "mem_duplicate_1",
      memberId: "mem_duplicate_1",
      roomId: "room_join",
      openId: "friend_openid",
      displayName: "维委柯",
      avatarUrl: "",
      seatIndex: 2,
      isHost: false,
      isReady: false,
      memberStatus: "active",
    },
    mem_duplicate_2: {
      _id: "mem_duplicate_2",
      memberId: "mem_duplicate_2",
      roomId: "room_join",
      openId: "friend_openid",
      displayName: "维委柯",
      avatarUrl: "",
      seatIndex: 3,
      isHost: false,
      isReady: false,
      memberStatus: "active",
    },
  });
  const { service } = loadRoomService({ db, openId: "friend_openid" });

  const response = await service.main(joinEvent("cmd_join_deduplicate"));

  assert.strictEqual(response.success, true);
  const dump = db.dump();
  const activeFriendMembers = Object.values(dump.room_members).filter(
    (member) => member.openId === "friend_openid" && member.memberStatus === "active",
  );
  assert.strictEqual(activeFriendMembers.length, 1, "a repeated join must repair historical duplicate seats");
  assert.strictEqual(dump.rooms.room_join.playerCount, 2);
  assert.strictEqual(response.data.lobbySnapshot.playerCount, 2);
}

async function assertFastRejoinCanSetReady() {
  const db = createLobbyFixture({
    mem_old: {
      _id: "mem_old",
      memberId: "mem_old",
      roomId: "room_join",
      openId: "friend_openid",
      displayName: "维委柯",
      avatarUrl: "",
      seatIndex: 2,
      isHost: false,
      isReady: false,
      memberStatus: "left",
    },
    mem_new: {
      _id: "mem_new",
      memberId: "mem_new",
      roomId: "room_join",
      openId: "friend_openid",
      displayName: "维委柯",
      avatarUrl: "",
      seatIndex: 2,
      isHost: false,
      isReady: false,
      memberStatus: "active",
    },
  });
  const { service } = loadRoomService({ db, openId: "friend_openid" });

  const response = await service.main({
    action: "setReady",
    payload: {
      commandId: "cmd_fast_rejoin_ready",
      roomId: "room_join",
      isReady: true,
    },
  });

  assert.strictEqual(response.success, true, "the active rejoined member must not be hidden by the old left record");
  const dump = db.dump();
  assert.strictEqual(dump.room_members.mem_old.memberStatus, "left");
  assert.strictEqual(dump.room_members.mem_old.isReady, false);
  assert.strictEqual(dump.room_members.mem_new.memberStatus, "active");
  assert.strictEqual(dump.room_members.mem_new.isReady, true, "ready must update the new active member");
  assert.strictEqual(response.data.viewerState.myMemberId, "mem_new");
  assert.strictEqual(response.data.viewerState.myIsReady, true);
}

async function assertGameServiceResolvesRejoinedMember() {
  const db = createLobbyFixture({
    mem_old: {
      _id: "mem_old",
      memberId: "mem_old",
      roomId: "room_join",
      openId: "friend_openid",
      displayName: "维委柯",
      seatIndex: 2,
      memberStatus: "left",
    },
    mem_new: {
      _id: "mem_new",
      memberId: "mem_new",
      roomId: "room_join",
      openId: "friend_openid",
      displayName: "维委柯",
      seatIndex: 2,
      memberStatus: "active",
    },
  });
  const { service } = loadGameService({ db, openId: "friend_openid" });

  const member = await service.__testHooks.getRoomMember("room_join", "friend_openid");

  assert.ok(member, "game service must resolve the active rejoined member");
  assert.strictEqual(member.memberId, "mem_new");
}

(async () => {
  await assertConcurrentJoinCreatesOneMember();
  await assertExistingMemberRepairsMissingProfileAnchor();
  await assertExistingDuplicatesAreCollapsed();
  await assertFastRejoinCanSetReady();
  await assertGameServiceResolvesRejoinedMember();
  console.log("roomService join concurrency tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
