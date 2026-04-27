# 《揭秘希特勒面杀助手》前端详细技术方案

## 1. 文档目标

本文档的目标不是重复 PRD，而是给后续前端代码开发提供一份可直接落地的实现方案，覆盖：

- 小程序目录与模块划分
- 页面路由与分包
- 状态管理
- 云函数调用与快照同步
- 页面 / 组件协议
- 阶段任务 UI 实现
- 隐私保护、异常恢复、性能与测试

后续前端开发应以本文档为直接编码依据；若实际实现需要修改接口字段或交互契约，必须先同步更新 `/docs/front_back_api.md`。

## 2. 现状与设计前提

### 2.1 当前仓库现状

当前仓库仍是微信云开发 QuickStart 模板，前端目录只有示例页：

- `miniprogram/pages/index`
- `miniprogram/pages/example`

这意味着后续开发应直接在现有小程序壳上重构，而不是继续在示例页上堆功能。

### 2.2 不可违反的上位约束

结合已有文档，前端必须严格遵守以下约束：

1. 前端不是裁判，不负责规则真相、胜负判定、身份分配、牌堆逻辑。
2. 所有写操作只能通过 `wx.cloud.callFunction` 发起命令。
3. 页面只能渲染大厅快照、游戏公共快照、当前玩家私密快照，不能持有完整真相。
4. 隐私信息必须默认遮罩，切后台后要立即回到安全态。
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
- 数据同步：`云函数命令 + 云函数轮询读取快照`

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

### 3.3 从当前 JS 模板到 TS 结构的迁移策略

由于当前项目仍是 JS 模板，建议按以下顺序迁移：

1. 保留现有 `app.js` 作为可运行壳。
2. 先新建 `miniprogram/services`、`store`、`types`、`utils`。
3. 新业务页面优先使用 TypeScript。
4. 首页与示例页替换完成后，再删除 QuickStart 示例逻辑。

换言之，迁移是“先扩建新结构，再清理旧模板”，不要一次性大改所有文件。

## 4. 目标目录结构

建议最终前端目录结构如下：

```text
miniprogram/
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
    privacy-mask/
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
```

## 5. 分包与路由方案

### 5.1 页面划分

建议页面保留 6 个页面，其中 5 个主流程页面 + 1 个辅助规则页：

| 页面 | 路径 | 作用 |
| --- | --- | --- |
| 首页 | `pages/home/index` | 创建房间、加入房间、恢复活跃房间 |
| 房间大厅 | `packageRoom/pages/lobby/index` | 展示房间、座位、准备、开始 |
| 身份页 | `packageRoom/pages/identity/index` | 查看并确认个人身份 |
| 对局桌面页 | `packageRoom/pages/board/index` | 公共桌面 + 当前私密任务 |
| 结果页 | `packageResult/pages/result/index` | 终局结果与复盘 |
| 规则页 | `packageRoom/pages/rules/index` | 局内规则说明 |

### 5.2 `app.json` 建议结构

