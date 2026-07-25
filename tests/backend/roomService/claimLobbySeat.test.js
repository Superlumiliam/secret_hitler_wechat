const assert = require("assert");
const { createMemoryDb, loadRoomService } = require("../helpers/loadGameService");

const FUTURE_EXPIRE_AT = "2099-01-01T00:00:00.000Z";

function makeRoom(overrides = {}) {
  const roomId = overrides.roomId || "room_seat";
  return {
    _id: roomId,
    roomId,
    roomCode: "456789",
    mode: "normal",
    status: "lobby",
    hostMemberId: "mem_host",
    targetPlayerCount: 5,
    playerCount: 2,
    version: 1,
    createdByOpenId: "host_openid",
    expireAt: FUTURE_EXPIRE_AT,
    assetFileIds: [],
    ...overrides,
  };
}

function makeMember(overrides = {}) {
  const memberId = overrides.memberId || "mem_host";
  return {
    _id: memberId,
    memberId,
    roomId: overrides.roomId || "room_seat",
    openId: overrides.openId || "host_openid",
    displayName: overrides.displayName || "玩家",
    avatarUrl: "",
    seatIndex: 1,
    isHost: false,
    isReady: false,
    isVirtual: false,
    memberStatus: "active",
    joinedAt: "2026-07-20T00:00:00.000Z",
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

function createFixture(overrides = {}) {
  const room = makeRoom(overrides.room);
  return createMemoryDb({
    rooms: { [room.roomId]: room },
    room_members: {
      mem_host: makeMember({ roomId: room.roomId, memberId: "mem_host", isHost: true, isReady: true }),
      ...(overrides.omitGuest
        ? {}
        : {
            mem_guest: makeMember({
              roomId: room.roomId,
              memberId: "mem_guest",
              openId: "guest_openid",
              displayName: "来宾",
              seatIndex: 2,
            }),
          }),
      ...(overrides.members || {}),
    },
  });
}

function claimEvent(commandId, targetSeatIndex, roomId = "room_seat") {
  return {
    action: "claimLobbySeat",
    payload: { commandId, roomId, targetSeatIndex },
  };
}

async function assertNormalSeatClaimPreservesMemberState() {
  const db = createFixture();
  const { service } = loadRoomService({ db, openId: "host_openid" });

  const response = await service.main(claimEvent("cmd_claim_normal", 5));

  assert.strictEqual(response.success, true);
  assert.strictEqual(response.data.viewerState.myIsReady, true);
  assert.strictEqual(db.dump().room_members.mem_host.seatIndex, 5);
  assert.strictEqual(db.dump().room_members.mem_host.isHost, true);
  assert.strictEqual(db.dump().room_members.mem_host.isReady, true);
  assert.strictEqual(db.dump().rooms.room_seat.version, 2);
  assert.deepStrictEqual(
    response.data.seatOrder.map((member) => member.seatIndex),
    [2, 5],
    "seat claim response must remain ordered by seat index",
  );
}

async function assertSoloClaimDoesNotMoveVirtualMembers() {
  const db = createFixture({
    room: { mode: "solo", playerCount: 2 },
    omitGuest: true,
    members: {
      mem_virtual: makeMember({
        memberId: "mem_virtual",
        roomId: "room_seat",
        openId: "",
        seatIndex: 3,
        isVirtual: true,
        displayName: "虚拟玩家",
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "host_openid" });

  const response = await service.main(claimEvent("cmd_claim_solo", 4));

  assert.strictEqual(response.success, true);
  assert.strictEqual(db.dump().room_members.mem_host.seatIndex, 4);
  assert.strictEqual(db.dump().room_members.mem_virtual.seatIndex, 3);
}

async function assertClaimRejectsInvalidOrOccupiedSeats() {
  const invalidDb = createFixture();
  const invalidService = loadRoomService({ db: invalidDb, openId: "host_openid" }).service;
  const invalidResponse = await invalidService.main(claimEvent("cmd_claim_invalid", 0));
  assert.strictEqual(invalidResponse.success, false);
  assert.strictEqual(invalidResponse.error.code, "INVALID_PAYLOAD");

  const occupiedDb = createFixture();
  const occupiedService = loadRoomService({ db: occupiedDb, openId: "host_openid" }).service;
  const occupiedResponse = await occupiedService.main(claimEvent("cmd_claim_occupied", 2));
  assert.strictEqual(occupiedResponse.success, false);
  assert.strictEqual(occupiedResponse.error.code, "SEAT_OCCUPIED");

  const nonMemberDb = createFixture();
  const nonMemberService = loadRoomService({ db: nonMemberDb, openId: "outsider_openid" }).service;
  const nonMemberResponse = await nonMemberService.main(claimEvent("cmd_claim_non_member", 5));
  assert.strictEqual(nonMemberResponse.success, false);
  assert.strictEqual(nonMemberResponse.error.code, "NOT_ROOM_MEMBER");

  const expiredDb = createFixture({ room: { expireAt: "2020-01-01T00:00:00.000Z" } });
  const expiredService = loadRoomService({ db: expiredDb, openId: "host_openid" }).service;
  const expiredResponse = await expiredService.main(claimEvent("cmd_claim_expired", 5));
  assert.strictEqual(expiredResponse.success, false);
  assert.strictEqual(expiredResponse.error.code, "ROOM_EXPIRED");

  const startedDb = createFixture({ room: { status: "in_game" } });
  const startedService = loadRoomService({ db: startedDb, openId: "host_openid" }).service;
  const startedResponse = await startedService.main(claimEvent("cmd_claim_started", 5));
  assert.strictEqual(startedResponse.success, false);
  assert.strictEqual(startedResponse.error.code, "GAME_ALREADY_STARTED");
}

async function assertConcurrentClaimsHaveOneWinner() {
  const db = createFixture();
  const hostService = loadRoomService({ db, openId: "host_openid" }).service;
  const guestService = loadRoomService({ db, openId: "guest_openid" }).service;

  const responses = await Promise.all([
    hostService.main(claimEvent("cmd_claim_host", 4)),
    guestService.main(claimEvent("cmd_claim_guest", 4)),
  ]);

  assert.strictEqual(responses.filter((response) => response.success).length, 1);
  assert.strictEqual(responses.filter((response) => response.error && response.error.code === "SEAT_OCCUPIED").length, 1);
  const activeMembers = Object.values(db.dump().room_members).filter((member) => member.memberStatus === "active");
  assert.strictEqual(activeMembers.filter((member) => member.seatIndex === 4).length, 1);
  assert.strictEqual(db.dump().rooms.room_seat.version, 2);
}

async function assertJoinUsesVacatedLowestSeat() {
  const db = createFixture();
  const hostService = loadRoomService({ db, openId: "host_openid" }).service;
  const joinService = loadRoomService({ db, openId: "new_openid" }).service;
  const claimResponse = await hostService.main(claimEvent("cmd_claim_before_join", 5));
  assert.strictEqual(claimResponse.success, true);

  const joinResponse = await joinService.main({
    action: "joinRoom",
    payload: {
      commandId: "cmd_join_vacated_seat",
      roomCode: "456789",
      displayName: "新玩家",
      avatarUrl: "",
    },
  });

  assert.strictEqual(joinResponse.success, true);
  assert.strictEqual(db.dump().room_members[joinResponse.data.memberId].seatIndex, 1);
  assert.deepStrictEqual(
    joinResponse.data.lobbySnapshot.seatOrder.map((member) => member.seatIndex),
    [1, 2, 5],
    "join response must remain ordered after filling a vacated lower seat",
  );
}

async function assertRoomSettingsRejectsHighestOccupiedSeat() {
  const db = createFixture({ room: { targetPlayerCount: 7 } });
  const { service } = loadRoomService({ db, openId: "host_openid" });
  const claimResponse = await service.main(claimEvent("cmd_claim_for_resize", 6));
  assert.strictEqual(claimResponse.success, true);

  const response = await service.main({
    action: "updateRoomSettings",
    payload: {
      commandId: "cmd_resize_below_highest_seat",
      roomId: "room_seat",
      targetPlayerCount: 5,
    },
  });

  assert.strictEqual(response.success, false);
  assert.strictEqual(response.error.code, "TARGET_COUNT_BELOW_SEATED");
  assert.strictEqual(db.dump().rooms.room_seat.targetPlayerCount, 7);
}

async function assertConcurrentSoloFillAndSeatClaimKeepSeatsUnique() {
  const room = makeRoom({
    roomId: "room_solo_seat",
    roomCode: "987654",
    mode: "solo",
    targetPlayerCount: 5,
    playerCount: 1,
  });
  const db = createMemoryDb({
    rooms: { [room.roomId]: room },
    room_members: {
      mem_host: makeMember({
        roomId: room.roomId,
        memberId: "mem_host",
        isHost: true,
        isReady: true,
      }),
    },
  });
  const { service } = loadRoomService({ db, openId: "host_openid" });

  const [claimResponse, fillResponse] = await Promise.all([
    service.main(claimEvent("cmd_claim_during_fill", 4, room.roomId)),
    service.main({
      action: "soloFillVirtualPlayers",
      payload: {
        commandId: "cmd_fill_during_claim",
        roomId: room.roomId,
      },
    }),
  ]);

  assert.strictEqual(fillResponse.success, true, "virtual fill must complete after concurrent seat claim");
  assert.ok(
    claimResponse.success || claimResponse.error.code === "SEAT_OCCUPIED",
    "seat claim may win first or observe the filled seat, but must not create a duplicate",
  );
  const activeMembers = Object.values(db.dump().room_members).filter((member) => member.memberStatus === "active");
  const seatIndexes = activeMembers.map((member) => member.seatIndex);
  assert.strictEqual(activeMembers.length, 5);
  assert.strictEqual(new Set(seatIndexes).size, 5, "concurrent fill and claim must not duplicate a seat");
  assert.strictEqual(db.dump().rooms[room.roomId].playerCount, 5);
}

(async () => {
  await assertNormalSeatClaimPreservesMemberState();
  await assertSoloClaimDoesNotMoveVirtualMembers();
  await assertClaimRejectsInvalidOrOccupiedSeats();
  await assertConcurrentClaimsHaveOneWinner();
  await assertJoinUsesVacatedLowestSeat();
  await assertRoomSettingsRejectsHighestOccupiedSeat();
  await assertConcurrentSoloFillAndSeatClaimKeepSeatsUnique();
  console.log("roomService lobby seat claim tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
