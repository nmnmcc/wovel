---
title: 快速开始
description: 跑起示例游戏，再写你自己的剧本。
---

## 准备

你需要 [devenv](https://devenv.sh)。它提供 Node.js 与 pnpm，版本和团队其他人一致。

```sh
devenv shell -- pnpm install
devenv shell -- pnpm build
devenv shell -- pnpm dev
```

打开 `http://localhost:5173`，就能玩 `examples/starter` 里的示例游戏《雨夜》。

## 操作

| 操作        | 键鼠                           |
| ----------- | ------------------------------ |
| 推进        | 点击、空格、回车               |
| 回滚 / 前滚 | 滚轮上 / 下，PageUp / PageDown |
| 隐藏界面    | H                              |
| 关闭面板    | Esc                            |

右上角是回退、历史、存档、读档。存档放在浏览器的 IndexedDB 里。

## 写自己的游戏

一个 Wovel 游戏就是一个 Vite 项目：

```
my-game/
  index.html
  vite.config.ts
  src/main.ts
  story/index.mdw        剧本，index 或 start 文件先读
  images/bg/street.webp  图像 bg street
  images/xue/smile.webp  图像 xue smile
  audio/rain.ogg         音频 rain
```

`vite.config.ts`：

```ts
import { wovel } from "@wovel/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [wovel()] })
```

`src/main.ts`：

```ts
import story from "virtual:wovel/story"
import { start } from "@wovel/web"

const game = start({
	story,
	root: document.getElementById("game")!,
	saves: "my-game",
})

// 改剧本时替换故事，保留玩家当前的位置。
import.meta.hot?.accept("virtual:wovel/story", (module) => {
	if (module !== undefined)
		game.replace(module["default"]).catch((error: unknown) => {
			// 剧本有错时旧故事继续运行，Vite 会显示编译错误。
			console.error("Could not use the new story", error)
		})
})
```

在 `tsconfig.json` 的 `types` 里加上 `@wovel/vite/client`，`virtual:wovel/story` 就有类型了。

剧本有错时，Vite 会在页面上显示文件、行号和原因。可疑但合法的写法（未定义的角色、找不到的图像、到不了的场景）会作为警告打印在终端里，并带上文件位置。`images/`、`audio/` 文件夹不存在时当作空文件夹；文件夹存在但读不了（比如没有权限）会报错。
