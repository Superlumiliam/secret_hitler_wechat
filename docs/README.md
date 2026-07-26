---
status: active
authority: documentation-index
last_verified: 2026-07-26
---

# 《secret dictator》文档中心

本目录面向 MVP 之后的持续开发。当前约束、未来提案和历史记录必须分开维护，避免已经完成的 0→1 方案继续限制 1→100 的演进。

## 当前权威文档

| 文档 | 负责回答 | 不负责回答 |
| --- | --- | --- |
| [`game_rules.md`](game_rules.md) | 游戏规则、人数配置、胜负和边界判定 | 产品取舍、技术实现 |
| [`product.md`](product.md) | 当前产品定位、已交付能力、产品边界 | 字段级协议、内部存储 |
| [`api.md`](api.md) | 已实现云函数 action、DTO、命令和错误语义 | 未来预留接口 |
| [`architecture.md`](architecture.md) | 当前代码架构、数据流、安全和运行约束 | 功能优先级 |
| [`roadmap.md`](roadmap.md) | 1→100 的候选需求与工程改进 | 已完成工作明细 |
| [`releases/mvp.md`](releases/mvp.md) | 0→1 交付范围、验证证据和已知债务 | 后续实现约束 |

根目录 [`../README.md`](../README.md) 是项目入口，[`../AGENTS.md`](../AGENTS.md) 是协作与执行规范。

## 权威顺序

不同文档负责不同边界，不应用一份文档覆盖另一份文档的职责：

1. 游戏规则冲突时，以 `game_rules.md` 为准。
2. 用户可见行为和产品范围冲突时，以 `product.md` 为准。
3. 前后端线上协议冲突时，以 `api.md` 为准。
4. 内部实现、安全边界和数据流冲突时，以 `architecture.md` 为准。
5. `roadmap.md`、RFC 和历史档案均不能覆盖以上当前权威文档。

代码和测试是已部署行为的证据，但不能静默改变产品或接口契约。发现代码与权威文档不一致时，先沿调用链和测试确认事实，再在同一次变更中修正文档或实现。

## 文档状态

- `active`：当前有效，后续开发需要遵守。
- `draft`：讨论中的提案，不具约束力。
- `accepted`：已批准但尚未完全落地的方案；实现时必须同步权威文档。
- `implemented`：提案已落地，当前行为已合并进权威文档。
- `superseded`：已被新决策替代，仅保留决策历史。
- `historical`：历史记录，不再约束开发。

活动文档使用顶部元数据声明 `status`、`authority` 和 `last_verified`。历史文档必须声明 `normative: false`，并指向替代它的当前文档。

## 新需求工作流

1. 在 `roadmap.md` 记录候选需求；尚未排期的条目不得写成既定约束。
2. 涉及多个模块、接口变化或重要产品取舍时，从 [`rfcs/0000-template.md`](rfcs/0000-template.md) 创建短 RFC。
3. RFC 在 `draft` 阶段只用于讨论。批准后才能进入实现。
4. 重大、长期且难以逆转的技术取舍，从 [`decisions/0000-template.md`](decisions/0000-template.md) 创建 ADR；普通实现细节不写 ADR。
5. 实现合入时同步更新受影响的产品、规则、API、架构、测试和路线图，并把 RFC 标记为 `implemented`。

任何新接口、字段、枚举或错误码必须在实现变更中同步更新 `api.md`。任何新的资源、数据边界或状态机不变量必须同步更新 `architecture.md`。

## 历史档案

[`archive/mvp/`](archive/mvp/) 保存 MVP 的设计过程、开发清单和问题排查。它们用于回顾“为什么曾经这样设计”，不作为当前实现依据。第一轮整理不删除原文，删除建议见 [`archive/mvp/README.md`](archive/mvp/README.md)。

## 变更完成检查

- 只修改与需求相关的权威文档，不复制同一契约到多个位置。
- 检查活动文档链接有效，且不会把历史档案当作依赖。
- 检查对外名称和中文术语符合 `AGENTS.md`。
- 对照代码、测试和运行证据检查当前态描述。
- 文档修改后检查关联文档的一致性。
