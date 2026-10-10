const assert = require("assert");
const test = require("node:test");
const { createVotingScenario } = require("../../backend/helpers/createVotingScenario");

test("a vote confirmed after another player votes should be accepted without manual retry", async (t) => {
  const scenario = await createVotingScenario(5);
  const beforeModal = await scenario.snapshot(1);
  const previousPage = global.Page;
  const previousWx = global.wx;
  const originalConsoleError = console.error;
  t.after(() => {
    if (previousPage === undefined) delete global.Page;
    else global.Page = previousPage;
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
    console.error = originalConsoleError;
  });
  let board;
  global.Page = (definition) => { board = definition; };
  const pagePath = require.resolve("../../../frontend/packageRoom/pages/board/index.js");
  delete require.cache[pagePath];
  require(pagePath);

  let modal;
  const requests = [];
  const toasts = [];
  const errors = [];
  const refreshes = [];
  console.error = (...args) => errors.push(args.map((arg) => arg instanceof Error ? arg.message : String(arg)));
  global.wx = {
    showModal(options) { modal = options; },
    showToast(options) { toasts.push(options.title); },
    cloud: {
      async callFunction(request) {
        const result = await scenario.clients[1].main(request.data);
        requests.push({ payload: request.data.payload, result });
        return { result };
      },
    },
  };
  const context = {
    ...board,
    data: {
      ...board.data,
      roomId: scenario.room.roomId,
      snapshot: beforeModal,
      canVote: true,
      isSubmittingCommand: false,
    },
    setData(update) { this.data = { ...this.data, ...update }; },
    // Timers/rendering are irrelevant here; use the real snapshot read for refresh.
    markCommandSettled() {},
    loadGameSnapshot() {
      const refresh = scenario.snapshot(1).then((snapshot) => {
        this.setData({ snapshot, canVote: Boolean(snapshot.pendingTask) });
      });
      refreshes.push(refresh);
      return refresh;
    },
  };

  const submission = context.submitVote("JA");
  assert.ok(modal, "the player is waiting at the confirmation dialog");
  assert.strictEqual(requests.length, 0, "no vote should be sent before confirmation");

  const otherVote = await scenario.vote(0, await scenario.snapshot(0));
  assert.strictEqual(otherVote.success, true);
  // A realtime refresh arrives while the confirmation dialog remains open.
  const refreshed = await scenario.snapshot(1);
  assert.strictEqual(refreshed.version, beforeModal.version + 1);
  assert.strictEqual(refreshed.pendingTask.taskId, beforeModal.pendingTask.taskId);
  context.setData({ snapshot: refreshed });

  modal.success({ confirm: true });
  await submission;
  await Promise.all(refreshes);
  t.diagnostic(JSON.stringify({
    versionBeforeModal: beforeModal.version,
    versionVisibleAtConfirmation: refreshed.version,
    submittedVersions: requests.map((r) => r.payload.expectedVersion),
    responses: requests.map((r) => r.result.success ? "accepted" : r.result.error.code),
    toasts, errors,
  }));
  const ballot = scenario.core().phaseData.votesByMemberId[scenario.members[1].memberId];
  assert.ok(ballot, "the confirmed current-task vote must be recorded without another user click");
  assert.strictEqual(ballot.vote, "JA");
});
