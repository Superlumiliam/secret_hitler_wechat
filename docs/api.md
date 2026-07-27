---
status: active
authority: api-contract
last_verified: 2026-07-27
---

# 《secret dictator》前后端 API

## 文档边界

本文记录当前代码已经实现的云函数契约。未实现能力不得提前出现在这里；候选接口先进入 [`roadmap.md`](roadmap.md) 或 RFC。

内部存储和安全边界见 [`architecture.md`](architecture.md)。实际 action 分发入口位于四个云函数的 `index.js`。

## 通用协议

客户端调用业务云函数时使用：

```json
{
  "action": "actionName",
  "payload": {}
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_...",
  "serverTime": "2026-07-26T00:00:00.000Z",
  "data": {}
}
```

失败响应：

```json
{
  "success": false,
  "requestId": "req_...",
  "serverTime": "2026-07-26T00:00:00.000Z",
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "当前局势已更新，请刷新后重试",
    "retryable": true
  }
}
```

约束：

- 服务端从微信云函数上下文取得 openid，不信任客户端传入的身份字段。
- 所有房间/游戏业务命令都必须带 `commandId`；同一命令重试复用原值，不同命令不能复用。会话恢复、清除恢复锚点和快照在线状态刷新虽然可能写入资料或 `lastSeenAt`，但不属于业务命令，不要求 `commandId`。
- `submitCommand` 必须带 `expectedVersion`；版本不一致返回 `VERSION_CONFLICT`。
- 前端以 `error.code` 做分支，`message` 只用于日志和兜底提示。
- 当前请求中没有显式 `apiVersion` 字段。不兼容变更必须通过新 action、新云函数或明确迁移方案处理。

## 已实现 action

### `bootstrapService`

| action | payload | `data` |
| --- | --- | --- |
| `ensureSession` | `{}` | `{ user: { sessionReady }, activeRoom }` |
| `recoverActiveRoom` | `{}` | 同上，并刷新有效真实成员的在线状态 |
| `clearActiveRoom` | `{ roomId? }` | `{ activeRoom: null }` |

`activeRoom` 为 `null` 或包含 `roomId`、`roomCode`、`roomStatus`、`memberId`、`routeHint`、`version` 和时间字段。`routeHint` 为 `lobby`、`board` 或 `result`。

`clearActiveRoom` 传入 `roomId` 时仅在资料中的恢复锚点仍指向该房间时清除；若已切换到其他房间则成功返回但不修改。成功清除会抑制成员扫描重新写回同一锚点，直到创建或加入新的有效房间。保留空 payload 的无条件清除语义以兼容旧客户端。

### `roomService`

| action | 必要 payload | 主要返回 |
| --- | --- | --- |
| `createRoom` | `commandId, targetPlayerCount, displayName`；`avatarUrl?` | 房间标识、成员标识和 `lobbySnapshot` |
| `joinRoom` | `commandId, roomCode 或 roomId, displayName`；`avatarUrl?` | 房间标识、成员标识和 `lobbySnapshot` |
| `leaveRoom` | `commandId, roomId` | 离开结果及后续路由信息 |
| `getLobbySnapshot` | `roomId`；`touchPresence?` | `LobbyView` |
| `claimLobbySeat` | `commandId, roomId, targetSeatIndex` | 更新后的 `LobbyView` |
| `updateRoomSettings` | `commandId, roomId, targetPlayerCount` | 版本和 `lobbySnapshot` |
| `setReady` | `commandId, roomId, isReady` | 更新后的 `LobbyView` |
| `soloCreateRoom` | 与 `createRoom` 相同 | `mode: solo` 的房间和 `lobbySnapshot` |
| `soloFillVirtualPlayers` | `commandId, roomId` | 补齐虚拟席位后的 `LobbyView` |
| `soloSetVirtualReady` | `commandId, roomId, memberId, isReady` | 更新后的 `LobbyView` |
| `soloReadyAllVirtualPlayers` | `commandId, roomId` | 真实房主及其虚拟席位准备后的 `LobbyView` |

`targetPlayerCount` 必须为 5–10。单人模式专用 action 只允许单人模式房间的真实房主调用。

当前没有 `updateSeatOrder` action。房主全量重排座位仍是未来候选能力，不能由客户端调用。

