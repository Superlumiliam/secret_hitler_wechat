const assert = require("assert");
const gameMapper = require("../../../frontend/packageRoom/mappers/gameMapper");

const assets = {
  playerSeat: "player-seat",
  playerSeatHitler: "player-seat-hitler",
  defaultAvatar: "default-avatar",
};

function makeSnapshot(identity) {
  return {
    myMemberId: "viewer",
    currentPhase: "nomination",
    privateState: {
      identity,
      investigationMarks: [],
    },
    publicState: {
      seatOrder: [
        {
          memberId: "viewer",
          displayName: "当前玩家",
          seatIndex: 1,
          isAlive: true,
        },
        {
          memberId: "dictator",
          displayName: "独裁者玩家",
          seatIndex: 2,
          isAlive: true,
        },
        {
          memberId: "other",
          displayName: "其他玩家",
          seatIndex: 3,
          isAlive: true,
        },
      ],
      submittedVoteMemberIds: [],
    },
  };
}

function seatFrameByMemberId(snapshot, customAssets = assets) {
  return Object.fromEntries(
    gameMapper.createSeats(snapshot, { assets: customAssets }).map((seat) => [seat.memberId, seat.seatFrameSrc]),
  );
}

function seatViewsByMemberId(snapshot, options = {}) {
  return Object.fromEntries(
    gameMapper.createSeats(snapshot, { assets, ...options }).map((seat) => [seat.memberId, seat]),
  );
}

function assertFascistViewerSeesDictatorSeat() {
  const frames = seatFrameByMemberId(
    makeSnapshot({
      role: "FASCIST",
      party: "FASCIST",
      knownMembers: [{ memberId: "dictator", role: "HITLER", party: "FASCIST" }],
    }),
  );

  assert.strictEqual(frames.dictator, assets.playerSeatHitler);
  assert.strictEqual(frames.viewer, assets.playerSeat);
  assert.strictEqual(frames.other, assets.playerSeat);
}

function assertDictatorViewerSeesOwnSeat() {
  const frames = seatFrameByMemberId(
    makeSnapshot({
      role: "HITLER",
      party: "FASCIST",
      knownMembers: [],
    }),
  );

  assert.strictEqual(frames.viewer, assets.playerSeatHitler);
  assert.strictEqual(frames.dictator, assets.playerSeat);
  assert.strictEqual(frames.other, assets.playerSeat);
}

function assertFascistViewerCanHideFactionMarkers() {
  const snapshot = makeSnapshot({
    role: "FASCIST",
    party: "FASCIST",
    knownMembers: [{ memberId: "dictator", role: "HITLER", party: "FASCIST" }],
  });
  const seats = seatViewsByMemberId(snapshot, { hideTeammates: true });

  assert.deepStrictEqual(
    Object.values(seats).map((seat) => seat.seatFrameSrc),
    [assets.playerSeat, assets.playerSeat, assets.playerSeat],
  );
  assert.deepStrictEqual(
    Object.values(seats).map((seat) => seat.nameClass),
    ["seat-name", "seat-name", "seat-name"],
  );
}

function assertNonFascistViewerIsUnaffectedByTeammateDisplay() {
  const snapshot = makeSnapshot({
    role: "LIBERAL",
    party: "LIBERAL",
    knownMembers: [],
  });
  const visibleMarkers = seatViewsByMemberId(snapshot, { hideTeammates: false });
  const hiddenMarkers = seatViewsByMemberId(snapshot, { hideTeammates: true });

  assert.deepStrictEqual(
    Object.values(hiddenMarkers).map((seat) => [seat.seatFrameSrc, seat.nameClass]),
    Object.values(visibleMarkers).map((seat) => [seat.seatFrameSrc, seat.nameClass]),
  );

  const spectatorSnapshot = makeSnapshot({});
  spectatorSnapshot.viewerState = {
    isSpectatorView: true,
    hasPrivateView: false,
  };
  const spectatorVisibleMarkers = seatViewsByMemberId(spectatorSnapshot, { hideTeammates: false });
  const spectatorHiddenMarkers = seatViewsByMemberId(spectatorSnapshot, { hideTeammates: true });
  assert.deepStrictEqual(
    Object.values(spectatorHiddenMarkers).map((seat) => [seat.seatFrameSrc, seat.nameClass]),
    Object.values(spectatorVisibleMarkers).map((seat) => [seat.seatFrameSrc, seat.nameClass]),
  );
}

