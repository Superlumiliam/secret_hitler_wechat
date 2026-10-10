const assert = require("assert");
const { createMemoryDb, loadGameService } = require("./loadGameService");

// Only storage and the WeChat identity context are mocked. Commands and snapshots
// go through gameService.main. The memory DB serializes transactions; this fixture
// reproduces stale client versions, not CloudBase transaction contention.
async function createVotingScenario(playerCount, dbOptions = {}) {
  const room = {
    _id: "room_vote_regression",
    roomId: "room_vote_regression",
    roomCode: "200009",
    mode: "normal",
    status: "in_game",
    currentGameId: "game_vote_regression",
    expireAt: "2099-01-01T00:00:00.000Z",
  };
  const members = Array.from({ length: playerCount }, (_, index) => ({
    _id: `mem_${index + 1}`,
    memberId: `mem_${index + 1}`,
    roomId: room.roomId,
    openId: `openid_${index + 1}`,
    displayName: `玩家${index + 1}`,
    avatarUrl: "",
    memberType: "player",
    memberStatus: "active",
    seatIndex: index + 1,
  }));
  const db = createMemoryDb({}, dbOptions);
  // Each client has its own immutable identity, including during Promise.all.
  const clients = members.map((member) => loadGameService({ db, openId: member.openId }).service);
  const hooks = clients[0].__testHooks;
  const updatedAt = new Date();
  const projection = hooks.createInitialGameProjection(room, members, {
    gameId: room.currentGameId,
    createdAt: updatedAt,
    pickIndex: () => 0,
  });
  const core = {
    ...projection.gameCore,
    version: 2,
    eventSeq: 3,
    phase: "voting",
    currentPresidentCandidateId: members[0].memberId,
    currentChancellorCandidateId: members[1].memberId,
    phaseData: {
      presidentCandidateId: members[0].memberId,
      chancellorCandidateId: members[1].memberId,
      votesByMemberId: {},
    },
    lastVoteResult: null,
    updatedAt,
  };
  await db.collection("rooms").doc(room.roomId).set({ data: room });
  await db.collection("game_core").doc(core.gameId).set({ data: core });
  await db.collection("room_public_snapshots").doc(room.roomId).set({
    data: {
      roomId: room.roomId,
      snapshotType: "game_public",
      version: core.version,
      payload: hooks.buildPublicSnapshotPayload(
        room, core, members, projection.publicSnapshotPayload.publicState.publicHistory, updatedAt,
      ),
    },
  });
  for (const member of members) {
    await db.collection("room_members").doc(member.memberId).set({ data: member });
    const payload = hooks.buildPrivateSnapshotPayload(core, member, members, updatedAt);
    await db.collection("player_private_snapshots").doc(member.memberId).set({
      data: {
        roomId: room.roomId,
        gameId: core.gameId,
        ownerOpenId: member.openId,
        version: core.version,
        payload,
        pendingTask: payload.pendingTask,
      },
    });
  }
  let commandSequence = 0;
  return {
    room, members, clients, db,
    async snapshot(index) {
      const result = await clients[index].main({
        action: "getGameSnapshot",
        payload: { roomId: room.roomId, touchPresence: false },
      });
      assert.strictEqual(result.success, true, JSON.stringify(result));
      return result.data;
    },
    vote(index, snapshot, vote = "JA") {
      return clients[index].main({
        action: "submitCommand",
        payload: {
          roomId: room.roomId,
          commandId: `cmd_regression_${++commandSequence}`,
          expectedVersion: snapshot.version,
          taskId: snapshot.pendingTask.taskId,
          type: "SUBMIT_VOTE",
          body: { vote },
        },
      });
    },
    core() {
      return db.dump().game_core[core.gameId];
    },
  };
}

module.exports = { createVotingScenario };
