"use strict";

const {
  COMMAND_RECORD_TTL_MS,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
  ROOM_CODE_RETRY_LIMIT,
  ROOM_TTL_ACTIVE_MS,
  ROOM_TTL_LOBBY_MS,
  ROOM_TTL_RESULT_MS
} = require("./config/constants");
const { ERROR_CODES } = require("./config/error-codes");
const { AppError, assert } = require("./domain/app-error");
const { advanceSystemPhases, applyCommand, createGame } = require("./game-engine");
const { buildGameSnapshot, buildLobbySnapshot, buildResultSnapshot, routeHintForRoom } = require("./projections");
const { RandomProvider } = require("./random");
const { createRequestId, generateId, generateRoomCode, hashPayload, normalizeDisplayName, nowIso, sortMembersBySeat } = require("./utils");

function createApp(dependencies) {
  const store = dependencies.store;
  const randomProvider = dependencies.randomProvider || new RandomProvider();
  const nowProvider = dependencies.nowProvider || (() => new Date());

  function success(data, requestId) {
    return {
      success: true,
      requestId,
      serverTime: nowIso(nowProvider),
      data
    };
  }

  function failure(error, requestId) {
    return {
      success: false,
      requestId,
      serverTime: nowIso(nowProvider),
      error: {
        code: error.code || ERROR_CODES.INTERNAL_ERROR,
        message: error.message || "内部错误",
        retryable: Boolean(error.retryable)
      }
    };
  }

  async function mutate(callback) {
    if (store && typeof store.runTransaction === "function") {
      return store.runTransaction(callback);
    }
    return callback(store);
  }

  async function run(action, payload, context) {
    const requestId = createRequestId();
    try {
      const openid = context && context.openid;
      assert(openid, ERROR_CODES.INTERNAL_ERROR, "缺少 openid 上下文");

      switch (action) {
        case "ensureSession":
          return success(await ensureSession(openid), requestId);
        case "recoverActiveRoom":
          return success(await recoverActiveRoom(openid), requestId);
        case "createRoom":
          return success(await createRoom(openid, payload || {}), requestId);
        case "joinRoom":
          return success(await joinRoom(openid, payload || {}), requestId);
        case "leaveRoom":
          return success(await leaveRoom(openid, payload || {}), requestId);
        case "getLobbySnapshot":
          return success(await getLobbySnapshot(openid, payload || {}), requestId);
        case "updateDisplayName":
          return success(await updateDisplayName(openid, payload || {}), requestId);
        case "updateSeatOrder":
          return success(await updateSeatOrder(openid, payload || {}), requestId);
        case "setReady":
          return success(await setReady(openid, payload || {}), requestId);
        case "startGame":
          return success(await startGame(openid, payload || {}), requestId);
        case "getGameSnapshot":
          return success(await getGameSnapshot(openid, payload || {}), requestId);
        case "submitCommand":
          return success(await submitGameCommand(openid, payload || {}), requestId);
        case "getResultSnapshot":
          return success(await getResultSnapshot(openid, payload || {}), requestId);
        default:
          throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "未知 action");
      }
    } catch (error) {
      if (!(error instanceof AppError)) {
        return failure(new AppError(ERROR_CODES.INTERNAL_ERROR, error.message || "内部错误"), requestId);
      }
      return failure(error, requestId);
    }
  }

  async function ensureUser(openid) {
    const now = nowIso(nowProvider);
    const existing = await store.getUser(openid);
    if (existing) {
      existing.lastSeenAt = now;
      await store.saveUser(existing);
      return existing;
    }

    const user = {
      openid,
      defaultDisplayName: "未命名玩家",
      activeRoomId: null,
      activeMemberId: null,
      lastSeenAt: now
    };
    await store.saveUser(user);
    return user;
  }

  function ensureCommandId(payload) {
    assert(payload.commandId && typeof payload.commandId === "string", ERROR_CODES.INVALID_PAYLOAD, "commandId 必填");
  }

  async function guardIdempotency(scopeKey, commandId, openid, payload) {
    const payloadHash = hashPayload(payload);
    const commandRecordId = `${scopeKey}:${commandId}`;
    const existing = await store.getCommandRecord(commandRecordId);
    if (!existing) {
      return {
        deduplicated: false,
        payloadHash,
        commandRecordId
      };
    }

    assert(existing.requesterOpenId === openid, ERROR_CODES.ACTION_NOT_ALLOWED, "同一 commandId 被其他玩家占用");
    assert(existing.payloadHash === payloadHash, ERROR_CODES.DUPLICATE_COMMAND, "同一 commandId 的 payload 不一致");

    return {
      deduplicated: true,
      responseData: existing.responseData,
      payloadHash,
      commandRecordId
    };
  }

  async function saveCommandRecord(commandRecordId, openid, payloadHash, responseData) {
    const now = nowIso(nowProvider);
    await store.saveCommandRecord({
      commandRecordId,
      requesterOpenId: openid,
      payloadHash,
      responseData,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
    });
  }

  function ensureDisplayName(displayName) {
    const normalized = normalizeDisplayName(displayName);
    assert(normalized.length >= 1 && normalized.length <= MAX_DISPLAY_NAME_LENGTH, ERROR_CODES.INVALID_PAYLOAD, "displayName 长度必须在 1-20 之间");
    return normalized;
  }

  function roomTtlForStatus(status) {
    if (status === "lobby") {
      return ROOM_TTL_LOBBY_MS;
    }
    if (status === "in_game") {
      return ROOM_TTL_ACTIVE_MS;
    }
    return ROOM_TTL_RESULT_MS;
  }

  function isRoomExpired(room) {
    if (!room || room.status === "expired") {
      return true;
    }

    const referenceTime = room.updatedAt || room.endedAt || room.createdAt;
    const ttl = roomTtlForStatus(room.status);
    return nowProvider().getTime() - Date.parse(referenceTime) > ttl;
  }

  async function ensureSession(openid) {
    const user = await ensureUser(openid);
    const activeRoom = await getActiveRoomSummary(user);
    return {
      user: {
        defaultDisplayName: user.defaultDisplayName
      },
      activeRoom
    };
  }

  async function recoverActiveRoom(openid) {
    const user = await ensureUser(openid);
    return {
      activeRoom: await getActiveRoomSummary(user)
    };
  }

  async function getActiveRoomSummary(user) {
    if (!user.activeRoomId || !user.activeMemberId) {
      return null;
    }

    const room = await store.getRoom(user.activeRoomId);
    if (!room || isRoomExpired(room)) {
      user.activeRoomId = null;
      user.activeMemberId = null;
      await store.saveUser(user);
      return null;
    }

    const member = await store.getRoomMember(user.activeRoomId, user.activeMemberId);
    if (!member || member.memberStatus === "left") {
      user.activeRoomId = null;
      user.activeMemberId = null;
      await store.saveUser(user);
      return null;
    }

    const game = room.status !== "lobby" ? await store.getGame(room.roomId) : null;
    return {
      roomId: room.roomId,
      roomCode: room.roomCode,
      roomStatus: room.status,
      memberId: member.memberId,
      routeHint: routeHintForRoom(room, game),
      version: room.status === "lobby" ? room.version : (game ? game.version : room.version),
      updatedAt: room.updatedAt
    };
  }

  async function createRoom(openid, payload) {
    ensureCommandId(payload);
    const displayName = ensureDisplayName(payload.displayName);
    const user = await ensureUser(openid);
    const activeRoom = await getActiveRoomSummary(user);
    if (activeRoom && activeRoom.roomStatus !== "ended") {
      throw new AppError(ERROR_CODES.ACTION_NOT_ALLOWED, "当前仍存在活跃房间");
    }

    const idempotent = await guardIdempotency(`user:${openid}`, payload.commandId, openid, payload);
    if (idempotent.deduplicated) {
      return idempotent.responseData;
    }

    return mutate(async (activeStore) => {
      const now = nowIso(nowProvider);
      let roomCode = null;
      for (let index = 0; index < ROOM_CODE_RETRY_LIMIT; index += 1) {
        const candidate = generateRoomCode(randomProvider);
        const exists = await activeStore.getRoomByCode(candidate);
        if (!exists || isRoomExpired(exists)) {
          roomCode = candidate;
          break;
        }
      }

      assert(roomCode, ERROR_CODES.INTERNAL_ERROR, "无法生成可用房号");
      const roomId = generateId("room");
      const memberId = generateId("mem");
      const room = {
        roomId,
        roomCode,
        status: "lobby",
        hostMemberId: memberId,
        version: 1,
        playerCount: 1,
        createdAt: now,
        updatedAt: now,
        gameId: generateId("game"),
        endedAt: null
      };
      const member = {
        roomId,
        memberId,
        openid,
        displayName,
        seatIndex: 1,
        isReady: true,
        memberStatus: "active",
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now
      };

      user.defaultDisplayName = displayName;
      user.activeRoomId = roomId;
      user.activeMemberId = memberId;
      user.lastSeenAt = now;

      await activeStore.saveRoom(room);
      await activeStore.saveRoomMember(member);
      await activeStore.saveUser(user);

      const lobbySnapshot = buildLobbySnapshot(room, [member], memberId);
      const responseData = {
        roomId,
        roomCode,
        roomStatus: "lobby",
        memberId,
        lobbySnapshot
      };

      await activeStore.saveCommandRecord({
        commandRecordId: idempotent.commandRecordId,
        requesterOpenId: openid,
        payloadHash: idempotent.payloadHash,
        responseData,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
      });
      return responseData;
    });
  }

  async function joinRoom(openid, payload) {
    ensureCommandId(payload);
    const displayName = ensureDisplayName(payload.displayName);
    assert(typeof payload.roomCode === "string" && /^\d{6}$/.test(payload.roomCode), ERROR_CODES.INVALID_PAYLOAD, "roomCode 必须为 6 位数字");

    const idempotent = await guardIdempotency(`user:${openid}`, payload.commandId, openid, payload);
    if (idempotent.deduplicated) {
      return idempotent.responseData;
    }

    const room = await store.getRoomByCode(payload.roomCode);
    assert(room, ERROR_CODES.ROOM_NOT_FOUND, "房间不存在");
    assert(!isRoomExpired(room), ERROR_CODES.ROOM_EXPIRED, "房间已过期");
    assert(room.status === "lobby", ERROR_CODES.ROOM_NOT_JOINABLE, "房间当前不可加入");

    const user = await ensureUser(openid);
    const activeRoom = await getActiveRoomSummary(user);
    if (activeRoom && activeRoom.roomId !== room.roomId && activeRoom.roomStatus !== "ended") {
      throw new AppError(ERROR_CODES.ACTION_NOT_ALLOWED, "当前仍存在活跃房间");
    }

    return mutate(async (activeStore) => {
      const txRoom = await activeStore.getRoomByCode(payload.roomCode);
      assert(txRoom, ERROR_CODES.ROOM_NOT_FOUND, "房间不存在");
      assert(!isRoomExpired(txRoom), ERROR_CODES.ROOM_EXPIRED, "房间已过期");
      assert(txRoom.status === "lobby", ERROR_CODES.ROOM_NOT_JOINABLE, "房间当前不可加入");

      const existingMember = await activeStore.getRoomMemberByOpenId(txRoom.roomId, openid);
      const members = await activeStore.listRoomMembers(txRoom.roomId);
      const activeMembers = members.filter((item) => item.memberStatus === "active");

      let member = existingMember;
      const now = nowIso(nowProvider);
      if (!member) {
        assert(activeMembers.length < MAX_PLAYER_COUNT, ERROR_CODES.ROOM_FULL, "房间已满");
        member = {
          roomId: txRoom.roomId,
          memberId: generateId("mem"),
          openid,
          displayName,
          seatIndex: activeMembers.length + 1,
          isReady: false,
          memberStatus: "active",
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now
        };
        await activeStore.saveRoomMember(member);
      } else {
        member.memberStatus = "active";
        member.displayName = displayName;
        member.updatedAt = now;
        member.lastSeenAt = now;
        await activeStore.saveRoomMember(member);
      }

      txRoom.playerCount = (await activeStore.listRoomMembers(txRoom.roomId)).filter((item) => item.memberStatus === "active").length;
      txRoom.updatedAt = now;
      txRoom.version += 1;
      await activeStore.saveRoom(txRoom);

      user.defaultDisplayName = displayName;
      user.activeRoomId = txRoom.roomId;
      user.activeMemberId = member.memberId;
      user.lastSeenAt = now;
      await activeStore.saveUser(user);

      const latestMembers = await activeStore.listRoomMembers(txRoom.roomId);
      const lobbySnapshot = buildLobbySnapshot(txRoom, latestMembers, member.memberId);
      const responseData = {
        roomId: txRoom.roomId,
        roomCode: txRoom.roomCode,
        roomStatus: txRoom.status,
        memberId: member.memberId,
        lobbySnapshot
      };
      await activeStore.saveCommandRecord({
        commandRecordId: idempotent.commandRecordId,
        requesterOpenId: openid,
        payloadHash: idempotent.payloadHash,
        responseData,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
      });
      return responseData;
    });
  }

  async function requireRoomMember(openid, roomId) {
    const room = await store.getRoom(roomId);
    assert(room, ERROR_CODES.ROOM_NOT_FOUND, "房间不存在");
    assert(!isRoomExpired(room), ERROR_CODES.ROOM_EXPIRED, "房间已过期");

    const member = await store.getRoomMemberByOpenId(roomId, openid);
    assert(member && member.memberStatus !== "left", ERROR_CODES.NOT_ROOM_MEMBER, "当前不是房间成员");
    return { room, member };
  }

  async function leaveRoom(openid, payload) {
    ensureCommandId(payload);
    assert(payload.roomId, ERROR_CODES.INVALID_PAYLOAD, "roomId 必填");
    const { room, member } = await requireRoomMember(openid, payload.roomId);

    const idempotent = await guardIdempotency(`room:${room.roomId}`, payload.commandId, openid, payload);
    if (idempotent.deduplicated) {
      return idempotent.responseData;
    }

    return mutate(async (activeStore) => {
      const txRoom = await activeStore.getRoom(room.roomId);
      const txMember = await activeStore.getRoomMember(room.roomId, member.memberId);
      const now = nowIso(nowProvider);
      let leaveMode = "removed_from_lobby";
      let roomExpired = false;

      if (txRoom.status === "lobby") {
        const members = await activeStore.listRoomMembers(txRoom.roomId);
        const activeMembers = sortMembersBySeat(members.filter((item) => item.memberStatus === "active" && item.memberId !== txMember.memberId));
        txMember.memberStatus = "left";
        txMember.updatedAt = now;
        txMember.lastSeenAt = now;
        await activeStore.saveRoomMember(txMember);

        activeMembers.forEach((item, index) => {
          item.seatIndex = index + 1;
          item.updatedAt = now;
        });
        await activeStore.saveRoomMembers(activeMembers);

        if (activeMembers.length === 0) {
          txRoom.status = "expired";
          roomExpired = true;
        } else if (txRoom.hostMemberId === txMember.memberId) {
          txRoom.hostMemberId = activeMembers[0].memberId;
        }

        txRoom.playerCount = activeMembers.length;
        txRoom.version += 1;
        txRoom.updatedAt = now;
        await activeStore.saveRoom(txRoom);
      } else {
        leaveMode = "marked_offline";
        txMember.memberStatus = "offline";
        txMember.lastSeenAt = now;
        txMember.updatedAt = now;
        await activeStore.saveRoomMember(txMember);
        txRoom.updatedAt = now;
        await activeStore.saveRoom(txRoom);
      }

      const user = (await activeStore.getUser(openid)) || {
        openid,
        defaultDisplayName: "未命名玩家",
        activeRoomId: null,
        activeMemberId: null,
        lastSeenAt: now
      };
      user.activeRoomId = null;
      user.activeMemberId = null;
      user.lastSeenAt = now;
      await activeStore.saveUser(user);

      const responseData = {
        roomId: txRoom.roomId,
        roomStatus: txRoom.status === "expired" ? "lobby" : txRoom.status,
        memberId: txMember.memberId,
        leaveMode,
        roomExpired,
        routeHint: "home"
      };

      await activeStore.saveCommandRecord({
        commandRecordId: idempotent.commandRecordId,
        requesterOpenId: openid,
        payloadHash: idempotent.payloadHash,
        responseData,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
      });
      return responseData;
    });
  }

  async function getLobbySnapshot(openid, payload) {
    assert(payload.roomId, ERROR_CODES.INVALID_PAYLOAD, "roomId 必填");
    const { room, member } = await requireRoomMember(openid, payload.roomId);
    assert(room.status === "lobby", room.status === "ended" ? ERROR_CODES.GAME_ALREADY_STARTED : ERROR_CODES.GAME_ALREADY_STARTED, "房间已不在大厅");
    const members = await store.listRoomMembers(room.roomId);
    return buildLobbySnapshot(room, members, member.memberId);
  }

  async function updateDisplayName(openid, payload) {
    ensureCommandId(payload);
    const displayName = ensureDisplayName(payload.displayName);
    const { room, member } = await requireRoomMember(openid, payload.roomId);
    assert(room.status === "lobby", ERROR_CODES.ACTION_NOT_ALLOWED, "仅大厅允许修改展示名");

    const idempotent = await guardIdempotency(`room:${room.roomId}`, payload.commandId, openid, payload);
    if (idempotent.deduplicated) {
      return idempotent.responseData;
    }

    return mutate(async (activeStore) => {
      const txRoom = await activeStore.getRoom(room.roomId);
      const txMember = await activeStore.getRoomMember(room.roomId, member.memberId);
      const now = nowIso(nowProvider);
      txMember.displayName = displayName;
      txMember.updatedAt = now;
      txMember.lastSeenAt = now;
      await activeStore.saveRoomMember(txMember);

      txRoom.version += 1;
      txRoom.updatedAt = now;
      await activeStore.saveRoom(txRoom);

      const user = (await activeStore.getUser(openid)) || {
        openid,
        defaultDisplayName: displayName,
        activeRoomId: txRoom.roomId,
        activeMemberId: txMember.memberId,
        lastSeenAt: now
      };
      user.defaultDisplayName = displayName;
      user.lastSeenAt = now;
      await activeStore.saveUser(user);

      const members = await activeStore.listRoomMembers(txRoom.roomId);
      const responseData = {
        roomId: txRoom.roomId,
        roomStatus: txRoom.status,
        newVersion: txRoom.version,
        lobbySnapshot: buildLobbySnapshot(txRoom, members, txMember.memberId)
      };
      await activeStore.saveCommandRecord({
        commandRecordId: idempotent.commandRecordId,
        requesterOpenId: openid,
        payloadHash: idempotent.payloadHash,
        responseData,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
      });
      return responseData;
    });
  }

  async function updateSeatOrder(openid, payload) {
    ensureCommandId(payload);
    const { room, member } = await requireRoomMember(openid, payload.roomId);
    assert(room.status === "lobby", ERROR_CODES.ACTION_NOT_ALLOWED, "仅大厅允许调整座位");
    assert(room.hostMemberId === member.memberId, ERROR_CODES.NOT_ROOM_HOST, "仅房主可以调整座位");
    assert(Array.isArray(payload.orderedMemberIds), ERROR_CODES.INVALID_PAYLOAD, "orderedMemberIds 必须是数组");

    const idempotent = await guardIdempotency(`room:${room.roomId}`, payload.commandId, openid, payload);
    if (idempotent.deduplicated) {
      return idempotent.responseData;
    }

    return mutate(async (activeStore) => {
      const txRoom = await activeStore.getRoom(room.roomId);
      const members = await activeStore.listRoomMembers(txRoom.roomId);
      const activeMembers = sortMembersBySeat(members.filter((item) => item.memberStatus === "active"));
      const currentIds = activeMembers.map((item) => item.memberId).sort();
      const nextIds = [...payload.orderedMemberIds].sort();
      assert(JSON.stringify(currentIds) === JSON.stringify(nextIds), ERROR_CODES.INVALID_PAYLOAD, "orderedMemberIds 必须与当前有效成员完全一致");

      const now = nowIso(nowProvider);
      payload.orderedMemberIds.forEach((memberId, index) => {
        const target = activeMembers.find((item) => item.memberId === memberId);
        target.seatIndex = index + 1;
        target.updatedAt = now;
      });
      await activeStore.saveRoomMembers(activeMembers);

      txRoom.version += 1;
      txRoom.updatedAt = now;
      await activeStore.saveRoom(txRoom);
      const responseData = {
        roomId: txRoom.roomId,
        roomStatus: txRoom.status,
        newVersion: txRoom.version,
        lobbySnapshot: buildLobbySnapshot(txRoom, activeMembers, member.memberId)
      };
      await activeStore.saveCommandRecord({
        commandRecordId: idempotent.commandRecordId,
        requesterOpenId: openid,
        payloadHash: idempotent.payloadHash,
        responseData,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
      });
      return responseData;
    });
  }

  async function setReady(openid, payload) {
    ensureCommandId(payload);
    assert(typeof payload.ready === "boolean", ERROR_CODES.INVALID_PAYLOAD, "ready 必须是布尔值");
    const { room, member } = await requireRoomMember(openid, payload.roomId);
    assert(room.status === "lobby", ERROR_CODES.ACTION_NOT_ALLOWED, "仅大厅允许设置准备状态");

    const idempotent = await guardIdempotency(`room:${room.roomId}`, payload.commandId, openid, payload);
    if (idempotent.deduplicated) {
      return idempotent.responseData;
    }

    return mutate(async (activeStore) => {
      const txRoom = await activeStore.getRoom(room.roomId);
      const txMember = await activeStore.getRoomMember(room.roomId, member.memberId);
      const now = nowIso(nowProvider);
      txMember.isReady = payload.ready;
      txMember.updatedAt = now;
      txMember.lastSeenAt = now;
      await activeStore.saveRoomMember(txMember);
      txRoom.version += 1;
      txRoom.updatedAt = now;
      await activeStore.saveRoom(txRoom);

      const members = await activeStore.listRoomMembers(txRoom.roomId);
      const responseData = {
        roomId: txRoom.roomId,
        roomStatus: txRoom.status,
        newVersion: txRoom.version,
        lobbySnapshot: buildLobbySnapshot(txRoom, members, txMember.memberId)
      };
      await activeStore.saveCommandRecord({
        commandRecordId: idempotent.commandRecordId,
        requesterOpenId: openid,
        payloadHash: idempotent.payloadHash,
        responseData,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
      });
      return responseData;
    });
  }

  async function startGame(openid, payload) {
    ensureCommandId(payload);
    const { room, member } = await requireRoomMember(openid, payload.roomId);
    assert(room.status === "lobby", ERROR_CODES.GAME_ALREADY_STARTED, "房间已开局");
    assert(room.hostMemberId === member.memberId, ERROR_CODES.NOT_ROOM_HOST, "仅房主可以开局");

    const idempotent = await guardIdempotency(`room:${room.roomId}`, payload.commandId, openid, payload);
    if (idempotent.deduplicated) {
      return idempotent.responseData;
    }

    const members = sortMembersBySeat((await store.listRoomMembers(room.roomId)).filter((item) => item.memberStatus === "active"));
    assert(members.length >= MIN_PLAYER_COUNT && members.length <= MAX_PLAYER_COUNT, ERROR_CODES.INVALID_PLAYER_COUNT, "玩家数量不合法");
    assert(members.every((item) => item.isReady), ERROR_CODES.NOT_ALL_READY, "仍有玩家未准备");

    return mutate(async (activeStore) => {
      const txRoom = await activeStore.getRoom(room.roomId);
      const txMembers = sortMembersBySeat((await activeStore.listRoomMembers(txRoom.roomId)).filter((item) => item.memberStatus === "active"));
      assert(txMembers.length >= MIN_PLAYER_COUNT && txMembers.length <= MAX_PLAYER_COUNT, ERROR_CODES.INVALID_PLAYER_COUNT, "玩家数量不合法");
      assert(txMembers.every((item) => item.isReady), ERROR_CODES.NOT_ALL_READY, "仍有玩家未准备");

      const now = nowIso(nowProvider);
      const game = createGame(txRoom, txMembers, randomProvider, now);
      txRoom.status = "in_game";
      txRoom.version += 1;
      txRoom.updatedAt = now;
      await activeStore.saveRoom(txRoom);
      await activeStore.saveGame({ ...game, publicHistory: [] });

      const responseData = {
        roomId: txRoom.roomId,
        roomCode: txRoom.roomCode,
        roomStatus: txRoom.status,
        version: game.version,
        routeHint: "identity",
        needsRefresh: true
      };

      await activeStore.saveCommandRecord({
        commandRecordId: idempotent.commandRecordId,
        requesterOpenId: openid,
        payloadHash: idempotent.payloadHash,
        responseData,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
      });
      return responseData;
    });
  }

  async function getGameSnapshot(openid, payload) {
    assert(payload.roomId, ERROR_CODES.INVALID_PAYLOAD, "roomId 必填");
    const { room, member } = await requireRoomMember(openid, payload.roomId);
    assert(room.status === "in_game", room.status === "ended" ? ERROR_CODES.GAME_ALREADY_ENDED : ERROR_CODES.GAME_NOT_STARTED, "当前房间不在游戏中");

    const game = await store.getGame(room.roomId);
    assert(game, ERROR_CODES.GAME_NOT_STARTED, "对局尚未开始");
    const members = await store.listRoomMembers(room.roomId);
    return buildGameSnapshot(room, game, members, member.memberId);
  }

  async function submitGameCommand(openid, payload) {
    assert(payload.roomId && payload.commandId && payload.type, ERROR_CODES.INVALID_PAYLOAD, "roomId、commandId、type 必填");
    assert(typeof payload.expectedVersion === "number", ERROR_CODES.INVALID_PAYLOAD, "expectedVersion 必填");

    const { room, member } = await requireRoomMember(openid, payload.roomId);
    assert(room.status === "in_game", room.status === "ended" ? ERROR_CODES.GAME_ALREADY_ENDED : ERROR_CODES.GAME_NOT_STARTED, "房间当前不在对局中");

    const idempotent = await guardIdempotency(`room:${room.roomId}`, payload.commandId, openid, payload);
    if (idempotent.deduplicated) {
      return {
        ...idempotent.responseData,
        deduplicated: true
      };
    }

    return mutate(async (activeStore) => {
      let game = await activeStore.getGame(room.roomId);
      const txRoom = await activeStore.getRoom(room.roomId);
      const txMember = await activeStore.getRoomMember(room.roomId, member.memberId);
      assert(game, ERROR_CODES.GAME_NOT_STARTED, "对局尚未开始");
      assert(game.status !== "ended", ERROR_CODES.GAME_ALREADY_ENDED, "对局已结束");
      assert(payload.expectedVersion === game.version, ERROR_CODES.VERSION_CONFLICT, "版本已过期");

      const members = await activeStore.listRoomMembers(txRoom.roomId);
      const now = nowIso(nowProvider);
      const applied = applyCommand({
        state: game,
        actorMemberId: txMember.memberId,
        command: payload,
        members,
        now,
        randomProvider
      });
      const advanced = advanceSystemPhases(applied.nextState, members, now, randomProvider);
      game = {
        ...advanced.nextState,
        publicHistory: [...(game.publicHistory || []), ...applied.events, ...advanced.events]
      };

      await activeStore.saveGame(game);
      txRoom.status = game.status === "ended" ? "ended" : "in_game";
      txRoom.updatedAt = now;
      if (game.status === "ended") {
        txRoom.endedAt = game.endedAt;
      }
      await activeStore.saveRoom(txRoom);

      const responseData = {
        accepted: true,
        roomId: txRoom.roomId,
        roomStatus: "in_game",
        previousVersion: payload.expectedVersion,
        newVersion: game.version,
        currentPhase: game.phase,
        phaseChanged: payload.expectedVersion !== game.version,
        deduplicated: false,
        needsRefresh: true
      };
      await activeStore.saveCommandRecord({
        commandRecordId: idempotent.commandRecordId,
        requesterOpenId: openid,
        payloadHash: idempotent.payloadHash,
        responseData,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECORD_TTL_MS).toISOString()
      });
      return responseData;
    });
  }

  async function getResultSnapshot(openid, payload) {
    assert(payload.roomId, ERROR_CODES.INVALID_PAYLOAD, "roomId 必填");
    const { room, member } = await requireRoomMember(openid, payload.roomId);
    assert(room.status === "ended", room.status === "lobby" ? ERROR_CODES.GAME_NOT_STARTED : ERROR_CODES.ACTION_NOT_ALLOWED, "结果尚不可读取");
    const game = await store.getGame(room.roomId);
    assert(game && game.status === "ended", ERROR_CODES.ACTION_NOT_ALLOWED, "结果尚不可读取");
    const members = await store.listRoomMembers(room.roomId);
    return {
      ...buildResultSnapshot(room, game, members),
      myMemberId: member.memberId
    };
  }

  return {
    run,
    services: {
      ensureSession,
      recoverActiveRoom,
      createRoom,
      joinRoom,
      leaveRoom,
      getLobbySnapshot,
      updateDisplayName,
      updateSeatOrder,
      setReady,
      startGame,
      getGameSnapshot,
      submitGameCommand,
      getResultSnapshot
    }
  };
}

module.exports = {
  createApp
};
