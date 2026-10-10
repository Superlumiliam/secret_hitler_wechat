const assert = require("assert");
const test = require("node:test");
const { createVotingScenario } = require("../helpers/createVotingScenario");
const { loadGameService } = require("../helpers/loadGameService");

function command(scenario, snapshot, overrides = {}) {
  return {
    action: "submitCommand",
    payload: {
      roomId: scenario.room.roomId,
      type: "SUBMIT_VOTE",
      commandId: "cmd_vote_boundary",
      expectedVersion: snapshot.version,
      taskId: snapshot.pendingTask.taskId,
      body: { vote: "JA" },
      ...overrides,
    },
  };
}

test("same ballot replay is atomic; changed payload or actor cannot reuse its receipt", async () => {
  const s = await createVotingScenario(5);
  const request = command(s, await s.snapshot(0));
  const responses = await Promise.all([s.clients[0].main(request), s.clients[0].main(request)]);
  assert.ok(responses.every((r) => r.success));
  assert.deepStrictEqual(responses[0], responses[1]);
  assert.strictEqual(s.core().version, 3);
  assert.strictEqual(Object.keys(s.core().phaseData.votesByMemberId).length, 1);

  const changed = await s.clients[0].main({
    ...request, payload: { ...request.payload, body: { vote: "NEIN" } },
  });
  assert.strictEqual(changed.error.code, "DUPLICATE_COMMAND");
  const stolen = await s.clients[1].main(request);
  assert.strictEqual(stolen.error.code, "ACTION_NOT_ALLOWED");
  const changedId = await s.clients[0].main(command(s, await s.snapshot(1), {
    commandId: "different_id", taskId: request.payload.taskId, body: { vote: "NEIN" },
  }));
  assert.strictEqual(changedId.error.code, "ACTION_NOT_ALLOWED");
  assert.strictEqual(s.core().phaseData.votesByMemberId.mem_1.vote, "JA");
});

test("old clients retain strict version checks; future versions and forged tasks are rejected", async () => {
  const s = await createVotingScenario(5);
  const snapshot = await s.snapshot(1);
  assert.ok((await s.vote(0, await s.snapshot(0))).success);
  for (const overrides of [
    { taskId: undefined },
    { expectedVersion: 999 },
    { expectedVersion: 0 },
    { taskId: snapshot.pendingTask.taskId.replace(":1:voting:", ":0:voting:") },
    { taskId: snapshot.pendingTask.taskId.replace("mem_2", "mem_3") },
    { taskId: snapshot.pendingTask.taskId.replace("game_vote_regression", "another_game") },
    { type: "NOMINATE_CHANCELLOR", body: { targetMemberId: "mem_3" } },
  ]) {
    const response = await s.clients[1].main(command(s, snapshot, overrides));
    assert.strictEqual(response.success, false, JSON.stringify(overrides));
  }
  const legacy = command(s, await s.snapshot(1), { taskId: undefined, commandId: "legacy_current" });
  assert.ok((await s.clients[1].main(legacy)).success, "current-version legacy voting remains compatible");
  assert.strictEqual(Object.keys(s.core().phaseData.votesByMemberId).length, 2);
});

test("same-task old versions never bypass actor, life or ballot validation", async () => {
  const s = await createVotingScenario(5);
  const snapshot = await s.snapshot(1);
  await s.vote(0, await s.snapshot(0));
  const invalidVote = await s.clients[1].main(command(s, snapshot, { body: { vote: "INVALID" } }));
  assert.strictEqual(invalidVote.error.code, "INVALID_PAYLOAD");
  await s.db.collection("game_core").doc(s.room.currentGameId).update({
    data: { aliveMemberIds: s.members.filter((_, i) => i !== 1).map((m) => m.memberId) },
  });
  assert.strictEqual((await s.clients[1].main(command(s, snapshot))).error.code, "ACTION_NOT_ALLOWED");
  const stranger = loadGameService({ db: s.db, openId: "stranger" }).service;
  assert.strictEqual((await stranger.main(command(s, snapshot))).error.code, "NOT_ROOM_MEMBER");
  await s.db.collection("room_members").doc("mem_3").update({ data: { memberType: "spectator" } });
  const spectator = await s.clients[2].main(command(s, snapshot, {
    taskId: snapshot.pendingTask.taskId.replace("mem_2", "mem_3"),
  }));
  assert.strictEqual(spectator.error.code, "ACTION_NOT_ALLOWED");
  assert.strictEqual(Object.keys(s.core().phaseData.votesByMemberId).length, 1);
});

