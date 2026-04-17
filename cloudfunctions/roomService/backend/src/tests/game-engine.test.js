"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGame, getEligibleChancellorIds } = require("../game-engine");
const { FixedRandomProvider } = require("../random");

function createMembers(count) {
  return Array.from({ length: count }, (_, index) => ({
    roomId: "room_test",
    memberId: `mem_${index + 1}`,
    displayName: `玩家${index + 1}`,
    seatIndex: index + 1
  }));
}

test("5 人局希特勒知道普通法西斯，7 人局希特勒不知道", () => {
  const fivePlayerGame = createGame(
    { roomId: "room5", roomCode: "123456", gameId: "game5" },
    createMembers(5),
    new FixedRandomProvider(1),
    "2026-04-12T12:00:00.000Z"
  );
  const fiveHitlerEntry = Object.entries(fivePlayerGame.roleAssignments).find(([, value]) => value.role === "HITLER");
  assert.equal(fiveHitlerEntry[1].knownMemberIds.length > 0, true);

  const sevenPlayerGame = createGame(
    { roomId: "room7", roomCode: "654321", gameId: "game7" },
    createMembers(7),
    new FixedRandomProvider(3),
    "2026-04-12T12:00:00.000Z"
  );
  const sevenHitlerEntry = Object.entries(sevenPlayerGame.roleAssignments).find(([, value]) => value.role === "HITLER");
  assert.deepEqual(sevenHitlerEntry[1].knownMemberIds, []);
});

test("总理候选人资格会排除当前总统和上一届政府", () => {
  const members = createMembers(7);
  const state = {
    aliveMemberIds: members.map((member) => member.memberId),
    deadMemberIds: [],
    currentPresidentCandidateId: "mem_3",
    previousElectedPresidentId: "mem_1",
    previousElectedChancellorId: "mem_2"
  };

  const eligibleIds = getEligibleChancellorIds(state, members);
  assert.equal(eligibleIds.includes("mem_3"), false);
  assert.equal(eligibleIds.includes("mem_1"), false);
  assert.equal(eligibleIds.includes("mem_2"), false);
  assert.equal(eligibleIds.includes("mem_4"), true);
});
