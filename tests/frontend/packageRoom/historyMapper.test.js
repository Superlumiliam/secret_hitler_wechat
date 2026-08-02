const assert = require("assert");
const {
  createHistoryRoundViews,
} = require("../../../frontend/packageRoom/pages/history/historyMapper");

const seatOrder = [
  { memberId: "mem_3", seatIndex: 3 },
  { memberId: "mem_1", seatIndex: 1 },
  { memberId: "mem_2", seatIndex: 2 },
];
const rounds = createHistoryRoundViews(
  [
    {
      round: 1,
      presidentId: "mem_2",
      chancellorId: "mem_1",
      voteSummary: {
        revealed: true,
        passed: true,
        electionTrackerCount: 0,
      },
      voteGroups: {
        jaMemberIds: ["mem_3", "mem_1"],
        neinMemberIds: ["mem_2"],
      },
      policyResult: { type: "liberal_policy", label: "自由派政策" },
      executiveResult: {
        type: "execution",
        targetSeatIndex: 3,
      },
    },
    {
      round: 2,
      presidentId: "mem_1",
      chancellorId: "mem_2",
      voteSummary: {
        revealed: true,
        passed: false,
        electionTrackerCount: 3,
      },
      voteGroups: {
        jaMemberIds: ["mem_1", "mem_2", "mem_3"],
        neinMemberIds: [],
      },
      vetoResult: { status: "rejected", accepted: false },
    },
    {
      round: 3,
      presidentId: "mem_3",
      chancellorId: "mem_2",
      voteSummary: {
        revealed: false,
        passed: null,
        electionTrackerCount: 0,
      },
      voteGroups: null,
    },
    {
      round: 4,
      chancellorId: null,
      voteSummary: {
        revealed: false,
        passed: null,
        electionTrackerCount: 0,
      },
      voteGroups: null,
    },
  ],
  seatOrder,
);

assert.strictEqual(rounds[0].roundTitle, "第 1 轮提名");
assert.strictEqual(rounds[0].governmentResultText, "政府通过");
assert.deepStrictEqual(rounds[0].policyResult, {
  text: "自由派政策",
  className: "round-result-badge is-liberal",
});
assert.deepStrictEqual(rounds[0].detailRows[0].actionSegments, [
  { text: "对", isCard: false },
  { text: "3号", isCard: true, cardClass: "is-action-target" },
  { text: "行使了", isCard: false },
  { text: "处决", isCard: false },
]);
assert.deepStrictEqual(
  rounds[0].detailRows.map((row) => row.playerCards.map((card) => card.label)),
  [["2号"], ["1号"], ["1号", "3号"], ["2号"]],
  "revealed rounds should render president, chancellor, and grouped seats as individual cards",
);
assert.strictEqual(rounds[1].governmentResultText, "政府未通过3/3");
assert.deepStrictEqual(rounds[1].detailRows[3].playerCards.map((card) => card.label), ["无"]);
assert.strictEqual(rounds[1].detailRows[1].actionText, "行使了否决权，否决被驳回");
assert.strictEqual(rounds[2].showGovernmentResult, false);
assert.deepStrictEqual(rounds[2].detailRows[0].playerCards.map((card) => card.label), ["3号"]);
assert.deepStrictEqual(rounds[2].detailRows[1].playerCards.map((card) => card.label), ["2号"]);
assert.deepStrictEqual(rounds[2].detailRows[2].playerCards, []);
assert.deepStrictEqual(rounds[2].detailRows[3].playerCards, []);
assert.strictEqual(rounds[3].showGovernmentResult, false);
assert(rounds[3].detailRows.every((row) => row.playerCards.length === 0));

const executiveRounds = createHistoryRoundViews(
  [
    { round: 5, presidentId: "mem_1", executiveResult: { type: "investigation", targetSeatIndex: 2 } },
    { round: 6, presidentId: "mem_1", executiveResult: { type: "special_election", targetSeatIndex: 2 } },
    { round: 7, presidentId: "mem_1", executiveResult: { type: "policy_peek" } },
    { round: 8, presidentId: "mem_1", executiveResult: { type: "execution", targetSeatIndex: 2 } },
  ],
  seatOrder,
);
assert.deepStrictEqual(
  executiveRounds.map((round) => round.detailRows[0].actionSegments),
  [
    [
      { text: "对", isCard: false },
      { text: "2号", isCard: true, cardClass: "is-action-target" },
      { text: "行使了", isCard: false },
      { text: "调查忠诚", isCard: false },
    ],
    [
      { text: "对", isCard: false },
      { text: "2号", isCard: true, cardClass: "is-action-target" },
      { text: "行使了", isCard: false },
      { text: "特别选举", isCard: false },
    ],
    [
      { text: "行使了", isCard: false },
      { text: "政策预览", isCard: false },
    ],
    [
      { text: "对", isCard: false },
      { text: "2号", isCard: true, cardClass: "is-action-target" },
      { text: "行使了", isCard: false },
      { text: "处决", isCard: false },
    ],
  ],
  "all presidential powers should be rendered in the president row",
);

console.log("history mapper tests passed");
