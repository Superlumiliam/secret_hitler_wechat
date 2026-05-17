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
  buildPrivateSnapshotPayload,
  buildPublicSnapshotPayload,
  createInitialGameProjection,
  drawPolicyCards,
  getChancellorTargetOptions,
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

function assertNominationTargetOptions() {
  const members = makeMembers(7);
  const baseCore = {
    aliveMemberIds: members.map((member) => member.memberId),
    currentPresidentCandidateId: "mem_1",
    previousElectedPresidentId: "mem_2",
    previousElectedChancellorId: "mem_3",
  };

  const options = getChancellorTargetOptions(baseCore, members);
  const byMemberId = Object.fromEntries(options.map((option) => [option.memberId, option]));
  assert.strictEqual(byMemberId.mem_1.canNominate, false, "president candidate should not nominate self");
  assert.strictEqual(byMemberId.mem_1.disabledReason, "不能提名自己");
  assert.strictEqual(byMemberId.mem_2.canNominate, false, "previous president should be blocked above five alive players");
  assert.strictEqual(byMemberId.mem_2.disabledReason, "受上一届总统任期限制影响");
  assert.strictEqual(byMemberId.mem_3.canNominate, false, "previous chancellor should be blocked");
  assert.strictEqual(byMemberId.mem_3.disabledReason, "受上一届总理任期限制影响");
  assert.strictEqual(byMemberId.mem_4.canNominate, true, "other alive players should be eligible");

  const fiveAliveCore = {
    ...baseCore,
    aliveMemberIds: ["mem_1", "mem_2", "mem_3", "mem_4", "mem_5"],
  };
  const fiveAliveOptions = getChancellorTargetOptions(fiveAliveCore, members);
  const fiveAliveByMemberId = Object.fromEntries(fiveAliveOptions.map((option) => [option.memberId, option]));
  assert.strictEqual(
    fiveAliveByMemberId.mem_2.canNominate,
    true,
    "previous president should be eligible when only five players are alive",
  );
  assert.strictEqual(fiveAliveByMemberId.mem_3.canNominate, false, "previous chancellor should still be blocked");
  assert.strictEqual(fiveAliveByMemberId.mem_6.disabledReason, "已出局", "dead players should show dead reason");
}

function assertLegislativePresidentVisibility() {
  const members = makeMembers(5);
  const room = {
    roomId: "room_legislative",
    roomCode: "778899",
  };
  const projection = createInitialGameProjection(room, members, {
    gameId: "game_legislative",
    createdAt: new Date("2026-05-12T00:00:00.000Z"),
    pickIndex: () => 0,
  });
  const drawResult = drawPolicyCards(projection.gameCore.policyState, 3);
  assert.strictEqual(Boolean(drawResult.error), false, "legislative draw should succeed");

  const gameCore = {
    ...projection.gameCore,
    version: 2,
    phase: "legislative_president",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_2",
    policyState: {
      ...drawResult.policyState,
      presidentHand: drawResult.cards,
      chancellorHand: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: drawResult.cards,
    },
  };

  const publicPayload = buildPublicSnapshotPayload(room, gameCore, members, [], new Date("2026-05-12T00:01:00.000Z"));
  assert.strictEqual(hasSecretKey(publicPayload), false, "public legislative snapshot should not contain secrets");
  assert.strictEqual(
    JSON.stringify(publicPayload).includes(drawResult.cards.join(",")),
    false,
    "public legislative snapshot should not reveal policy hand",
  );

  const presidentPrivate = buildPrivateSnapshotPayload(gameCore, members[0], members, new Date("2026-05-12T00:01:00.000Z"));
  assert.strictEqual(
    presidentPrivate.pendingTask.taskType,
    "PRESIDENT_DISCARD_POLICY",
    "president should receive discard task",
  );
  assert.strictEqual(presidentPrivate.privateState.legislative.hand.length, 3, "president should see three policies");
  assert.deepStrictEqual(
    presidentPrivate.privateState.legislative.hand,
    drawResult.cards,
    "president should see the drawn policy hand",
  );

  members.slice(1).forEach((member) => {
    const privatePayload = buildPrivateSnapshotPayload(gameCore, member, members, new Date("2026-05-12T00:01:00.000Z"));
    assert.strictEqual(privatePayload.pendingTask, null, "non-president should not receive discard task");
    assert.strictEqual(privatePayload.privateState.legislative, null, "non-president should not see president hand");
  });
}

function assertLegislativeChancellorVisibility() {
  const members = makeMembers(5);
  const room = {
    roomId: "room_chancellor_legislative",
    roomCode: "778900",
  };
  const chancellorHand = ["LIBERAL", "FASCIST"];
  const gameCore = {
    ...createInitialGameProjection(room, members, {
      gameId: "game_chancellor_legislative",
      createdAt: new Date("2026-05-12T00:00:00.000Z"),
      pickIndex: () => 0,
    }).gameCore,
    version: 3,
    phase: "legislative_chancellor",
    currentPresidentId: "mem_1",
    currentChancellorId: "mem_2",
    policyState: {
      drawPile: ["FASCIST", "LIBERAL", "FASCIST"],
      discardPile: ["LIBERAL"],
      presidentHand: null,
      chancellorHand,
      peekPile: null,
    },
    phaseData: {
      presidentId: "mem_1",
      chancellorId: "mem_2",
      cards: chancellorHand,
      vetoAllowed: false,
    },
  };

  const publicPayload = buildPublicSnapshotPayload(room, gameCore, members, [], new Date("2026-05-12T00:02:00.000Z"));
  assert.strictEqual(hasSecretKey(publicPayload), false, "public chancellor snapshot should not contain secrets");
  assert.strictEqual(
    JSON.stringify(publicPayload).includes(chancellorHand.join(",")),
    false,
    "public chancellor snapshot should not reveal policy hand",
  );

  const chancellorPrivate = buildPrivateSnapshotPayload(
    gameCore,
    members[1],
    members,
    new Date("2026-05-12T00:02:00.000Z"),
  );
  assert.strictEqual(
    chancellorPrivate.pendingTask.taskType,
    "CHANCELLOR_ENACT_POLICY",
    "chancellor should receive enact task",
  );
  assert.strictEqual(
    chancellorPrivate.privateState.legislative.action,
    "enact_one",
    "chancellor legislative action should be enact_one",
  );
  assert.deepStrictEqual(
    chancellorPrivate.privateState.legislative.hand,
    chancellorHand,
    "chancellor should see the two remaining policy cards",
  );

  [members[0], ...members.slice(2)].forEach((member) => {
    const privatePayload = buildPrivateSnapshotPayload(gameCore, member, members, new Date("2026-05-12T00:02:00.000Z"));
    assert.strictEqual(privatePayload.pendingTask, null, "non-chancellor should not receive enact task");
    assert.strictEqual(privatePayload.privateState.legislative, null, "non-chancellor should not see chancellor hand");
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

assertNominationTargetOptions();
assertLegislativePresidentVisibility();
assertLegislativeChancellorVisibility();

console.log("startGame initialization tests passed");
