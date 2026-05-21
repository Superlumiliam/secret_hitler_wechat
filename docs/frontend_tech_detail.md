# 《secret hitler》前端详细技术方案

## 1. 文档目标

本文档的目标不是重复 PRD，而是给后续前端代码开发提供一份可直接落地的实现方案，覆盖：

- 小程序目录与模块划分
- 页面路由与分包
- 状态管理
- 云函数调用与大厅视图 / 对局快照同步
- 页面 / 组件协议
- 阶段任务 UI 实现
- 隐私保护、异常恢复、性能与测试

后续前端开发应以本文档为直接编码依据；若实际实现需要修改接口字段或交互契约，必须先同步更新 `/docs/front_back_api.md`。

## 2. 现状与设计前提

### 2.1 当前仓库现状

当前仓库已经完成微信云开发 QuickStart 模板清理，真实前端入口统一位于 `frontend/`，微信开发者工具配置中的 `miniprogramRoot` 与 `srcMiniprogramRoot` 均应指向该目录。

后续开发必须继续在 `frontend/` 真实业务结构内推进，不再依赖旧模板页面或示例云函数作为代码参考。

### 2.2 不可违反的上位约束

结合已有文档，前端必须严格遵守以下约束：

1. 前端不是裁判，不负责规则真相、胜负判定、身份分配、牌堆逻辑。
2. 所有写操作只能通过 `wx.cloud.callFunction` 发起命令。
3. 页面只能渲染大厅视图、游戏公共快照、当前玩家私密快照，不能持有完整真相。
4. 前端只能展示当前用户有权查看的私密切片；身份页不做额外遮罩、定时隐藏或特殊保密逻辑。
5. 前端不能直接读写或监听任何后端数据库集合。
6. 所有写操作都必须携带 `commandId`，其中游戏内写操作还必须携带 `expectedVersion`。
7. 所有渲染都以快照为准，不能用“按钮已点击”推断状态已推进。
8. MVP 必须支持 `5-10` 人标准局、完整流程、断线恢复、结果复盘。

### 2.3 前端实施总原则

1. 原生微信小程序优先，不引入跨端框架。
2. TypeScript 优先，所有领域类型显式建模。
3. 命令与快照分离，页面通过 view-model 消费数据。
4. 公共桌面与私密动作分层，避免误泄露。
5. 低依赖、低心智成本、可逐步迭代。

## 3. 技术选型结论

## 3.1 框架与语言

- 框架：原生微信小程序
- 语言：TypeScript
- 样式：WXSS
- 云能力：`wx.cloud`
- 数据同步：`云函数命令 + 云函数轮询读取大厅视图 / 对局快照`

### 3.2 依赖策略

前端不引入重型框架，MVP 依赖原则如下：

- 不引入 Taro / uni-app
- 不引入全局状态管理框架
- 不引入第三方 UI 组件库
- 不引入前端规则引擎
- 如无明确收益，不引入额外 npm 工具

优先自己实现小而稳的基础能力：

- `createStore`
- `eventEmitter`
- `commandId` 生成器
- `errorMapper`
- `snapshotMapper`

### 3.3 当前 JS 到 TS 结构的演进策略

当前业务页面已经位于 `frontend/`，后续演进策略是“稳定现有业务路径，逐步补齐 TS 化能力”：

1. 新增业务页面、组件、服务层都放在 `frontend/` 目录下。
2. 新业务页面与服务层优先使用 TypeScript；已有 JS 页面可随功能迭代逐步迁移。
3. 所有云函数调用统一通过前端服务层封装，页面不直接拼接底层请求细节。

## 4. 目标目录结构

建议最终前端目录结构如下。微信开发者工具项目根目录应指向 `frontend/`：

```text
frontend/
  app.ts
  app.json
  app.wxss
  sitemap.json
  styles/
    reset.wxss
    theme.wxss
    utilities.wxss
  pages/
    home/
      index.ts
      index.wxml
      index.wxss
      index.json
    user-profile/
      index.ts
      index.wxml
      index.wxss
      index.json
    create-room/
      index.ts
      index.wxml
      index.wxss
      index.json
  packageRoom/
    pages/
      lobby/
        index.ts
        index.wxml
        index.wxss
        index.json
      identity/
        index.ts
        index.wxml
        index.wxss
        index.json
      board/
        index.ts
        index.wxml
        index.wxss
        index.json
      history/
        index.ts
        index.wxml
        index.wxss
        index.json
      rules/
        index.ts
        index.wxml
        index.wxss
        index.json
  packageResult/
    pages/
      result/
        index.ts
        index.wxml
        index.wxss
        index.json
  components/
    room-code-card/
    seat-list/
    seat-item/
    phase-banner/
    policy-track/
    election-track/
    government-badge/
    public-log/
    pending-task-card/
    vote-panel/
    policy-picker/
    target-picker/
    secret-panel/
    result-timeline/
    state-feedback/
  services/
    cloud.ts
    bootstrapService.ts
    roomService.ts
    gameService.ts
    snapshotService.ts
    shareService.ts
  store/
    createStore.ts
    sessionStore.ts
    userProfileStore.ts
    roomStore.ts
    gameStore.ts
    uiStore.ts
  mappers/
    lobbyMapper.ts
    gameMapper.ts
    taskMapper.ts
    resultMapper.ts
    errorMapper.ts
  types/
    api.ts
    room.ts
    game.ts
    result.ts
    command.ts
    task.ts
    error.ts
    ui.ts
  constants/
    phase.ts
    command.ts
    error.ts
    route.ts
    copy.ts
  utils/
    command.ts
    storage.ts
    logger.ts
    router.ts
    guard.ts
    emitter.ts
    shallowEqual.ts
    visibility.ts
    debounce.ts
  behaviors/
    withStore.ts
    withPageLifecycle.ts
  static/
    rulesContent.ts
  assets/
    images/
      avatars/
        default-player.png
      decorations/
      icons/
```

目录约定：

- `frontend/assets/images/avatars/`：小于等于 `200K` 的默认玩家头像、占位头像。
- `frontend/assets/images/decorations/`：小于等于 `200K` 的非交互装饰元素、氛围图、分隔图。
- `frontend/assets/images/icons/`：小于等于 `200K` 且无法用 WXSS 或文字表达的静态图标。
- `frontend/static/` 只放结构化文本或配置，如 `rulesContent.ts`；不放图片。
- 大于 `200K` 的图片资源不得进入 `frontend/` 主包，应上传到微信云存储；源文件在 `reference/` 保留备份。
- 页面使用云存储图片时，不直接把 `cloud://` 地址传给 `image.src`，统一先通过 `wx.cloud.getTempFileURL` 获取临时 HTTPS 地址，失败时保留纯色或样式兜底。
- 用户自定义头像不作为长期云存储资源保存；创建 / 加入房间时才上传为房间临时头像，并由房间过期或维护清理流程删除。

## 5. 分包与路由方案

### 5.1 页面划分

建议页面保留 9 个页面，其中 7 个主流程页面 + 2 个辅助查看页。创建游戏前端流程拆为“首页（创建房间入口）”、“创建用户”、“创建房间”、“房间大厅”四个页面；创建用户页也是首页头像入口的资料编辑页。页面参考 `reference/01-首页入口.png`、`reference/02-创建房间.png`、`reference/03-房间大厅.png`：

