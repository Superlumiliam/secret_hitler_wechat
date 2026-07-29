const assert = require("assert");
const { mapResultSnapshot } = require("../../../frontend/packageResult/pages/result/resultMapper");

const result = mapResultSnapshot({
  winner: "LIBERAL",
  myMemberId: "mem_1",
  finalPlayers: [
    { memberId: "mem_2", seatIndex: 2, displayName: "玩家2", role: "FASCIST", party: "FASCIST" },
    { memberId: "mem_1", seatIndex: 1, displayName: "玩家1", role: "LIBERAL", party: "LIBERAL" },
    { memberId: "mem_3", seatIndex: 3, displayName: "玩家3", role: "LIBERAL", party: "LIBERAL" },
  ],
  timeline: [
    {
      eventId: "evt_vote_failed",
      round: 1,
      type: "VOTES_REVEALED",
      title: "政府投票揭示",
      summary: "政府投票公开：1 票赞同，2 票反对，政府未通过",
      voteGroups: {
        jaMemberIds: ["mem_1"],
        neinMemberIds: ["mem_3", "mem_2"],
      },
    },
  ],
});

assert.strictEqual(result.timeline[0].showVoteGroups, true);
assert.deepStrictEqual(
  result.timeline[0].voteGroupRows.map((row) => ({
    label: row.label,
    memberText: row.memberText,
    lineText: row.lineText,
  })),
  [
    { label: "赞同", memberText: "1号", lineText: "赞同：1号" },
    { label: "反对", memberText: "2号、3号", lineText: "反对：2号、3号" },
  ],
  "result mapper should render grouped election ballots as short seat text in seat order",
);

const fascistObserverResult = mapResultSnapshot({
  roomId: "room_fascist_win",
  winner: "FASCIST",
  myMemberId: "mem_spectator",
  finalPlayers: [
    { memberId: "virtual_1", seatIndex: 1, displayName: "玩家1", role: "HITLER", party: "FASCIST" },
    { memberId: "virtual_2", seatIndex: 2, displayName: "玩家2", role: "LIBERAL", party: "LIBERAL" },
  ],
  policySummary: {
    liberal: 2,
    fascist: 6,
  },
  timeline: [],
});

assert.strictEqual(fascistObserverResult.winnerText, "极权派胜利");
assert.strictEqual(
  fascistObserverResult.resultImageAssetKey,
  "result-success-fascist",
  "an observer must see the result image for the actual winning faction",
);

const losingPlayerResult = mapResultSnapshot({
  winner: "FASCIST",
  myMemberId: "virtual_2",
  finalPlayers: [
    { memberId: "virtual_1", seatIndex: 1, displayName: "玩家1", role: "HITLER", party: "FASCIST" },
    { memberId: "virtual_2", seatIndex: 2, displayName: "玩家2", role: "LIBERAL", party: "LIBERAL" },
  ],
  policySummary: {},
  timeline: [],
});
assert.strictEqual(
  losingPlayerResult.resultImageAssetKey,
  "result-fail-liberal",
  "player result images must continue to use the player's own faction",
);

const legislativeResult = mapResultSnapshot({
  myMemberId: "mem_1",
  finalPlayers: [
    { memberId: "mem_1", seatIndex: 1, displayName: "玩家1", role: "LIBERAL", party: "LIBERAL" },
    { memberId: "mem_4", seatIndex: 4, displayName: "玩家4", role: "FASCIST", party: "FASCIST" },
  ],
  timeline: [
    {
      eventId: "evt_policy_enacted",
      round: 3,
      type: "POLICY_ENACTED",
      title: "政策颁布",
      summary: "4号玩家颁布了 1 张自由派政策",
    },
    {
      eventId: "evt_veto_responded",
      round: 5,
      type: "VETO_RESPONDED",
      title: "总统同意否决",
      summary: "1号玩家同意否决，本轮不颁布政策",
    },
  ],
  legislativeHistory: [
    {
      round: 3,
      presidentMemberId: "mem_1",
      chancellorMemberId: "mem_4",
      presidentDiscardedPolicy: "FASCIST",
      chancellorEnactedPolicy: "LIBERAL",
      chancellorDiscardedPolicies: ["FASCIST"],
    },
    {
      round: 5,
      presidentMemberId: "mem_1",
      chancellorMemberId: "mem_4",
      presidentDiscardedPolicy: "LIBERAL",
      chancellorEnactedPolicy: null,
      chancellorDiscardedPolicies: ["FASCIST", "FASCIST"],
    },
  ],
});

assert.strictEqual(Object.prototype.hasOwnProperty.call(legislativeResult, "legislativeHistory"), false);
assert.deepStrictEqual(legislativeResult.timeline[0].legislativeReview, {
  round: 3,
  lines: [
    "1号总统 弃掉了 1张极权派政策",
    "4号总理 弃掉了 1张极权派政策",
    "4号总理 颁布了 1张自由派政策",
  ],
});
assert.deepStrictEqual(legislativeResult.timeline[1].legislativeReview, {
  round: 5,
  lines: [
    "1号总统 弃掉了 1张自由派政策",
    "4号总理 弃掉了 2张极权派政策、极权派政策",
    "4号总理 未颁布政策",
  ],
});
assert.strictEqual(legislativeResult.timeline[0].showSummary, false);
assert.strictEqual(JSON.stringify(legislativeResult).includes("Seen"), false);

console.log("result mapper tests passed");