`leaveRoom` 成功后返回 `routeHint: "home"`。该值表示离开结果的下一路由，不会出现在 `ActiveRoomSummary` 中。

### `gameService`

| action | 必要 payload | 主要返回 |
| --- | --- | --- |
| `startGame` | `commandId, roomId` | 版本、`needsRefresh`、`routeHint` 和桌面路径 |
| `getGameSnapshot` | `roomId`；`controlledMemberId?`、`touchPresence?` | `GameSnapshot` |
| `submitCommand` | `commandId, roomId, expectedVersion, type, body`；`taskId?`、`controlledMemberId?` | 命令接受结果和新版本提示 |
| `getResultSnapshot` | `roomId` | `ResultSnapshot` |

`controlledMemberId` 只在单人模式中有效，并且只能指向当前 openid 控制的虚拟席位。

### `maintenanceService`

该函数不对客户端开放。定时或维护调用默认执行集合初始化、过期房间清理和幂等记录清理。维护 action `prepareRoomSyncSignals` 只用于显式准备同步信号集合。

## 主要 DTO

### `LobbyView`

```json
{
  "roomId": "room_...",
  "roomCode": "482615",
  "roomMode": "normal",
  "roomStatus": "lobby",
  "hostMemberId": "mem_...",
  "playerCount": 5,
  "targetPlayerCount": 5,
  "minPlayerCount": 5,
  "maxPlayerCount": 10,
  "seatOrder": [],
  "viewerState": {
    "myMemberId": "mem_...",
    "isHost": true,
    "myIsReady": true,
    "canStart": true
  },
  "version": 3,
  "expireAt": "...",
  "updatedAt": "..."
}
```

`seatOrder` 只包含大厅有效成员及其公开资料、席位、房主和准备状态。大厅视图不得包含身份、政策牌、投票或游戏真相。

### `GameSnapshot`

```json
{
  "roomId": "room_...",
  "roomCode": "482615",
  "roomStatus": "in_game",
  "roomMode": "normal",
  "myMemberId": "mem_...",
  "realMemberId": "mem_...",
  "controlledMemberId": "",
  "version": 18,
  "round": 3,
  "currentPhase": "voting",
  "publicState": {},
  "privateState": {},
  "pendingTask": null,
  "serverHints": [],
  "expireAt": "...",
  "updatedAt": "..."
}
```

- `publicState` 只含全体成员可见的座位、政府、政策轨、选举计数器、公开票型和公共历史。
- `privateState` 只含当前席位的身份、手牌、个人投票、调查结果、政策预览等私密信息。
- `pendingTask` 是当前席位的权威待办；目标选择不得超出其中的 `allowedTargets`。
- 前端不得从其他字段推导无权限信息。

### `CommandAccepted`

```json
{
  "accepted": true,
  "roomId": "room_...",
  "roomStatus": "in_game",
  "previousVersion": 18,
  "newVersion": 19,
  "currentPhase": "voting",
  "phaseChanged": true,
  "deduplicated": false,
  "needsRefresh": true,
  "routeHint": "board"
}
```

该响应只确认服务端接受命令。页面必须随后读取快照，不能用响应局部字段自行拼接游戏状态。

### `ResultSnapshot`

```json
{
  "roomId": "room_...",
  "roomCode": "482615",
  "roomStatus": "ended",
  "myMemberId": "mem_...",
  "version": 32,
  "winner": "LIBERAL",
  "winReason": "HITLER_EXECUTED",
  "endedAt": "...",
  "expireAt": "...",
  "policySummary": {},
  "finalPlayers": [],
  "timeline": []
}
```

只有终局后且当前 openid 属于本局真实成员时可以读取。`finalPlayers` 可公开最终身份；`timeline[].votes` 只允许包含已经公开的政府投票。

## 游戏命令

`submitCommand` 的通用结构：

```json
{
  "commandId": "cmd_...",
  "roomId": "room_...",
  "expectedVersion": 18,
  "type": "SUBMIT_VOTE",
  "taskId": "game_...:1:voting:SUBMIT_VOTE:mem_...",
  "controlledMemberId": "",
  "body": {
    "vote": "JA"
  }
}
```