| 页面 | 路径 | 作用 |
| --- | --- | --- |
| 首页 | `pages/home/index` | 展示左上角圆形头像入口、创建房间入口、加入房间入口、恢复活跃房间 |
| 创建用户 | `pages/user-profile/index` | 首次创建或后续修改用户头像与用户名 |
| 创建房间 | `pages/create-room/index` | 选择对局人数、确认创建房间 |
| 房间大厅 | `packageRoom/pages/lobby/index` | 展示房间、座位、准备、开始、分享 |
| 身份页 | `packageRoom/pages/identity/index` | 查看自己的身份并返回桌面 |
| 对局桌面页 | `packageRoom/pages/board/index` | 公共桌面 + 当前私密任务 |
| 历史记录页 | `packageRoom/pages/history/index` | 局内查看总体情况与逐轮公开记录 |
| 结果页 | `packageResult/pages/result/index` | 终局结果与复盘 |
| 规则页 | `packageRoom/pages/rules/index` | 局内规则说明 |

### 5.2 `app.json` 建议结构

```json
{
  "pages": [
    "pages/home/index",
    "pages/user-profile/index",
    "pages/create-room/index"
  ],
  "subpackages": [
    {
      "root": "packageRoom",
      "pages": [
        "pages/lobby/index",
        "pages/identity/index",
        "pages/board/index",
        "pages/history/index",
        "pages/rules/index"
      ]
    },
    {
      "root": "packageResult",
      "pages": [
        "pages/result/index"
      ]
    }
  ],
  "preloadRule": {
    "pages/home/index": {
      "network": "all",
      "packages": ["packageRoom"]
    },
    "packageRoom/pages/board/index": {
      "network": "all",
      "packages": ["packageResult"]
    }
  },
  "lazyCodeLoading": "requiredComponents",
  "style": "v2"
}
```

### 5.3 页面跳转规则

页面切换统一由 `router.ts` 中的 `resolveRouteBySnapshot()` 决定：

| 状态 | 目标页 |
| --- | --- |
| `roomStatus = lobby` | 大厅页 |
| `roomStatus = in_game` | 对局桌面页 |
| `roomStatus = ended` 或 `currentPhase = game_ended` | 结果页 |
| `roomStatus = expired` | 首页 |

### 5.4 页面栈策略

- `home -> create-room`：`wx.navigateTo`
- `home -> user-profile`：点击左上角圆形头像后 `wx.navigateTo`
- `home -> create-room` / `home -> joinRoom` 前必须先检查本地用户资料；缺失时 `wx.navigateTo({ url: '/pages/user-profile/index' })`
- `user-profile -> home`：点击“保存形象”且保存成功后统一回首页；优先 `wx.navigateBack` 回到上一层首页，异常栈下兜底 `wx.reLaunch({ url: '/pages/home/index' })`
- `create-room -> lobby`：`wx.redirectTo`
- `home -> lobby`：加入房间或恢复房间成功后 `wx.redirectTo`
- `lobby -> board`：开局成功后 `wx.redirectTo`
- `board -> identity`：点击“我的身份”后 `wx.navigateTo`
- `identity -> board`：点击“我知道了”后 `wx.navigateBack`
- `board -> history`：点击“历史记录”后 `wx.navigateTo`
- `history -> board`：点击左上角回退按钮或系统返回后 `wx.navigateBack`
- `board -> result`：`wx.redirectTo`
- `rules`：统一 `wx.navigateTo`
- 退出房间 / 房间失效 / 页面超时：`wx.reLaunch({ url: '/pages/home/index' })`

原因：

1. 游戏是明确状态机，不需要保留深页面回退链。
2. `redirectTo` 可减少页面栈和私密页面残留。
3. `rules` 是临时查看页，保留回退符合预期。

## 6. 应用生命周期设计

## 6.1 `App` 层职责

`app.ts` 只负责五件事：

1. 初始化云开发环境
2. 初始化全局 store
3. 恢复本地房间上下文
4. 注册网络与可见性监听
5. 处理分享回流参数

### 6.2 `onLaunch`

执行顺序：

1. 校验 `wx.cloud` 可用
2. `wx.cloud.init({ env, traceUser: true })`
3. 初始化 `sessionStore` / `roomStore` / `gameStore` / `uiStore`
4. 加载本地缓存的非敏感上下文与用户资料缓存
5. 注册 `wx.onNetworkStatusChange`

### 6.3 `onShow`

执行顺序：

1. 记录页面回流时间
2. 发布全局“应用回到前台”事件
3. 若带 `roomCode` 分享参数，优先尝试恢复 / 加入目标房间
4. 调用 `bootstrapService.ensureSession()` 建立云函数会话
5. 调用 `bootstrapService.recoverActiveRoom()`
6. 按返回结果决定是否自动跳转

### 6.4 `onHide`

`onHide` 不做业务提交，只做安全态处理：

1. 向当前页面广播 `APP_HIDDEN`
2. 停止当前页面的轮询计时器
3. 清空临时提交态与未完成的面板交互态

注意：只重置临时 UI 状态，不清空内存中的快照对象；这样回前台后可以快速恢复。

## 7. 类型体系设计

## 7.1 核心类型文件

至少定义以下类型文件：

- `types/api.ts`
- `types/room.ts`
- `types/game.ts`
- `types/result.ts`
- `types/command.ts`
- `types/task.ts`
- `types/error.ts`
- `types/ui.ts`

### 7.2 API envelope 类型

```ts
export interface ApiSuccess<T> {
  success: true
  requestId: string
  serverTime: string
  data: T
}

export interface ApiFailure {
  success: false
  requestId: string
  serverTime: string
  error: {
    code: ErrorCode
    message: string
    retryable: boolean
  }
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure
```

### 7.3 常量与枚举

所有字符串常量必须收敛在 `constants` 中：

- `ROOM_STATUS`
- `PHASE`
- `VOTE`
- `POLICY_TYPE`
- `COMMAND_TYPE`
- `ERROR_CODE`
- `TASK_TYPE`

推荐写法：

```ts
export const PHASE = {
  LOBBY: 'lobby',
  NOMINATION: 'nomination',
  VOTING: 'voting',
  HITLER_CHECK: 'hitler_check',
  LEGISLATIVE_PRESIDENT: 'legislative_president',
  LEGISLATIVE_CHANCELLOR: 'legislative_chancellor',
  VETO_RESPONSE: 'veto_response',
  EXECUTIVE_ACTION: 'executive_action',
  ROUND_RESULT: 'round_result',
  GAME_ENDED: 'game_ended'
} as const
```

### 7.4 领域对象边界

前端只定义三层对象：

1. `Snapshot DTO`
2. `ViewModel`
3. `Local UI State`

禁止页面直接把 DTO 原样塞入 `data` 后边渲染边拼逻辑。

## 8. Store 设计

## 8.1 总体原则

前端状态分三层：

1. 全局 store：跨页共享且轻量
2. 页面 data：只存当前页渲染字段
3. 组件 data：只存局部交互态

### 8.2 `createStore` 实现

不引入外部状态库，自己实现最小 store：

```ts
interface Store<T> {
  getState(): T
  setState(next: T): void
  patch(partial: Partial<T>): void
  subscribe(listener: (state: T) => void): () => void
  reset(): void
}
```

实现要求：

- 监听器基于 `Set`
- `patch` 做浅合并
- `subscribe` 返回取消订阅函数
- `reset` 回到初始值

### 8.3 `sessionStore`

保存非敏感且跨页需要的信息：

```ts
interface SessionState {
  envReady: boolean
  bootstrapReady: boolean
  profileCompleted: boolean
  avatarUrl: string
  activeRoomId: string | null
  activeRoomCode: string | null
  activeMemberId: string | null
  activeRoomStatus: 'lobby' | 'in_game' | 'ended' | 'expired' | null
  displayName: string
  isNetworkAvailable: boolean
  lastRecoverAt: number | null
}
```

### 8.4 `roomStore`

保存大厅视图：

