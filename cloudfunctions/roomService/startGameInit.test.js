const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "wx-server-sdk") {
    return {
      DYNAMIC_CURRENT_ENV: "test-env",
      init() {},
      getWXContext() {
        return {
          OPENID: "test_openid",
        };
      },
      database() {
        return {
          command: {
            in(value) {
              return value;
            },
            inc(value) {
              return value;
            },
          },
          collection() {
            return {};
          },
        };
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { __testHooks } = require("./index");
Module._load = originalLoad;

const {
  ROLE_PRESET_BY_PLAYER_COUNT,
  createInitialGameProjection,
} = __testHooks;

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

function countBy(items) {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function hasSecretKey(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.keys(value).some((key) => {
    if (["roleAssignments", "policyState", "drawPile", "discardPile"].includes(key)) {
      return true;
    }
    return hasSecretKey(value[key]);
  });
}

function assertPolicyDeck(policyState) {
  assert.strictEqual(policyState.drawPile.length, 17, "drawPile should contain 17 cards");
  assert.deepStrictEqual(policyState.discardPile, [], "discardPile should start empty");
  const policyCounts = countBy(policyState.drawPile);
  assert.strictEqual(policyCounts.LIBERAL, 6, "drawPile should contain 6 liberal policies");
  assert.strictEqual(policyCounts.FASCIST, 11, "drawPile should contain 11 fascist policies");
}

function assertPrivateVisibility(projection, playerCount) {
  const assignments = projection.gameCore.roleAssignments;
  const fascistIds = Object.keys(assignments).filter((memberId) => assignments[memberId].role === "FASCIST");
  const hitlerId = Object.keys(assignments).find((memberId) => assignments[memberId].role === "HITLER");

  fascistIds.forEach((memberId) => {
    const known = assignments[memberId].knownMemberIds.slice().sort();
    const expected = fascistIds.concat(hitlerId).filter((knownMemberId) => knownMemberId !== memberId).sort();
    assert.deepStrictEqual(known, expected, `${playerCount}p fascist should know teammates and dictator`);
  });

  const hitlerKnown = assignments[hitlerId].knownMemberIds.slice().sort();
  const expectedHitlerKnown = playerCount <= 6 ? fascistIds.slice().sort() : [];
  assert.deepStrictEqual(hitlerKnown, expectedHitlerKnown, `${playerCount}p dictator visibility mismatch`);

  projection.privateSnapshotPayloads.forEach((snapshot) => {
    const identity = snapshot.payload.privateState.identity;
    assert.strictEqual(identity.role, assignments[snapshot.memberId].role, "private identity should match assignment");
    assert.strictEqual(identity.party, assignments[snapshot.memberId].party, "private party should match assignment");
    assert.deepStrictEqual(
      identity.knownMembers.map((member) => member.memberId).sort(),
      assignments[snapshot.memberId].knownMemberIds.slice().sort(),
      "private knownMembers should mirror allowed visibility",
    );
    identity.knownMembers.forEach((knownMember) => {
      assert.strictEqual(
        knownMember.role,
        assignments[knownMember.memberId].role,
        "private knownMembers should include known role",
      );
      assert.strictEqual(
        knownMember.party,
        assignments[knownMember.memberId].party,
        "private knownMembers should include known party",
      );
    });
  });
}

function assertPublicSnapshotSafe(projection) {
  assert.strictEqual(hasSecretKey(projection.publicSnapshotPayload), false, "public snapshot should not contain secrets");
  const publicState = projection.publicSnapshotPayload.publicState;
  assert.strictEqual(publicState.liberalPolicyCount, 0, "liberal track should start at 0");
  assert.strictEqual(publicState.fascistPolicyCount, 0, "fascist track should start at 0");
  assert.strictEqual(publicState.electionTracker, 0, "election tracker should start at 0");
}

function assertEventsSafe(projection) {
  assert.strictEqual(projection.publicEvents.length, 2, "should write two initial public events");
  projection.publicEvents.forEach((event) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(event, "_id"), false, "event data should not write reserved _id");
    assert.strictEqual(event.privatePayload, null, "initial public events should not carry private payload");
    assert.strictEqual(hasSecretKey(event), false, "initial events should not contain secrets");
  });
}

Object.keys(ROLE_PRESET_BY_PLAYER_COUNT).forEach((playerCountKey) => {
  const playerCount = Number(playerCountKey);
  const room = {
    roomId: `room_${playerCount}`,
    roomCode: `${playerCount}`.padStart(6, "0"),
  };
  const projection = createInitialGameProjection(room, makeMembers(playerCount), {
    gameId: `game_${playerCount}`,
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });

  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(projection.gameCore, "_id"),
    false,
    "game core data should not write reserved _id",
  );
  const roleCounts = countBy(Object.values(projection.gameCore.roleAssignments).map((assignment) => assignment.role));
  const expectedCounts = countBy(ROLE_PRESET_BY_PLAYER_COUNT[playerCount]);
  assert.deepStrictEqual(roleCounts, expectedCounts, `${playerCount}p role counts should match preset`);
  assertPolicyDeck(projection.gameCore.policyState);
  assertPrivateVisibility(projection, playerCount);
  assertPublicSnapshotSafe(projection);
  assertEventsSafe(projection);
});

console.log("startGame initialization tests passed");