```json
{
  "pages": [
    "pages/home/index"
  ],
  "subpackages": [
    {
      "root": "packageRoom",
      "pages": [
        "pages/lobby/index",
        "pages/identity/index",
        "pages/board/index",
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
| `roomStatus = in_game` 且 `currentPhase = role_reveal` | 身份页 |
| `roomStatus = in_game` 且 `currentPhase != role_reveal` | 对局桌面页 |
| `roomStatus = ended` 或 `currentPhase = game_ended` | 结果页 |
| `roomStatus = expired` | 首页 |

### 5.4 页面栈策略

- `home -> lobby`：`wx.redirectTo`
- `lobby -> identity`：`wx.redirectTo`
- `identity -> board`：`wx.redirectTo`
- `board -> result`：`wx.redirectTo`
- `rules`：统一 `wx.navigateTo`
- 退出房间 / 房间失效：`wx.reLaunch({ url: '/pages/home/index' })`

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
4. 加载本地缓存的非敏感上下文
5. 注册 `wx.onNetworkStatusChange`

### 6.3 `onShow`

执行顺序：

1. 记录页面回流时间
2. 发布全局“应用回到前台”事件
3. 若带 `roomCode` 分享参数，优先尝试恢复 / 加入目标房间
4. 调用 `bootstrapService.recoverActiveRoom()`
5. 按返回结果决定是否自动跳转

### 6.4 `onHide`

`onHide` 不做业务提交，只做安全态处理：

1. 向当前页面广播 `APP_HIDDEN`
2. 所有私密面板立刻重新遮罩
3. 清空组件中的“已展开私密内容”局部状态
4. 停止当前页面的轮询计时器

注意：只重置“显示态”，不清空内存中的快照对象；这样回前台后可以快速恢复，同时又不会在 UI 上裸露敏感信息。

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
  ROLE_REVEAL: 'role_reveal',
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
  lobbySnapshot: LobbySnapshot | null
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
  privacyShieldVisible: boolean
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

- `createRoom(displayName)`
- `joinRoom(roomCode, displayName)`
- `leaveRoom(roomId)`
- `getLobbySnapshot(roomId)`
- `updateDisplayName(roomId, displayName)`
- `updateSeatOrder(roomId, orderedMemberIds)`
- `setReady(roomId, ready)`
- `startGame(roomId)`

补充约束：

- 除 `getLobbySnapshot` 外，其余方法都属于写操作，必须通过 `callWriteAction` 自动补齐 `commandId`
- `createRoom`、`joinRoom` 成功后直接返回 `lobbySnapshot`
- `startGame` 成功后只以返回的 `routeHint / needsRefresh` 作为跳转依据，正式桌面数据仍通过 `getGameSnapshot` 获取

### 9.4 `gameService`

必须包含：

- `getGameSnapshot(roomId)`
- `submitCommand(command)`
- `getResultSnapshot(roomId)`

补充约束：

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

## 10. 快照同步设计

## 10.1 同步策略结论

采用“轮询优先”的单一方案。MVP 阶段不直接读取或监听数据库投影文档，所有快照都通过云函数 action 拉取。

### 10.2 轮询读取入口

前端只通过以下 service 方法读取快照：

- 大厅：`roomService.getLobbySnapshot(roomId)`
- 对局：`gameService.getGameSnapshot(roomId)`
- 结果：`gameService.getResultSnapshot(roomId)`

这样做的原因：

1. 不需要向前端开放数据库集合读取或监听权限。
2. 私密快照始终由云函数按当前微信身份合并返回。
3. 前端读取来源单一，mapper 不需要为监听数据和接口数据分叉。

### 10.3 大厅同步流程

1. 进入大厅页先主动调用一次 `getLobbySnapshot`
2. 页面可见时启动大厅轮询
3. 页面隐藏时停止大厅轮询
4. 命令提交成功后立即补拉一次最新快照

轮询间隔建议：

- 页面可见：`2000ms`
- 页面隐藏：停止轮询

### 10.4 对局同步流程

1. 进入身份页 / 桌面页先主动 `getGameSnapshot`
2. 页面可见时启动对局轮询
3. 页面隐藏时停止对局轮询
4. 命令提交成功、版本冲突或阶段变化时立即补拉一次最新快照

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

### 10.6 快照消费规则

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

- 输入展示名
- 创建房间
- 输入房号加入
- 恢复活跃房间

### `data` 字段

```ts
interface HomePageData {
  displayName: string
  roomCode: string
  creating: boolean
  joining: boolean
  recovering: boolean
  canRecover: boolean
  activeRoomCode: string
  errorText: string
}
```

### 主要方法

- `onDisplayNameInput`
- `onRoomCodeInput`
- `handleCreateRoom`
- `handleJoinRoom`
- `handleRecoverRoom`
- `handleShareEntry`

### 实现细节

1. 展示名默认取本地缓存，没有则给出随机占位，如“玩家1234”。
2. 房号输入统一转大写、去空格。
3. 创建 / 加入共用 `state-feedback` 组件展示 loading 与错误。
4. 恢复房间只依赖后端 `recoverActiveRoom()` 结果，不信任本地缓存单独跳转。

## 12.2 大厅页 `lobby`

### 页面职责

- 展示房间号
- 展示玩家列表与座位顺序
- 修改展示名
- 设置准备状态
- 房主调整座位
- 房主开始游戏
- 发起分享

### `data` 字段

```ts
interface LobbyPageData {
  lobby: LobbyViewModel | null
  renaming: boolean
  readySubmitting: boolean
  startSubmitting: boolean
  seatSubmitting: boolean
  shareEnabled: boolean
}
```

### MVP 座位调整交互

不做复杂拖拽，改用更稳的“上移 / 下移”方案：

- 房主视角下，每个座位项显示 `上移` / `下移`
- 点击后生成新的 `orderedMemberIds`
- 调用 `updateSeatOrder`

原因：

1. 微信小程序拖拽实现复杂、误触成本高。
2. 线下玩家数最多 10 人，上下移动足够。
3. 更利于后续联调和异常排查。

### 大厅页按钮策略

- 自己已准备：按钮显示“取消准备”
- 未准备：按钮显示“准备”
- 非房主不显示“开始游戏”
- 房主点击开始前弹出确认弹窗，避免误开局

### 分享策略

- 只有大厅阶段允许分享房间
- 分享卡片 path：`/pages/home/index?roomCode=ABCD12`
- 分享文案不出现任何私密词汇，只写房号和人数信息

## 12.3 身份页 `identity`

### 页面职责

- 私密显示角色 / 党派 / 可知队友
- 玩家确认已查看身份

### `data` 字段

```ts
interface IdentityPageData {
  identity: IdentityViewModel | null
  revealed: boolean
  ackSubmitting: boolean
  privacyShieldVisible: boolean
}
```

### 交互方案

1. 初始只显示“请确认周围安全后查看身份”
2. 点击后 `revealed = true`
3. 再显示角色卡、党派卡、队友信息
4. 页面顶部固定显示“请勿向他人展示本页”
5. 用户点击“我已查看”后提交 `ACK_ROLE_REVEAL`

### 安全态处理

- `onHide` 时强制 `revealed = false`
- 回到前台后需再次手动显示
- 不把身份信息写入本地缓存

## 12.4 对局桌面页 `board`

### 页面职责

- 展示公共桌面
- 展示当前轮次 / 阶段 / 候选人 / 政策轨 / 选举轨
- 展示个人待办任务
- 承载投票、提名、选牌、执行权力等私密交互

### 页面布局

从上到下分 5 块：

1. `phase-banner`
2. `government-badge + tracks`
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
  privacyShieldVisible: boolean
}
```

