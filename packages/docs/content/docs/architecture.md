---
title: 架构
description: 剧本怎样变成画面，状态怎样变成提交。
---

```
.mdw 文件 ──@wovel/parser──▶ Story（JSON）──@wovel/vite──▶ virtual:wovel/story
                                   │
                                   ▼
                Interpreter（纯函数，需要 Evaluator 服务）
                                   │ State
                                   ▼
               Game 服务 ──Repository──▶ Persistence（内存 / IndexedDB）
                                   │ View 流
                                   ▼
                  @wovel/web Renderer（Foldkit 程序）
```

## Story

编译器把所有剧本文件编译成一个 **Story**：一条线性的指令序列，加上场景表、角色、变量默认值、图像和音频表。Story 是纯 JSON，用 Effect Schema 定义，游戏启动时用 `Story.decode` 校验一次。

每条指令有：

- `id`：`场景-序号`，例如 `开场-3`；
- `hash`：指令内容的哈希；
- `source`：文件和行号，用于报错。

`if`、`while` 和内联选项会被编译成 `Branch` 和指向下标的 `Jump`。

## Interpreter

解释器是两个纯函数：

- `start(story, seed)`：从起始场景跑到第一个需要等待玩家的语句；
- `resume(story, state, input)`：玩家点击（`Advance`）或选择（`Choose`）之后，继续跑到下一个等待点。

等待点只有四种：台词、菜单、暂停、结束。中间的跳转、赋值、舞台指令一口气执行完。超过十万条语句不等待会报错，防止死循环卡住页面。

**State** 是纯数据：等待的语句指针、调用栈、变量、随机数种子、舞台和等待内容。指针用 `{ id, hash }` 而不是下标，所以剧本改动后存档还能找回位置：先找同 id 同内容，再找唯一的同内容语句，最后找同 id。

可能没有的值（背景、转场、说话人、菜单提问、父提交）在内存里是 `Option`，编码成 JSON 时是 `null`（`Schema.OptionFromNullOr`）。所以 State 的编码形式仍是纯 JSON，旧存档也能读回。

JS 表达式和代码块交给 **Evaluator** 服务执行。默认实现用 `with` 作用域和 Proxy 把读写限制在变量表里；宿主可以换成在 Web Worker 里运行的实现。

脚本里的错误都是 `ScriptError`，带有出错语句的文件和行号，`cause` 里保留脚本抛出的原始值。表达式的值转成文本时如果出错（比如循环引用的对象），也是 `ScriptError`，不会让游戏崩溃。

## Git 式仓库

每一步生成一个不可变的 **Commit**：`id` 是父提交 id 和 State 的 JSON 编码形式的 SHA-256，所以同样的一步得到同样的 id。

哈希由 Effect 的 **Crypto** 服务计算，所以 `Commit.make`、`Repository.commit` 和 `Game` 都要求宿主提供它。`@wovel/core` 带 `WebCrypto.layer`：它用浏览器和 Node 都有的 Web Crypto API（`crypto.subtle`），`@wovel/web` 的 `start()` 和测试都用它。不在安全上下文里（比如用 `http://` 加局域网地址打开页面）时浏览器没有 `crypto.subtle`，这时 `Commit.make` 以 `CommitError` 失败，错误会显示在游戏里。

| 功能                | 在仓库里是什么                                       |
| ------------------- | ---------------------------------------------------- |
| 回滚                | 移到父提交                                           |
| 前滚                | 沿回滚留下的路径走回去；重新做出同样的选择时路径保留 |
| 存档                | ref `save/<槽位>`                                    |
| 快速存档 / 自动存档 | ref `quick` / `auto`                                 |
| 历史记录            | 沿父提交回溯                                         |
| 热重载              | 换掉 Story，当前提交不动                             |

存储由 **Persistence** 服务提供。`@wovel/core` 带内存实现，`@wovel/web` 带 IndexedDB 实现，它存的是 Commit 的 JSON 编码形式，读回时再解码。写入在事务完成后才算成功，所以磁盘满之类的错误不会被吞掉。找不到的提交是 `missing-commit` 错误；存档列表会跳过指向丢失提交或已损坏的存档，其他存档照常显示。

## Game

`Game` 是一个 Effect 服务，把 Story、Interpreter 和仓库组合起来：`advance`、`choose`、`rollback`、`rollforward`、`save`、`load`、`history`、`replace`，并用 `SubscriptionRef` 提供当前画面的变化流 `changes`。所有操作串行执行。一步推进时，写自动存档和更新画面不会被中途打断。

## Renderer

`@wovel/web` 的 Renderer 是一个 [Foldkit](https://foldkit.dev) 程序。Foldkit 基于 Effect，采用 Elm 架构：整个画面的状态是一个用 Schema 定义的 Model，发生的事情都是 Message，纯函数 `update` 算出下一个 Model，纯函数 `view` 把 Model 画成虚拟 DOM，再由 Foldkit 对比出差异，只改动变了的 DOM 节点。

- **Model**：最近一个画面的等待状态（台词、菜单、暂停、结束）和舞台、打字机进度、正在淡出的立绘、`fade` 转场的阶段、历史面板、提示、错误信息，以及标签文字等设置。游戏状态本身不在这里，仍然在 `Game` 里。
- **Subscription**：订阅 `Game` 的 `changes`，每个新画面变成一条 `ChangedView` 消息；打字机在逐字显示时按速度发出 `TickedTypewriter`。
- **Command**：推进、选择、回滚、前滚、存档、读档、读取历史、重新开始都是 Command，在里面调用 `Game` 服务。失败会变成 `FailedGameAction` 消息，错误显示在画面上并写进日志。播放音频和给菜单设置焦点也是 Command。
- **Mount**：动画属于具体的元素。新出现的背景和立绘在插入 DOM 时用 Web Animations API 淡入，离开的立绘淡出后才移除，`fade` 的遮罩先变黑、换舞台、再变亮。键盘和滚轮也由游戏根元素上的 Mount 读取，因为它们需要事件目标和滚动方向。

`Game` 的每个画面都带有 `move`，说明它是怎么来的（`start`、`step`、`rollback`、`rollforward`、`load`）。新游戏（包括重新开始）、向前推进一步和前滚时，台词逐字打出，并播放转场和音效；回滚和读档直接跳到结果。打字机效果按字素簇逐个显示，避免拆散表情符号。点击、空格和回车先补完正在打出的台词，再推进。

`Game` 服务和音频播放器作为 Foldkit 的 resources 提供给 Command。Renderer 在自己的 fiber 里运行这个 Foldkit 程序，所以 DOM 节点、事件监听、动画和音频元素都挂在 Scope 上，关闭 Scope 就全部清理。`start()` 是唯一运行 Effect 的地方。`stop()` 只是中断，不算错误。如果 `update` 或 `view` 出了程序错误，Foldkit 会停下并显示错误信息。
