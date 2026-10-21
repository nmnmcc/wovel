---
title: 包
description: 工作区里的包，以及各自的用途。
---

Wovel 是一个 pnpm 工作区。所有包名是 `@wovel/<name>`，版本 `0.1.0`，使用 `effect@4.0.5`。它们还没有发布到 npm，在工作区里用 `"workspace:*"` 引用。

| 包                 | 用途                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `core`             | 故事模型、解释器、求值器、Git 式状态仓库、Game 服务。不依赖 DOM。 |
| `parser`           | 把 MDW 编译成 Story；`Lint` 检查可疑写法并统计字数。              |
| `web`              | DOM 渲染、输入、音频、IndexedDB 存档，以及入口 `start()`。        |
| `vite`             | Vite 插件：编译剧本、登记 `images/` 和 `audio/`、热重载。         |
| `docs`             | 这个文档站。                                                      |
| `examples/starter` | 示例游戏《雨夜》。                                                |

依赖方向：`parser → core`，`web → core`，`vite → parser → core`。包之间只通过各自的入口互相引用。