test("a delayed first-round ballot cannot enter the next voting round", async () => {
  const s = await createVotingScenario(5);
  const old = await s.snapshot(0);
  const snapshots = await Promise.all(s.members.map((_, i) => s.snapshot(i)));
  const rejectedGovernment = await Promise.all(snapshots.map((snapshot, i) => s.vote(i, snapshot, "NEIN")));
  assert.ok(rejectedGovernment.every((r) => r.success));
  const presidentIndex = s.members.findIndex((m) => m.memberId === s.core().currentPresidentCandidateId);
  const nomination = await s.snapshot(presidentIndex);
  const nominate = await s.clients[presidentIndex].main(command(s, nomination, {
    type: "NOMINATE_CHANCELLOR",
    commandId: "nominate_round_two",
    body: { targetMemberId: nomination.pendingTask.allowedTargets[0] },
  }));
  assert.ok(nominate.success);
  assert.strictEqual(s.core().round, 2);
  assert.strictEqual(s.core().phase, "voting");
  const delayed = await s.clients[0].main(command(s, old));
  assert.strictEqual(delayed.success, false);
  assert.deepStrictEqual(s.core().phaseData.votesByMemberId, {});
});

test("last two votes settle a tie once; replay cannot advance the election tracker twice", async () => {
  const s = await createVotingScenario(6);
  const snapshots = await Promise.all(s.members.map((_, i) => s.snapshot(i)));
  for (let i = 0; i < 4; i += 1) {
    assert.ok((await s.vote(i, snapshots[i], i < 3 ? "JA" : "NEIN")).success);
  }
  const last = [4, 5].map((i) => command(s, snapshots[i], {
    commandId: `final_vote_${i}`, body: { vote: "NEIN" },
  }));
  const responses = await Promise.all(last.map((request, i) => s.clients[i + 4].main(request)));
  assert.ok(responses.every((r) => r.success));
  await Promise.all(last.map((request, i) => s.clients[i + 4].main(request)));
  assert.strictEqual(s.core().phase, "nomination");
  assert.strictEqual(s.core().round, 2);
  assert.strictEqual(s.core().electionTracker, 1);
  assert.strictEqual(s.core().lastVoteResult.passed, false);
  const events = Object.values(s.db.dump().game_events).filter((e) => e.type === "VOTES_REVEALED");
  assert.strictEqual(events.length, 1);
});

for (const terminal of [false, true]) {
  test(`receipt failure rolls back the entire ${terminal ? "terminal" : "partial"} vote`, async (t) => {
    let rejectReceipt = false;
    const s = await createVotingScenario(5, {
      beforeDocOperation({ collection, type }) {
        if (rejectReceipt && collection === "command_records" && type === "set") {
          throw new Error("injected receipt write failure");
        }
      },
    });
    const originalError = console.error;
    console.error = () => {};
    t.after(() => { console.error = originalError; });
    let index = 0;
    if (terminal) {
      // A third failed election enacts the fifth liberal policy and ends the game.
      const core = s.core();
      await s.db.collection("game_core").doc(s.room.currentGameId).update({
        data: {
          electionTracker: 2, liberalPolicyCount: 4,
          policyState: { ...core.policyState, drawPile: ["LIBERAL", ...core.policyState.drawPile] },
        },
      });
      for (let i = 0; i < 4; i += 1) await s.vote(i, await s.snapshot(i), "NEIN");
      index = 4;
    }
    const request = command(s, await s.snapshot(index), { body: { vote: terminal ? "NEIN" : "JA" } });
    const before = s.db.dump();
    rejectReceipt = true;
    const response = await s.clients[index].main(request);
    assert.strictEqual(response.error.code, "INTERNAL_ERROR");
    for (const collection of [
      "game_core", "rooms", "room_public_snapshots", "player_private_snapshots",
      "room_sync_signals", "game_events", "multiplayer_stat_events", "command_records",
    ]) {
      assert.deepStrictEqual(s.db.dump()[collection], before[collection], collection);
    }
    rejectReceipt = false;
    const accepted = await s.clients[index].main(request);
    assert.ok(accepted.success);
    assert.deepStrictEqual(await s.clients[index].main(request), accepted, "lost response must be replayable");
    if (terminal) {
      assert.strictEqual(s.core().winner, "LIBERAL");
      assert.strictEqual(s.core().phase, "game_ended");
      assert.strictEqual(Object.keys(s.db.dump().multiplayer_stat_events).length, 1);
    }
  });
}

test("presence failure cannot turn a committed ballot into an error", async (t) => {
  let rejectPresence = false;
  const s = await createVotingScenario(5, {
    beforeDocOperation({ collection, type }) {
      if (rejectPresence && collection === "room_members" && type === "update") {
        throw new Error("injected presence failure");
      }
    },
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  t.after(() => { console.warn = originalWarn; });
  const request = command(s, await s.snapshot(0));
  rejectPresence = true;
  assert.ok((await s.clients[0].main(request)).success);
  assert.ok((await s.clients[0].main(request)).success);
  assert.strictEqual(s.core().version, 3);
  assert.strictEqual(Object.keys(s.db.dump().command_records).length, 1);
  assert.strictEqual(warnings.length, 2);
  assert.ok(warnings.every(([message]) => message === "vote presence refresh failed"));
});
