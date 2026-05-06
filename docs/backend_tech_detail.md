# 《secret hitler》后端详细技术方案

## 1. 文档定位

本文档不再重复解释产品目标，而是直接回答下面这些开发问题：

- 后端目录怎么拆
- 云函数怎么分
- 云数据库集合怎么建
- 每个字段存什么
- 状态机如何推进
- 命令如何做幂等、鉴权、版本控制
- 快照如何生成
- 异常恢复、房间过期、测试怎么做

## 2. 设计结论总览

### 2.1 最终技术路线

后端统一采用以下路线：

- 微信云开发云函数
- 微信云数据库
- TypeScript 编写后端核心逻辑
- `命令处理 + 纯领域状态机 + 快照投影 + 事件日志` 架构
- `云函数读写快照` 作为 MVP 默认读取方式

### 2.2 明确取舍

本方案做出以下明确取舍：

1. MVP 不开放前端直接读取或监听数据库快照，统一通过云函数轮询读取快照。
2. 核心真相只保存在后端内部集合，前端永远不拿完整真相。
3. 每次成功写入后同步重建公共快照和全部私密快照，优先保证一致性，暂不优先优化写放大。
4. 游戏内所有写操作统一走 `gameService.submitCommand`，大厅阶段写操作统一走 `roomService`。

### 2.3 为什么不用数据库直读或监听

本项目存在两类高敏信息：

- 仅当前玩家可见的私密快照
- 仅系统可见的完整真相

MVP 阶段为了降低泄露风险和权限配置复杂度，固定采用：

- 后端持续维护 `room_public_snapshots` 与 `player_private_snapshots`
- 前端通过 `getLobbySnapshot`、`getGameSnapshot`、`getResultSnapshot` 等云函数 action 读取快照
- 前端页面按固定间隔轮询，命令成功后立即补拉一次

这样可以同时满足：

- 快照模型不变
- 前后端接口稳定
- 前端无需任何数据库集合读权限或监听权限

## 3. 与当前仓库的衔接方式

- `bootstrapService`
- `roomService`
- `gameService`
- `maintenanceService`

其中：

- 前三个对前端开放
- `maintenanceService` 仅用于定时清理和过期处理，不对前端开放

## 4. 推荐目录结构

```text
backend/
  src/
    application/
      bootstrap/
      room/
      game/
      maintenance/
    domain/
      room/
      game/
      policy/
      projection/
      errors/
      types/
    repositories/
      user-profile-repository.ts
      room-repository.ts
      room-member-repository.ts
      game-core-repository.ts
      snapshot-repository.ts
      event-repository.ts
      command-record-repository.ts
    cloud/
      context.ts
      envelope.ts
      logger.ts
      transaction.ts
    config/
      constants.ts
      role-config.ts
      executive-power-config.ts
      error-codes.ts
    utils/
      id.ts
      random.ts
      date.ts
      validate.ts
    tests/
      fixtures/
      unit/
      integration/
cloudfunctions/
  bootstrapService/
    index.js
    package.json
  roomService/
    index.js
    package.json
  gameService/
    index.js
    package.json
  maintenanceService/
    index.js
    package.json
scripts/
  build-cloudfunctions.mjs
  copy-cloudfunction-assets.mjs
```

### 4.1 分层职责

- `application`：编排事务、仓储、状态机和投影
- `domain`：纯规则、纯状态迁移、纯数据结构
- `repositories`：云数据库读写封装
- `cloud`：云函数入口通用包装
- `config`：常量、枚举、规则表
- `utils`：与领域无关的工具函数

### 4.2 严格约束

- 云函数 `index` 只做 action 分发，不写业务规则
- 规则判断只能放在 `domain`
- 数据库集合名只能集中写在 repository 层
- 前端返回结构只能由 projector 输出，不允许 handler 手写拼装

## 5. 运行环境与工程配置

## 5.1 运行时

后端代码按微信云函数当前可用的最高 LTS Node.js 运行时配置，代码目标保持为：

- CommonJS 输出
- ES2021 语法目标
- 严格模式 TypeScript

为了降低云函数兼容性风险，业务代码不依赖：

- ESM only 运行方式
- 浏览器 API
- 需要原生编译的重依赖

## 5.2 依赖策略

运行时依赖保持极简：

- `wx-server-sdk`

开发依赖建议：

- `typescript`
- `esbuild`
- `vitest`
- `@types/node`

MVP 阶段不额外引入重量级 ORM 或状态机框架，原因是：

- 云数据库模型简单
- 核心价值在规则正确性，不在数据库抽象
- 纯函数状态机更容易测试

## 5.3 构建策略

推荐采用“根目录统一构建，输出到各云函数目录”的方式：

1. 后端源码全部写在 `backend/src`
2. 由 `scripts/build-cloudfunctions.mjs` 分别打包四个云函数入口
3. 每个函数目录只保留部署所需产物：
   - `index.js`
   - `package.json`
   - `config.json`（有权限要求时）

### 5.4 推荐脚本

根目录 `package.json` 推荐至少包含：

```json
{
  "scripts": {
    "build:backend": "node scripts/build-cloudfunctions.mjs",
    "test:backend": "vitest run backend/src/tests",
    "lint:backend": "tsc --noEmit -p tsconfig.backend.json"
  }
}
```

## 6. 核心常量、枚举与 ID 约定

## 6.1 全局常量

```ts
export const MIN_PLAYER_COUNT = 5;
export const MAX_PLAYER_COUNT = 10;
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_RETRY_LIMIT = 10;
export const MAX_DISPLAY_NAME_LENGTH = 20;
export const ROOM_TTL_LOBBY_MS = 2 * 60 * 60 * 1000;
export const ROOM_TTL_ACTIVE_MS = 12 * 60 * 60 * 1000;
export const ROOM_TTL_RESULT_MS = 24 * 60 * 60 * 1000;
export const COMMAND_RECORD_TTL_MS = 24 * 60 * 60 * 1000;
export const GAME_POLL_INTERVAL_MS = 1500;
export const LOBBY_POLL_INTERVAL_MS = 3000;
```

说明：

- 房间过期时间必须统一放在配置，不允许散落在 handler 里硬编码
- 倒计时是 P1 能力，MVP 的 `pendingTask.deadline` 固定为 `null`

## 6.2 ID 规则

后端内部使用如下 ID：

- `roomId`：`room_` 前缀 + 12 位随机串
- `memberId`：`mem_` 前缀 + 12 位随机串
- `gameId`：`game_` 前缀 + 12 位随机串
- `eventId`：`evt_${gameId}_${seq}`
- `commandRecordId`：`${scopeKey}:${commandId}`