```ts
interface RoomState {
  lobbyView: LobbyView | null
  lobbyVm: LobbyViewModel | null
  syncMode: 'polling' | 'idle'
  loading: boolean
  refreshing: boolean
  lastVersion: number | null
}
```

### 8.5 `gameStore`

保存游戏视图：

```ts
interface GameState {
  snapshot: GameSnapshot | null
  boardVm: GameBoardViewModel | null
  taskVm: PendingTaskViewModel | null
  resultVm: ResultViewModel | null
  syncMode: 'polling' | 'idle'
  loading: boolean
  refreshing: boolean
  commandLocks: Record<string, boolean>
  lastVersion: number | null
}
```

### 8.6 `uiStore`

只存全局 UI 控制态：

```ts
interface UiState {
  globalLoadingText: string
  latestToast: {
    type: 'success' | 'error' | 'info'
    text: string
  } | null
}
```

## 8.7 Store 使用规则

1. Store 保存原始快照和通用 VM。
2. 页面收到 store 更新后，只 `setData` 当前页真正需要的字段。
3. `commandLocks` 以 `taskId` 或 `commandType` 为 key。
4. 页面卸载时解除订阅，不清空全局状态。

## 9. Service 层设计

## 9.1 `cloud.ts`

统一封装云函数调用。

建议同时提供“通用调用”和“写操作调用”两个入口：

```ts
export async function callCloudAction<T>(
  name: string,
  action: string,
  payload: Record<string, unknown>
): Promise<T>

export async function callWriteAction<TInput extends Record<string, unknown>, TOutput>(
  name: string,
  action: string,
  payload: TInput
): Promise<TOutput>
```

职责：

1. 统一拼接 `{ action, payload }`
2. 统一处理 envelope
3. 统一记录 `requestId`
4. 统一把错误码转成前端异常对象
5. `callWriteAction` 内部自动补齐 `commandId`

### 9.2 `bootstrapService`

提供两个方法：

- `ensureSession()`
- `recoverActiveRoom()`

调用时机：

- `App.onLaunch`
- `App.onShow`
- 首页主动恢复房间

### 9.3 `roomService`

必须包含：

- `createRoom(targetPlayerCount, localUserProfile)`
- `joinRoom(roomCode, localUserProfile)`
- `leaveRoom(roomId)`
- `getLobbySnapshot(roomId)`
- `setReady(roomId, ready)`

补充约束：

- 除 `getLobbySnapshot` 外，其余方法都属于写操作，必须通过 `callWriteAction` 自动补齐 `commandId`
- `createRoom`、`joinRoom` 成功后直接返回 `lobbySnapshot`
- `createRoom`、`joinRoom` 前端必须先确认本地用户资料已完成；若使用自定义头像，应先上传为房间临时头像，再在请求中携带 `displayName/avatarUrl`，后端只校验并保存到当前房间成员快照
- 房间临时头像建议使用可归属到房间的云路径，例如 `room_assets/{roomId}/avatars/{memberId或openid}_{timestamp}.jpg`；创建 / 加入房间前未知 `roomId` 时可先使用 `room_assets/pending/{commandId}/...`，由后端在成功创建或加入后关联到房间清理清单
- `updateSeatOrder(roomId, orderedMemberIds)` 属于 P1 座位管理扩展，MVP 前端不接入

### 9.4 `gameService`

必须包含：

- `startGame(roomId)`
- `getGameSnapshot(roomId)`
- `submitCommand(command)`
- `getResultSnapshot(roomId)`

补充约束：

- `startGame` 内部自动补齐 `commandId`
- `startGame` 成功后只以返回的 `routeHint / needsRefresh` 作为跳转依据，正式桌面数据仍通过 `getGameSnapshot` 获取
- `submitCommand` 内部自动补齐 `commandId`
- `submitCommand` 必须从 `gameStore.version` 注入 `expectedVersion`
- 若当前操作来自 `pendingTask`，必须回传 `taskId`

### 9.5 `snapshotService`

职责是管理“读”：

- 启动大厅轮询
- 启动游戏轮询
- 管理页面可见性与轮询频率
- 页面隐藏时停止同步
- 命令成功后主动 refresh

### 9.6 `shareService`

负责生成分享内容：

- 大厅页分享房间
- 首页解析分享参数

分享路径只允许携带：

- `roomCode`

禁止携带：

- `memberId`
- `role`
- `party`
- `seatIndex`

## 10. 大厅视图与快照同步设计

## 10.1 同步策略结论

采用“轮询优先”的单一方案。MVP 阶段不直接读取或监听数据库投影文档，大厅视图与对局快照都通过云函数 action 拉取。

大厅准备阶段不维护公共 / 私密快照。大厅页调用 `roomService.getLobbySnapshot(roomId)` 时，后端实时读取 `rooms + room_members` 并返回大厅视图响应；其中 `viewerState` 只表示当前 openid 的派生视角，不是数据库字段。

### 10.2 轮询读取入口

前端只通过以下 service 方法读取后端视图：

- 大厅：`roomService.getLobbySnapshot(roomId)`
- 对局：`gameService.getGameSnapshot(roomId)`
- 结果：`gameService.getResultSnapshot(roomId)`

这样做的原因：

1. 不需要向前端开放数据库集合读取或监听权限。
2. 对局私密快照始终由云函数按当前微信身份合并返回。
3. 前端读取来源单一，mapper 不需要为监听数据和接口数据分叉。

### 10.3 大厅同步流程

1. 进入大厅页先主动调用一次 `getLobbySnapshot`
2. 页面可见时启动大厅轮询
3. 页面隐藏时停止大厅轮询
4. 命令提交成功后立即补拉一次最新大厅视图

轮询间隔建议：

- 页面可见：`2000ms`
- 页面隐藏：停止轮询

### 10.4 对局同步流程

1. 进入对局桌面页先主动 `getGameSnapshot`
2. 桌面页可见时启动对局轮询
3. 桌面页隐藏时停止对局轮询
4. 身份页优先使用当前 `gameStore.privateState.identity`；缺失时只补拉一次 `getGameSnapshot`，不启动独立轮询
5. 命令提交成功、版本冲突或阶段变化时立即补拉一次最新快照

轮询间隔建议：

- 当前页可见且本人有待办：`1000ms`
- 当前页可见但本人无待办：`1500ms`
- 刚提交命令后的 5 秒内：`800ms`
- 页面隐藏：停止轮询

### 10.5 同步触发点

以下情况必须立即 refresh：

1. 页面首次进入
2. `onShow`
3. 网络由断开变恢复
4. 命令提交成功且 `needsRefresh = true`
5. 收到 `VERSION_CONFLICT`
6. 收到 `PHASE_MISMATCH`
7. 收到 `DUPLICATE_COMMAND`

### 10.6 页面超时处理

大厅、对局桌面、结果页及其辅助页必须按后端房间 TTL 设置前端页面超时，避免页面长时间停留后继续展示旧房间：

- 大厅页：30 分钟
- 大厅规则页：沿用大厅页的同一个超时截止时间
- 对局桌面页：2 小时
- 身份页、历史记录页、对局规则页：沿用对局桌面页的同一个超时截止时间
- 结果页：30 分钟
- 结果页进入的规则页：沿用结果页的同一个超时截止时间

超时或轮询拉取快照收到 `ROOM_EXPIRED`、`ROOM_NOT_FOUND`、`NOT_ROOM_MEMBER` 时，页面必须：