function assertLiberalViewerSeesOnlyNormalSeats() {
  const frames = seatFrameByMemberId(
    makeSnapshot({
      role: "LIBERAL",
      party: "LIBERAL",
      knownMembers: [{ memberId: "dictator", role: "HITLER", party: "FASCIST" }],
    }),
  );

  assert.deepStrictEqual(Object.values(frames), [assets.playerSeat, assets.playerSeat, assets.playerSeat]);
}

function assertMissingSpecialAssetFallsBackToNormalSeat() {
  const frames = seatFrameByMemberId(
    makeSnapshot({
      role: "FASCIST",
      party: "FASCIST",
      knownMembers: [{ memberId: "dictator", role: "HITLER", party: "FASCIST" }],
    }),
    {
      playerSeat: assets.playerSeat,
      defaultAvatar: assets.defaultAvatar,
    },
  );

  assert.strictEqual(frames.dictator, assets.playerSeat);
}

function assertSubmittedVoteSeatHasArchivedState() {
  const snapshot = makeSnapshot({
    role: "LIBERAL",
    party: "LIBERAL",
    knownMembers: [],
  });
  snapshot.currentPhase = "voting";
  snapshot.publicState.submittedVoteMemberIds = ["dictator"];
  const seats = gameMapper.createSeats(snapshot, { assets });
  const submittedSeat = seats.find((seat) => seat.memberId === "dictator");
  const pendingSeat = seats.find((seat) => seat.memberId === "other");

  assert.strictEqual(submittedSeat.isVoteSubmitted, true);
  assert.strictEqual(submittedSeat.voteStatusLabel, "已投票，等待其他玩家");
  assert.ok(submittedSeat.seatClass.includes("is-vote-submitted"));
  assert.strictEqual(pendingSeat.isVoteSubmitted, false);
  assert.strictEqual(pendingSeat.voteStatusLabel, "等待投票");
}

function assertVoteResultUsesGroupedSeats() {
  const snapshot = makeSnapshot({
    role: "LIBERAL",
    party: "LIBERAL",
    knownMembers: [],
  });
  snapshot.round = 2;
  snapshot.publicState.voteResult = {
    round: 2,
    presidentCandidateId: "viewer",
    chancellorCandidateId: "dictator",
    voteGroups: {
      jaMemberIds: ["other", "viewer", "dictator"],
      neinMemberIds: [],
    },
    passed: true,
    electionTrackerBefore: 1,
    electionTrackerAfter: 0,
  };

  const voteResult = gameMapper.createVoteResult(snapshot);
  assert.strictEqual(voteResult.detailText, "赞同 3，反对 0；选举计数器 1 → 0");
  assert.deepStrictEqual(
    voteResult.voteGroupRows.map((row) => row.memberCards.map((card) => card.label)),
    [["1号", "2号", "3号"], []],
    "vote result modal data should expose sorted seat-card labels without 玩家 suffix",
  );
}

function assertVoteResultExpandsForWrappedVoteGroups() {
  const snapshot = makeSnapshot({
    role: "LIBERAL",
    party: "LIBERAL",
    knownMembers: [],
  });
  snapshot.publicState.seatOrder = Array.from({ length: 9 }, (_, index) => ({
    memberId: `member-${index + 1}`,
    displayName: `玩家${index + 1}`,
    seatIndex: index + 1,
    isAlive: true,
  }));
  snapshot.publicState.voteResult = {
    round: 2,
    voteGroups: {
      jaMemberIds: [],
      neinMemberIds: snapshot.publicState.seatOrder.map((member) => member.memberId),
    },
    passed: false,
  };

  const voteResult = gameMapper.createVoteResult(snapshot);
  assert.match(voteResult.resultClass, /has-wrapped-votes/);
}

assertFascistViewerSeesDictatorSeat();
assertDictatorViewerSeesOwnSeat();
assertFascistViewerCanHideFactionMarkers();
assertNonFascistViewerIsUnaffectedByTeammateDisplay();
assertLiberalViewerSeesOnlyNormalSeats();
assertMissingSpecialAssetFallsBackToNormalSeat();
assertSubmittedVoteSeatHasArchivedState();
assertVoteResultUsesGroupedSeats();
assertVoteResultExpandsForWrappedVoteGroups();

console.log("gameMapper seat perspective tests passed");