前端生成：

- `commandId`

其中：

- `scopeKey = user:${openid}`，用于 `createRoom`、`joinRoom`
- `scopeKey = room:${roomId}`，用于其余大厅写操作和全部游戏命令

后端生成：

- 其余所有业务 ID

## 6.3 关键枚举

```ts
export type RoomStatus = "lobby" | "in_game" | "ended" | "expired";

export type Phase =
  | "nomination"
  | "voting"
  | "hitler_check"
  | "legislative_president"
  | "legislative_chancellor"
  | "veto_response"
  | "executive_action"
  | "round_result"
  | "game_ended";

export type Role = "LIBERAL" | "FASCIST" | "HITLER";
export type Party = "LIBERAL" | "FASCIST";
export type Vote = "JA" | "NEIN";
export type PolicyType = "LIBERAL" | "FASCIST";

export type ExecutiveActionType =
  | "INVESTIGATE"
  | "SPECIAL_ELECTION"
  | "POLICY_PEEK"
  | "EXECUTION";

export type WinReason =
  | "LIBERAL_FIVE_POLICIES"
  | "FASCIST_SIX_POLICIES"
  | "HITLER_ELECTED_CHANCELLOR"
  | "HITLER_EXECUTED";
```

## 7. 数据库集合设计

## 7.1 总览

最终集合划分如下：

| 集合 | 用途 | 前端是否可直读 | 前端是否可直写 |
| --- | --- | --- | --- |
| `rooms` | 房间主记录 | 否 | 否 |
| `room_members` | 房间成员与座位信息 | 否 | 否 |
| `game_core` | 游戏完整真相 | 否 | 否 |
| `room_public_snapshots` | 公共快照缓存 | 否，MVP 通过云函数读 | 否 |
| `player_private_snapshots` | 玩家私密快照缓存 | 否，MVP 通过云函数读 | 否 |
| `game_events` | 事件日志与复盘依据 | 否 | 否 |
| `command_records` | 幂等记录与请求审计 | 否 | 否 |

## 7.2 用户资料存储边界

MVP 后端不建立长期 `user_profiles` 集合。

原因：

- 用户可能只使用一次小程序，长期保存头像与用户名会造成数据只增不减
- MVP 不支持换设备、清缓存、重装后恢复用户名头像
- 用户资料只服务于房间内展示，不是账号体系

实现约束：

- 用户名、头像、资料完成状态只存在小程序本地缓存
- `createRoom` / `joinRoom` 请求必须携带本地用户资料
- 后端只把请求中的 `displayName/avatarUrl` 写入当前房间的 `room_members` 成员快照
- 房间结束、过期或销毁后，成员快照随房间数据清理，不保留跨局用户资料
- 恢复活跃房间时，通过 `room_members.openId` 查询当前 openid 仍有效的房间成员，不依赖用户资料表

## 7.3 `rooms`

作用：

- 保存房间生命周期主状态
- 作为大厅阶段的可信记录

推荐文档结构：

```json
{
  "_id": "room_xxx",
  "roomId": "room_xxx",
  "roomCode": "482615",
  "status": "lobby",
  "hostMemberId": "mem_xxx",
  "currentGameId": null,
  "playerCount": 6,
  "targetPlayerCount": 7,
  "version": 4,
  "createdByOpenId": "openid",
  "createdAt": "2026-04-12T12:00:00.000Z",
  "updatedAt": "2026-04-12T12:05:00.000Z",
  "startedAt": null,
  "endedAt": null,
  "expireAt": "2026-04-12T14:00:00.000Z"
}
```

约束：

- `rooms.version` 仅用于大厅阶段版本控制
- `targetPlayerCount` 来自创建房间页选择，仅用于大厅展示和开局前提示；开局合法性仍以后端当前有效成员数为准
- 开局后 `playerCount` 不再变化
- `expireAt` 每次有效操作后更新

## 7.4 `room_members`

作用：

- 保存房间成员、座位、准备态和连接态
- 作为前端身份恢复的锚点

推荐文档结构：

```json
{
  "_id": "mem_xxx",
  "memberId": "mem_xxx",
  "roomId": "room_xxx",
  "openId": "openid",
  "displayName": "玩家A",
  "avatarUrl": "cloud://xxx/avatar/openid.png",
  "seatIndex": 1,
  "isHost": true,
  "isReady": true,
  "memberStatus": "active",
  "joinedAt": "2026-04-12T12:00:00.000Z",
  "leftAt": null,
  "lastSeenAt": "2026-04-12T12:05:00.000Z",
  "createdAt": "2026-04-12T12:00:00.000Z",
  "updatedAt": "2026-04-12T12:05:00.000Z"
}
```

`memberStatus` 取值：

- `active`：在房内且可参与
- `left`：大厅中主动退出，保留记录仅用于审计
- `offline`：开局后掉线或主动离开小程序

约束：

- 大厅阶段同一 `roomId + openId` 只能存在一个 `active` 成员
- 开局后同一 openid 回到同房间必须复用原 `memberId`

## 7.5 `game_core`

作用：

- 保存整局游戏的唯一可信真相

推荐文档结构：

```json
{
  "_id": "game_xxx",
  "gameId": "game_xxx",
  "roomId": "room_xxx",
  "status": "in_game",
  "version": 18,
  "eventSeq": 42,
  "round": 3,
  "phase": "voting",
  "playerCount": 7,
  "currentPresidentCandidateId": "mem_1",
  "currentChancellorCandidateId": "mem_4",
  "currentPresidentId": null,
  "currentChancellorId": null,
  "previousElectedPresidentId": "mem_3",
  "previousElectedChancellorId": "mem_5",
  "specialElectionCallerId": null,
  "forcedNextPresidentId": null,
  "electionTracker": 1,
  "liberalPolicyCount": 2,
  "fascistPolicyCount": 3,
  "vetoUnlocked": false,
  "roleAssignments": {
    "mem_1": {
      "role": "LIBERAL",
      "party": "LIBERAL",
      "knownMemberIds": []
    },
    "mem_2": {
      "role": "HITLER",
      "party": "FASCIST",
      "knownMemberIds": []
    }
  },
  "aliveMemberIds": ["mem_1", "mem_2", "mem_3", "mem_4", "mem_5", "mem_6", "mem_7"],
  "deadMemberIds": [],
  "confirmedNotHitlerMemberIds": ["mem_5"],
  "investigatedMemberIds": ["mem_6"],
  "roleRevealAckedMemberIds": ["mem_1", "mem_2"],
  "policyState": {
    "drawPile": ["FASCIST", "LIBERAL", "FASCIST"],
    "discardPile": ["LIBERAL", "FASCIST"],
    "presidentHand": null,
    "chancellorHand": null,
    "peekPile": null
  },
  "phaseData": {
    "ballots": {
      "mem_1": { "submitted": true, "vote": "JA" },
      "mem_2": { "submitted": false, "vote": null }
    }
  },
  "winner": null,
  "winReason": null,
  "startedAt": "2026-04-12T12:10:00.000Z",
  "endedAt": null,
  "updatedAt": "2026-04-12T12:20:00.000Z",
  "expireAt": "2026-04-13T00:20:00.000Z"
}
```