1. 停止当前页轮询和页面超时定时器。
2. 清理前端运行态房间数据，例如 `activeRoom` 与初始大厅快照缓存。
3. 调用 `bootstrapService.clearActiveRoom` 清理当前用户的活跃房间恢复锚点。
4. `wx.reLaunch({ url: '/pages/home/index?pageTimedOut=1' })` 回到首页。
5. `App.onLaunch/onShow` 检测到 `pageTimedOut=1` 时跳过本轮活跃房间自动恢复。
6. 首页检测到 `pageTimedOut=1` 后弹出单按钮弹框，标题“页面已超时”，用户点击“确认”后关闭弹框。

页面首次进入时可使用本地阶段 TTL 建立兜底定时器；一旦成功拿到 `getLobbySnapshot`、`getGameSnapshot` 或 `getResultSnapshot`，必须以服务端返回的 `expireAt` 校准本地截止时间。辅助页通过路由参数继承主页面的绝对截止时间，不重新计算新的 TTL。

### 10.7 快照消费规则

页面始终按以下顺序消费：

1. 原始 DTO 进入 store
2. mapper 转成 VM
3. 页面浅比较变更
4. 仅对必要字段调用 `setData`

禁止做法：

- 每次更新把整份 snapshot 原样 `setData`
- 页面模板里直接访问深层后端字段

## 11. 写操作幂等与游戏命令提交设计

## 11.1 统一命令构造

大厅写操作统一经 `callWriteAction()` 自动注入 `commandId`。

所有游戏内操作统一经 `submitGameCommand()`：

```ts
interface SubmitGameCommandParams<T> {
  roomId: string
  type: CommandType
  body: T
  taskId?: string
}
```

内部自动补齐：

- `commandId`
- `expectedVersion`
- 当前任务场景下的 `taskId`

### 11.2 `commandId` 生成规则

前端实现建议：

```ts
${memberId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}
```

要求：

- 纯前端生成
- 当前会话唯一即可
- 不依赖第三方 uuid 库
- 同一逻辑动作重试必须复用同一个 `commandId`
- 所有房间写操作和游戏写操作共用同一套生成规则

### 11.3 锁机制

按钮点击后先加锁：

- key 优先使用 `pendingTask.taskId`
- 无 `taskId` 时退化为 `commandType`

锁释放时机：

1. 请求成功
2. 请求失败
3. 强制 refresh 完成

### 11.4 命令成功后的 UI 处理

命令成功后不做乐观更新，只做：

1. 标记“已提交”
2. 隐藏确认面板或切到等待态
3. 主动 refresh

例如投票：

- 点击 `JA`
- 二次确认
- 提交命令
- 页面显示“已提交，等待其他玩家”
- 等快照变更后再更新公共投票结果

### 11.5 特殊错误处理

| 错误码 | 前端处理 |
| --- | --- |
| `VERSION_CONFLICT` | 静默刷新，提示“状态已更新” |
| `PHASE_MISMATCH` | 静默刷新，关闭当前操作面板 |
| `DUPLICATE_COMMAND` | 视同已提交，立即刷新 |
| `NOT_CURRENT_ACTOR` | 关闭操作态，刷新快照 |
| `ACTION_NOT_ALLOWED` | 提示原因，不保留提交态 |

## 12. 页面设计

## 12.1 首页 `home`

### 页面职责

- 展示左上角圆形头像按钮
- 展示创建房间入口
- 展示加入房间入口，并在弹框中输入房号加入
- 恢复活跃房间

### `data` 字段

```ts
interface HomePageData {
  userProfileReady: boolean
  avatarUrl: string
  joinDialogVisible: boolean
  joinRoomCode: string
  joining: boolean
  recovering: boolean
  canRecover: boolean
  activeRoomCode: string
  errorText: string
}
```

### 主要方法

- `handleOpenUserProfile`
- `handleGoCreateRoom`
- `handleOpenJoinDialog`
- `handleCloseJoinDialog`
- `onJoinRoomCodeInput`
- `handleJoinRoom`
- `handleRecoverRoom`
- `handleShareEntry`

### 实现细节

1. 首页常驻内容只保留左上角圆形头像按钮、“创建房间”和“加入房间”两个入口按钮，参考 `reference/01-首页入口.png`，不在首页首屏直接展示房号输入框。
2. 点击“加入房间”后打开输入弹框；弹框内只包含房号输入、取消和确定，不提供“粘贴”按钮。用户可通过系统输入能力手动填写或复制后粘贴到输入框。
3. 房号输入在提交前统一去空格和连字符，只接受 6 位房号字符串；不在首页 UI 中暴露 `roomId` 加入入口。
4. 点击弹框“确定”后执行 `handleJoinRoom`：先校验房号，再检查本地用户资料，再上传房间临时头像并调用 `roomService.joinRoom(roomCode, localUserProfile)`。
5. 分享卡片带回 `roomCode` 时，首页只预填弹框输入值或在用户点击“加入房间”时带入该房号，不自动提交加入；用户仍需在弹框中点击“确定”确认。
6. 加入提交期间弹框确定按钮进入 loading / disabled 状态；失败时保留弹框并展示 toast 或就地错误，成功后关闭弹框并 `wx.redirectTo` 到大厅页。
7. 恢复房间只依赖后端 `recoverActiveRoom()` 结果，不信任本地缓存单独跳转。
8. 左上角头像使用圆形按钮：已有用户头像时展示头像，没有时展示默认头像；点击进入 `pages/user-profile/index`。
9. `handleGoCreateRoom` 与 `handleJoinRoom` 都必须先执行 `ensureUserProfileReady()`：本地缺少 `profileCompleted` 时，跳转创建用户页；创建用户页保存成功后只回首页，不自动继续创建或加入。若当前来自带 `roomCode` 的分享入口，返回首页时应保留该房号，用户再次点击“加入房间”后可继续确认加入。

## 12.2 创建用户页 `user-profile`

### 页面职责

- 首次创建用户资料
- 后续修改头像或用户名
- 点击“保存形象”后写入本地缓存并回到首页

### `data` 字段

```ts
interface UserProfilePageData {
  avatarUrl: string
  displayName: string
  saving: boolean
  errorText: string
}
```

### 主要方法

- `handleChooseAvatar`
- `onNicknameInput`
- `handleSaveAvatarProfile`

### 实现细节

1. 头像使用微信小程序当前支持的头像选择能力，例如 `button open-type="chooseAvatar"`；MVP 可优先使用默认头像或本地可用头像路径。创建用户页只保存本地资料，不上传头像到云存储。
2. 用户名输入优先使用微信昵称输入能力，例如 `input type="nickname"`，同时允许用户手动编辑。
3. 用户名去首尾空格后长度必须在 `1-20`；头像可为空，为空时使用默认头像。
4. “保存形象”按钮触发保存：成功后只写入 `wx.setStorageSync` 的用户资料缓存，并更新 `userProfileStore`，不调用云函数保存长期用户资料，也不产生 `user_avatars/` 这类长期头像资源。
5. 保存成功后统一回首页，不自动继续创建房间或加入房间；用户回到首页后重新点击对应入口。
6. 创建用户页只处理头像和用户名，不承载房间规则或对局设置。

## 12.3 创建房间页 `create-room`

### 页面职责

- 选择对局人数
- 创建房间

### `data` 字段

```ts
interface CreateRoomPageData {
  playerCount: number
  creating: boolean
  errorText: string
}
```

### 主要方法

- `handleSelectPlayerCount`
- `handleCreateRoom`

### 实现细节

1. 页面参考 `reference/02-创建房间.png`，人数范围固定为 `5-10`。
2. 创建成功后跳转房间大厅。
3. 选择人数用于创建时的目标人数与大厅展示；实际开局仍以后端校验的当前有效人数为准。

## 12.4 大厅页 `lobby`

### 页面职责

