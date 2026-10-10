const assert = require("assert");
const test = require("node:test");
const { createVotingScenario } = require("../../backend/helpers/createVotingScenario");
const { POLICY_TRACK_ASSET_FILE_IDS } = require("../../../frontend/packageRoom/types/game");
const { clearGameSnapshotCache } = require("../../../frontend/utils/gameSnapshotCache");

async function setup(t, options = {}) {
  const scenario = await createVotingScenario(5);
  const initial = await scenario.snapshot(1);
  const previous = { Page: global.Page, wx: global.wx, error: console.error };
  let board;
  global.Page = (definition) => { board = definition; };
  const path = require.resolve("../../../frontend/packageRoom/pages/board/index.js");
  delete require.cache[path];
  require(path);
  const commands = [];
  const modals = [];
  const toasts = [];
  let reads = 0;
  console.error = () => {};
  global.wx = {
    getStorageSync: () => true,
    setStorage() {},
    showShareMenu() {},
    showToast({ title }) { toasts.push(title); },
    showModal(modal) {
      modals.push(modal);
      if (!options.deferModal) modal.success({ confirm: true });
    },
    cloud: {
      async callFunction(request) {
        const next = async () => ({ result: await scenario.clients[1].main(request.data) });
        if (request.data.action === "submitCommand") {
          commands.push(JSON.parse(JSON.stringify(request.data.payload)));
          return options.send ? options.send(request, next, commands.length, scenario) : next();
        }
        reads += 1;
        return options.read ? options.read(request, next, reads, initial) : next();
      },
    },
  };
  const context = {
    ...board,
    snapshotRequestQueue: [],
    data: {
      ...board.data,
      roomId: scenario.room.roomId,
      policyAssets: Object.fromEntries(Object.keys(POLICY_TRACK_ASSET_FILE_IDS).map((key) => [key, "asset"])),
    },
    setData(update) { this.data = { ...this.data, ...update }; },
  };
  t.after(() => {
    clearTimeout(context.__pageTimeoutTimer);
    context.stopRefreshTimer();
    clearGameSnapshotCache();
    if (previous.Page === undefined) delete global.Page;
    else global.Page = previous.Page;
    if (previous.wx === undefined) delete global.wx;
    else global.wx = previous.wx;
    console.error = previous.error;
  });
  await context.hydrateSnapshot(initial);
  return { scenario, initial, context, commands, modals, toasts };
}

test("the confirmation dialog blocks reentry; cancel sends no ballot", async (t) => {
  const h = await setup(t, { deferModal: true });
  const first = h.context.submitVote("JA");
  await h.context.submitVote("NEIN");
  assert.strictEqual(h.modals.length, 1);
  assert.strictEqual(h.context.data.isSubmittingCommand, true);
  h.modals[0].success({ confirm: false });
  await first;
  assert.strictEqual(h.commands.length, 0);
  assert.strictEqual(h.context.data.isSubmittingCommand, false);
  assert.strictEqual(h.context.data.canVote, true);

  const confirmed = h.context.submitVote("JA");
  h.modals[1].success({ confirm: true });
  await confirmed;
  assert.strictEqual(h.commands.length, 1);
  assert.strictEqual(h.context.data.voteSubmissionState, "submitted");
});

test("a task completed on another client while the modal is open is not resubmitted", async (t) => {
  const h = await setup(t, { deferModal: true });
  const waiting = h.context.submitVote("JA");
  await h.scenario.vote(1, h.initial);
  await h.context.loadGameSnapshot({ silent: true });
  h.modals[0].success({ confirm: true });
  await waiting;
  assert.strictEqual(h.commands.length, 0);
  assert.strictEqual(h.context.data.canVote, false);
});

test("lost success response is confirmed by snapshot without resending or reopening voting", async (t) => {
  const h = await setup(t, {
    async send(request, next) {
      await next();
      throw new Error("response lost after commit");
    },
  });
  await h.context.submitVote("JA");
  assert.strictEqual(h.commands.length, 1);
  assert.strictEqual(h.context.pendingVoteCommand, null);
  assert.strictEqual(h.context.data.voteSubmissionState, "submitted");
  assert.strictEqual(h.context.data.canVote, false);
  assert.strictEqual(h.scenario.core().version, 3);
  await h.context.hydrateSnapshot(h.initial);
  assert.strictEqual(h.context.data.snapshot.version, 3);
  assert.strictEqual(h.context.data.canVote, false);
});