关键约束：

- `game_core` 必须足够完整，允许单独重放和重建快照
- 所有隐藏信息只允许出现在 `game_core` 和内部事件中
- 不把完整复盘历史塞回 `game_core`，避免版本更新过重

## 7.6 `room_public_snapshots`

作用：

- 保存大厅或对局公共视图
- 供 `getLobbySnapshot` / `getGameSnapshot` 直接读取

推荐结构：

```json
{
  "_id": "room_xxx",
  "roomId": "room_xxx",
  "roomCode": "482615",
  "roomStatus": "in_game",
  "snapshotType": "game_public",
  "version": 18,
  "payload": {},
  "updatedAt": "2026-04-12T12:20:00.000Z",
  "expireAt": "2026-04-13T00:20:00.000Z"
}
```

说明：

- `snapshotType` 可取 `lobby`、`game_public`、`result_public`
- `payload` 内部字段由 projector 严格生成

## 7.7 `player_private_snapshots`

作用：

- 保存按玩家裁剪后的私密快照

推荐结构：

```json
{
  "_id": "mem_xxx",
  "memberId": "mem_xxx",
  "roomId": "room_xxx",
  "gameId": "game_xxx",
  "ownerOpenId": "openid",
  "roomStatus": "in_game",
  "version": 18,
  "payload": {},
  "pendingTask": null,
  "updatedAt": "2026-04-12T12:20:00.000Z",
  "expireAt": "2026-04-13T00:20:00.000Z"
}
```

约束：

- 一名成员只对应一份私密快照文档
- 写入时全量覆盖，不做局部 patch
- 游戏结束后仍保留到结果过期时间，便于复盘

## 7.8 `game_events`

作用：

- 记录事件流
- 支撑复盘、测试、排障

推荐结构：

```json
{
  "_id": "evt_game_xxx_42",
  "eventId": "evt_game_xxx_42",
  "gameId": "game_xxx",
  "roomId": "room_xxx",
  "seq": 42,
  "type": "VOTES_REVEALED",
  "actorMemberId": null,
  "publicPayload": {
    "votes": [
      { "memberId": "mem_1", "vote": "JA" },
      { "memberId": "mem_2", "vote": "NEIN" }
    ]
  },
  "privatePayload": null,
  "internalPayload": null,
  "createdAt": "2026-04-12T12:20:00.000Z"
}
```

事件载荷分层约束：

- `publicPayload`：复盘时可公开
- `privatePayload`：仅特定成员可见，MVP 暂不直接下发
- `internalPayload`：仅后端排障使用

## 7.9 `command_records`

作用：

- 保证幂等
- 记录请求结果
- 排查重复点击、旧版本提交、异常重试

推荐结构：

```json
{
  "_id": "room:room_xxx:cmd_xxx",
  "commandId": "cmd_xxx",
  "scopeKey": "room:room_xxx",
  "roomId": "room_xxx",
  "gameId": "game_xxx",
  "action": "submitCommand",
  "commandType": "SUBMIT_VOTE",
  "taskId": "game_xxx:20:SUBMIT_VOTE:mem_xxx",
  "requesterOpenId": "openid",
  "requesterMemberId": "mem_xxx",
  "payloadHash": "sha1_xxx",
  "expectedVersion": 18,
  "resolvedVersion": 19,
  "phaseAtRequest": "voting",
  "result": "applied",
  "errorCode": null,
  "createdAt": "2026-04-12T12:20:00.000Z",
  "resolvedAt": "2026-04-12T12:20:00.200Z",
  "expireAt": "2026-04-13T12:20:00.000Z"
}
```

`result` 取值：

- `applied`
- `duplicate`
- `rejected`
- `conflict`

补充约束：

- `createRoom`、`joinRoom` 的 `scopeKey` 使用 `user:${openid}`
- 其他写操作的 `scopeKey` 使用 `room:${roomId}`
- 相同 `scopeKey + commandId` 的完全相同请求返回幂等成功
- 相同 `scopeKey + commandId` 但不同 `payloadHash` 的请求返回 `DUPLICATE_COMMAND`

## 7.10 索引要求

至少创建以下索引：

| 集合 | 索引 |
| --- | --- |
| `rooms` | `roomCode` |
| `rooms` | `status + expireAt` |
| `room_members` | `roomId + openId` |
| `room_members` | `roomId + seatIndex` |
| `room_members` | `roomId + memberStatus` |
| `game_core` | `roomId` |
| `game_events` | `roomId + seq` |
| `game_events` | `roomId + createdAt` |
| `command_records` | `scopeKey + createdAt` |
| `player_private_snapshots` | `roomId + memberId` |

## 8. 云函数边界与 action 设计

## 8.1 `bootstrapService`

允许 action：

- `ensureSession`
- `recoverActiveRoom`

### `ensureSession`

流程：

1. 通过 `cloud.getWXContext()` 取得 `OPENID`
2. 不创建长期用户资料记录
3. 可按 `room_members.openId` 尝试查找当前用户仍有效的活跃房间摘要
4. 返回会话可用状态和活跃房间摘要

返回建议：

```json
{
  "user": {
    "sessionReady": true
  },
  "activeRoom": {
    "roomId": "room_xxx",
    "roomCode": "482615",
    "roomStatus": "in_game",
    "memberId": "mem_xxx",
    "routeHint": "board",
    "version": 18,
    "updatedAt": "2026-04-12T12:00:00.000Z"
  }
}
```

### `recoverActiveRoom`

流程：

1. 通过 `cloud.getWXContext()` 取得 `OPENID`
2. 查询 `room_members` 中当前 openid 仍有效的成员记录
3. 按 `updatedAt/lastSeenAt` 选择最近的未失效房间；若没有，返回 `null`
4. 读取对应 `rooms`，若房间已过期或成员已失效，返回 `null`
5. 若仍有效，返回：
   - `roomId`
   - `roomCode`
   - `roomStatus`
   - `memberId`
   - `routeHint`

`routeHint` 建议值：

- `lobby`
- `board`
- `result`

## 8.2 `roomService`

