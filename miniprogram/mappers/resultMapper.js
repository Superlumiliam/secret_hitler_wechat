const winnerLabelMap = {
  LIBERAL: '自由派胜利',
  FASCIST: '法西斯胜利',
};

const reasonLabelMap = {
  LIBERAL_FIVE_POLICIES: '自由派完成 5 张政策',
  FASCIST_SIX_POLICIES: '法西斯完成 6 张政策',
  HITLER_ELECTED_CHANCELLOR: '希特勒当选总理',
  HITLER_EXECUTED: '希特勒被处决',
};

function mapResultSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    roomId: snapshot.roomId,
    roomCode: snapshot.roomCode,
    winner: snapshot.winner,
    winReason: snapshot.winReason,
    policySummary: snapshot.policySummary || { liberal: 0, fascist: 0 },
    finalPlayers: snapshot.finalPlayers || [],
    timeline: snapshot.timeline || [],
    winnerLabel: winnerLabelMap[snapshot.winner] || '对局结束',
    reasonLabel: reasonLabelMap[snapshot.winReason] || snapshot.winReason,
  };
}

module.exports = {
  mapResultSnapshot,
};

