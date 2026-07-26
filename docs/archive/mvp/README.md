---
status: historical
normative: false
archived_at: 2026-07-26
---

# MVP 历史文档审查清单

本目录完整保留 0→1 阶段的过程文档。它们均不再约束开发；当前文档入口为 [`../../README.md`](../../README.md)。

第一轮整理不删除任何原文。下表用于用户审查后决定下一步保留或删除，执行删除时还需再次检查 Git 历史和当前文档链接。

| 文件 | 已提取到 | 历史价值 | 建议 |
| --- | --- | --- | --- |
| `secret_hitler_prd.md` | `product.md`、`releases/mvp.md` | MVP 产品范围与早期取舍 | 当前内容已由产品基线覆盖，审查后可删除 |
| `backend_tech_detail.md` | `architecture.md`、`api.md`、`game_rules.md` | 早期数据模型和状态机推演 | 先核对是否仍需字段级推演，之后可依赖 Git 历史删除 |
| `frontend_tech_detail.md` | `architecture.md`、`product.md` | 页面与组件实施过程 | 当前页面已落地，审查后可删除 |
| `front_back_api.md` | `api.md` | 详细 DTO 示例及曾经预留的接口 | 确认当前精简契约满足联调需要后可删除 |
| `project_state.md` | `releases/mvp.md`、`roadmap.md` | 40 个已完成条目的过程证据 | 发布记录确认无误后可删除 |
| `develop_mode.md` | `product.md`、`architecture.md`、`api.md` | 开发者模式迁移为正式单人模式的过程 | 当前单人模式边界已提取，审查后可删除 |
| `database_call_optimization_context.md` | `architecture.md`、`roadmap.md` | 有真实数据的性能问题排查 | 建议保留为历史事件，后续可移入独立 incidents 档案 |

## 审查标准

- 当前权威文档是否已覆盖仍然有效的产品、规则、安全和协议约束。
- 过程文档是否包含代码、测试和 Git 历史无法替代的运行证据。
- 保留的历史文档是否有明确用途，而不是因为“可能有用”无限堆积。
- 删除批准必须逐文件记录；未获批准的文件继续留在本目录。