允许 action：

- `createRoom`
- `joinRoom`
- `leaveRoom`
- `getLobbySnapshot`
- `setReady`
- `startGame`

说明：`updateSeatOrder` 属于 P1 座位管理扩展，MVP 不要求实现。

统一约束：

- 除 `getLobbySnapshot` 外，其余 action 都属于写操作，正式协议要求必须携带 `commandId`
- 请求与响应字段以 `/docs/front_back_api.md` 为唯一对外准则
- 本节重点描述后端实现步骤与强校验点，不重复维护一份独立返回结构

### 8.2.1 `createRoom`

实现步骤：

1. 认证当前 openid
2. 校验 `targetPlayerCount` 为 `5-10` 的整数
3. 校验请求中的 `displayName/avatarUrl`，作为本房间成员快照资料
4. 检查该用户是否已有未失效活跃房间
5. 生成唯一 6 位房号
6. 使用请求中的 `displayName/avatarUrl` 创建房主成员资料快照
7. 创建 `rooms`
8. 创建首个 `room_members`
9. 写 `room_public_snapshots`
10. 返回房间与房主成员快照

约束：

- 同一 openid 存在 `lobby` 或 `in_game` 状态活跃房间时，直接拒绝，错误码使用 `ACTION_NOT_ALLOWED`
- 若用户当前只关联到 `ended` 或已过期房间，允许创建新房间
- 房主默认 `seatIndex = 1`
- MVP 座位顺序由加入顺序初始化；不提供房主调整座位能力

### 8.2.2 `joinRoom`

实现步骤：

1. 通过 `roomCode` 找房间
2. 校验请求中的 `displayName/avatarUrl`，作为本房间成员快照资料
3. 校验房间存在、未过期、仍在大厅；同一 openid 回流只允许恢复自己已有成员身份
4. 若同一 openid 已在该房间有有效成员，则直接返回该成员记录；不因本次请求覆盖既有成员快照
5. 若房间是大厅且未满，则使用请求中的 `displayName/avatarUrl` 创建新成员资料快照
6. 更新房间 `playerCount` 与大厅快照
7. 返回房间与当前成员快照

关键约束：

- 大厅阶段最多 10 人
- 开局后不允许新 openid 加入
- 同 openid 分享回流时必须复用原成员身份，不重复占座
- 若用户当前只关联到 `ended` 或已过期房间，允许加入新房间

### 8.2.3 `leaveRoom`

大厅阶段：

1. 将该成员标记为 `left`
2. 从有效成员列表移除
3. 重新压缩剩余 `seatIndex`
4. 若房间没人了，直接销毁或标记房间过期
5. 若离开者是房主且仍有其他有效成员，则把房主转移给新的最小 `seatIndex`

对局阶段：

1. 不删除成员
2. 将 `memberStatus` 改为 `offline`
3. 更新 `lastSeenAt`
4. 返回当前房间仍有效

说明：MVP 不提供“恢复所有人已离线的房间”能力。房间是否可回到活跃态只以具体玩家自己的 `room_members.openId/memberId` 与房间过期规则为准；当大厅阶段所有玩家都退出后，房间立即失效。

### 8.2.4 `updateSeatOrder`（P1 扩展，MVP 不实现）

座位管理已降为 P1 可扩展能力。MVP 后端只按加入顺序生成与压缩 `seatIndex`，不开放调整座位 action。

强校验：

- 仅房主
- 仅大厅
- `orderedMemberIds` 必须与当前全部有效成员完全一致，不能缺人、不能多人、不能重复

更新方式：

- 按数组顺序重写各成员 `seatIndex`
- `rooms.version + 1`
- 重建大厅快照

### 8.2.6 `setReady`

强校验：

- 仅大厅
- 仅本人

更新方式：

- 修改 `room_members.isReady`
- `rooms.version + 1`
- 重建大厅快照

### 8.2.7 `startGame`

强校验：

- 仅房主
- 房间状态必须是 `lobby`
- 玩家数必须在 `5-10`
- 全员 `isReady === true`

执行步骤：

1. 固化当前有效成员列表和座位顺序
2. 生成角色分配
3. 生成初始牌堆
4. 随机首任总统候选人
5. 创建 `game_core`
6. 更新 `rooms.status = in_game`
7. 写初始公共快照和全部私密快照
8. 写 `GAME_STARTED` 事件

## 8.3 `gameService`

允许 action：

- `getGameSnapshot`
- `submitCommand`
- `getResultSnapshot`

### 8.3.1 `getGameSnapshot`

读取逻辑固定为：

1. 通过 openid 定位当前成员
2. 读取 `room_public_snapshots`
3. 读取 `player_private_snapshots`
4. 将 `room_public_snapshots.payload` 与 `player_private_snapshots.payload` 合并为 API 文档要求的 `GameSnapshot`

不允许：

- 现场从 `game_core` 即时拼装复杂业务视图
- 前端传入任意 `memberId` 读取他人私密快照

### 8.3.2 `submitCommand`

这是整个后端的核心写入口。所有游戏内命令都按统一结构进入：

```json
{
  "roomId": "room_xxx",
  "commandId": "cmd_xxx",
  "expectedVersion": 18,
  "taskId": "game_xxx:20:SUBMIT_VOTE:mem_2",
  "type": "SUBMIT_VOTE",
  "body": {
    "vote": "JA"
  }
}
```

命令处理只认：

- 云函数上下文 openid
- 当前房间成员身份
- 当前游戏版本
- 当前阶段

绝不信任前端传入的：

- `memberId`
- `seatIndex`
- `role`

### 8.3.3 `getResultSnapshot`

仅当：

- 房间 `status === ended`
- 当前 openid 是本局成员

才允许返回。

返回内容：

- 胜利阵营
- 胜利原因
- 最终身份
- 关键事件时间线

## 8.4 `maintenanceService`

这是内部定时函数，不对前端暴露。

职责：

- 清理空房间
- 清理已过期大厅
- 清理已结束超时房间
- 清理过期命令记录
- 清理过期快照
- 清理已失效房间关联的 `room_members` 状态

建议每 10 分钟执行一次。

## 9. 房间与游戏状态机设计

## 9.1 房间生命周期

```text
lobby -> in_game -> ended -> expired
```

状态说明：

- `lobby`：组局中
- `in_game`：已开局
- `ended`：已结算，允许复盘
- `expired`：已失效，不再可访问

终局落库要求：

- `game_core.status = ended`
- `game_core.phase = game_ended`
- `game_core.endedAt` 写入服务器时间
- `rooms.status = ended`
- `rooms.endedAt` 写入服务器时间
- `room_public_snapshots.snapshotType = result_public`
- 所有 `player_private_snapshots.roomStatus = ended`

