# 《secret hitler》前后端交互 API 详细设计

## 1. 文档目标

本文档用于统一《secret hitler》微信小程序的前后端交互协议，覆盖：

- 云函数 action 划分
- 请求与响应 envelope
- 大厅视图响应、对局 / 结果快照 DTO
- 游戏命令结构与幂等规则
- 轮询读取方式
- 错误码与联调边界

后续所有前后端实现都必须以本文档为准；若请求字段、响应字段、命令类型、错误码发生变化，必须先更新本文档，再更新实现。

本文档解决的问题不是“数据库怎么存”，而是“前端以什么协议读写、后端以什么协议返回，以及双方如何避免口头约定漂移”。

## 2. 总体交互原则

## 2.1 统一交互通道

前后端交互只允许统一云函数通道。

统一使用 `wx.cloud.callFunction`，用于：

- 创建房间
- 加入房间
- 修改大厅状态
- 发起游戏命令
- 主动拉取大厅视图或对局快照

MVP 阶段前端不直接读取或监听任何数据库集合，包括已裁剪的投影视图集合。大厅视图与对局快照都必须通过云函数 action 获取。

## 2.2 命令与读取视图分离

本项目必须采用“命令写入，读取后端确认视图”的模式：

- 前端提交的是意图
- 后端返回的是已确认状态
- 前端不能用本地按钮点击直接推断状态已推进

大厅等待阶段不存在角色、手牌、牌堆、投票等私密游戏真相，也不区分公共视图与个人私密视图。大厅页读取的是由 `rooms` 与 `room_members` 实时组装的大厅视图响应，不写入 `room_public_snapshots`。

## 2.3 前端禁止直接写核心集合

前端不得直接写入以下任何集合：

- `rooms`
- `room_members`
- `game_core`
- `game_events`
- `command_records`

所有状态变更必须通过云函数完成。

## 2.4 对局公共视图与私密视图分离

进入对局后，后端对前端暴露的数据必须分为：

- 公共快照
- 当前玩家私密快照

前端不允许拿到完整真相后自行隐藏字段。

## 3. 统一协议基础

## 3.1 云函数划分

MVP 阶段固定为以下三类对外云函数：

| 云函数 | 职责 | 允许 action |
| --- | --- | --- |
| `bootstrapService` | 会话初始化与活跃房间恢复 | `ensureSession`、`recoverActiveRoom`、`clearActiveRoom` |
| `roomService` | 大厅阶段与房间生命周期 | `createRoom`、`joinRoom`、`leaveRoom`、`getLobbySnapshot`、`setReady` |
| `gameService` | 游戏开局、对局快照、命令处理、结果快照 | `startGame`、`getGameSnapshot`、`submitCommand`、`getResultSnapshot` |

说明：

- 游戏开局走 `gameService.startGame`，游戏内所有可变更状态操作统一走 `gameService.submitCommand`
- 不为每个游戏动作拆分独立云函数
- `maintenanceService` 仅供定时任务使用，不对前端暴露

## 3.2 统一请求结构

所有云函数请求统一采用：

```json
{
  "action": "actionName",
  "payload": {}
}
```

约束：

- `action` 必须显式声明
- `payload` 永远存在，读接口传空对象 `{}` 即可
- 所有写操作都必须携带 `commandId`
- 除 `startGame` 外，所有游戏内写操作都必须额外携带 `expectedVersion`

## 3.3 统一响应 envelope

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {}
}
```

失败响应：

```json
{
  "success": false,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "error": {
    "code": "PHASE_MISMATCH",
    "message": "当前阶段不允许该操作",
    "retryable": false
  }
}
```

字段约束：

- `requestId` 由后端生成，用于日志串联
- `serverTime` 统一使用 ISO 字符串
- `message` 面向调试与兜底提示，前端正式文案应基于 `code` 本地映射

## 3.4 `commandId` 规则

所有会改变状态的请求都必须带 `commandId`：

- 大厅写操作：`createRoom`、`joinRoom`、`leaveRoom`、`setReady`
- 游戏写操作：`startGame`、`submitCommand`

用途：

- 幂等保护
- 重试请求去重
- 日志链路追踪

约束：

- `commandId` 由前端生成
- 同一逻辑动作重试时必须复用同一个 `commandId`
- 同一玩家的不同动作不得复用同一个 `commandId`

## 3.5 `expectedVersion` 规则

只有游戏内命令需要携带 `expectedVersion`。

用途：

- 后端识别前端是否基于旧快照发起请求
- 阻止基于过期状态的误操作

规则：

- `expectedVersion` 必须等于当前 `game_core.version`
- 不相等时直接返回 `VERSION_CONFLICT`
- 前端收到 `VERSION_CONFLICT` 后应立即刷新 `getGameSnapshot`

## 3.6 会话与身份规则

后端识别操作者时必须优先使用微信云函数上下文身份。

禁止：

- 仅信任前端传入的 `memberId`
- 仅信任前端传入的 `playerId`
- 仅根据 `roomCode` 判定权限

前端可以持有但不能视为最终权限依据的字段：

- `roomId`
- `roomCode`
- `memberId`
- `displayName`

## 3.7 API 版本

当前协议版本固定为 `v1`。

MVP 阶段不要求前端在每个请求显式传 `apiVersion`，但后续如发生不兼容变更，必须通过以下任一方式升级：

- 增加显式版本字段
- 新增 action
- 新增云函数

禁止静默修改既有结构。

## 4. DTO 详细设计

## 4.1 `ActiveRoomSummary`

用于会话恢复与路由跳转判断。

```json
{
  "roomId": "room_xxx",
  "roomCode": "482615",
  "roomStatus": "in_game",
  "memberId": "mem_xxx",
  "routeHint": "board",
  "version": 18,
  "updatedAt": "2026-04-12T12:00:00.000Z"
}
```

字段约束：

- `routeHint` 只允许为 `lobby`、`board`、`result`
- `version` 为当前房间版本；大厅时对应 `rooms.version`，对局时对应游戏版本

## 4.2 `LobbyView`

`roomService.getLobbySnapshot` 返回的 `data`、以及 `createRoom` / `joinRoom` / 大厅写操作返回中的 `lobbySnapshot`，都必须使用以下结构。

说明：这里沿用 `getLobbySnapshot` 与 `lobbySnapshot` 命名是为了保持前后端接口稳定；它表示“大厅视图响应”，不是落库的公共快照文档。

```json
{
  "roomId": "room_xxx",
  "roomCode": "482615",
  "roomStatus": "lobby",
  "hostMemberId": "mem_host",
  "playerCount": 6,
  "targetPlayerCount": 7,
  "minPlayerCount": 5,
  "maxPlayerCount": 10,
  "seatOrder": [
    {
      "memberId": "mem_host",
      "displayName": "玩家A",
      "avatarUrl": "cloud://xxx/room_assets/room_xxx/avatars/member_xxx.png",
      "seatIndex": 1,
      "isHost": true,
      "isReady": true
    }
  ],
	  "viewerState": {
	    "myMemberId": "mem_host",
	    "isHost": true,
	    "myIsReady": true,
	    "canStart": true
	  },
	  "version": 3,
	  "expireAt": "2026-04-12T12:30:00.000Z",
	  "updatedAt": "2026-04-12T12:00:00.000Z"
	}
