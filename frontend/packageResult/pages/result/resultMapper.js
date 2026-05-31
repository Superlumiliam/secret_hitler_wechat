const { createFascistTrack, createLiberalTrack } = require("../../utils/policyTrack");

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

function mapResultSnapshot(snapshot, assets = {}) {
  const policySummary = snapshot.policySummary || {};
  const finalPlayers = snapshot.finalPlayers || [];
  const timeline = snapshot.timeline || [];
  const replaceTimelineNames = createTimelineNameReplacer(finalPlayers);
  const winner = snapshot.winner || "";
  const myPlayer = finalPlayers.find((player) => player.memberId === snapshot.myMemberId);
  const isMyWinner = myPlayer ? myPlayer.party === winner : true;
  const myPartyAssetSuffix = myPlayer && myPlayer.party === "FASCIST" ? "fascist" : "liberal";
  const targetPlayerCount = finalPlayers.length || 6;
  const liberalPolicyCount = policySummary.liberal || 0;
  const fascistPolicyCount = policySummary.fascist || 0;

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
    timeline: timeline.map((item) => ({
      ...item,
      title: replaceTimelineNames(item.title),
      summary: replaceTimelineNames(item.summary),
      timeText: formatTime(item.createdAt),
      roundText: `第 ${item.round || 1} 轮`,
    })),
  };
}

module.exports = {
  mapResultSnapshot,
};