- 展示房间号
- 展示玩家列表与座位顺序
- 设置准备状态
- 房主开始游戏
- 发起分享

### `data` 字段

```ts
interface LobbyPageData {
  lobby: LobbyViewModel | null
  readySubmitting: boolean
  startSubmitting: boolean
  shareEnabled: boolean
}
```

### 座位展示策略

MVP 不支持房主调整座位，座位顺序由加入顺序初始化并在开局后锁定。大厅页只展示当前 `1-N` 座位、玩家名、准备状态与房主标识；后续 P1 座位管理再补充调整交互。

### 大厅页按钮策略

- 自己已准备：按钮显示“取消准备”
- 未准备：按钮显示“准备”
- 非房主不显示“开始游戏”
- 房主点击开始前弹出确认弹窗，避免误开局
- 确认后调用 `gameService.startGame(roomId)`；成功后根据 `routeHint` 进入对局桌面，并立即拉取 `gameService.getGameSnapshot(roomId)`

### 分享策略

- 只有大厅阶段允许分享房间
- 分享卡片 path：`/pages/home/index?roomCode=ABCD12`
- 分享文案不出现任何私密词汇，只写房号和人数信息

## 12.5 身份页 `identity`

### 页面职责

- 显示当前玩家自己的角色 / 党派 / 可知队友
- 点击“我知道了”返回对局桌面页

### `data` 字段

```ts
interface IdentityPageData {
  identity: IdentityViewModel | null
}
```

### 交互方案

1. 用户在对局桌面页点击“我的身份”，参考 `reference/04-对局桌面页.png`。
2. 前端跳转到身份页，页面参考 `reference/07-身份页.png`。
3. 身份页直接展示当前玩家自己的角色、党派、可知队友信息。
4. 用户点击“我知道了”后返回对局桌面页。

### 实现约束

- 不做遮罩、二次点击展示、定时隐藏或特殊保密逻辑。
- 不提交确认身份命令，点击“我知道了”只做页面返回。
- 身份数据只来自 `privateState.identity`，不写入本地缓存。

## 12.6 对局桌面页 `board`

### 页面职责

- 展示公共桌面
- 展示当前轮次 / 阶段 / 候选人 / 政策轨 / 选举轨 / 政策牌堆张数
- 展示个人待办任务
- 承载投票、提名、选牌、执行权力等私密交互
- 提供历史记录入口

### 页面布局

从上到下分 5 块：

1. `phase-banner`
2. `government-badge + tracks + deck-piles`
3. `seat-list`
4. `public-log`
5. `pending-task-card / private overlay`

### `data` 字段

```ts
interface BoardPageData {
  board: GameBoardViewModel | null
  task: PendingTaskViewModel | null
  actionPanelVisible: boolean
  submitting: boolean
}
```

### 页面实现细节

1. 公共桌面始终可见。
2. 页面提供“我的身份”入口，点击后跳转身份页。
3. 页面提供“历史记录”入口，点击后跳转 `packageRoom/pages/history/index`，携带 `roomId` 或复用当前 `gameStore` 的活跃房间上下文。
4. `pendingTask = null` 时显示“当前无需操作，等待其他玩家”。
5. 已出局玩家显示只读提示，不显示操作入口。
6. 规则入口固定在右上角。
7. 政策轨区域同时展示抽牌堆与弃牌堆：使用政策牌背图做堆叠卡牌视觉，旁边显示公开张数，不显示牌面、牌序或弃牌构成。

## 12.7 历史记录页 `history`

### 页面职责

- 参考 `reference/09-历史记录页.png` 完整实现局内历史记录页
- 从对局桌面页进入，返回后仍回到对局桌面页
- 展示本局公共总览、已开始轮次的逐轮记录和图例
- 当前轮未完成时展示已知事实与下一步状态，不出现无意义空白

### 页面视觉

历史记录页完全参考 `reference/09-历史记录页.png` 的信息层级与视觉气质：

- 深色档案 / 复古桌游桌面背景，铜色边框、细线分隔、旧纸纹理和低饱和红蓝对比
- 顶部为左上回退按钮、居中标题“历史记录”、房间号、人数局、当前轮标签
- 第一块大看板为总体情况，横向展示已进行轮次、自由派已颁布、极权派已颁布、当前选举轨
- 后续看板按轮次倒序或正序连续展示；MVP 按参考图正序展示，当前轮滚动到可见区域即可
- 每个轮次看板左侧为圆形轮次章，中部为总统提名总理与投票结果，底部为座位投票条，右侧为本轮结算徽章
- 页底展示图例：赞成、反对、已出局无法投票

### `data` 字段

```ts
interface HistoryPageData {
  history: GameHistoryViewModel | null
  loading: boolean
  errorText: string
}
```

### ViewModel

```ts
interface GameHistoryViewModel {
  roomId: string
  roomCode: string
  playerCount: number
  currentRound: number
  roundsStarted: number
  roundsCompleted: number
  tracks: {
    liberal: number
    fascist: number
    electionTracker: number
  }
  players: Array<{
    memberId: string
    seatIndex: number
    displayName: string
    isAlive: boolean
  }>
  rounds: RoundHistoryViewModel[]
}

interface RoundHistoryViewModel {
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
  presidentSeatIndex: number | null
  presidentName: string | null
  chancellorSeatIndex: number | null
  chancellorName: string | null
  voteSummary: {
    ja: number
    nein: number
    required: number
    revealed: boolean
  }
  votes: Array<{
    memberId: string
    seatIndex: number
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
    targetText?: string
  }
  executiveResult: {
    type: 'investigation' | 'special_election' | 'policy_peek' | 'execution'
    text: string
    presidentSeatIndex: number
    targetSeatIndex?: number
    targetMemberId?: string
  } | null
}
```

### 数据来源

- 页面进入时优先消费 `gameStore.snapshot.publicState.history`。
- 若 `gameStore` 中没有快照或版本落后，调用 `gameService.getGameSnapshot(roomId)` 刷新。
- 历史页只使用公共快照，不读取 `privateState`，不展示任何私密行动结果。

### 未完成轮次显示逻辑

当前轮数据不完整时按阶段渐进展示：

| 当前阶段 | 看板显示 |
| --- | --- |
| `nomination` | 展示总统候选人；总理位置显示“等待提名”；投票条为 `not_started`；右侧徽章显示“提名中” |
| `voting` | 展示候选总统 / 总理；已投票人数可在小字中显示，但单人投票条统一为 `pending`，右侧徽章显示“投票中” |
| 投票已公开且未通过 | 展示完整赞成 / 反对和每人投票，右侧徽章显示“未通过” |
| `hitler_check` | 展示候选政府已通过；右侧徽章显示“危险阶段判定中”，不展示内部判定细节 |
| `legislative_president` | 展示投票通过；右侧徽章显示“总统立法中”，不展示总统手牌或弃牌 |
| `legislative_chancellor` | 展示投票通过；右侧徽章显示“总理立法中”，不展示总理手牌 |
| `veto_response` | 展示投票通过；右侧徽章显示“否决待确认” |
| `executive_action` | 右侧徽章继续展示本轮已颁布政策；总统权力尚未完成时不在政策下方额外显示“权力执行中”，避免下一轮后残留阶段态 |
| `round_result` | 展示本轮公开结算；若下一轮即将开始，右侧徽章显示最终结算 |

显示原则：

