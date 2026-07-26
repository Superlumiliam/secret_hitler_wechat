# secret dictator / 揭秘独裁者

一款服务于线下面对面聚会的微信小程序，通过自动化组局、身份分配、流程裁判和结果复盘，降低游戏门槛，让玩家专注于桌面讨论与博弈。

## 当前状态

项目已经完成 0→1 的 MVP 功能闭环，支持：

- 5–10 人普通多人房间；
- 正式单人模式与虚拟席位手动对局；
- 完整提名、投票、立法、否决、总统权力和胜负流程；
- 身份隔离、断线恢复、局内历史和终局复盘；
- 实时同步信号与轮询降级。

交付记录见 [`docs/releases/mvp.md`](docs/releases/mvp.md)，后续候选工作见 [`docs/roadmap.md`](docs/roadmap.md)。

## 文档

从 [`docs/README.md`](docs/README.md) 开始阅读。该索引区分当前权威文档、未来 RFC/ADR 和不再约束开发的 MVP 历史档案。

## 项目结构

- `frontend/`：原生微信小程序客户端。
- `cloudfunctions/`：会话、房间、游戏和维护云函数。
- `tests/`：后端规则/并发测试与前端映射/同步测试。
- `reference/`：页面参考设计和图片素材。

## 本地测试

```bash
node scripts/run-backend-tests.js || exit 1
for f in tests/frontend/*.test.js tests/frontend/*/*.test.js; do node "$f" || exit 1; done
```
