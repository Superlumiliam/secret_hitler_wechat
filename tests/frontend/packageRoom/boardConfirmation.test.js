const assert = require("assert");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");

function loadPageDefinition() {
  const absolutePath = path.join(repoRoot, "frontend/packageRoom/pages/board/index.js");
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  delete require.cache[absolutePath];
  require(absolutePath);
  return definition;
}

function createContext(board, data, overrides = {}) {
  return {
    ...board,
    data: {
      ...board.data,
      ...data,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
    ...overrides,
  };
}

async function assertPolicyPeekRequiresConfirmation() {
  const board = loadPageDefinition();
  const modals = [];
  const submissions = [];
  let nextConfirm = false;
  global.wx = {
    showModal(options) {
      modals.push(options);
      options.success({ confirm: nextConfirm });
    },
  };

  const context = createContext(board, {
    snapshot: {
      pendingTask: { taskType: "EXEC_POLICY_PEEK_ACK", taskId: "task_1" },
    },
    isSubmittingCommand: false,
  }, {
    submitExecutiveCommand(options) {
      submissions.push(options);
      return Promise.resolve();
    },
  });

  await board.onTapPolicyPeekAck.call(context);
  assert.strictEqual(modals.length, 1, "policy peek completion should open a confirmation modal");
  assert.strictEqual(modals[0].title, "确认完成政策预览");
  assert.strictEqual(submissions.length, 0, "cancelling policy peek confirmation must not submit a command");

  nextConfirm = true;
  await board.onTapPolicyPeekAck.call(context);
  assert.strictEqual(submissions.length, 1, "confirming policy peek should submit exactly one command");
  assert.strictEqual(submissions[0].commandType, "EXEC_POLICY_PEEK_ACK");
}

async function assertPolicyPeekConfirmationIsLockedDuringModal() {
  const board = loadPageDefinition();
  let modalCount = 0;
  let resolveModal;
  let submissionCount = 0;
  global.wx = {
    showModal(options) {
      modalCount += 1;
      resolveModal = options.success;
    },
  };

  const context = createContext(board, {
    snapshot: {
      pendingTask: { taskType: "EXEC_POLICY_PEEK_ACK", taskId: "task_1" },
    },
    isSubmittingCommand: false,
  }, {
    submitExecutiveCommand() {
      submissionCount += 1;
      return Promise.resolve();
    },
  });

  const firstTap = board.onTapPolicyPeekAck.call(context);
  const secondTap = board.onTapPolicyPeekAck.call(context);
  assert.strictEqual(modalCount, 1, "repeated taps while the modal is open should create one confirmation flow");

  resolveModal({ confirm: true });
  await Promise.all([firstTap, secondTap]);
  assert.strictEqual(submissionCount, 1, "repeated taps should submit one policy peek command");
}

function assertNominationHasConfirmation() {
  const board = loadPageDefinition();
  let modalOptions = null;
  let submissionCount = 0;
  global.wx = {
    showModal(options) {
      modalOptions = options;
    },
  };

  const context = createContext(board, {
    selectedNominationTargetId: "member_2",
    nominateTargets: [{ memberId: "member_2", label: "2号 玩家2", canNominate: true }],
    isSubmittingCommand: false,
  }, {
    submitNomination() {
      submissionCount += 1;
    },
  });

  board.onTapNominateSelected.call(context);
  assert.ok(modalOptions, "nomination should open a confirmation modal");
  assert.strictEqual(modalOptions.title, "确认提名");
  modalOptions.success({ confirm: true });
  assert.strictEqual(submissionCount, 1, "confirming nomination should submit once");
}

async function assertExecutiveTargetHasConfirmation() {
  const board = loadPageDefinition();
  let modalOptions = null;
  let submissionCount = 0;
  global.wx = {
    showModal(options) {
      modalOptions = options;
      options.success({ confirm: true });
    },
  };

  const context = createContext(board, {
    selectedExecutiveTargetId: "member_2",
    executiveTargets: [{ memberId: "member_2", label: "2号 玩家2", canTarget: true }],
    snapshot: { pendingTask: { taskType: "EXEC_SPECIAL_ELECTION", taskId: "task_2" } },
    executiveAction: { title: "特别选举" },
    isSubmittingCommand: false,
  }, {
    submitExecutiveCommand() {
      submissionCount += 1;
      return Promise.resolve();
    },
  });

  await board.onTapExecutiveSelected.call(context);
  assert.ok(modalOptions, "targeted presidential power should open a confirmation modal");
  assert.strictEqual(modalOptions.title, "特别选举");
  assert.strictEqual(submissionCount, 1, "confirming a targeted presidential power should submit once");
}

(async () => {
  await assertPolicyPeekRequiresConfirmation();
  await assertPolicyPeekConfirmationIsLockedDuringModal();
  assertNominationHasConfirmation();
  await assertExecutiveTargetHasConfirmation();
  console.log("board confirmation tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
