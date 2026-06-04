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

assertFascistViewerSeesDictatorSeat();
assertDictatorViewerSeesOwnSeat();
assertLiberalViewerSeesOnlyNormalSeats();
assertMissingSpecialAssetFallsBackToNormalSeat();

console.log("gameMapper seat perspective tests passed");