```

字段约束：

- `targetPlayerCount` 来自创建房间页选择，用于大厅展示目标人数
- `seatOrder` 只包含当前有效大厅成员，MVP 顺序由加入顺序初始化
- `viewerState` 由后端根据当前 openid 与房间成员即时派生，只存在于 API 响应，不写入数据库
- `viewerState.canStart` 仅表示“从当前查看者视角是否满足开始条件”，不额外授予权限
- `expireAt` 为服务端房间阶段过期时间，前端页面超时以该字段校准
- 大厅视图绝不包含角色、党派、牌堆、投票等游戏真相
- 大厅阶段不维护 `room_public_snapshots` 或 `player_private_snapshots`

## 4.3 `GameSnapshot`

`gameService.getGameSnapshot` 返回结构固定如下：

```json
{
  "roomId": "room_xxx",
  "roomCode": "482615",
  "roomStatus": "in_game",
  "myMemberId": "mem_2",
  "version": 18,
  "round": 3,
  "currentPhase": "voting",
  "publicState": {},
  "privateState": {},
	  "pendingTask": null,
	  "serverHints": [],
	  "expireAt": "2026-04-12T14:00:00.000Z",
	  "updatedAt": "2026-04-12T12:10:00.000Z"
	}
```

字段约束：

- `roomStatus` 在结果页前仍为 `in_game`
- `myMemberId` 由后端根据当前身份定位，不接受前端指定
- `publicState` 和 `privateState` 必须按本节定义生成
- `pendingTask` 为当前玩家待办；无待办时返回 `null`
- `expireAt` 为开局后固定 2 小时的服务端过期时间，游戏命令不延长该时间

## 4.4 `publicState`

`publicState` 必须只包含全体玩家可见信息，推荐固定如下：

```json
{
  "seatOrder": [
    {
      "memberId": "mem_1",
      "displayName": "玩家A",
      "avatarUrl": "cloud://xxx/room_assets/room_xxx/avatars/member_1.png",
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
  "policyDeck": {
    "drawCount": 9,
    "discardCount": 2
  },
  "vetoUnlocked": false,
  "executiveActionType": null,
  "voteProgress": {
    "submittedCount": 3,
    "requiredCount": 7
  },
  "revealedVotes": null,
  "history": {
    "roundsStarted": 4,
    "roundsCompleted": 3,
    "rounds": [
      {
        "round": 4,
        "status": "voting",
        "presidentId": "mem_1",
        "chancellorId": "mem_7",
        "voteSummary": {
          "ja": 0,
          "nein": 0,
          "required": 9,
          "revealed": false
        },
        "votes": [
          { "memberId": "mem_1", "state": "pending" },
          { "memberId": "mem_8", "state": "dead" }
        ],
        "outcome": {
          "type": "pending_vote",
          "label": "投票中"
        }
      }
    ]
  },
  "publicHistory": [
    {
      "eventId": "evt_game_xxx_18",
      "round": 3,
      "phase": "voting",
      "type": "GOVERNMENT_NOMINATED",
      "title": "总统提名总理",
      "summary": "玩家A 提名 玩家D 为总理候选人",
      "createdAt": "2026-04-12T12:09:50.000Z"
    }
  ]
}
```

字段说明：

- `seatOrder` 是游戏内座位主数据，前端所有目标选择与头像展示都应基于它
- `currentPresidentCandidateId` / `currentChancellorCandidateId` 表示“正在提名或正在投票的候选政府”
- `currentPresidentId` / `currentChancellorId` 表示“已当选并正在执政的政府”
- `previousElectedPresidentId` / `previousElectedChancellorId` 用于前端展示任期限制提示
- `policyDeck.drawCount` / `policyDeck.discardCount` 只表示抽牌堆和弃牌堆当前张数，用于公共桌面牌堆显示
- `revealedVotes` 在投票未公开前必须为 `null`；公开后为完整数组
- `history` 是局内历史记录页的公共投影，只能由公开事实生成，不得包含私密牌面、调查结果或未公开投票
- `publicHistory` 只写公共事实摘要，不写私密结果

禁止包含：

- 角色映射
- 牌堆顺序
- 牌堆构成
- 弃牌牌面
- 玩家手牌
- 调查结果
- 牌顶预览内容
- 未公开投票

### 4.4.1 `publicState.history`

`history` 用于 `packageRoom/pages/history/index` 渲染参考 `reference/09-历史记录页.png` 的总体情况与逐轮看板。它是公共快照的一部分，所有房间成员看到的内容一致。

```ts
interface PublicHistoryProjection {
  roundsStarted: number
  roundsCompleted: number
  rounds: Array<{
    round: number
    status:
      | 'nominating'
      | 'voting'
      | 'vote_failed'
      | 'legislating'
      | 'executing'
      | 'completed'
      | 'chaos'
      | 'game_ended'
    presidentId: string | null
    chancellorId: string | null
    voteSummary: {
      ja: number
      nein: number
      required: number
      revealed: boolean
    }
    votes: Array<{
      memberId: string
      state: 'ja' | 'nein' | 'dead' | 'pending' | 'not_started'
    }>
    outcome: {
      type:
        | 'pending_nomination'
        | 'pending_vote'
        | 'vote_failed'
        | 'pending_legislation'
        | 'liberal_policy'
        | 'fascist_policy'
        | 'vetoed'
        | 'chaos_policy'
        | 'win'
      label: string
      targetMemberId?: string
    }
    executiveResult: {
      type: 'investigation' | 'special_election' | 'policy_peek' | 'execution'
      text: string
      presidentMemberId: string
      presidentSeatIndex: number
      targetMemberId?: string
      targetSeatIndex?: number
    } | null
  }>
}
```

生成规则：

- `roundsStarted` 表示已经创建或进入过的轮次，包含当前未完成轮。
- `roundsCompleted` 表示已经完成结算并离开该轮的轮次数；当前轮仍在提名、投票、立法或执行阶段时不计入完成。
- 投票未公开前，`voteSummary.revealed = false`，`ja/nein = 0`，存活玩家 `votes.state = pending` 或 `not_started`，不得返回真实单人票。
- 投票公开后，`votes` 必须包含本轮所有座位成员；已出局玩家使用 `dead`。
- 总统弃牌、总理弃牌、调查忠诚结果、政策预览牌面不得写入 `history`。
- `outcome` 只表达本轮提名 / 投票 / 政策 / 胜负结算；总统权力不得写入 `outcome`，避免历史看板把阶段状态误当作本轮结算。
- `executiveResult` 只在总统权力完成后出现，用于前端在投票列表下方显示一行公开结果，例如“5号总统处决了6号玩家”“5号总统特别任命了6号玩家”“5号总统调查了6号玩家”“5号总统查看了政策牌堆顶”。
- `executiveResult.targetMemberId` 只用于公开目标，例如调查目标、特别总统、处决目标；不得用于表示私密结果。

## 4.5 `privateState`

`privateState` 只允许包含当前玩家个人视角所需信息，固定结构如下：

```json
{
  "identity": {
    "role": "FASCIST",
    "party": "FASCIST",
    "knownMembers": [
      {
        "memberId": "mem_3",
        "displayName": "玩家C"
      }
    ]
  },
  "voting": {
    "submitted": true,
    "myVote": "JA"
  },
  "legislative": {
    "hand": ["FASCIST", "LIBERAL"],
    "action": "enact_one",
    "canRequestVeto": false
  },
  "investigationResult": null,
  "policyPeek": null
}
```

字段说明：

- `identity` 在整局有效，用于身份页展示当前玩家自己的身份
- `knownMembers` 只包含按规则可见的队友信息
- `voting.myVote` 仅当前玩家可见
- `legislative.hand` 只在当前玩家持牌阶段出现，否则为 `null`
- `investigationResult` 在总统调查后对该总统个人可见
- `policyPeek` 在总统预览牌顶后对该总统个人可见

推荐子结构：

```json
{
  "investigationResult": {
    "targetMemberId": "mem_5",
    "targetDisplayName": "玩家E",
    "party": "LIBERAL",
    "revealedAt": "2026-04-12T12:11:10.000Z"
  },
  "policyPeek": {
    "cards": ["FASCIST", "FASCIST", "LIBERAL"],
    "viewedAt": "2026-04-12T12:12:30.000Z"
  }
}
```

## 4.6 `pendingTask`

`pendingTask` 用于告诉前端当前玩家是否必须操作。结构固定为：

```json
{
  "taskId": "game_xxx:20:SUBMIT_VOTE:mem_2",
  "taskType": "SUBMIT_VOTE",
  "required": true,
  "deadline": null,
  "allowedTargets": [],
  "meta": {}
}
```

字段约束：

- `taskId` 由后端生成，前端只能回传不能伪造语义
- `taskType` 必须与命令类型一一对应；唯一例外是 `CHANCELLOR_REQUEST_VETO` 作为 `CHANCELLOR_ENACT_POLICY` 阶段的可选子动作，不单独生成任务卡
- `allowedTargets` 是权威目标列表；前端不得自行扩大
- `meta` 只放“无法从快照其他字段可靠推导”的附加信息；目标类任务可在 `meta.targetOptions` 下发禁用原因供前端展示

正式 `meta` 契约如下：

| `taskType` | `meta` 字段 |
| --- | --- |
| `NOMINATE_CHANCELLOR` | `ruleHint`、`targetOptions = [{ memberId, canNominate, disabledReason }]` |
| `SUBMIT_VOTE` | `options = ["JA", "NEIN"]` |
| `PRESIDENT_DISCARD_POLICY` | `selectionMode = "discard_one"` |
| `CHANCELLOR_ENACT_POLICY` | `selectionMode = "enact_one"`、`canRequestVeto` |
| `PRESIDENT_RESPOND_VETO` | `options = [true, false]`、`requestedByMemberId` |
| `EXEC_INVESTIGATE` | `actionTitle`、`actionHint` |
| `EXEC_SPECIAL_ELECTION` | `actionTitle`、`actionHint` |
| `EXEC_POLICY_PEEK_ACK` | 可为空，允许补充 `confirmText` |
| `EXECUTE_PLAYER` | `actionTitle`、`actionHint`、`dangerConfirmText` |

## 4.7 `ResultSnapshot`

`gameService.getResultSnapshot` 返回结构固定如下：

```json
{
  "roomId": "room_xxx",
  "roomCode": "482615",
  "roomStatus": "ended",
  "myMemberId": "mem_2",
  "version": 32,
	  "winner": "LIBERAL",
	  "winReason": "HITLER_EXECUTED",
	  "endedAt": "2026-04-12T13:30:00.000Z",
	  "expireAt": "2026-04-12T14:00:00.000Z",
	  "policySummary": {
    "liberal": 3,
    "fascist": 5
  },
  "finalPlayers": [
    {
      "memberId": "mem_1",
      "displayName": "玩家A",
      "avatarUrl": "cloud://xxx/room_assets/room_xxx/avatars/member_1.png",
      "seatIndex": 1,
      "role": "LIBERAL",
      "party": "LIBERAL",
      "isAlive": true
    }
  ],
  "timeline": [
    {
      "eventId": "evt_game_xxx_32",
      "round": 6,
      "phase": "executive_action",
      "type": "PLAYER_EXECUTED",
      "title": "总统处决玩家",
      "summary": "玩家A 处决了 玩家E，系统判定独裁者被处决，自由派获胜",
      "createdAt": "2026-04-12T13:29:58.000Z"
    }
  ]
}
```

字段约束：

- `winner` 只允许为 `LIBERAL` 或 `FASCIST`
- `winReason` 必须使用枚举，不能直接返回展示文案
- `timeline` 只记录复盘所需关键节点
- `expireAt` 为游戏结束后固定 30 分钟的服务端过期时间

## 5. `bootstrapService` 详细接口

说明：创建用户页的“保存形象”不调用后端接口，只写入小程序本地缓存并回到首页。`createRoom` / `joinRoom` 在用户重新点击入口时携带本地缓存中的 `displayName`，并在需要对房间内其他玩家展示自定义头像时，先把本地头像上传为房间临时头像，再携带该房间头像 `fileID`。

头像生命周期约束：

- 前端不得在保存形象时上传长期用户头像，不使用 `user_avatars/` 作为用户头像库。
- 房间临时头像应可归属到具体房间；创建 / 加入房间前未知 `roomId` 时，可用 `commandId` 生成待关联路径，成功创建或加入后由后端登记到房间资源清理清单。
- 游戏结束后不立即删除头像；`ended` 复盘保留期内头像继续可用。
- 房间进入 `expired`、大厅空房间销毁或维护任务清理房间数据时，后端删除该房间关联的头像文件。

## 5.1 `ensureSession`

用途：

- 确认当前用户身份
- 建立云函数会话
- 返回当前用户是否有活跃房间摘要

请求：

```json
{
  "action": "ensureSession",
  "payload": {}
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "user": {
      "sessionReady": true
    },
    "activeRoom": {
      "roomId": "room_xxx",
      "roomCode": "482615",
      "roomStatus": "lobby",
      "memberId": "mem_xxx",
      "routeHint": "lobby",
      "version": 3,
      "updatedAt": "2026-04-12T11:59:58.000Z"
    }
  }
}
```

说明：

- 若无活跃房间，则 `activeRoom = null`
- 不向前端暴露 `openid`

主要失败错误码：

- `INTERNAL_ERROR`

## 5.2 `recoverActiveRoom`

用途：

- 在小程序回前台时恢复活跃房间上下文
- 通过当前 openid 对应的 `room_members` 查找仍有效的活跃房间
- 只恢复当前用户自己的活跃成员身份，不提供“恢复所有人已离线的房间”能力

请求：

```json
{
  "action": "recoverActiveRoom",
  "payload": {}
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
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
}
```

说明：

- 若活跃房间无效，返回 `activeRoom = null`
- `routeHint` 由后端根据房间状态与阶段决定

主要失败错误码：

- `INTERNAL_ERROR`

## 5.3 `clearActiveRoom`

用途：

- 页面超时或前端确认退出恢复上下文时，清理当前用户的活跃房间恢复锚点
- 只更新当前 openid 对应的 `user_profiles.activeRoomId / activeMemberId / activeRoomStatus`
- 不负责把房间置为过期，也不替代 `maintenanceService` 的房间数据清理

请求：

```json
{
  "action": "clearActiveRoom",
  "payload": {}
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "activeRoom": null
  }
}
```

主要失败错误码：

- `INTERNAL_ERROR`

## 6. `roomService` 详细接口

说明：

- 本节除 `getLobbySnapshot` 外，其余 action 都属于写操作，必须带 `commandId`
- 大厅写操作不需要 `expectedVersion`
- 同一 `commandId` 的合法重试必须返回幂等成功，而不是重复写入

## 6.1 `createRoom`

请求：

```json
{
  "action": "createRoom",
  "payload": {
    "commandId": "cmd_create_room_xxx",
    "targetPlayerCount": 7,
    "displayName": "玩家A",
    "avatarUrl": "cloud://xxx/room_assets/pending/cmd_create_room_xxx/avatar_xxx.png"
  }
}
```

字段校验：

- `targetPlayerCount` 必须是 `5-10` 的整数
- `displayName` 来自小程序本地用户资料，去首尾空格后长度必须在 `1-20`
- `avatarUrl` 为前端上传后的房间临时头像 `fileID`，可以为空；为空时前端使用默认头像
- 同一用户存在未失效活跃房间时拒绝创建新房间
- 房主初始用户名与头像由请求中的 `displayName/avatarUrl` 写入房间成员快照

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "roomId": "room_xxx",
    "roomCode": "482615",
    "roomStatus": "lobby",
    "memberId": "mem_host",
    "lobbySnapshot": {}
  }
}
```