## 9.2 游戏主阶段

| 阶段 | 是否等待玩家输入 | 唯一合法操作者 |
| --- | --- | --- |
| `nomination` | 是 | 当前总统候选人 |
| `voting` | 是 | 全体存活玩家 |
| `hitler_check` | 否 | 系统 |
| `legislative_president` | 是 | 当前总统 |
| `legislative_chancellor` | 是 | 当前总理 |
| `veto_response` | 是 | 当前总统 |
| `executive_action` | 是 | 当前总统 |
| `round_result` | 否 | 系统 |
| `game_ended` | 否 | 系统 |

实现原则：

- `hitler_check` 与 `round_result` 是内部自动阶段
- 一次命令处理结束后，持久化的最终阶段应尽量落在“下一个等待玩家输入的阶段”
- 前端理论上允许识别全部阶段枚举，但正常情况下很少观察到 `hitler_check` 和 `round_result`

## 9.3 `phaseData` 结构定义

### `nomination`

```json
{
  "presidentCandidateId": "mem_1",
  "eligibleChancellorIds": ["mem_2", "mem_4", "mem_5"]
}
```

### `voting`

```json
{
  "presidentCandidateId": "mem_1",
  "chancellorCandidateId": "mem_4",
  "ballots": {
    "mem_1": { "submitted": true, "vote": "JA" },
    "mem_2": { "submitted": false, "vote": null }
  }
}
```

### `legislative_president`

```json
{
  "presidentId": "mem_1",
  "cards": ["FASCIST", "LIBERAL", "FASCIST"]
}
```

### `legislative_chancellor`

```json
{
  "chancellorId": "mem_4",
  "cards": ["LIBERAL", "FASCIST"],
  "vetoAllowed": false
}
```

### `veto_response`

```json
{
  "presidentId": "mem_1",
  "chancellorId": "mem_4",
  "cards": ["LIBERAL", "FASCIST"]
}
```

### `executive_action`

```json
{
  "presidentId": "mem_1",
  "actionType": "INVESTIGATE",
  "allowedTargetIds": ["mem_2", "mem_3"]
}
```

### `round_result`

```json
{
  "reason": "POLICY_ENACTED",
  "lastPolicy": "FASCIST"
}
```

## 10. 规则实现细节

## 10.1 人数与身份配置

角色配置必须固化在代码表中：

```ts
export const ROLE_PRESET_BY_PLAYER_COUNT = {
  5: ["LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "HITLER"],
  6: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "HITLER"],
  7: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "FASCIST", "HITLER"],
  8: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "FASCIST", "HITLER"],
  9: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "FASCIST", "FASCIST", "HITLER"],
  10: ["LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "FASCIST", "FASCIST", "FASCIST", "HITLER"]
} as const;
```

实现方式：

1. 取当前有效成员，按 `seatIndex` 排序
2. 复制对应角色数组
3. 随机打乱角色数组
4. 逐个映射到成员

## 10.2 队友可见信息生成

规则如下：

- 普通极权派始终知道所有普通极权派和独裁者
- `5-6` 人局的独裁者知道普通极权派
- `7-10` 人局的独裁者不知道普通极权派
- 自由派没有已知队友

因此 `roleAssignments[memberId].knownMemberIds` 在开局时一次性写入，不在游戏中变化。

## 10.3 牌堆实现

政策牌使用数组表示：

```ts
const initialDeck: PolicyType[] = [
  "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL", "LIBERAL",
  "FASCIST", "FASCIST", "FASCIST", "FASCIST", "FASCIST", "FASCIST",
  "FASCIST", "FASCIST", "FASCIST", "FASCIST", "FASCIST"
];
```

洗牌使用 Fisher-Yates。

### 抽牌规则

统一实现 `drawPolicies(state, count)`：

1. 若 `drawPile.length < count`，先将 `drawPile + discardPile` 混洗为新牌堆
2. 从牌顶取前 `count` 张
3. 更新 `drawPile`
4. 若是常规立法回合结束且 `drawPile.length < 3`，立即为下一轮预洗

说明：

- 预洗只是维护 `drawPile`，不改变当前玩家手里的 `cards`
- 只允许后端修改牌顺序

## 10.4 首任总统生成

开局后随机生成一个 `seatIndex` 对应的成员作为首任总统候选人，写入：

- `currentPresidentCandidateId`
- `phase = nomination`

身份信息生成后即进入首轮 `nomination`。玩家可从对局桌面页点击“我的身份”查看，不影响阶段推进。

## 10.5 提名资格计算

统一实现：

```ts
getEligibleChancellorIds(state): string[]
```

逻辑顺序：

1. 只看 `aliveMemberIds`
2. 排除当前总统候选人自己
3. 若 `aliveCount > 5`，排除上一届当选政府的总统
4. 永远排除上一届当选政府的总理
5. 三连败触发混乱政策后，`previousElectedPresidentId` 和 `previousElectedChancellorId` 清空

注意：

- 任期限制只看“上一届当选政府”
- 被提名失败的组合不进入限制
- 特别选举只改变“下一轮总统候选人”，不改变这个资格函数本身

## 10.6 投票提交与揭示

每次 `SUBMIT_VOTE`：

1. 校验操作者必须存活
2. 校验当前阶段必须是 `voting`
3. 若该玩家已提交过投票：
   - 同一 `commandId` 返回幂等成功
   - 不同 `commandId` 拒绝，错误码 `ACTION_NOT_ALLOWED`
4. 写入 `phaseData.ballots[memberId]`
5. 若未全部提交，阶段不变
6. 若全部提交，则立即结算并生成公开投票结果

结算规则：

- `jaCount > floor(aliveCount / 2)` 才算通过
- 平票按失败

投票结果一旦揭示，应写入事件：

- `VOTES_REVEALED`

并同步到公共快照。

## 10.7 政府通过后的即时独裁者判定

当投票通过时：

1. 写入：
   - `currentPresidentId`
   - `currentChancellorId`
   - `previousElectedPresidentId`
   - `previousElectedChancellorId`
2. `electionTracker = 0`
3. 若当前 `fascistPolicyCount >= 3`：
   - 检查总理角色是否为 `HITLER`
   - 若是，则直接结束游戏，极权派胜
   - 若不是，把该总理加入 `confirmedNotHitlerMemberIds`

只有通过这个检查后，才进入立法阶段。

## 10.8 三连败与混乱政策

投票失败后：

1. `electionTracker += 1`
2. 若 `< 3`：
   - 正常轮换到下一位总统候选人
   - 进入下一轮 `nomination`
