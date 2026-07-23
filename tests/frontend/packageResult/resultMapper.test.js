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
      summary: "政府投票公开：1 票赞成，2 票反对，政府未通过",
      votes: [
        { memberId: "mem_3", vote: "NEIN" },
        { memberId: "mem_1", vote: "JA" },
        { memberId: "mem_2", vote: "NEIN" },
      ],
    },
  ],
});

assert.strictEqual(result.timeline[0].showVotePattern, true);
assert.deepStrictEqual(
  result.timeline[0].voteRows.map((vote) => ({
    seatIndex: vote.seatIndex,
    mark: vote.mark,
  })),
  [
    { seatIndex: 1, mark: "✔" },
    { seatIndex: 2, mark: "×" },
    { seatIndex: 3, mark: "×" },
  ],
  "result mapper should render failed election ballots in seat order",
);

console.log("result mapper tests passed");