主要失败错误码：

- `INVALID_PAYLOAD`
- `ACTION_NOT_ALLOWED`
- `INTERNAL_ERROR`

## 6.2 `joinRoom`

请求：

```json
{
  "action": "joinRoom",
  "payload": {
    "commandId": "cmd_join_room_xxx",
    "roomCode": "482615",
    "displayName": "玩家B",
    "avatarUrl": "cloud://xxx/room_assets/pending/cmd_join_room_xxx/avatar_yyy.png"
  }
}
```

字段校验：

- `roomCode` 必须是 6 位房号字符串
- `displayName` 来自小程序本地用户资料，去首尾空格后长度必须在 `1-20`
- `avatarUrl` 为前端上传后的房间临时头像 `fileID`，可以为空；为空时前端使用默认头像
- 新成员用户名与头像由请求中的 `displayName/avatarUrl` 写入房间成员快照

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "roomId": "room_xxx",
    "roomCode": "482615",
    "roomStatus": "lobby",
    "memberId": "mem_2",
    "lobbySnapshot": {}
  }
}
```

行为约束：

- 同一 `openid` 已在该房间有有效成员时必须复用原 `memberId`
- 开局后不允许新 `openid` 加入
- 若房间已满返回 `ROOM_FULL`

主要失败错误码：

- `INVALID_PAYLOAD`
- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `ROOM_FULL`
- `ROOM_NOT_JOINABLE`
- `ACTION_NOT_ALLOWED`
- `INTERNAL_ERROR`

## 6.3 `leaveRoom`

请求：

```json
{
  "action": "leaveRoom",
  "payload": {
    "commandId": "cmd_leave_room_xxx",
    "roomId": "room_xxx"
  }
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "roomId": "room_xxx",
    "roomStatus": "lobby",
    "memberId": "mem_2",
    "leaveMode": "removed_from_lobby",
    "newHostMemberId": "mem_3",
    "roomExpired": false,
    "routeHint": "home"
  }
}
```

字段说明：

- `leaveMode` 只允许为 `removed_from_lobby` 或 `marked_offline`
- `newHostMemberId` 表示本次退出后自动转移到的新房主；未发生转移时为 `null`
- `roomExpired` 表示该房间是否在本次操作后变为无效房间
- 大厅阶段所有玩家退出后，房间自动销毁或标记为失效，不支持恢复空房间
- 对局阶段离开只会标记离线，不会移除成员

主要失败错误码：

- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `NOT_ROOM_MEMBER`
- `INTERNAL_ERROR`

## 6.4 `getLobbySnapshot`

请求：

```json
{
  "action": "getLobbySnapshot",
  "payload": {
    "roomId": "room_xxx"
  }
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {}
}
```

其中 `data` 必须完整符合 `LobbyView` 结构。

主要失败错误码：

- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `NOT_ROOM_MEMBER`
- `GAME_ALREADY_STARTED`
- `INTERNAL_ERROR`

## 6.5 `updateSeatOrder`（P1 扩展，MVP 不开放）

说明：座位管理已调整为 P1 可扩展能力，MVP 不在前端暴露该 action，也不要求后端首期实现。以下协议仅作为后续扩展预留。

请求：

```json
{
  "action": "updateSeatOrder",
  "payload": {
    "commandId": "cmd_update_seat_xxx",
    "roomId": "room_xxx",
    "orderedMemberIds": ["mem_1", "mem_2", "mem_3"]
  }
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "roomId": "room_xxx",
    "roomStatus": "lobby",
    "newVersion": 5,
    "lobbySnapshot": {}
  }
}
```

约束：

- 仅房主可调用
- 仅大厅可调用
- `orderedMemberIds` 必须与当前全部有效成员完全一致，不能缺、不能多、不能重复

主要失败错误码：

- `INVALID_PAYLOAD`
- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `NOT_ROOM_MEMBER`
- `NOT_ROOM_HOST`
- `ACTION_NOT_ALLOWED`
- `INTERNAL_ERROR`

## 6.7 `setReady`

请求：

```json
{
  "action": "setReady",
  "payload": {
    "commandId": "cmd_set_ready_xxx",
    "roomId": "room_xxx",
    "ready": true
  }
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "roomId": "room_xxx",
    "roomStatus": "lobby",
    "newVersion": 6,
    "lobbySnapshot": {}
  }
}
```

约束：

- 仅大厅允许
- 仅本人可修改自己的准备状态

主要失败错误码：

- `INVALID_PAYLOAD`
- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `NOT_ROOM_MEMBER`
- `ACTION_NOT_ALLOWED`
- `INTERNAL_ERROR`

## 7. `gameService` 详细接口

## 7.1 `startGame`

请求：

```json
{
  "action": "startGame",
  "payload": {
    "commandId": "cmd_start_game_xxx",
    "roomId": "room_xxx"
  }
}
```

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "roomId": "room_xxx",
    "roomCode": "482615",
    "roomStatus": "in_game",
    "version": 1,
    "routeHint": "board",
    "needsRefresh": true
  }
}
```