1. 未公开单人投票前，不显示赞成 / 反对分布，避免泄露。
2. 已出局玩家在投票条中使用骷髅态，并显示“已出局无法投票”。
3. 尚未发生的节点使用明确状态文案，例如“等待提名”“投票中”“立法中”，不留空白。
4. 右侧徽章只展示本轮投票 / 政策 / 胜负结算，不展示“调查忠诚”“特别选举”“政策预览”“处决”等总统权力类型。
5. 总统权力完成后，在本轮投票列表下方新增一行公开结果文案，例如“5号总统处决了6号玩家”“5号总统特别任命了6号玩家”“5号总统调查了6号玩家”；政策预览显示“5号总统查看了政策牌堆顶”。
6. 调查忠诚只展示调查目标，不展示阵营结果。
7. 政策预览只展示已查看动作，不展示牌面。
8. 处决展示被处决座位与出局态；若处决直接终局，结果页再展示身份真相。

### 交互方案

- 左上角回退按钮使用可点击 `view`，保留 `role="button"` 与 `aria-label="返回对局桌面"`，避免原生 `button` 默认样式偏移。
- 页面不提供主动命令操作，不需要 `expectedVersion`。
- 页面可随对局桌面轮询刷新；若刷新到 `game_ended`，保留当前页展示并提示可返回桌面进入结果页，或由全局路由统一跳转结果页。

## 12.8 结果页 `result`

### 页面职责

- 展示胜利阵营
- 展示胜利原因
- 展示最终身份
- 展示关键回合时间线

### `data` 字段

```ts
interface ResultPageData {
  result: ResultViewModel | null
  loading: boolean
}
```

### 结果页交互

- 支持“返回首页”
- 支持“查看规则”
- 不支持重新加入已失效旧局

## 12.9 规则页 `rules`

规则页不直接读取 markdown，而是消费 `static/rulesContent.ts` 的结构化数据：

```ts
interface RuleSection {
  id: string
  title: string
  items: string[]
}
```

原因：

1. 小程序前端不适合在运行时解析本地 markdown。
2. 规则页只需要局内可读的精简摘要。
3. 开发时可手工维护一份与 `/docs/game_rules.md` 对齐的结构化文案。

## 13. 组件设计

## 13.1 组件总原则

1. 组件只接收 `props` 与触发事件，不直接调云函数。
2. 组件不持有跨页状态。
3. 组件不保存敏感信息到本地缓存。
4. 复杂组件内部使用 `pureDataPattern` 保存非渲染字段。

## 13.2 关键组件协议

| 组件 | 作用 | 核心 props | 核心事件 |
| --- | --- | --- | --- |
| `seat-list` | 渲染座位列表 | `players`, `mode`, `allowedTargets` | `move`, `select` |
| `phase-banner` | 阶段提示 | `phase`, `title`, `description`, `danger` | 无 |
| `policy-track` | 渲染政策轨 | `liberalCount`, `fascistCount`, `vetoUnlocked` | 无 |
| `election-track` | 渲染选举轨 | `count` | 无 |
| `deck-piles` | 渲染抽牌堆 / 弃牌堆计数 | `drawCount`, `discardCount` | 无 |
| `public-log` | 渲染最近公开事件 | `items` | `expand` |
| `history-summary-board` | 历史页总体情况看板 | `summary` | 无 |
| `round-history-card` | 历史页单轮记录看板 | `round`, `players` | 无 |
| `pending-task-card` | 当前待办入口 | `task`, `submitting` | `open` |
| `vote-panel` | 投票面板 | `visible` | `confirmVote`, `cancel` |
| `policy-picker` | 政策牌选择 | `visible`, `cards`, `mode` | `confirmPick`, `cancel` |
| `target-picker` | 选择玩家目标 | `visible`, `targets`, `mode` | `confirmTarget`, `cancel` |
| `secret-panel` | 展示当前玩家临时可见信息，如政策预览 | `visible`, `contentType`, `content` | `confirm`, `close` |
| `state-feedback` | 空态 / 错误 / loading | `status`, `text` | `retry` |

### 13.3 组件实现细节

#### `seat-list`

- 默认线性列表，不做圆桌布局
- 每一项展示：座位号、昵称、存活状态、准备状态、政府标记、可选择高亮
- MVP 大厅模式不展示 `上移` / `下移`，P1 座位管理再扩展移动事件

#### `public-log`

- 桌面页只展示最近 `8-12` 条摘要
- 结果页展示完整时间线
- 日志只渲染后端已公开事件

#### `deck-piles`

- 抽牌堆与弃牌堆均使用本地或云存储的政策牌背素材，避免用纯 CSS 方块代替主要视觉。
- 数字徽章只展示张数：`drawCount`、`discardCount`。
- `drawCount = 0` 或 `discardCount = 0` 时保留空堆占位，避免桌面布局跳动。
- 组件不得接收或渲染牌面数组；任何牌面、牌序、弃牌构成都只能存在于后端内部状态或当前玩家私密任务中。

#### `policy-picker`

- `mode = discard_one` 时显示“选择要弃掉的 1 张”
- `mode = enact_one` 时显示“选择要颁布的 1 张”
- 只显示当前用户在当前阶段可操作的牌

## 14. 后端视图到 ViewModel 的映射

## 14.1 为什么必须加 mapper

后端返回的是“领域视图”，页面需要的是“渲染视图”。两者不能混用。

例如：

- 后端返回 `publicState.currentPresidentCandidateId`
- 页面需要的是 `presidentName`, `presidentSeatIndex`, `presidentAlive`

所以必须存在 mapper 层。

## 14.2 `lobbyMapper`

输出：

```ts
interface LobbyViewModel {
  roomId: string
  roomCode: string
  myMemberId: string
  isHost: boolean
  myIsReady: boolean
  canStart: boolean
  players: Array<{
    memberId: string
    displayName: string
    avatarUrl: string
    seatIndex: number
    isHost: boolean
    isReady: boolean
    isSelf: boolean
  }>
  summaryText: string
}
```

其中 `myMemberId / isHost / myIsReady / canStart` 来自大厅响应中的 `viewerState`，前端不得把它们视为房间公共事实。

## 14.3 `gameMapper`

输出：

```ts
interface GameBoardViewModel {
  roomId: string
  roomCode: string
  version: number
  round: number
  phase: Phase
  phaseTitle: string
  phaseDescription: string
  players: SeatViewModel[]
  government: GovernmentViewModel
  tracks: {
    liberal: number
    fascist: number
    electionTracker: number
    vetoUnlocked: boolean
  }
  deckPiles: {
    drawCount: number
    discardCount: number
  }
  publicLogs: PublicLogItem[]
  history: GameHistoryViewModel
  dangerFlags: string[]
}
```

### 14.4 `taskMapper`

输出统一任务模型：

```ts
interface PendingTaskViewModel {
  taskId: string
  taskType: TaskType
  title: string
  description: string
  actionMode:
    | 'vote'
    | 'pick_policy'
    | 'pick_target'
    | 'confirm_only'
    | 'respond_veto'
    | 'none'
  targets?: TargetOption[]
  cards?: PolicyCardVm[]
  extra?: Record<string, unknown>
}
```

这样桌面页只判断 `actionMode`，不直接写一堆 phase if-else。

## 15. 各阶段待办任务实现

## 15.1 `NOMINATE_CHANCELLOR`

- 页面：`board`
- 组件：`target-picker`
- 数据源：`pendingTask.allowedTargets`、`pendingTask.meta.targetOptions`
- UI 要求：
  - 不可选玩家显示置灰和禁用原因
  - 显示“上一届政府任期限制”提示文案

## 15.2 `SUBMIT_VOTE`

- 页面：`board`
- 组件：`vote-panel`
- UI：
  - 两个大按钮 `Ja` / `Nein`
  - 选择后弹出确认弹窗
  - 提交后显示等待态

## 15.3 `PRESIDENT_DISCARD_POLICY`

