const assert = require("assert");
const { createMemoryDb, loadGameService } = require("../helpers/loadGameService");

function makeMembers(playerCount, roomId = "room_test") {
  return Array.from({ length: playerCount }, (_, index) => ({
    _id: `mem_${index + 1}`,
    memberId: `mem_${index + 1}`,
    roomId,
    openId: `openid_${index + 1}`,
    displayName: `玩家${index + 1}`,
    avatarUrl: "",
    seatIndex: index + 1,
    memberStatus: "active",
  }));
}

async function assertResultSnapshotBlockedBeforeGameEnds() {
  const db = createMemoryDb({
    rooms: {
      room_1: {
        _id: "room_1",
        roomId: "room_1",
        roomCode: "100001",
        status: "in_game",
        currentGameId: "game_1",
        expireAt: "2099-01-01T00:00:00.000Z",
      },
    },
    room_members: {
      mem_1: makeMembers(1, "room_1")[0],
    },
  });
  const { service } = loadGameService({ db, openId: "openid_1" });

  const response = await service.main({
    action: "getResultSnapshot",
    payload: {
      roomId: "room_1",
    },
  });

  assert.strictEqual(response.success, false, "result snapshot should be blocked before game ends");
  assert.strictEqual(response.error.code, "ACTION_NOT_ALLOWED");
}

async function assertResultSnapshotUsesEndedPublicProjection() {
  const db = createMemoryDb();
  const { service } = loadGameService({ db, openId: "openid_1" });
  const members = makeMembers(5, "room_2");
  const room = {
    _id: "room_2",
    roomId: "room_2",
    roomCode: "100002",
    status: "ended",
    currentGameId: "game_2",
    expireAt: "2099-01-01T00:00:00.000Z",
  };
  const projection = service.__testHooks.createInitialGameProjection(room, members, {
    gameId: "game_2",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const endedCore = {
    ...projection.gameCore,
    status: "ended",
    phase: "game_ended",
    winner: "LIBERAL",
    winReason: "HITLER_EXECUTED",
    endedAt: new Date("2026-05-12T00:10:00.000Z"),
  };
  const resultPayload = service.__testHooks.buildResultSnapshotPayload(
    room,
    endedCore,
    members,
    [],
    new Date("2026-05-12T00:10:00.000Z"),
    "mem_1",
  );

  await db.collection("rooms").doc("room_2").set({ data: room });
  for (const member of members) {
    await db.collection("room_members").doc(member.memberId).set({ data: member });
  }
  await db.collection("room_public_snapshots").doc("room_2").set({
    data: {
      _id: "room_2",
      roomId: "room_2",
      snapshotType: "result_public",
      payload: resultPayload,
    },
  });

  const response = await service.main({
    action: "getResultSnapshot",
    payload: {
      roomId: "room_2",
    },
  });

  assert.strictEqual(response.success, true, "ended room should return result snapshot");
  assert.strictEqual(response.data.roomStatus, "ended");
  assert.strictEqual(response.data.myMemberId, "mem_1");
  assert.strictEqual(response.data.winner, "LIBERAL");
  assert.strictEqual(response.data.finalPlayers.length, 5);
  assert(response.data.finalPlayers.every((player) => player.role && player.party), "final identities should be revealed");

  const updatedMember = db.dump().room_members.mem_1;
  assert.strictEqual(updatedMember.memberStatus, "active", "successful cloud function call should touch last seen member");
  assert(updatedMember.lastSeenAt, "successful cloud function call should update lastSeenAt");
}

(async () => {
  await assertResultSnapshotBlockedBeforeGameEnds();
  await assertResultSnapshotUsesEndedPublicProjection();
  console.log("gameService result snapshot integration tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
