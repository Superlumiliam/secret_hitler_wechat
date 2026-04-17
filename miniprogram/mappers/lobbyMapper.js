function mapLobbySnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  const players = (snapshot.seatOrder || []).map((seat) => ({
    memberId: seat.memberId,
    displayName: seat.displayName,
    seatIndex: seat.seatIndex,
    isHost: !!seat.isHost,
    isReady: !!seat.isReady,
    isSelf: seat.memberId === snapshot.myMemberId,
  }));

  const readyCount = players.filter((player) => player.isReady).length;
  const canStart = !!snapshot.canStart;
  const summaryText = canStart
    ? `已准备 ${readyCount}/${players.length}，可以开始`
    : `已准备 ${readyCount}/${players.length}，等待全部就绪`;

  return {
    roomId: snapshot.roomId,
    roomCode: snapshot.roomCode,
    roomStatus: snapshot.roomStatus,
    myMemberId: snapshot.myMemberId,
    hostMemberId: snapshot.hostMemberId,
    isHost: snapshot.hostMemberId === snapshot.myMemberId,
    canStart,
    playerCount: snapshot.playerCount,
    minPlayerCount: snapshot.minPlayerCount,
    maxPlayerCount: snapshot.maxPlayerCount,
    players,
    summaryText,
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
  };
}

module.exports = {
  mapLobbySnapshot,
};

