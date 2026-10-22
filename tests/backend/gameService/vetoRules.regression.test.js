const assert = require("node:assert/strict");
const test = require("node:test");
const { createVotingScenario } = require("../helpers/createVotingScenario");

// Seed a mid-game policy track once; all subsequent transitions use the real
// cloud-function entry and client snapshots. Keep the 6/11 policy totals valid.
async function createScenario(fascistPolicyCount, firstPolicy = "LIBERAL") {
  const scenario = await createVotingScenario(5);
  const core = scenario.core();
  const prefix = firstPolicy === "FASCIST"
    ? ["FASCIST", "LIBERAL", "FASCIST", "LIBERAL"]
    : ["LIBERAL", "FASCIST", "FASCIST", "LIBERAL"];
  const drawPile = prefix.concat(
    Array(6 - prefix.filter((card) => card === "LIBERAL").length).fill("LIBERAL"),
    Array(11 - fascistPolicyCount - prefix.filter((card) => card === "FASCIST").length).fill("FASCIST"),
  );
  const nextCore = {
    ...core,
    fascistPolicyCount,
    vetoUnlocked: fascistPolicyCount >= 5,
    policyState: {
      drawPile,
      discardPile: [],
      presidentHand: null,
      chancellorHand: null,
      peekPile: null,
    },
  };
  const hooks = scenario.clients[0].__testHooks;
  const now = new Date();
  await scenario.db.collection("game_core").doc(core.gameId).set({ data: nextCore });
  await scenario.db.collection("room_public_snapshots").doc(scenario.room.roomId).set({
    data: {
      roomId: scenario.room.roomId,
      snapshotType: "game_public",
      version: nextCore.version,
      payload: hooks.buildPublicSnapshotPayload(scenario.room, nextCore, scenario.members, [], now),
    },
  });
  for (const member of scenario.members) {
    const payload = hooks.buildPrivateSnapshotPayload(nextCore, member, scenario.members, now);
    await scenario.db.collection("player_private_snapshots").doc(member.memberId).set({
      data: { roomId: scenario.room.roomId, payload, pendingTask: payload.pendingTask },
    });
  }

  let sequence = 0;
  scenario.command = async (memberId, type, body = {}) => {
    const index = scenario.members.findIndex((member) => member.memberId === memberId);
    const snapshot = await scenario.snapshot(index);
    const event = {
      action: "submitCommand",
      payload: {
        roomId: scenario.room.roomId,
        commandId: `cmd_veto_regression_${++sequence}`,
        expectedVersion: snapshot.version,
        taskId: snapshot.pendingTask.taskId,
        type,
        body,
      },
    };
    const response = await scenario.clients[index].main(event);
    return { response, replay: () => scenario.clients[index].main(event) };
  };
  return scenario;
}

async function acceptedCommand(scenario, memberId, type, body) {
  const command = await scenario.command(memberId, type, body);
  assert.equal(command.response.success, true, JSON.stringify(command.response));
  return command;
}

async function elect(scenario, vote) {
  if (scenario.core().phase === "nomination") {
    const core = scenario.core();
    const targets = scenario.clients[0].__testHooks.getEligibleChancellorIdsFromCore(core);
    const targetMemberId = targets.find((id) => core.roleAssignments[id].role !== "HITLER");
    assert.ok(targetMemberId);
    await acceptedCommand(scenario, core.currentPresidentCandidateId, "NOMINATE_CHANCELLOR", { targetMemberId });
  }
  assert.equal(scenario.core().phase, "voting");
  for (let index = 0; index < scenario.members.length; index += 1) {
    const response = await scenario.vote(index, await scenario.snapshot(index), vote);
    assert.equal(response.success, true, JSON.stringify(response));
  }
}

async function requestVeto(scenario) {
  await acceptedCommand(scenario, scenario.core().currentPresidentId, "PRESIDENT_DISCARD_POLICY", {
    discardPolicyIndex: 1,
  });
  await acceptedCommand(scenario, scenario.core().currentChancellorId, "CHANCELLOR_REQUEST_VETO");
}

test("two failed elections + elected government's veto must trigger chaos exactly once", async () => {
  const scenario = await createScenario(5);
  await elect(scenario, "NEIN");
  await elect(scenario, "NEIN");
  assert.equal(scenario.core().electionTracker, 2);
  await elect(scenario, "JA");
  assert.equal(scenario.core().phase, "legislative_president");
  assert.equal(scenario.core().electionTracker, 2, "electing a government must not reset the tracker");
  const electedSnapshot = await scenario.snapshot(0);
  assert.equal(electedSnapshot.publicState.electionTracker, 2);
  assert.equal(electedSnapshot.publicState.voteResult.electionTrackerAfter, 2);
  assert.equal(electedSnapshot.publicState.history.rounds.find((round) => round.round === scenario.core().round)
    .voteSummary.electionTrackerCount, 2);

  await requestVeto(scenario);
  const presidentIndex = scenario.members.findIndex((member) => member.memberId === scenario.core().currentPresidentId);
  assert.equal((await scenario.snapshot(presidentIndex)).pendingTask.meta.electionTrackerBefore, 2);
  const command = await acceptedCommand(scenario, scenario.core().currentPresidentId, "PRESIDENT_RESPOND_VETO", {
    accepted: true,
  });
  const settled = scenario.core();
  assert.equal(settled.electionTracker, 0);
  assert.equal(settled.liberalPolicyCount, 1);
  assert.equal(settled.lastLegislativeResult.chaosPolicy.policy, "LIBERAL");
  assert.equal(settled.previousElectedPresidentId, null);
  assert.equal(settled.previousElectedChancellorId, null);
  assert.equal(settled.phase, "nomination");
  assert.equal((await command.replay()).success, true);
  assert.deepEqual(scenario.core(), settled, "replaying the veto must not enact a second chaos policy");
});

