const { createFascistTrack, createLiberalTrack } = require("../../utils/policyTrack");
const { createVoteGroupRows } = require("../../utils/voteGroups");

const WINNER_TEXT = {
  LIBERAL: "自由派胜利",
  FASCIST: "极权派胜利",
};

const WIN_REASON_TEXT = {
  LIBERAL_POLICIES: "自由派完成 5 项政策",
  FASCIST_POLICIES: "极权派完成 6 项政策",
  HITLER_ELECTED: "独裁者当选总理",
  HITLER_EXECUTED: "独裁者被处决",
};

const ROLE_CHIP_ASSET_KEY = {
  LIBERAL: "result-role-chip-liberal",
  FASCIST: "result-role-chip-fascist",
  HITLER: "result-role-chip-dictator",
};

const POLICY_TEXT = {
  LIBERAL: "自由派政策",
  FASCIST: "极权派政策",
};

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createTimelineNameReplacer(players) {
  const replacements = players
    .filter((player) => player && player.displayName && player.seatIndex)
    .map((player) => ({
      displayName: String(player.displayName),
      seatText: `${player.seatIndex}号玩家`,
    }))
    .sort((a, b) => b.displayName.length - a.displayName.length);

  return (text) => {
    let nextText = text || "";
    replacements.forEach((item) => {
      nextText = nextText.replace(new RegExp(escapeRegExp(item.displayName), "g"), item.seatText);
    });
    return nextText;
  };
}

function createTimelineVoteGroupRows(item, players) {
  if (!item || item.type !== "VOTES_REVEALED" || !item.voteGroups) {
    return [];
  }
  return createVoteGroupRows(item.voteGroups, players).map((row) => {
    const memberText = row.memberCards.length
      ? row.memberCards.map((member) => member.label).join("、")
      : "无";
    return {
      ...row,
      memberText,
      lineText: `${row.label}：${memberText}`,
    };
  });
}

function mapLegislativeHistoryByRound(history, players) {
  const playerById = Object.fromEntries(players.map((player) => [player.memberId, player]));
  return Object.fromEntries((Array.isArray(history) ? history : []).map((item) => {
    const president = playerById[item.presidentMemberId] || {};
    const chancellor = playerById[item.chancellorMemberId] || {};
    const presidentRoleText = president.seatIndex ? `${president.seatIndex}号总统` : "总统";
    const chancellorRoleText = chancellor.seatIndex ? `${chancellor.seatIndex}号总理` : "总理";
    const chancellorDiscardedPolicyText = (Array.isArray(item.chancellorDiscardedPolicies)
      ? item.chancellorDiscardedPolicies
      : []
    )
      .map((policy) => POLICY_TEXT[policy] || "")
      .filter(Boolean)
      .join("、");
    const chancellorEnactedPolicyText = POLICY_TEXT[item.chancellorEnactedPolicy] || "";
    const chancellorDiscardedPolicies = Array.isArray(item.chancellorDiscardedPolicies)
      ? item.chancellorDiscardedPolicies
      : [];
    const lines = [
      `${presidentRoleText} 弃掉了 1张${POLICY_TEXT[item.presidentDiscardedPolicy] || "未知政策"}`,
    ];
    if (chancellorDiscardedPolicyText) {
      lines.push(`${chancellorRoleText} 弃掉了 ${chancellorDiscardedPolicies.length}张${chancellorDiscardedPolicyText}`);
    }
    if (chancellorEnactedPolicyText) {
      lines.push(`${chancellorRoleText} 颁布了 1张${chancellorEnactedPolicyText}`);
    } else {
      lines.push(`${chancellorRoleText} 未颁布政策`);
    }

    return [item.round || 1, {
      round: item.round || 1,
      lines,
    }];
  }));
}

