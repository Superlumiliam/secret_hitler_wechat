const { createVoteGroupRows } = require("../../../utils/voteGroups");

function createHistoryRoundViews(rounds, seatOrder) {
  const memberById = Object.fromEntries(
    (Array.isArray(seatOrder) ? seatOrder : []).map((member) => [member.memberId, member]),
  );

  return (Array.isArray(rounds) ? rounds : []).map((round) => {
    const president = memberById[round.presidentId] || null;
    const chancellor = memberById[round.chancellorId] || null;
    const voteSummary = round.voteSummary || {};
    const voteGroupRows =
      voteSummary.revealed && round.voteGroups
        ? createVoteGroupRows(round.voteGroups, seatOrder)
        : [];
    const createPlayerCards = (groupRow) => {
      if (!voteSummary.revealed || !groupRow) {
        return [];
      }
      return groupRow.memberCards.length
        ? groupRow.memberCards
        : [{ memberId: `${groupRow.key}_empty`, label: "无", cardClass: "is-empty" }];
    };
    const showGovernmentResult = voteSummary.revealed && typeof voteSummary.passed === "boolean";

    return {
      round: round.round,
      roundTitle: `第 ${round.round} 轮提名`,
      showGovernmentResult,
      governmentResultText: showGovernmentResult
        ? voteSummary.passed
          ? "政府通过"
          : `政府未通过${voteSummary.electionTrackerCount || 0}/3`
        : "",
      governmentResultClass: `round-result-badge ${voteSummary.passed ? "is-passed" : "is-failed"}`,
      detailRows: [
        {
          key: "president",
          label: "总统",
          labelClass: "history-detail-label is-president",
          playerCards: president
            ? [{ memberId: president.memberId, label: `${president.seatIndex}号`, cardClass: "" }]
            : [],
        },
        {
          key: "chancellor",
          label: "总理",
          labelClass: "history-detail-label is-chancellor",
          playerCards: chancellor
            ? [{ memberId: chancellor.memberId, label: `${chancellor.seatIndex}号`, cardClass: "" }]
            : [],
        },
        {
          key: "ja",
          label: "赞同",
          labelClass: "history-detail-label is-ja",
          playerCards: createPlayerCards(voteGroupRows[0]),
        },
        {
          key: "nein",
          label: "反对",
          labelClass: "history-detail-label is-nein",
          playerCards: createPlayerCards(voteGroupRows[1]),
        },
      ],
    };
  });
}

module.exports = {
  createHistoryRoundViews,
};