约束：

- 仅房主可调用
- 房间状态必须是 `lobby`
- 玩家数必须在 `5-10`
- 全员 `isReady === true`
- 成功后前端应立即调用 `getGameSnapshot`，并进入轮询刷新流程

主要失败错误码：

- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `NOT_ROOM_MEMBER`
- `NOT_ROOM_HOST`
- `INVALID_PLAYER_COUNT`
- `NOT_ALL_READY`
- `GAME_ALREADY_STARTED`
- `ACTION_NOT_ALLOWED`
- `INTERNAL_ERROR`

## 7.2 `getGameSnapshot`

请求：

```json
{
  "action": "getGameSnapshot",
  "payload": {
    "roomId": "room_xxx"
  }
}
```

成功响应中的 `data` 必须完整符合 `GameSnapshot` 结构。

实现要求：

- 通过当前微信身份定位成员
- 读取公共快照投影和当前成员私密快照投影
- 合并后返回统一 DTO

禁止：

- 允许前端传入任意 `memberId` 读取他人私密快照
- 现场从核心状态拼装一套临时结构绕开文档

主要失败错误码：

- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `NOT_ROOM_MEMBER`
- `GAME_NOT_STARTED`
- `GAME_ALREADY_ENDED`
- `INTERNAL_ERROR`

