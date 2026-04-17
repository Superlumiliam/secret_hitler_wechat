"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("./helpers");

test("大厅流程支持创建、加入、房主转移和开局", async () => {
  const { call, store } = createTestApp(7);

  const created = await call("host-openid", "createRoom", {
    commandId: "cmd-create-room",
    displayName: "房主"
  });
  assert.equal(created.roomStatus, "lobby");
  assert.equal(created.lobbySnapshot.playerCount, 1);
  assert.equal(created.lobbySnapshot.canStart, false);

  const roomId = created.roomId;
  const roomCode = created.roomCode;
  const joiners = [
    ["player-2", "玩家2"],
    ["player-3", "玩家3"],
    ["player-4", "玩家4"],
    ["player-5", "玩家5"]
  ];

  for (const [openid, name] of joiners) {
    await call(openid, "joinRoom", {
      commandId: `join-${openid}`,
      roomCode,
      displayName: name
    });
    await call(openid, "setReady", {
      commandId: `ready-${openid}`,
      roomId,
      ready: true
    });
  }

  await call("host-openid", "leaveRoom", {
    commandId: "leave-host",
    roomId
  });

  const room = await store.getRoom(roomId);
  assert.equal(room.hostMemberId.startsWith("mem_"), true);

  const roomMembers = await store.listRoomMembers(roomId);
  const activeMembers = roomMembers.filter((member) => member.memberStatus === "active");
  assert.equal(activeMembers.length, 4);
  assert.deepEqual(activeMembers.map((member) => member.seatIndex).sort((left, right) => left - right), [1, 2, 3, 4]);

  const newHost = activeMembers.find((member) => member.seatIndex === 1);
  const lobby = await call("player-2", "getLobbySnapshot", { roomId });
  assert.equal(lobby.hostMemberId, newHost.memberId);

  await call("player-6", "joinRoom", {
    commandId: "player-6-join",
    roomCode,
    displayName: "玩家6"
  });
  await call("player-6", "setReady", {
    commandId: "player-6-ready",
    roomId,
    ready: true
  });

  const start = await call(newHost.openid, "startGame", {
    commandId: "start-game",
    roomId
  });
  assert.equal(start.roomStatus, "in_game");
  assert.equal(start.routeHint, "identity");
});