- 页面：`board`
- 组件：`policy-picker`
- 数据源：`privateState.legislative.hand`
- UI：
  - 文案“请选择 1 张弃掉”
  - 提交前二次确认

## 15.5 `CHANCELLOR_ENACT_POLICY`

- 页面：`board`
- 组件：`policy-picker`
- 数据源：`privateState.legislative.hand`
- UI：
  - 文案“请选择 1 张颁布”
  - 若 `extra.canRequestVeto = true`，额外展示“请求否决”

## 15.6 `PRESIDENT_RESPOND_VETO`

- 页面：`board`
- 组件：`pending-task-card`
- UI：
  - 两按钮：`接受否决` / `拒绝否决`
  - 接受属于危险操作，按钮使用警示样式

## 15.7 `EXEC_INVESTIGATE`

- 页面：`board`
- 组件：`target-picker`
- 数据源：`allowedTargets`
- UI：
  - 只显示合法目标
  - 已调查过的人不出现在可选列表中，或显示禁用原因

## 15.8 `EXEC_SPECIAL_ELECTION`

- 页面：`board`
- 组件：`target-picker`
- UI：
  - 禁止选择自己
  - 文案明确“指定下一轮临时总统”

## 15.9 `EXEC_POLICY_PEEK_ACK`

- 页面：`board`
- 组件：`secret-panel`
- 数据源：`privateState.policyPeek.cards`
- UI：
  - 展示 3 张牌面
  - 点击确认后提交 `EXEC_POLICY_PEEK_ACK`

## 15.10 `EXECUTE_PLAYER`

- 页面：`board`
- 组件：`target-picker`
- UI：
  - 使用危险色样式
  - 提交前必须二次确认
  - 文案明确“该操作不可撤销”
  - 若后端 `allowedTargets` 包含当前总统本人，前端不得自行过滤该选项

## 16. 前后端联调正式契约

`/docs/front_back_api.md` 已经冻结了正式接口协议，本节只保留前端必须直接消费的关键契约。

## 16.1 `pendingTask.meta` 正式消费规则

前端只消费无法从 `publicState`、`privateState`、`allowedTargets` 推导出的 `meta` 字段。

| `taskType` | 正式 `meta` |
| --- | --- |
| `NOMINATE_CHANCELLOR` | `ruleHint` |
| `SUBMIT_VOTE` | `options = ["JA", "NEIN"]` |
| `PRESIDENT_DISCARD_POLICY` | `selectionMode = "discard_one"` |
| `CHANCELLOR_ENACT_POLICY` | `selectionMode = "enact_one"`、`canRequestVeto` |
| `PRESIDENT_RESPOND_VETO` | `options = [true, false]`、`requestedByMemberId` |
| `EXEC_INVESTIGATE` | `actionTitle`、`actionHint` |
| `EXEC_SPECIAL_ELECTION` | `actionTitle`、`actionHint` |
| `EXEC_POLICY_PEEK_ACK` | 可为空，允许补充 `confirmText` |
| `EXECUTE_PLAYER` | `actionTitle`、`actionHint`、`dangerConfirmText` |

实现原则：

1. 目标类任务的候选人列表统一从 `pendingTask.allowedTargets + publicState.seatOrder` 派生。
2. 命名、文案和危险提示优先消费 `meta`，但不以 `meta` 复制公共状态字段。
3. `CHANCELLOR_REQUEST_VETO` 不单独生成任务卡，而是作为 `CHANCELLOR_ENACT_POLICY` 的次级动作。

## 16.2 `privateState` 正式最小字段

为支持前端私密 UI，正式最小结构如下：

```ts
interface PrivateState {
  identity: {
    role: 'LIBERAL' | 'FASCIST' | 'HITLER'
    party: 'LIBERAL' | 'FASCIST'
    knownMembers: Array<{ memberId: string; displayName: string; avatarUrl: string }>
  }
  voting: {
    submitted: boolean
    myVote: 'JA' | 'NEIN' | null
  } | null
  legislative: {
    hand: Array<'LIBERAL' | 'FASCIST'>
    action: 'discard_one' | 'enact_one'
    canRequestVeto: boolean
  } | null
  investigationResult: {
    targetMemberId: string
    targetDisplayName: string
    party: 'LIBERAL' | 'FASCIST'
    revealedAt: string
  } | null
  policyPeek: {
    cards: Array<'LIBERAL' | 'FASCIST'>
    viewedAt: string
  } | null
}
```

## 16.3 `getResultSnapshot` 正式最小结构

结果页必须至少消费以下结构：

```ts
interface ResultSnapshot {
  roomId: string
  roomCode: string
  roomStatus: 'ended'
  myMemberId: string
  version: number
	  winner: 'LIBERAL' | 'FASCIST'
	  winReason: string
	  endedAt: string
	  expireAt: string
	  policySummary: {
    liberal: number
    fascist: number
  }
  finalPlayers: Array<{
    memberId: string
    displayName: string
    avatarUrl: string
    seatIndex: number
    role: 'LIBERAL' | 'FASCIST' | 'HITLER'
    party: 'LIBERAL' | 'FASCIST'
    isAlive: boolean
  }>
  timeline: Array<{
    eventId: string
    round: number
    phase: string
    type: string
    title: string
    summary: string
    createdAt: string
  }>
}
```

## 16.4 `allowedActions` 的处理结论

本方案结论保持不变：

1. MVP 前端只依赖 `pendingTask` 作为主动操作入口。
2. `allowedActions` 不作为必需字段。
3. 若后续要做更细粒度禁用态，再单独扩展协议并更新 `/docs/front_back_api.md`。

## 17. 错误处理与用户提示

## 17.1 错误分层

前端错误只分三层：

1. 可直接重试
2. 需要刷新状态
3. 需要跳回首页 / 结束页

### 17.2 错误码映射建议

| 错误码 | 页面策略 | 用户文案 |
| --- | --- | --- |
| `ROOM_NOT_FOUND` | 首页留在当前页 | 房间不存在 |
| `ROOM_EXPIRED` | 弹窗后回首页 | 房间已失效 |
| `ROOM_FULL` | 留在首页 | 房间已满 |
| `ROOM_NOT_JOINABLE` | 留在首页 | 房间当前不可加入 |
| `NOT_ROOM_HOST` | 就地提示 | 只有房主可执行该操作 |
| `NOT_ALL_READY` | 大厅页提示 | 还有玩家未准备 |
| `GAME_ALREADY_STARTED` | 跳转桌面页 | 对局已开始，正在为你恢复 |
| `GAME_ALREADY_ENDED` | 跳转结果页 | 对局已结束 |
| `VERSION_CONFLICT` | 刷新当前快照 | 状态已更新 |
| `PHASE_MISMATCH` | 刷新当前快照 | 当前阶段已变化 |
| `INVALID_TARGET` | 保留当前页 | 目标已不可选 |
| `TARGET_ALREADY_DEAD` | 刷新当前快照 | 目标已出局 |
| `TARGET_ALREADY_INVESTIGATED` | 刷新当前快照 | 该玩家已被调查过 |
| `INTERNAL_ERROR` | 提供重试入口 | 系统繁忙，请稍后重试 |

### 17.3 云函数异常兜底

对非标准 envelope 异常，统一映射为：

- `code = INTERNAL_ERROR`
- `retryable = true`

同时记录：

- function name
- action
- request payload 摘要
- `requestId`（若有）

## 18. 隐私与安全实现细节

## 18.1 允许持久化的字段

可写入 `wx.setStorageSync` 的只有：

- `profileCompleted`
- `displayName`
- `avatarUrl`：仅表示本地头像路径、默认头像标识或前端可展示的临时地址；不能把它当作长期云端用户头像
- `activeRoomId`
- `activeRoomCode`
- `activeMemberId`
- `activeRoomStatus`
- `lastRecoverAt`

