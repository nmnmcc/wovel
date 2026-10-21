---
title: 参与开发
description: 命令、检查和代码约定。
---

所有命令都通过 devenv 运行：

```sh
devenv shell -- pnpm install
devenv shell -- pnpm build
devenv shell -- pnpm typecheck
devenv shell -- pnpm -r test
devenv shell -- pnpm --filter @wovel/docs dev
```

`pnpm typecheck` 使用 TypeScript 7 和 Effect 语言服务插件，警告也要清零。

测试放在各包的 `test/` 目录，通过包名引用被测的包（先 `pnpm build`）。

- `core`、`parser`、`vite` 的测试用 `node --test`。
- `web` 的测试在真正的浏览器里跑：Vitest 的浏览器模式，用 Playwright 驱动无头 Chromium。所以测试用的是真实的 DOM、Web Animations、`<audio>` 和 IndexedDB，点击和按键也是真实的输入事件。不需要装完整的桌面浏览器，也不需要显示器。

浏览器由 devenv 提供：`devenv.nix` 把 nixpkgs 里的 `playwright-driver.browsers` 设为 `PLAYWRIGHT_BROWSERS_PATH`。Playwright 自己下载的浏览器在 NixOS 上跑不起来，所以不下载。npm 包 `playwright` 的版本必须和 nixpkgs 里 `playwright-driver` 的版本一致（现在是 1.61.1），升级 nixpkgs 时要一起改。

测试失败时，截图保存在 `packages/web/.vitest/` 下。

代码约定见仓库根目录的 `AGENTS.md`。
