const assert = require("assert");
const { loadGameService } = require("../helpers/loadGameService");

const { service } = loadGameService();
const {
  buildPrivateSnapshotPayload,
  buildPublicSnapshotPayload,
  createInitialGameProjection,
  drawPolicyCards,
  getChancellorTargetOptions,
  getEligibleChancellorIdsFromCore,
  getNextNominationTransition,
} = service.__testHooks;

function makeMembers(playerCount) {
  return Array.from({ length: playerCount }, (_, index) => ({
    memberId: `mem_${index + 1}`,
    openId: `openid_${index + 1}`,
    displayName: `玩家${index + 1}`,
    avatarUrl: "",
    seatIndex: index + 1,
    memberStatus: "active",
  }));
}

function hasSecretKey(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.keys(value).some((key) => {
    if (["roleAssignments", "drawPile", "discardPile", "presidentHand", "chancellorHand"].includes(key)) {
      return true;
    }
    return hasSecretKey(value[key]);
  });
}

function assertNominationEligibilityEdges() {
  const members = makeMembers(6);
  const sixAliveCore = {
    aliveMemberIds: members.map((member) => member.memberId),
    currentPresidentCandidateId: "mem_1",
    previousElectedPresidentId: "mem_2",
    previousElectedChancellorId: "mem_3",
  };
  assert.deepStrictEqual(
    getEligibleChancellorIdsFromCore(sixAliveCore),
    ["mem_4", "mem_5", "mem_6"],
    "above five alive players should enforce both term limits and self nomination ban",
  );

  const fiveAliveCore = {
    ...sixAliveCore,
    aliveMemberIds: ["mem_1", "mem_2", "mem_3", "mem_4", "mem_5"],
  };
  assert.deepStrictEqual(
    getEligibleChancellorIdsFromCore(fiveAliveCore),
    ["mem_2", "mem_4", "mem_5"],
    "with five alive players, previous president should become eligible again",
  );

  const options = getChancellorTargetOptions(fiveAliveCore, members);
  const byMemberId = Object.fromEntries(options.map((option) => [option.memberId, option]));
  assert.strictEqual(byMemberId.mem_1.disabledReason, "不能提名自己");
  assert.strictEqual(byMemberId.mem_3.disabledReason, "受上一届总理任期限制影响");
  assert.strictEqual(byMemberId.mem_6.disabledReason, "已出局");
}

function assertPolicyDrawReshufflesWithoutMutatingInput() {
  const policyState = {
    drawPile: ["LIBERAL", "FASCIST"],
    discardPile: ["FASCIST", "LIBERAL"],
    presidentHand: null,
    chancellorHand: null,
    peekPile: null,
  };
  const before = JSON.stringify(policyState);
  const result = drawPolicyCards(policyState, 3);

  assert.strictEqual(Boolean(result.error), false, "drawing should succeed by reshuffling discard pile");
  assert.strictEqual(result.cards.length, 3, "president draw should produce three cards");
  assert.strictEqual(result.policyState.discardPile.length, 0, "discard pile should be consumed after reshuffle");
  assert.strictEqual(
    result.cards.length + result.policyState.drawPile.length,
    4,
    "drawn cards and remaining draw pile should preserve policy count",
  );
  assert.strictEqual(JSON.stringify(policyState), before, "drawPolicyCards should not mutate input policy state");
}

function assertSpecialElectionRotationRestoresCallerOrder() {
  const members = makeMembers(7);
  const transition = getNextNominationTransition(
    {
      aliveMemberIds: members.map((member) => member.memberId),
      currentPresidentCandidateId: "mem_5",
      specialElectionCallerId: "mem_2",
      forcedNextPresidentId: "mem_5",
    },
    members,
  );

  assert.strictEqual(transition.nextPresidentCandidateId, "mem_3");
  assert.strictEqual(transition.specialElectionCallerId, null);
  assert.strictEqual(transition.forcedNextPresidentId, null);
}

function assertPrivateLegislativeHandsStayPrivate() {
  const members = makeMembers(5);
  const room = {
    roomId: "room_private_legislation",
    roomCode: "123456",
  };
  const projection = createInitialGameProjection(room, members, {
    gameId: "game_private_legislation",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const presidentHand = ["LIBERAL", "FASCIST", "FASCIST"];
  const gameCore = {
    ...projection.gameCore,
    version: 2,
    phase: "legislative_president",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_2",
    policyState: {
      drawPile: ["LIBERAL", "FASCIST"],
      discardPile: [],
      presidentHand,
      chancellorHand: null,
      peekPile: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: presidentHand,
    },
  };

  const publicPayload = buildPublicSnapshotPayload(room, gameCore, members, [], new Date("2026-05-12T00:01:00.000Z"));
  assert.strictEqual(hasSecretKey(publicPayload), false, "public snapshot should not contain hidden policy state");

  const presidentPrivate = buildPrivateSnapshotPayload(gameCore, members[0], members, new Date("2026-05-12T00:01:00.000Z"));
  assert.deepStrictEqual(
    presidentPrivate.privateState.legislative.hand,
    presidentHand,
    "president should see the private legislative hand",
  );

  const chancellorPrivate = buildPrivateSnapshotPayload(gameCore, members[1], members, new Date("2026-05-12T00:01:00.000Z"));
  assert.strictEqual(chancellorPrivate.privateState.legislative, null, "chancellor should not see president hand early");
}

assertNominationEligibilityEdges();
assertPolicyDrawReshufflesWithoutMutatingInput();
assertSpecialElectionRotationRestoresCallerOrder();
assertPrivateLegislativeHandsStayPrivate();

console.log("game rule scenario tests passed");