3. 若 `=== 3`：
   - 翻开牌顶 1 张直接颁布
   - 忽略总统权力
   - `electionTracker = 0`
   - `previousElectedPresidentId = null`
   - `previousElectedChancellorId = null`
   - 检查政策胜负
   - 若未结束，进入下一轮 `nomination`

## 10.9 立法阶段

### 总统阶段

`PRESIDENT_DISCARD_POLICY`：

1. 当前阶段必须是 `legislative_president`
2. 当前操作者必须是 `currentPresidentId`
3. `discardPolicyIndex` 必须在 `[0, 1, 2]`
4. 被弃牌进入 `discardPile`
5. 剩余两张写入 `phaseData.cards`
6. 转为 `legislative_chancellor`

### 总理阶段

`CHANCELLOR_ENACT_POLICY`：

1. 当前阶段必须是 `legislative_chancellor`
2. 当前操作者必须是 `currentChancellorId`
3. `enactPolicyIndex` 必须在 `[0, 1]`
4. 未选中的另一张进入 `discardPile`
5. 选中的政策推进轨道
6. 检查胜负
7. 若未结束，再判断是否触发权力

## 10.10 否决权

实现约束：

- `vetoUnlocked` 只有在第 5 张极权派政策颁布之后，才从“后续立法阶段”生效
- 当前立法阶段是否可否决，取决于进入 `legislative_chancellor` 时的 `vetoUnlocked`

`CHANCELLOR_REQUEST_VETO`：

1. 当前阶段必须是 `legislative_chancellor`
2. `phaseData.vetoAllowed === true`
3. 切换到 `veto_response`

`PRESIDENT_RESPOND_VETO`：

1. 当前阶段必须是 `veto_response`
2. 若 `accepted === true`：
   - 两张牌全部进 `discardPile`
   - `electionTracker += 1`
   - 若达到 `3`，按三连败处理
   - 否则直接进入下一轮提名
3. 若 `accepted === false`：
   - 回到 `legislative_chancellor`
   - 原两张牌保持不变

特别注意：

- 否决不会清空上一届政府任期限制
- 否决发生后，下一轮的总理提名限制仍基于这届已经当选的政府

## 10.11 总统权力映射

统一配置表：

```ts
export const EXECUTIVE_POWER_TRACK = {
  5: { 3: "POLICY_PEEK", 4: "EXECUTION", 5: "EXECUTION" },
  6: { 3: "POLICY_PEEK", 4: "EXECUTION", 5: "EXECUTION" },
  7: { 2: "INVESTIGATE", 3: "SPECIAL_ELECTION", 4: "EXECUTION", 5: "EXECUTION" },
  8: { 2: "INVESTIGATE", 3: "SPECIAL_ELECTION", 4: "EXECUTION", 5: "EXECUTION" },
  9: { 1: "INVESTIGATE", 2: "INVESTIGATE", 3: "SPECIAL_ELECTION", 4: "EXECUTION", 5: "EXECUTION" },
  10: { 1: "INVESTIGATE", 2: "INVESTIGATE", 3: "SPECIAL_ELECTION", 4: "EXECUTION", 5: "EXECUTION" }
} as const;
```

### 调查忠诚

校验：

- 目标必须存活
- 目标不能重复被调查

落库：

- 将目标加入 `investigatedMemberIds`
- 仅在当前总统私密快照中写入结果 `party`
- 公共事件只公开目标，不公开结果

### 特别选举

校验：

- 目标必须存活
- 目标必须不是总统自己

落库：

- `specialElectionCallerId = currentPresidentId`
- `forcedNextPresidentId = targetMemberId`

在本回合结束进入下一轮时：

- 先使用 `forcedNextPresidentId`
- 特别选举结束后，再回到 `specialElectionCallerId` 左手边继续正常轮换
- 消费完成后清空：
  - `forcedNextPresidentId`
  - `specialElectionCallerId`

### 政策预览

执行：

1. 查看牌顶 3 张
2. 写入当前总统私密快照
3. 等待 `EXEC_POLICY_PEEK_ACK`
4. `ACK` 后直接进入下一轮

### 处决

校验：

- 目标必须存活
- 目标可以是当前总统本人，不额外排除操作者自己

执行：

1. 从 `aliveMemberIds` 移除目标
2. 加入 `deadMemberIds`
3. 若目标角色是 `HITLER`，自由派立即胜利
4. 若不是独裁者，不公开身份

说明：

- 规则明确允许总统处决自己，后端不得在 `EXECUTE_PLAYER` 中加入“不能选择自己”的限制

## 11. 轮换与回合推进算法

## 11.1 获取下一位总统候选人

统一实现：

```ts
getNextPresidentCandidateId(state, membersBySeat): string
```

逻辑顺序：

1. 若存在 `forcedNextPresidentId`，本轮直接返回它
2. 否则按当前总统候选人或当前总统所在座位顺时针，找到下一位存活成员
3. 若处于“特别选举结束后的恢复轮换”：
   - 从 `specialElectionCallerId` 左手边开始继续

## 11.2 自动推进器

实现一个纯函数：

```ts
advanceSystemPhases(state): {
  nextState: GameState;
  events: DomainEvent[];
}
```

它负责处理：

- `hitler_check`
- `round_result`
- 自动开始下一轮提名
- 自动结束游戏

约束：

- 自动推进器只处理“不需要玩家输入”的阶段
- 一次命令处理结束前，必须循环执行到下一个交互阶段或终局
- 一旦检测到 `winner`，自动推进器负责同步切换 `game_core` 与 `rooms` 的结束态，并触发结果快照投影

## 12. 命令处理流水线

## 12.1 统一处理步骤

`submitCommand` 固定按以下顺序执行：

1. 解析 envelope，生成 `requestId`
2. 从云函数上下文获取 `openid`
3. 定位房间成员
4. 读取 `rooms`、`game_core`
5. 校验房间与游戏状态
6. 检查 `command_records`
7. 校验 `expectedVersion`
8. 若请求带 `taskId`，校验其与当前玩家待办任务一致
9. 调用纯领域函数 `applyCommand`
10. 调用 `advanceSystemPhases`
11. 持久化 `game_core`
12. 写事件日志
13. 重建公共快照
14. 重建全部私密快照
15. 写入 `command_records`
16. 返回标准响应

## 12.2 事务边界

大厅阶段写操作和游戏阶段命令写操作，都使用单事务提交。

单次事务内允许修改的典型文档数：

- `rooms`
- 若干 `room_members`
- `game_core`
- `command_records`
- `game_events`
- `room_public_snapshots`
- 最多 10 条 `player_private_snapshots`