## 7.3 `submitCommand`

这是游戏内唯一写入口。

请求结构固定如下：

```json
{
  "action": "submitCommand",
  "payload": {
    "roomId": "room_xxx",
    "commandId": "cmd_vote_xxx",
    "expectedVersion": 18,
    "taskId": "game_xxx:20:SUBMIT_VOTE:mem_2",
    "type": "SUBMIT_VOTE",
    "body": {
      "vote": "JA"
    }
  }
}
```

字段说明：

- `taskId` 推荐在由 `pendingTask` 驱动的操作中回传，便于后端做更严格校验
- `taskId` 缺失时后端仍可根据 `type + actor + phase` 判定，但优先校验回传值
- 后端绝不信任前端提供的 `memberId`、`seatIndex`、`role`

成功响应：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "serverTime": "2026-04-12T12:00:00.000Z",
  "data": {
    "accepted": true,
    "roomId": "room_xxx",
    "roomStatus": "in_game",
    "previousVersion": 18,
    "newVersion": 19,
    "currentPhase": "round_result",
    "phaseChanged": true,
    "deduplicated": false,
    "needsRefresh": true
  }
}
```

约束：

- 成功响应不直接返回完整游戏真相
- 前端收到成功响应后必须以新快照为准更新页面
- 幂等重试命中时仍返回成功 envelope，但 `deduplicated = true`

主要失败错误码：

- `INVALID_PAYLOAD`
- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `NOT_ROOM_MEMBER`
- `GAME_NOT_STARTED`
- `GAME_ALREADY_ENDED`
- `VERSION_CONFLICT`
- `PHASE_MISMATCH`
- `NOT_CURRENT_ACTOR`
- `INVALID_TARGET`
- `TARGET_ALREADY_DEAD`
- `TARGET_ALREADY_INVESTIGATED`
- `ACTION_NOT_ALLOWED`
- `DUPLICATE_COMMAND`
- `INTERNAL_ERROR`

## 7.4 `getResultSnapshot`

请求：

```json
{
  "action": "getResultSnapshot",
  "payload": {
    "roomId": "room_xxx"
  }
}
```

成功响应中的 `data` 必须完整符合 `ResultSnapshot` 结构。

约束：

- 仅 `roomStatus === ended` 时允许读取
- 当前微信身份必须是本局成员

主要失败错误码：

- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `NOT_ROOM_MEMBER`
- `GAME_NOT_STARTED`
- `ACTION_NOT_ALLOWED`
- `INTERNAL_ERROR`

## 8. 游戏命令模型详细设计

## 8.1 统一命令结构

`submitCommand.payload` 固定结构如下：

```json
{
  "roomId": "string",
  "commandId": "string",
  "expectedVersion": 18,
  "taskId": "string",
  "type": "SUBMIT_VOTE",
  "body": {}
}
```

约束：

- `commandId` 必填
- `expectedVersion` 必填
- `taskId` 推荐必带；若某阶段无任务卡但有命令，也可传 `null`
- `body` 必须严格匹配对应命令类型定义

## 8.2 命令类型与 body 契约

| `type` | 允许阶段 | 操作者 | `body` |
| --- | --- | --- | --- |
| `NOMINATE_CHANCELLOR` | `nomination` | 当前总统候选人 | `{ "targetMemberId": "mem_xxx" }` |
| `SUBMIT_VOTE` | `voting` | 所有存活玩家 | `{ "vote": "JA" }` 或 `{ "vote": "NEIN" }` |
| `PRESIDENT_DISCARD_POLICY` | `legislative_president` | 当前总统 | `{ "discardPolicyIndex": 0 }` |
| `CHANCELLOR_ENACT_POLICY` | `legislative_chancellor` | 当前总理 | `{ "enactPolicyIndex": 1 }` |
| `CHANCELLOR_REQUEST_VETO` | `legislative_chancellor` | 当前总理 | `{ "request": true }` |
| `PRESIDENT_RESPOND_VETO` | `veto_response` | 当前总统 | `{ "accepted": true }` 或 `{ "accepted": false }` |
| `EXEC_INVESTIGATE` | `executive_action` | 当前总统 | `{ "targetMemberId": "mem_xxx" }` |
| `EXEC_SPECIAL_ELECTION` | `executive_action` | 当前总统 | `{ "targetMemberId": "mem_xxx" }` |
| `EXEC_POLICY_PEEK_ACK` | `executive_action` | 当前总统 | `{ "acknowledged": true }` |
| `EXECUTE_PLAYER` | `executive_action` | 当前总统 | `{ "targetMemberId": "mem_xxx" }` |

校验补充：

- `CHANCELLOR_REQUEST_VETO` 仅在 `vetoUnlocked === true` 时允许
- `PRESIDENT_DISCARD_POLICY.discardPolicyIndex` 必须是当前 3 张手牌中的有效下标
- `CHANCELLOR_ENACT_POLICY.enactPolicyIndex` 必须是当前 2 张手牌中的有效下标
- `EXEC_POLICY_PEEK_ACK` 仅用于确认查看，不修改公共真相
- `EXECUTE_PLAYER.targetMemberId` 必须是存活玩家；允许等于当前总统本人

## 8.3 `pendingTask` 与命令映射

正式映射如下：

| `pendingTask.taskType` | 提交命令 |
| --- | --- |
| `NOMINATE_CHANCELLOR` | `NOMINATE_CHANCELLOR` |
| `SUBMIT_VOTE` | `SUBMIT_VOTE` |
| `PRESIDENT_DISCARD_POLICY` | `PRESIDENT_DISCARD_POLICY` |
| `CHANCELLOR_ENACT_POLICY` | `CHANCELLOR_ENACT_POLICY` 或 `CHANCELLOR_REQUEST_VETO` |
| `PRESIDENT_RESPOND_VETO` | `PRESIDENT_RESPOND_VETO` |
| `EXEC_INVESTIGATE` | `EXEC_INVESTIGATE` |
| `EXEC_SPECIAL_ELECTION` | `EXEC_SPECIAL_ELECTION` |
| `EXEC_POLICY_PEEK_ACK` | `EXEC_POLICY_PEEK_ACK` |
| `EXECUTE_PLAYER` | `EXECUTE_PLAYER` |

说明：

- `CHANCELLOR_REQUEST_VETO` 不单独生成任务类型，作为总理行动面板里的次级操作出现
- 前端根据 `taskType` 渲染 UI，但最终以后端校验结果为准

## 8.4 命令幂等语义

后端处理规则固定如下：

1. 若相同 `roomId + commandId` 不存在，则正常处理
2. 若存在且 `requesterOpenId` 与原请求不同，返回 `ACTION_NOT_ALLOWED`
3. 若存在且 `payloadHash` 完全一致，返回幂等成功，`deduplicated = true`
4. 若存在但 `payloadHash` 不一致，返回 `DUPLICATE_COMMAND`

## 9. 轮询读取与投影文档约束

## 9.1 读取准则

MVP 阶段前端只能通过云函数读取大厅视图或对局快照：

- 大厅页轮询 `roomService.getLobbySnapshot`
- 对局页轮询 `gameService.getGameSnapshot`
- 结果页读取 `gameService.getResultSnapshot`

前端禁止直接读取或监听：

- `room_public_snapshots`
- `player_private_snapshots`
- `game_core`
- `game_events`
- `command_records`
- 任何后端数据库集合

## 9.2 大厅视图不落投影文档

大厅准备阶段不维护 `room_public_snapshots` 或 `player_private_snapshots`。

原因：

- 大厅阶段没有角色、党派、牌堆、投票、待办等私密游戏真相。
- `rooms` 与 `room_members` 已经是大厅事实源，二者足以实时组装大厅视图响应。
- `viewerState` 依赖当前 openid，是 API 响应时的派生结果，不是公共房间事实。

`getLobbySnapshot` 每次读取 `rooms` 与 `room_members`，校验当前 openid 的有效成员身份后，返回 `LobbyView`。

## 9.3 `room_public_snapshots` 文档结构

`room_public_snapshots` 只用于对局和结果阶段的公共投影缓存。

```json
{
  "_id": "room_xxx",
  "roomId": "room_xxx",
  "roomCode": "482615",
  "roomStatus": "in_game",
  "snapshotType": "game_public",
  "version": 18,
  "payload": {
    "roomId": "room_xxx",
    "roomCode": "482615",
    "roomStatus": "in_game",
	    "version": 18,
	    "round": 3,
	    "currentPhase": "voting",
	    "expireAt": "2026-04-12T14:00:00.000Z",
	    "publicState": {},
	    "updatedAt": "2026-04-12T12:10:00.000Z"
	  },
  "updatedAt": "2026-04-12T12:10:00.000Z",
  "expireAt": "2026-04-13T00:10:00.000Z"
}
```

约束：

- `snapshotType` 可取 `game_public`、`result_public`
- `payload` 必须是“公共部分的游戏快照”或结果公共视图，不包含 `privateState` 和 `pendingTask`

## 9.4 `player_private_snapshots` 文档结构

```json
{
  "_id": "mem_xxx",
  "memberId": "mem_xxx",
  "roomId": "room_xxx",
  "roomStatus": "in_game",
  "version": 18,
  "payload": {
    "memberId": "mem_xxx",
    "privateState": {},
    "pendingTask": null,
    "updatedAt": "2026-04-12T12:10:00.000Z"
  },
  "updatedAt": "2026-04-12T12:10:00.000Z",
  "expireAt": "2026-04-13T00:10:00.000Z"
}
```

约束：

- 一名成员只对应一份私密快照文档
- `_id` 直接使用 `memberId`
- `payload.privateState` 与 `payload.pendingTask` 共同构成私密视图

## 9.5 轮询读取策略

前端进入相关页面后必须按固定频率轮询对应后端视图：

- 大厅页轮询 `getLobbySnapshot`
- 对局页轮询 `getGameSnapshot`

轮询要求：

- 返回结构不得变化
- 前端 mapper 不得绕开 API DTO 直接消费投影文档结构
- 页面隐藏时应停止轮询，回到前台后立即补拉一次

## 9.6 版本消费规则

前端消费快照时必须遵循：

1. 只接受版本号大于等于本地版本的快照
2. 版本号回退时丢弃该快照并记录日志
3. 写操作成功后仍要以新快照为准，而不是以响应内局部字段为准

## 10. 错误码详细约束

MVP 阶段统一使用以下错误码：

| 错误码 | `retryable` | 语义 |
| --- | --- | --- |
| `INVALID_PAYLOAD` | `false` | 请求字段缺失、类型错误、枚举值非法、长度非法 |
| `ROOM_NOT_FOUND` | `false` | 房间不存在 |
| `ROOM_EXPIRED` | `false` | 房间已过期或已被清理 |
| `ROOM_FULL` | `false` | 房间人数已满 |
| `ROOM_NOT_JOINABLE` | `false` | 房间当前状态不允许加入 |
| `NOT_ROOM_MEMBER` | `false` | 当前用户不是该房间有效成员 |
| `NOT_ROOM_HOST` | `false` | 当前用户不是房主 |
| `INVALID_PLAYER_COUNT` | `false` | 玩家人数不符合开局条件 |
| `NOT_ALL_READY` | `false` | 大厅成员未全部准备 |
| `GAME_NOT_STARTED` | `false` | 房间尚未开局 |
| `GAME_ALREADY_STARTED` | `false` | 房间已经开局，不能做大厅操作 |
| `GAME_ALREADY_ENDED` | `false` | 对局已结束，不能继续提交命令 |
| `PHASE_MISMATCH` | `false` | 当前阶段与命令类型不匹配 |
| `VERSION_CONFLICT` | `true` | 前端基于旧版本快照发起命令 |
| `DUPLICATE_COMMAND` | `false` | `commandId` 已存在但请求内容不一致 |
| `NOT_CURRENT_ACTOR` | `false` | 当前用户不是本阶段合法操作者 |
| `INVALID_TARGET` | `false` | 目标不合法，例如不在允许列表内 |
| `TARGET_ALREADY_DEAD` | `false` | 目标已死亡 |
| `TARGET_ALREADY_INVESTIGATED` | `false` | 目标已被调查过 |
| `ACTION_NOT_ALLOWED` | `false` | 当前房间状态或业务规则不允许执行该操作 |
| `INTERNAL_ERROR` | `true` | 服务端未预期异常 |

前端联调约束：

- 以 `code` 为主做逻辑分支
- `message` 只用于日志与兜底 toast
- `retryable = true` 时前端可优先选择刷新重试，而不是保留旧操作态

## 11. 字段命名与枚举约束

## 11.1 命名风格

统一使用 `camelCase`。

例如：

- `roomId`
- `roomCode`
- `memberId`
- `expectedVersion`
- `currentPhase`

## 11.2 枚举

### `roomStatus`

- `lobby`
- `in_game`
- `ended`
- `expired`

### `routeHint`

- `lobby`
- `board`
- `result`

### `vote`

- `JA`
- `NEIN`

### `policyType`

- `LIBERAL`
- `FASCIST`

### `phase`

- `nomination`
- `voting`
- `hitler_check`
- `legislative_president`
- `legislative_chancellor`
- `veto_response`
- `executive_action`
- `round_result`
- `game_ended`

### `executiveActionType`

- `INVESTIGATE`
- `SPECIAL_ELECTION`
- `POLICY_PEEK`
- `EXECUTION`

### `winReason`

- `LIBERAL_FIVE_POLICIES`
- `FASCIST_SIX_POLICIES`
- `HITLER_ELECTED_CHANCELLOR`
- `HITLER_EXECUTED`

## 12. 前后端协作强约束

## 12.1 前端不得绕开快照

前端页面显示必须以快照为准，不能用本地命令结果直接拼出下一状态。

## 12.2 后端不得绕开文档新增字段

新增请求字段、新增返回字段、新增命令类型、新增错误码，都必须先更新本文档。

## 12.3 联调阶段必须锁定结构

前后端并行开发阶段优先冻结以下内容：

- 云函数名
- action 名
- DTO 主结构
- 命令类型名
- 错误码

禁止口头约定新增字段后再补文档。

## 12.4 `pendingTask` 优先于 `allowedActions`

MVP 前端交互以 `pendingTask` 为唯一强约束任务来源：

- `pendingTask = null` 表示当前无需主动操作
- `allowedActions` 不作为必需字段
- 若后续需要更细粒度的禁用态，再单独扩展并更新本文档

## 13. 交付结论

后续所有实现都必须遵守以下结论：

- 前端只通过云函数提交命令，不直接写核心状态
- 所有写操作都必须带 `commandId`
- 除 `startGame` 外，所有游戏内写操作都必须带 `expectedVersion`
- 游戏内所有状态变更统一走 `gameService.submitCommand`
- 前端只消费大厅视图、游戏公共快照和当前玩家私密快照
- 大厅视图与对局快照只允许通过 `getLobbySnapshot`、`getGameSnapshot`、`getResultSnapshot` 等云函数 action 读取
- 结果页只能通过 `getResultSnapshot` 获取正式复盘数据
- 所有接口统一使用标准 envelope 和统一错误码