test("an undelivered request retries once with exactly the same payload and no new confirmation", async (t) => {
  const h = await setup(t, {
    async send(request, next, count) {
      if (count === 1) throw new Error("request did not reach server");
      return next();
    },
  });
  await h.context.submitVote("JA");
  assert.strictEqual(h.commands.length, 2);
  assert.deepStrictEqual(h.commands[0], h.commands[1]);
  assert.strictEqual(h.modals.length, 1);
  assert.strictEqual(h.context.data.voteSubmissionState, "submitted");
  assert.strictEqual(h.scenario.core().version, 3);
});

test("retry is bounded; explicit confirmation reuses the ballot and prevents changing it", async (t) => {
  let offline = true;
  const h = await setup(t, {
    async send(request, next) {
      if (offline) throw new Error("requests unavailable");
      return next();
    },
  });
  await h.context.submitVote("JA");
  assert.strictEqual(h.commands.length, 2);
  assert.strictEqual(h.context.data.voteSubmissionState, "confirming");
  assert.strictEqual(h.context.data.isSubmittingCommand, false);
  assert.strictEqual(h.context.data.canVote, false);
  await h.context.submitVote("NEIN");
  assert.strictEqual(h.commands.length, 2);
  offline = false;
  await h.context.onRetryVoteConfirmation();
  assert.strictEqual(h.commands.length, 3);
  assert.deepStrictEqual(h.commands[2], h.commands[0]);
  assert.strictEqual(h.modals.length, 1);
  assert.strictEqual(h.scenario.core().phaseData.votesByMemberId.mem_2.vote, "JA");
  assert.strictEqual(h.context.data.voteSubmissionState, "submitted");
});

test("snapshot failure leaves an uncertain vote pending without a blind automatic resend", async (t) => {
  const h = await setup(t, {
    async send() { throw new Error("request unavailable"); },
    async read() { throw new Error("snapshot unavailable"); },
  });
  await h.context.submitVote("JA");
  assert.strictEqual(h.commands.length, 1);
  assert.strictEqual(h.context.data.voteSubmissionState, "confirming");
  assert.ok(h.context.pendingVoteCommand);
});

test("DUPLICATE_COMMAND is an actual rejection, not a success toast or an automatic retry", async (t) => {
  const h = await setup(t, {
    async send() {
      return { result: { success: false, error: { code: "DUPLICATE_COMMAND", retryable: false } } };
    },
  });
  await h.context.submitVote("JA");
  assert.strictEqual(h.commands.length, 1);
  assert.strictEqual(h.context.pendingVoteCommand, null);
  assert.strictEqual(h.context.data.voteSubmissionState, "");
  assert.strictEqual(h.context.data.canVote, true, "a definitive rejection must not strand the vote UI");
  assert.ok(h.toasts.some((text) => text.includes("请求不一致")));
  assert.ok(h.toasts.every((text) => !text.includes("已提交")));
});

test("old reads after an accepted response cannot reopen voting; an immediate fresh read catches up", async (t) => {
  const h = await setup(t, {
    async read(request, next, count, initial) {
      return count === 1 ? { result: { success: true, data: initial } } : next();
    },
  });
  await h.context.submitVote("JA");
  assert.strictEqual(h.commands.length, 1);
  assert.strictEqual(h.context.data.snapshot.version, 3);
  assert.strictEqual(h.context.data.canVote, false);
  assert.strictEqual(h.context.pendingVoteCommand, null);
  assert.strictEqual(h.context.data.voteSubmissionState, "submitted");
});

test("an election that advanced during a lost response stops recovery of the old task", async (t) => {
  const h = await setup(t, {
    async send(request, next, count, scenario) {
      await next();
      for (const index of [0, 2, 3, 4]) {
        await scenario.vote(index, await scenario.snapshot(index));
      }
      throw new Error("response lost while the election advanced");
    },
  });
  await h.context.submitVote("JA");
  assert.strictEqual(h.commands.length, 1);
  assert.strictEqual(h.scenario.core().phase, "legislative_president");
  assert.strictEqual(h.context.pendingVoteCommand, null);
  assert.strictEqual(h.context.data.voteSubmissionState, "");
});

test("mixed public/private reads after a lost response do not reopen a confirmed ballot", async (t) => {
  const h = await setup(t, {
    async send(request, next) {
      await next();
      throw new Error("response lost after commit");
    },
    async read(request, next, count, initial) {
      const response = await next();
      // getGameSnapshot reads public and private documents separately. A commit
      // between those reads can expose the old public version with our new ballot.
      if (count === 1) response.result.data.version = initial.version;
      return response;
    },
  });
  await h.context.submitVote("JA");
  await h.context.hydrateSnapshot(h.initial);
  assert.strictEqual(h.commands.length, 1);
  assert.strictEqual(h.context.data.snapshot.version, 3);
  assert.strictEqual(h.context.data.canVote, false);
  assert.strictEqual(h.context.data.voteSubmissionState, "submitted");
});
