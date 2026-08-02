const { createVoteGroupRows } = require("../../utils/voteGroups");

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
    const policyResult =
      round.policyResult ||
      (round.outcome && ["liberal_policy", "fascist_policy"].includes(round.outcome.type) ? round.outcome : null);
    const executiveResult = round.executiveResult || null;
    const vetoResult = round.vetoResult || null;
    const createExecutiveActionSegments = (result) => {
      if (!result) {
        return [];
      }
      const actionTextByType = {
        investigation: "调查忠诚",
        special_election: "特别选举",
        policy_peek: "政策预览",
        execution: "处决",
      };
      const powerText = actionTextByType[result.type] || "";
      if (!powerText) {
        return [];
      }
      const segments = [];
      if (result.targetSeatIndex) {
        segments.push({ text: "对", isCard: false });
        segments.push({
          text: `${result.targetSeatIndex}号`,
          isCard: true,
          cardClass: "is-action-target",
        });
      }
      segments.push({ text: "行使了", isCard: false });
      segments.push({ text: powerText, isCard: false });
      return segments;
    };
    const createVetoActionText = (result) => {
      if (!result) {
        return "";
      }
      if (result.status === "pending") {
        return "行使了否决权，等待总统回应";
      }
      return `行使了否决权，否决${result.accepted ? "通过" : "被驳回"}`;
    };

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
      policyResult: policyResult
        ? {
            text: policyResult.label,
            className: `round-result-badge ${policyResult.type === "liberal_policy" ? "is-liberal" : "is-fascist"}`,
          }
        : null,
      detailRows: [
        {
          key: "president",
          label: "总统",
          labelClass: "history-detail-label is-president",
          playerCards: president
            ? [{ memberId: president.memberId, label: `${president.seatIndex}号`, cardClass: "" }]
            : [],
          actionSegments: createExecutiveActionSegments(executiveResult),
        },
        {
          key: "chancellor",
          label: "总理",
          labelClass: "history-detail-label is-chancellor",
          playerCards: chancellor
            ? [{ memberId: chancellor.memberId, label: `${chancellor.seatIndex}号`, cardClass: "" }]
            : [],
          actionSegments: [],
          actionText: createVetoActionText(vetoResult),
        },
        {
          key: "ja",
          label: "赞同",
          labelClass: "history-detail-label is-ja",
          playerCards: createPlayerCards(voteGroupRows[0]),
          actionSegments: [],
        },
        {
          key: "nein",
          label: "反对",
          labelClass: "history-detail-label is-nein",
          playerCards: createPlayerCards(voteGroupRows[1]),
          actionSegments: [],
        },
      ],
    };
  });
}

module.exports = {
  createHistoryRoundViews,
};
