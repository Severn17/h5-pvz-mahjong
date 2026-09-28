# AI-DLC 过程文档

本项目用 **AWS AI-DLC（AI-Driven Development Life Cycle）** 的思路完成：由 AI 主导起草计划、设计和实现，人在每个阶段的关键节点做决策和验收。AI-DLC 把开发分成三个阶段：

| 阶段 | 关注点 | 本项目的产出 |
|---|---|---|
| **Inception（启动）** | 意图 → 需求 → 拆分工作单元 | [inception.md](inception.md)、[../PLAN.md](../PLAN.md) 第 0–4、7 节 |
| **Construction（构建）** | 每个单元的设计 → 实现 → 测试 → 调整 | [construction.md](construction.md)、`mahjong` 分支上的提交、`tests/` |
| **Operations（运维）** | 运行、CI、部署、观测 | [operations.md](operations.md)、`.github/workflows/` |

人与 AI 的分工、关键提示词和纠偏记录见 [prompts-and-decisions.md](prompts-and-decisions.md)。

## 怎么读

1. 先看 [inception.md](inception.md)：要做什么、为什么这样拆。
2. 再看 [construction.md](construction.md)：每个单元对应哪个提交、怎么验证的、根据数据改了什么。
3. 对照代码：`git log baseline-roguelike..mahjong` 按单元逐个提交查看。

## 说明

- [`docs/PLAN.md`](../PLAN.md) 是开发过程中**实际使用**的计划文档，随每轮调整更新，保留原样。
- 本目录下的文档是在 M1 完成后**事后整理**的，把 PLAN.md 和提交记录按 AI-DLC 阶段重新组织，方便阅读；内容以当时的记录为准，不是事先写好的。
