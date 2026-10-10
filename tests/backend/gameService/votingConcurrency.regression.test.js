const assert = require("assert");
const test = require("node:test");
const { createVotingScenario } = require("../helpers/createVotingScenario");

function assertSettledOnce(scenario) {
  const core = scenario.core();
  assert.strictEqual(core.phase, "legislative_president");
  assert.deepStrictEqual(core.lastVoteResult.voteGroups.jaMemberIds, scenario.members.map((m) => m.memberId));
  assert.deepStrictEqual(core.lastVoteResult.voteGroups.neinMemberIds, []);
  const revealedEvents = Object.values(scenario.db.dump().game_events || {})
    .filter((event) => event.type === "VOTES_REVEALED");
  assert.strictEqual(revealedEvents.length, 1, "one election must produce exactly one reveal event");
}

// Regression for simultaneous same-task votes from a shared public version.
// Assert desired user behavior, rather than treating VERSION_CONFLICT as success.
for (const playerCount of [5, 7, 10]) {
  test(`${playerCount} players voting from the same snapshot should all be accepted`, async (t) => {
    const scenario = await createVotingScenario(playerCount);
    const snapshots = await Promise.all(scenario.members.map((_, index) => scenario.snapshot(index)));
    assert.strictEqual(new Set(snapshots.map((s) => s.version)).size, 1);
    const responses = await Promise.all(snapshots.map((snapshot, index) => scenario.vote(index, snapshot)));
    const rejected = responses.filter((r) => !r.success).map((r) => r.error.code);
    const core = scenario.core();
    const recordedVotes = core.lastVoteResult
      ? core.lastVoteResult.jaCount + core.lastVoteResult.neinCount
      : Object.keys(core.phaseData.votesByMemberId).length;
    t.diagnostic(JSON.stringify({
      playerCount, submittedVersion: snapshots[0].version,
      accepted: responses.filter((r) => r.success).length,
      rejected, recordedVotes, phase: core.phase,
    }));
    assert.deepStrictEqual(rejected, [], "other players' votes must not invalidate a current-task ballot");
    assert.strictEqual(recordedVotes, playerCount);
    assertSettledOnce(scenario);
  });
}

test("control: sequential voting with a fresh snapshot completes the election", async () => {
  const scenario = await createVotingScenario(10);
  for (let index = 0; index < scenario.members.length; index += 1) {
    const result = await scenario.vote(index, await scenario.snapshot(index));
    assert.strictEqual(result.success, true, JSON.stringify(result));
  }
  assertSettledOnce(scenario);
});

test("ten players should not need repeated synchronized refresh-and-retry waves", async (t) => {
  const scenario = await createVotingScenario(10);
  let pending = scenario.members.map((_, index) => index);
  const attempts = scenario.members.map(() => 0);
  const waves = [];
  // Model users manually refreshing and clicking again. This is not a proposed
  // production retry algorithm. Bound it so a stuck election cannot hang tests.
  for (let wave = 0; pending.length && wave < 10; wave += 1) {
    const snapshots = await Promise.all(pending.map((index) => scenario.snapshot(index)));
    const responses = await Promise.all(pending.map((index, position) => {
      attempts[index] += 1;
      return scenario.vote(index, snapshots[position]);
    }));
    waves.push({
      version: snapshots[0].version,
      submitted: pending.length,
      accepted: responses.filter((r) => r.success).length,
      errors: responses.filter((r) => !r.success).map((r) => r.error.code),
    });
    pending = pending.filter((_, position) => !responses[position].success);
  }
  t.diagnostic(JSON.stringify({ waves, totalAttempts: attempts.reduce((a, b) => a + b, 0), attempts }));
  assert.deepStrictEqual(pending, [], "the bounded scenario should reach a settled election");
  assertSettledOnce(scenario);
  assert.strictEqual(Math.max(...attempts), 1, "a legal vote should not require repeated user confirmation");
});