### 页面实现细节

1. 公共桌面始终可见。
2. 私密任务使用全屏遮罩层组件，不单独跳新页面。
3. `pendingTask = null` 时显示“当前无需操作，等待其他玩家”。
4. 已出局玩家显示只读提示，不显示操作入口。
5. 规则入口固定在右上角。

## 12.5 结果页 `result`

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

## 12.6 规则页 `rules`

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
| `public-log` | 渲染最近公开事件 | `items` | `expand` |
| `pending-task-card` | 当前待办入口 | `task`, `submitting` | `open` |
| `vote-panel` | 投票面板 | `visible` | `confirmVote`, `cancel` |
| `policy-picker` | 政策牌选择 | `visible`, `cards`, `mode` | `confirmPick`, `cancel` |
| `target-picker` | 选择玩家目标 | `visible`, `targets`, `mode` | `confirmTarget`, `cancel` |
| `secret-panel` | 私密信息显示 | `visible`, `masked`, `contentType` | `reveal`, `close` |
| `privacy-mask` | 应用切后台安全遮罩 | `visible` | 无 |
| `state-feedback` | 空态 / 错误 / loading | `status`, `text` | `retry` |

### 13.3 组件实现细节

#### `seat-list`

- 默认线性列表，不做圆桌布局
- 每一项展示：座位号、昵称、存活状态、准备状态、政府标记、可选择高亮
- 房主模式下可出现 `上移` / `下移`

#### `public-log`

- 桌面页只展示最近 `8-12` 条摘要
- 结果页展示完整时间线
- 日志只渲染后端已公开事件

#### `policy-picker`

- `mode = discard_one` 时显示“选择要弃掉的 1 张”
- `mode = enact_one` 时显示“选择要颁布的 1 张”
- 卡牌默认遮罩，点击后只显示当前用户手牌

#### `privacy-mask`

- 由 `uiStore.privacyShieldVisible` 控制
- 文案固定为“已进入安全模式，请确认周围环境后重新查看”

## 14. 快照到 ViewModel 的映射

## 14.1 为什么必须加 mapper