test("three consecutive elected governments may accumulate three accepted vetoes", async () => {
  const scenario = await createScenario(5);
  for (let round = 1; round <= 3; round += 1) {
    await elect(scenario, "JA");
    await requestVeto(scenario);
    await acceptedCommand(scenario, scenario.core().currentPresidentId, "PRESIDENT_RESPOND_VETO", {
      accepted: true,
    });
    assert.equal(scenario.core().electionTracker, round === 3 ? 0 : round);
    assert.equal(Boolean(scenario.core().lastLegislativeResult.chaosPolicy), round === 3);
    if (round < 3) {
      assert.ok(scenario.core().previousElectedPresidentId);
      assert.ok(scenario.core().previousElectedChancellorId);
    }
  }
  assert.equal(scenario.core().liberalPolicyCount + scenario.core().fascistPolicyCount, 6);
});

test("rejecting veto preserves the tracker; actually enacting a policy resets it", async () => {
  const scenario = await createScenario(5);
  await elect(scenario, "NEIN");
  await elect(scenario, "NEIN");
  await elect(scenario, "JA");
  await requestVeto(scenario);
  await acceptedCommand(scenario, scenario.core().currentPresidentId, "PRESIDENT_RESPOND_VETO", {
    accepted: false,
  });
  assert.equal(scenario.core().electionTracker, 2);
  assert.equal(scenario.core().phase, "legislative_chancellor");
  const denied = await scenario.command(scenario.core().currentChancellorId, "CHANCELLOR_REQUEST_VETO");
  assert.equal(denied.response.error.code, "ACTION_NOT_ALLOWED");
  const enactPolicyIndex = scenario.core().policyState.chancellorHand.indexOf("LIBERAL");
  assert.ok(enactPolicyIndex >= 0);
  await acceptedCommand(scenario, scenario.core().currentChancellorId, "CHANCELLOR_ENACT_POLICY", {
    enactPolicyIndex,
  });
  assert.equal(scenario.core().electionTracker, 0);
  assert.equal(scenario.core().liberalPolicyCount, 1);
  assert.equal(scenario.core().phase, "nomination");
});

test("fifth fascist policy from chaos unlocks the next government's veto without execution", async () => {
  const scenario = await createScenario(4, "FASCIST");
  for (let round = 0; round < 3; round += 1) await elect(scenario, "NEIN");
  assert.equal(scenario.core().fascistPolicyCount, 5);
  assert.equal(scenario.core().phase, "nomination", "chaos must skip executive powers");
  assert.equal(scenario.core().aliveMemberIds.length, 5);
  assert.equal(scenario.core().vetoUnlocked, true, "chaos must persist the veto unlock");
  assert.equal((await scenario.snapshot(0)).publicState.vetoUnlocked, true);

  await elect(scenario, "JA");
  await acceptedCommand(scenario, scenario.core().currentPresidentId, "PRESIDENT_DISCARD_POLICY", {
    discardPolicyIndex: 1,
  });
  const chancellorIndex = scenario.members.findIndex((member) => member.memberId === scenario.core().currentChancellorId);
  assert.equal((await scenario.snapshot(chancellorIndex)).pendingTask.meta.canRequestVeto, true);
  await acceptedCommand(scenario, scenario.core().currentChancellorId, "CHANCELLOR_REQUEST_VETO");
  await acceptedCommand(scenario, scenario.core().currentPresidentId, "PRESIDENT_RESPOND_VETO", {
    accepted: true,
  });
  assert.equal(scenario.core().electionTracker, 1);
  assert.equal(scenario.core().vetoUnlocked, true);
});

test("fourth fascist policy from chaos must not unlock veto early", async () => {
  const scenario = await createScenario(3, "FASCIST");
  for (let round = 0; round < 3; round += 1) await elect(scenario, "NEIN");
  assert.equal(scenario.core().fascistPolicyCount, 4);
  assert.equal(scenario.core().vetoUnlocked, false);
  assert.equal(scenario.core().phase, "nomination");
  await elect(scenario, "JA");
  await acceptedCommand(scenario, scenario.core().currentPresidentId, "PRESIDENT_DISCARD_POLICY", {
    discardPolicyIndex: 1,
  });
  const before = scenario.core();
  const denied = await scenario.command(before.currentChancellorId, "CHANCELLOR_REQUEST_VETO");
  assert.equal(denied.response.error.code, "ACTION_NOT_ALLOWED");
  assert.deepEqual(scenario.core(), before);
});

test("sixth fascist policy from chaos still ends the game immediately", async () => {
  const scenario = await createScenario(5, "FASCIST");
  for (let round = 0; round < 3; round += 1) await elect(scenario, "NEIN");
  assert.equal(scenario.core().phase, "game_ended");
  assert.equal(scenario.core().winner, "FASCIST");
  assert.equal(scenario.core().winReason, "FASCIST_POLICIES");
  assert.equal(scenario.core().electionTracker, 0);
  assert.equal(scenario.db.dump().rooms[scenario.room.roomId].status, "ended");
});