## 18.2 禁止持久化的字段

不得写入本地缓存：

- 身份角色
- 阵营
- 队友信息
- 政策牌手牌
- 调查结果
- 预览结果
- 未公开投票

## 18.3 身份页查看策略

身份页是从对局桌面页打开的普通查看页：

1. 对局桌面页提供“我的身份”入口。
2. 身份页直接展示当前用户自己的身份切片。
3. 点击“我知道了”返回对局桌面页。
4. 不做遮罩、定时隐藏、二次确认或身份确认提交。

## 18.4 房主权限边界

前端在 UI 上也必须体现“房主不是裁判”：

- 房主只多显示大厅管理按钮
- 开局后房主不多出任何隐藏信息入口
- 不出现“房主面板”或“裁判模式”概念

## 19. 样式与视觉实现规范

## 19.1 视觉基调

以“规则清晰、状态明确、私密安全”为优先级，不追求复杂炫技。

色彩建议：

- 中性背景：浅灰米白
- 自由派：深蓝 / 青蓝
- 极权派：深红 / 暗红
- 危险操作：高对比警示红
- 禁用态：低饱和灰

### 19.2 WXSS 组织方式

- `styles/reset.wxss`：基础重置
- `styles/theme.wxss`：色彩、字号、间距类
- `styles/utilities.wxss`：通用布局类

每个页面 / 组件仍保留自己的局部样式，不做全局 utility-first 架构。

### 19.3 样式命名

统一 BEM 风格简化版：

- `board__header`
- `board__section`
- `seat-item--active`
- `action-panel--danger`

### 19.4 交互反馈规范

- 所有提交按钮必须有 loading 态
- 所有禁用按钮必须有禁用原因文案
- 危险操作必须有确认弹窗
- 公共状态变化尽量用轻提示，不使用大面积弹窗打断

## 20. 性能实现要求

## 20.1 `setData` 约束

1. 页面只 `setData` 渲染必须字段
2. 对比前后 VM，没变就不更新
3. 公共日志只增量更新，不整段替换
4. 大对象保存在 JS 内存，不直接挂到 `data`

### 20.2 图片与资源

MVP 尽量少图化：

- 优先使用纯色块、徽章和文字
- 角色卡、政策卡优先用样式绘制，不依赖大图
- 小于等于 `200K` 的前端页面元素图片可放在 `frontend/assets/images/`
- 大于 `200K` 的图片必须放到微信云存储，不能进入主包
- 云存储图片需在 `reference/` 目录保留一份源文件备份，如 `reference/background-home.png`
- 云存储图片在页面侧通过 `wx.cloud.getTempFileURL` 获取临时 HTTPS 地址后再绑定到 `image.src`
- 默认玩家头像放在 `frontend/assets/images/avatars/`
- 用户自定义头像仅在创建 / 加入房间时上传为房间临时头像；`ended` 复盘期继续使用，房间进入 `expired` 或维护清理时由后端删除
- 装饰性小图放在 `frontend/assets/images/decorations/`
- 静态小图标统一放在 `frontend/assets/images/icons/`
- 页面代码引用本地资源时使用项目内绝对路径，如 `/assets/images/avatars/default-player.png`

### 20.3 页面复杂度控制

- 桌面页不做重型动画
- 座位列表不做复杂 canvas 渲染
- 优先确保真机低端机也能流畅切页

## 21. 测试与联调方案

## 21.1 单元测试优先范围

应优先覆盖纯逻辑模块：

- `lobbyMapper`
- `gameMapper`
- `taskMapper`
- `errorMapper`
- `router.resolveRouteBySnapshot`
- `submitGameCommand` 锁逻辑

## 21.2 联调检查清单

每个阶段至少覆盖以下真机用例：

1. 创建用户 -> 回首页 -> 创建房间 -> 加入房间 -> 准备 -> 开局
2. 桌面页点击“我的身份” -> 身份页点击“我知道了” -> 返回桌面
3. 提名 -> 投票通过 / 失败
4. 三连败自动翻牌
5. 总统弃牌 -> 总理立法
6. 第 5 张极权派政策后的否决流程
7. 调查 / 特别选举 / 预览 / 处决
8. 独裁者当选即时结束
9. 处决独裁者结束
10. 对局结束 -> 结果页

## 21.3 弱网与恢复测试

必须专门测试：

1. 投票提交时断网
2. 选牌中切后台
3. 提交成功但前端超时
4. 页面在旧 version 上发命令
5. 房间失效后从分享卡片回流

## 21.4 开发者调试模式

个人开发阶段需要支持一人手动验收完整对局流程。具体方案以 `/docs/develop_mode.md` 为准。

前端实现时必须遵守：

- 调试入口、调试面板、开发者房间创建入口必须受编译宏或环境配置控制。
- 生产包不注册可访问的调试入口页面，不展示调试面板。
- 第一阶段只做最短闭环：创建开发者房间、一键补齐虚拟玩家、设置虚拟玩家准备、本地切换操控席位、查看身份、提交合法游戏命令并跑完整局。
- 席位视角切换只保存在前端本地 `controlledMemberId`，不做持久化的 `devSwitchControlledSeat`。
- 席位视角切换后必须带 `controlledMemberId` 重新拉取该席位对应的公共快照和私密快照。
- 调试模式下的游戏内操作仍通过正式服务层提交命令，并携带 `commandId`、`expectedVersion` 和当前 `controlledMemberId`，不用本地状态伪造流程推进。
- 场景种子、身份总览、包含牌序或构成的牌堆摘要、复杂事件日志暂不进入第一阶段；正式桌面的抽牌堆 / 弃牌堆张数属于公共信息展示，应随对局桌面实现。

## 22. 开发顺序建议

推荐按以下顺序落地，而不是并行铺开所有页面。

### 阶段 1：基础壳

- 重写首页、创建用户页与创建房间页
- 接入 `bootstrapService`
- 建好 `types / store / services / constants`
- 跑通 `createRoom / joinRoom / recoverActiveRoom`

### 阶段 2：大厅

- 大厅页
- 准备
- 开始游戏（调用 `gameService.startGame`）
- 分享

### 阶段 3：桌面与身份查看

- 桌面页公共区
- “我的身份”入口与身份页返回
- 路由决策器
- 快照同步

### 阶段 4：任务面板

- 提名
- 投票
- 总统弃牌
- 总理立法
- 否决响应
- 总统权力动作

### 阶段 5：结果与规则

- 结果页
- 时间线
- 规则页

### 阶段 6：稳定性与细节

- 弱网恢复
- 错误码处理
- 空态 / loading / 重试

## 23. 最终实施结论

前端最终实现应收敛为以下形态：

1. 原生微信小程序 + TypeScript。
2. 页面只消费快照 view-model，不操作核心真相。
3. 开局统一走 `gameService.startGame`，游戏内命令统一走 `submitGameCommand`；所有写操作强制带 `commandId`，除 `startGame` 外的游戏内命令强制带 `expectedVersion`。
4. 数据同步采用“云函数轮询读取快照”。
5. 大厅与对局页面分包，规则与结果独立分包。
6. 身份页只做“我的身份”查看与“我知道了”返回，不增加遮罩、定时或确认命令。
7. MVP 先保证流程正确、状态清晰、恢复稳定，再做视觉增强。

如果后续实现与本方案冲突，以：

1. `/docs/front_back_api.md` 的正式字段定义
2. `/docs/game_rules.md` 的规则正确性
3. `/docs/secret_hitler_prd.md` 的产品边界

为最终裁决依据。