function attachLegislativeReviews(timeline, historyByRound) {
  const timelineIndicesByRound = {};
  timeline.forEach((item, index) => {
    const round = item.round || 1;
    if (!timelineIndicesByRound[round]) {
      timelineIndicesByRound[round] = [];
    }
    timelineIndicesByRound[round].push(index);
  });

  const reviewByTimelineIndex = {};
  Object.keys(historyByRound).forEach((roundKey) => {
    const review = historyByRound[roundKey];
    const indices = timelineIndicesByRound[roundKey] || [];
    const preferredIndex = indices
      .slice()
      .reverse()
      .find((index) => ["POLICY_ENACTED", "VETO_RESPONDED"].includes(timeline[index].type));
    const targetIndex = preferredIndex === undefined ? indices[indices.length - 1] : preferredIndex;
    if (targetIndex !== undefined) {
      reviewByTimelineIndex[targetIndex] = review;
    }
  });

  return timeline.map((item, index) => {
    const legislativeReview = reviewByTimelineIndex[index] || null;
    return {
      ...item,
      legislativeReview,
      showSummary: !legislativeReview && Boolean(item.summary),
    };
  });
}

function mapResultSnapshot(snapshot, assets = {}) {
  const policySummary = snapshot.policySummary || {};
  const finalPlayers = snapshot.finalPlayers || [];
  const timeline = snapshot.timeline || [];
  const replaceTimelineNames = createTimelineNameReplacer(finalPlayers);
  const winner = snapshot.winner || "";
  const myPlayer = finalPlayers.find((player) => player.memberId === snapshot.myMemberId);
  const isMyWinner = myPlayer ? myPlayer.party === winner : true;
  const viewerParty = myPlayer ? myPlayer.party : winner;
  const myPartyAssetSuffix = viewerParty === "FASCIST" ? "fascist" : "liberal";
  const targetPlayerCount = finalPlayers.length || 6;
  const liberalPolicyCount = policySummary.liberal || 0;
  const fascistPolicyCount = policySummary.fascist || 0;
  const legislativeHistoryByRound = mapLegislativeHistoryByRound(snapshot.legislativeHistory, finalPlayers);

  return {
    roomId: snapshot.roomId || "",
    roomCode: snapshot.roomCode || "",
    roomStatus: snapshot.roomStatus || "",
    myMemberId: snapshot.myMemberId || "",
    version: snapshot.version || 0,
    winner,
    winnerText: WINNER_TEXT[winner] || "对局结束",
    winnerClass: winner === "LIBERAL" ? "is-liberal" : "is-fascist",
    resultImageAssetKey: `result-${isMyWinner ? "success" : "fail"}-${myPartyAssetSuffix}`,
    winReason: snapshot.winReason || "",
    winReasonText: WIN_REASON_TEXT[snapshot.winReason] || "胜负已判定",
    endedAtText: formatTime(snapshot.endedAt),
    policySummary: {
      liberal: liberalPolicyCount,
      fascist: fascistPolicyCount,
      targetPlayerCount,
      liberalTrack: createLiberalTrack(liberalPolicyCount, assets),
      fascistTrack: createFascistTrack(targetPlayerCount, fascistPolicyCount, assets),
    },
    players: finalPlayers
      .slice()
      .sort((a, b) => (a.seatIndex || 0) - (b.seatIndex || 0))
      .map((player) => ({
        ...player,
        partyText: player.party === "LIBERAL" ? "自由派阵营" : "极权派阵营",
        identityPlateAssetKey:
          player.role === "LIBERAL" ? "result-identity-row-liberal" : "result-identity-row-fascist",
        roleChipAssetKey: ROLE_CHIP_ASSET_KEY[player.role] || "result-role-chip-fascist",
        className: [
          "player-card",
          player.role === "LIBERAL" ? "is-liberal" : "is-fascist",
          player.memberId === snapshot.myMemberId ? "is-me" : "",
        ]
          .filter(Boolean)
          .join(" "),
      })),
    timeline: attachLegislativeReviews(timeline.map((item) => {
      const voteGroupRows = createTimelineVoteGroupRows(item, finalPlayers);
      return {
        ...item,
        title: replaceTimelineNames(item.title),
        summary: replaceTimelineNames(item.summary),
        timeText: formatTime(item.createdAt),
        roundText: `第 ${item.round || 1} 轮`,
        showVoteGroups: voteGroupRows.length > 0,
        voteGroupRows,
      };
    }), legislativeHistoryByRound),
  };
}

module.exports = {
  mapResultSnapshot,
};