| `type` | `body` |
| --- | --- |
| `NOMINATE_CHANCELLOR` | `{ targetMemberId }` |
| `SUBMIT_VOTE` | `{ vote: "JA" \| "NEIN" }` |
| `PRESIDENT_DISCARD_POLICY` | `{ discardPolicyIndex: 0..2 }` |
| `CHANCELLOR_ENACT_POLICY` | `{ enactPolicyIndex: 0..1 }` |
| `CHANCELLOR_REQUEST_VETO` | `{}` |
| `PRESIDENT_RESPOND_VETO` | `{ accepted: boolean }` |
| `EXEC_INVESTIGATE` | `{ targetMemberId }` |
| `EXEC_SPECIAL_ELECTION` | `{ targetMemberId }` |
| `EXEC_POLICY_PEEK_ACK` | `{ acknowledged: true }` |
| `EXECUTE_PLAYER` | `{ targetMemberId }` |

除投票允许兼容无 `taskId` 的当前调用外，其余需要玩家待办的命令必须回传快照给出的 `taskId`。任务 ID 由 `gameId:round:phase:taskType:memberId` 组成，在同一阶段和轮次内不随 `version` 变化；后端仍会独立校验阶段、行动人、目标、版本和房间模式。旧的包含游戏版本的任务 ID 不再接受，客户端应刷新快照获取新任务 ID。

## 实时同步信号

`room_sync_signals` 不是业务 API，只用于通知客户端刷新：

```json
{
  "roomId": "room_...",
  "roomStatus": "in_game",
  "version": 18,
  "signalType": "room_version",
  "updatedAt": "..."
}
```

客户端只能监听当前活跃房间，不能写入。信号不承载快照内容，收到新版本后仍须调用对应读取 action。

## 当前枚举

- `roomMode`：`normal`、`solo`
- `roomStatus`：`lobby`、`in_game`、`ended`、`expired`
- `routeHint`：`home`、`lobby`、`board`、`result`；其中 `ActiveRoomSummary` 只使用 `lobby`、`board`、`result`，`leaveRoom` 使用 `home`
- `vote`：`JA`、`NEIN`
- `policyType`：`LIBERAL`、`FASCIST`
- `phase`：`nomination`、`voting`、`hitler_check`、`legislative_president`、`legislative_chancellor`、`veto_response`、`executive_action`、`round_result`、`game_ended`
- `executiveActionType`：`INVESTIGATE`、`SPECIAL_ELECTION`、`POLICY_PEEK`、`EXECUTION`
- `winner`：`LIBERAL`、`FASCIST`
- `winReason`：`LIBERAL_POLICIES`、`FASCIST_POLICIES`、`HITLER_ELECTED`、`HITLER_EXECUTED`

## 当前错误码

| 类别 | 错误码 |
| --- | --- |
| 请求与资料 | `INVALID_PAYLOAD`、`PROFILE_REQUIRED` |
| 房间 | `ROOM_NOT_FOUND`、`ROOM_EXPIRED`、`ROOM_FULL`、`ROOM_NOT_JOINABLE` |
| 权限 | `NOT_ROOM_MEMBER`、`NOT_ROOM_HOST`、`NOT_CURRENT_ACTOR`、`ACTION_NOT_ALLOWED` |
| 大厅与座位 | `INVALID_PLAYER_COUNT`、`TARGET_COUNT_BELOW_SEATED`、`SEAT_OCCUPIED`、`NOT_ALL_READY` |
| 游戏生命周期 | `GAME_NOT_STARTED`、`GAME_ALREADY_STARTED`、`GAME_ALREADY_ENDED` |
| 命令 | `PHASE_MISMATCH`、`VERSION_CONFLICT`、`DUPLICATE_COMMAND`、`INVALID_TARGET` |
| 系统 | `INTERNAL_ERROR` |

`VERSION_CONFLICT` 和未预期的 `INTERNAL_ERROR` 可标记为 `retryable: true`。刷新或重试不能绕过业务错误。

## 契约变更规则

- 新增或修改 action、payload、DTO、命令、枚举和错误码时，同一次变更必须更新本文和测试。
- 可选字段新增必须保持旧客户端可用；删除、改名或改变语义属于不兼容变更。
- 尚未实现的接口只能出现在 RFC，不得进入本文。
- 如本文与运行代码不一致，先核对分发入口、调用方和测试，修复真实边界，不能用兼容兜底掩盖漂移。
