"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("./helpers");

async function setupStartedGame() {
  const testApp = createTestApp(2);
  const { call, store } = testApp;
  const openids = ["p1", "p2", "p3", "p4", "p5"];
  const created = await call(openids[0], "createRoom", {
    commandId: "create",
    displayName: "玩家1"
  });

  for (const [index, openid] of openids.slice(1).entries()) {
    await call(openid, "joinRoom", {
      commandId: `join-${openid}`,
      roomCode: created.roomCode,
      displayName: `玩家${index + 2}`
    });
    await call(openid, "setReady", {
      commandId: `ready-${openid}`,
      roomId: created.roomId,
      ready: true
    });
  }

  await call(openids[0], "startGame", {
    commandId: "start",
    roomId: created.roomId
  });

  return {
    ...testApp,
    openids,
    roomId: created.roomId
  };
}

test("对局支持身份确认、提名、投票和立法推进", async () => {
  const { call, store, openids, roomId } = await setupStartedGame();
  const members = await store.listRoomMembers(roomId);
  const memberByOpenid = Object.fromEntries(members.map((member) => [member.openid, member]));

  for (const openid of openids) {
    const snapshot = await call(openid, "getGameSnapshot", { roomId });
    assert.equal(snapshot.currentPhase, "role_reveal");
    await call(openid, "submitCommand", {
      roomId,
      commandId: `ack-${openid}`,
      expectedVersion: snapshot.version,
      taskId: snapshot.pendingTask.taskId,
      type: "ACK_ROLE_REVEAL",
      body: { acknowledged: true }
    });
  }

  const nominationSnapshot = await call(openids[0], "getGameSnapshot", { roomId });
  assert.equal(nominationSnapshot.currentPhase, "nomination");
  const presidentCandidateId = nominationSnapshot.publicState.currentPresidentCandidateId;
  const presidentOpenid = Object.keys(memberByOpenid).find((openid) => memberByOpenid[openid].memberId === presidentCandidateId);
  const presidentNominationSnapshot = await call(presidentOpenid, "getGameSnapshot", { roomId });

  await call(presidentOpenid, "submitCommand", {
    roomId,
    commandId: "nominate",
    expectedVersion: presidentNominationSnapshot.version,
    taskId: presidentNominationSnapshot.pendingTask.taskId,
    type: "NOMINATE_CHANCELLOR",
    body: {
      targetMemberId: presidentNominationSnapshot.pendingTask.allowedTargets[0]
    }
  });

  const votingSnapshot = await call(openids[0], "getGameSnapshot", { roomId });
  assert.equal(votingSnapshot.currentPhase, "voting");

  let latestVersion = votingSnapshot.version;
  for (const openid of openids) {
    const snapshot = await call(openid, "getGameSnapshot", { roomId });
    const result = await call(openid, "submitCommand", {
      roomId,
      commandId: `vote-${openid}`,
      expectedVersion: snapshot.version,
      taskId: snapshot.pendingTask.taskId,
      type: "SUBMIT_VOTE",
      body: {
        vote: "JA"
      }
    });
    latestVersion = result.newVersion;
  }

  const afterVote = await call(presidentOpenid, "getGameSnapshot", { roomId });
  assert.equal(["legislative_president", "legislative_chancellor"].includes(afterVote.currentPhase), true);
  assert.equal(afterVote.version >= latestVersion, true);

  const presidentSnapshot = await call(presidentOpenid, "getGameSnapshot", { roomId });
  const discardResult = await call(presidentOpenid, "submitCommand", {
    roomId,
    commandId: "discard",
    expectedVersion: presidentSnapshot.version,
    taskId: presidentSnapshot.pendingTask.taskId,
    type: "PRESIDENT_DISCARD_POLICY",
    body: {
      discardPolicyIndex: 0
    }
  });
  assert.equal(discardResult.accepted, true);

  const chancellorId = (await store.getGame(roomId)).currentChancellorId;
  const chancellorOpenid = Object.keys(memberByOpenid).find((openid) => memberByOpenid[openid].memberId === chancellorId);
  const chancellorSnapshot = await call(chancellorOpenid, "getGameSnapshot", { roomId });
  const enactResult = await call(chancellorOpenid, "submitCommand", {
    roomId,
    commandId: "enact",
    expectedVersion: chancellorSnapshot.version,
    taskId: chancellorSnapshot.pendingTask.taskId,
    type: "CHANCELLOR_ENACT_POLICY",
    body: {
      enactPolicyIndex: 0
    }
  });
  assert.equal(enactResult.accepted, true);

  const nextSnapshot = await call(openids[0], "getGameSnapshot", { roomId });
  assert.equal(["nomination", "executive_action"].includes(nextSnapshot.currentPhase), true);
});