这样做的原因：

- 房间最大只有 10 人
- 快照重建成本可接受
- 能保证“写入成功后所有玩家读取到同一版本”

## 12.3 幂等规则

### 游戏内命令

使用：

- `scopeKey = room:${roomId}`
- `commandRecordId = scopeKey + ":" + commandId`

处理规则：

1. 若存在相同 `commandRecordId` 且结果为 `applied`，直接按幂等成功返回
2. 若存在但 `requesterOpenId` 不同，视为非法冲突，返回 `ACTION_NOT_ALLOWED`
3. 若存在但 `payloadHash` 不一致，返回 `DUPLICATE_COMMAND`
4. 若不存在，继续处理

### 大厅写操作

大厅写操作必须带 `commandId`，不再保留退化时间窗方案。

作用域规则：

- `createRoom`、`joinRoom`：`scopeKey = user:${openid}`
- `leaveRoom`、`setReady`、`startGame`：`scopeKey = room:${roomId}`

处理规则与游戏内命令一致：

1. 相同 `scopeKey + commandId` 且 `payloadHash` 相同，返回幂等成功
2. 相同 `scopeKey + commandId` 但 `payloadHash` 不同，返回 `DUPLICATE_COMMAND`
3. 缺少 `commandId` 直接返回 `INVALID_PAYLOAD`

## 12.4 版本冲突规则

`expectedVersion` 仅用于游戏内命令。

判断：

- 若 `expectedVersion !== game_core.version`，直接拒绝 `VERSION_CONFLICT`
- 前端应立即调用 `getGameSnapshot` 重新获取最新快照

## 12.5 命令处理纯函数接口

推荐定义：

```ts
type ApplyCommandInput = {
  state: GameState;
  actorMemberId: string;
  command: GameCommand;
  now: string;
};

type ApplyCommandResult = {
  nextState: GameState;
  events: DomainEvent[];
};
```

要求：

- 不在纯函数里直接访问数据库
- 不在纯函数里直接打日志
- 不在纯函数里生成快照

## 13. 投影与快照生成

## 13.1 大厅快照生成

`buildLobbySnapshot(room, members, myMemberId)` 输出必须至少包含：

- `roomId`
- `roomCode`
- `roomStatus`
- `hostMemberId`
- `playerCount`
- `targetPlayerCount`
- `minPlayerCount`
- `maxPlayerCount`
- `seatOrder`
- `myMemberId`
- `canStart`
- `version`

`canStart` 计算方式：

- 房主本人查看时：人数合法且所有有效成员已准备
- 非房主查看时：仅作展示，不赋予操作权限

## 13.2 游戏公共快照生成

`publicState` 建议固定生成以下字段：

```json
{
  "seatOrder": [
    {
      "memberId": "mem_1",
      "displayName": "玩家A",
      "avatarUrl": "cloud://xxx/avatar/openid.png",
      "seatIndex": 1,
      "isAlive": true,
      "isOffline": false,
      "confirmedNotHitler": false
    }
  ],
  "currentPresidentCandidateId": "mem_1",
  "currentChancellorCandidateId": "mem_4",
  "currentPresidentId": null,
  "currentChancellorId": null,
  "previousElectedPresidentId": "mem_5",
  "previousElectedChancellorId": "mem_2",
  "electionTracker": 1,
  "liberalPolicyCount": 2,
  "fascistPolicyCount": 3,
  "vetoUnlocked": false,
  "executiveActionType": null,
  "voteProgress": {
    "submittedCount": 3,
    "requiredCount": 7
  },
  "revealedVotes": null,
  "publicHistory": []
}
```

公共快照绝不包含：

- 角色映射
- 牌堆顺序
- 玩家手牌
- 调查结果
- 牌顶预览内容

## 13.3 私密快照生成

`privateState` 建议固定包含以下模块：

```json
{
  "identity": {
    "role": "FASCIST",
    "party": "FASCIST",
    "knownMembers": [
      { "memberId": "mem_2", "displayName": "玩家B", "avatarUrl": "cloud://xxx/avatar/openid-b.png" }
    ]
  },
  "voting": {
    "submitted": true,
    "myVote": "JA"
  },
  "legislative": {
    "hand": ["LIBERAL", "FASCIST"],
    "action": "enact_one",
    "canRequestVeto": false
  },
  "investigationResult": null,
  "policyPeek": null
}
```

## 13.4 `pendingTask` 生成规则

### `nomination`

总统候选人：

```json
{
  "taskId": "game_xxx:19:NOMINATE_CHANCELLOR:mem_1",
  "taskType": "NOMINATE_CHANCELLOR",
  "required": true,
  "deadline": null,
  "allowedTargets": ["mem_2", "mem_4", "mem_5"],
  "meta": {
    "ruleHint": "上一届当选政府成员不能再次组成政府；若仅存活 5 人则放宽总统限制"
  }
}
```

### `voting`

未投票的存活玩家：

```json
{
  "taskId": "game_xxx:20:SUBMIT_VOTE:mem_2",
  "taskType": "SUBMIT_VOTE",
  "required": true,
  "deadline": null,
  "allowedTargets": [],
  "meta": {
    "options": ["JA", "NEIN"]
  }
}
```

### `legislative_president`

```json
{
  "taskId": "game_xxx:21:PRESIDENT_DISCARD_POLICY:mem_1",
  "taskType": "PRESIDENT_DISCARD_POLICY",
  "required": true,
  "deadline": null,
  "allowedTargets": [],
  "meta": {
    "selectionMode": "discard_one"
  }
}
```

### `legislative_chancellor`

```json
{
  "taskId": "game_xxx:22:CHANCELLOR_ENACT_POLICY:mem_4",
  "taskType": "CHANCELLOR_ENACT_POLICY",
  "required": true,
  "deadline": null,
  "allowedTargets": [],
  "meta": {
    "selectionMode": "enact_one",
    "canRequestVeto": false
  }
}
```

### `veto_response`

```json
{
  "taskId": "game_xxx:23:PRESIDENT_RESPOND_VETO:mem_1",
  "taskType": "PRESIDENT_RESPOND_VETO",
  "required": true,
  "deadline": null,
  "allowedTargets": [],
  "meta": {
    "options": [true, false],
    "requestedByMemberId": "mem_4"
  }
}
```

### `executive_action`

按 actionType 映射：

- `INVESTIGATE` -> `EXEC_INVESTIGATE`
- `SPECIAL_ELECTION` -> `EXEC_SPECIAL_ELECTION`
- `POLICY_PEEK` -> `EXEC_POLICY_PEEK_ACK`
- `EXECUTION` -> `EXECUTE_PLAYER`