后端快照是“领域视图”，页面需要的是“渲染视图”。两者不能混用。

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
  canStart: boolean
  players: Array<{
    memberId: string
    displayName: string
    seatIndex: number
    isHost: boolean
    isReady: boolean
    isSelf: boolean
  }>
  summaryText: string
}
```

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
  publicLogs: PublicLogItem[]
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

## 15.1 `ACK_ROLE_REVEAL`

- 页面：`identity`
- 数据源：`privateState.identity`
- 提交命令：`ACK_ROLE_REVEAL`
- UI：确认按钮

## 15.2 `NOMINATE_CHANCELLOR`

- 页面：`board`
- 组件：`target-picker`
- 数据源：`pendingTask.allowedTargets`
- UI 要求：
  - 不可选玩家显示置灰和禁用原因
  - 显示“上一届政府任期限制”提示文案

## 15.3 `SUBMIT_VOTE`

- 页面：`board`
- 组件：`vote-panel`
- UI：
  - 两个大按钮 `Ja` / `Nein`
  - 选择后弹出确认弹窗
  - 提交后显示等待态

## 15.4 `PRESIDENT_DISCARD_POLICY`

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

## 16. 前后端联调正式契约

`/docs/front_back_api.md` 已经冻结了正式接口协议，本节只保留前端必须直接消费的关键契约。

## 16.1 `pendingTask.meta` 正式消费规则

前端只消费无法从 `publicState`、`privateState`、`allowedTargets` 推导出的 `meta` 字段。

| `taskType` | 正式 `meta` |
| --- | --- |
| `ACK_ROLE_REVEAL` | 可为空，允许补充 `confirmText` |
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
    knownMembers: Array<{ memberId: string; displayName: string }>
    acknowledged: boolean
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
  policySummary: {
    liberal: number
    fascist: number
  }
  finalPlayers: Array<{
    memberId: string
    displayName: string
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

- `displayName`
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

## 18.3 私密视图统一安全策略

所有私密组件遵循同一套规则：

1. 默认遮罩
2. 用户主动触发才显示
3. `onHide` 立即恢复遮罩
4. 页面切换回来后需再次主动显示
5. 不允许截图保护依赖，因为小程序无法可靠防截屏

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
- 法西斯：深红 / 暗红
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
- 静态图标统一放在 `images/icons`

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

1. 创建房间 -> 加入房间 -> 准备 -> 开局
2. 身份查看 -> 确认 -> 跳桌面
3. 提名 -> 投票通过 / 失败
4. 三连败自动翻牌
5. 总统弃牌 -> 总理立法
6. 第 5 张法西斯政策后的否决流程
7. 调查 / 特别选举 / 预览 / 处决
8. 希特勒当选即时结束
9. 处决希特勒结束
10. 对局结束 -> 结果页

## 21.3 弱网与恢复测试

必须专门测试：

1. 投票提交时断网
2. 选牌中切后台
3. 提交成功但前端超时
4. 页面在旧 version 上发命令
5. 房间失效后从分享卡片回流

## 22. 开发顺序建议

推荐按以下顺序落地，而不是并行铺开所有页面。

### 阶段 1：基础壳

- 重写首页
- 接入 `bootstrapService`
- 建好 `types / store / services / constants`
- 跑通 `createRoom / joinRoom / recoverActiveRoom`

### 阶段 2：大厅

- 大厅页
- 座位调整
- 准备
- 开始游戏
- 分享

### 阶段 3：身份与桌面基础

- 身份页
- 桌面页公共区
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

- 切后台安全态
- 弱网恢复
- 错误码处理
- 空态 / loading / 重试

## 23. 最终实施结论

前端最终实现应收敛为以下形态：

1. 原生微信小程序 + TypeScript。
2. 页面只消费快照 view-model，不操作核心真相。
3. 命令统一走 `submitGameCommand`，强制带 `commandId` 和 `expectedVersion`。
4. 数据同步采用“云函数轮询读取快照”。
5. 大厅与对局页面分包，规则与结果独立分包。
6. 私密信息统一遮罩，切后台立刻进入安全态。
7. MVP 先保证流程正确、状态清晰、恢复稳定，再做视觉增强。

如果后续实现与本方案冲突，以：

1. `/docs/front_back_api.md` 的正式字段定义
2. `/docs/game_rules.md` 的规则正确性
3. `/docs/secret_hitler_prd.md` 的产品边界

为最终裁决依据。