推荐 `meta`：

- `EXEC_INVESTIGATE`：`actionTitle`、`actionHint`
- `EXEC_SPECIAL_ELECTION`：`actionTitle`、`actionHint`
- `EXEC_POLICY_PEEK_ACK`：可为空，允许补充 `confirmText`
- `EXECUTE_PLAYER`：`actionTitle`、`actionHint`、`dangerConfirmText`

## 14. 错误处理与日志

## 14.1 错误码落地原则

严格使用 `/docs/front_back_api.md` 已定义错误码：

- `INVALID_PAYLOAD`
- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `ROOM_FULL`
- `ROOM_NOT_JOINABLE`
- `NOT_ROOM_MEMBER`
- `NOT_ROOM_HOST`
- `INVALID_PLAYER_COUNT`
- `NOT_ALL_READY`
- `GAME_NOT_STARTED`
- `GAME_ALREADY_STARTED`
- `GAME_ALREADY_ENDED`
- `PHASE_MISMATCH`
- `VERSION_CONFLICT`
- `DUPLICATE_COMMAND`
- `NOT_CURRENT_ACTOR`
- `INVALID_TARGET`
- `TARGET_ALREADY_DEAD`
- `TARGET_ALREADY_INVESTIGATED`
- `ACTION_NOT_ALLOWED`
- `INTERNAL_ERROR`

不新增新错误码，除非先同步修改 API 文档。

## 14.2 错误与 retryable 约定

建议：

- `VERSION_CONFLICT`：`retryable = true`
- `INTERNAL_ERROR`：`retryable = true`
- `ROOM_EXPIRED`：`retryable = false`
- `PHASE_MISMATCH`：`retryable = false`
- `NOT_CURRENT_ACTOR`：`retryable = false`

## 14.3 日志字段

所有云函数统一日志字段：

- `requestId`
- `action`
- `roomId`
- `gameId`
- `memberId`
- `commandId`
- `taskId`
- `expectedVersion`
- `resolvedVersion`
- `phase`
- `durationMs`
- `success`
- `errorCode`

禁止把以下内容直接打到普通日志：

- 全量角色映射
- 玩家手牌
- 调查结果
- 牌顶预览

若排障确需记录，只能写入 `internalPayload` 事件，不写普通控制台日志。

## 15. 安全、隐私与恢复

## 15.1 鉴权原则

永远以云函数上下文中的 `OPENID` 为准。

权限判定顺序固定：

1. openid
2. room_members 映射
3. room 状态
4. game 状态
5. phase 和目标合法性

## 15.2 私密信息最小暴露

以下数据只允许存在于 `game_core`：

- `roleAssignments`
- `drawPile`
- `discardPile`
- `presidentHand`
- `chancellorHand`
- `peekPile`
- 调查真实结果

私密快照中只允许出现“当前玩家应该看到的那一份切片”。

## 15.3 断线恢复

每次成功调用任意后端接口，都更新：

- `room_members.lastSeenAt`

恢复流程：

1. 小程序启动时调用 `ensureSession`
2. 进入首页后调用 `recoverActiveRoom`
3. 若存在活跃房间，则直接跳转到对应页面
4. 游戏内页面 `onShow` 必须立即补拉 `getGameSnapshot`

## 15.4 开局后离线策略

MVP 不做自动托管或自动跳过。

也就是说：

- 关键阶段玩家离线，游戏继续停在当前阶段
- 其他玩家只能等待其恢复
- 后端不会代替玩家自动投票、自动弃牌、自动立法

这是和 PRD “一致性优先于弱实时”的要求一致的。

## 16. 清理与过期策略

## 16.1 房间过期规则

- `lobby`：最后一次有效操作后 2 小时过期
- `in_game`：最后一次有效操作后 12 小时过期
- `ended`：结束后保留 24 小时，再转 `expired`

## 16.2 过期处理动作

当 `maintenanceService` 发现房间过期时：

1. 把 `rooms.status` 标记为 `expired`
2. 将相关 `room_members` 标记为失效或随房间归档清理
3. 删除或失效：
   - `room_public_snapshots`
   - `player_private_snapshots`
4. 保留或延迟清理：
   - `game_events`
   - `command_records`

建议：

- `game_events` 额外保留 24 小时用于排障
- `command_records` 额外保留 24 小时用于幂等审计

## 17. 测试方案

## 17.1 单元测试

必须覆盖：

- 各人数角色配置
- 开局队友可见性
- 提名资格计算
- 投票通过/失败/平票
- 三连败混乱政策
- 独裁者当选即时判定
- 立法弃牌流程
- 否决逻辑
- 各人数权力触发
- 特别选举轮换恢复
- 处决与胜负判定

## 17.2 集成测试

必须覆盖整局流程：

1. `createRoom -> joinRoom -> setReady -> startGame`
2. 身份切片生成后直接进入首轮提名
3. 正常提名、投票、立法
4. 权力执行
5. 终局结算
6. 结果读取

还要覆盖异常流：

- 重复点击同一命令
- 旧版本命令
- 非当前行动人提交
- 死者继续投票
- 对已调查目标再次调查
- 房主大厅离开
- 游戏中断线恢复

## 17.3 固定随机测试

为了保证可重复测试，领域层的随机逻辑要抽象为 `RandomProvider`：

```ts
export interface RandomProvider {
  shuffle<T>(items: T[]): T[];
  randomInt(maxExclusive: number): number;
}
```

生产环境使用真实随机，测试环境使用固定 seed。

## 18. 开发顺序建议

按以下顺序实现，风险最低：

1. 先搭建 TypeScript 后端工程和四个云函数入口
2. 实现 `rooms / room_members` 仓储
3. 实现 `createRoom / joinRoom / getLobbySnapshot`
4. 实现 `startGame` 和开局身份生成
5. 实现纯领域状态机与 `submitCommand`
6. 实现快照投影器
7. 实现 `getGameSnapshot / getResultSnapshot`
8. 实现 `maintenanceService`
9. 补齐测试与日志

## 19. 最终落地要求

后续实际编码时必须满足以下要求：

1. 不允许前端直接写任何核心集合
2. 不允许在云函数入口文件中直接写规则判断
3. 不允许跳过事件日志只维护最终快照
4. 不允许只更新公共快照、不更新私密快照
5. 不允许为了“减少一次查询”而把完整真相下发给前端

如果后续实现严格按本文档执行，则本项目后端会具备：

- 正确的规则裁判能力
- 清晰的读写边界
- 可恢复的房间上下文
- 可测试的状态机
- 可排障的事件日志
- 可扩展的后续联机同步基础
