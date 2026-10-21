# Wovel

Wovel is a Web Native visual novel engine. You write the script in Markdown, the game runs in the browser, and every step of the game is an immutable commit, like in Git.

```md
# 开场

::bg[street]{transition=fade}

雨下得很大。

**小雪**{expr=smile at=right}：你好。

- [把伞让给她](#让伞)
- [和她一起等雨停](#等雨)
```

## Features

- **MDW scripts.** Headings are scenes, paragraphs are narration, `**Name**:` is dialogue, a list of links is a menu, and `::directives` change the stage. Scripts read well on GitHub.
- **DOM rendering.** The dialogue box, menus, sprites, and backgrounds are HTML elements. The browser does CJK layout, ruby, fonts, and accessibility.
- **Git-style state.** Rollback moves to the parent commit. A save is a ref. A save still loads after the script changes.
- **Built with Effect.** The interpreter is a pure function. The evaluator, the storage, and the game are Effect services that you can replace.
- **Vite plugin.** Assets register from folders, script errors show with file and line, and hot reload keeps the player's place.

## Quick start

You need [devenv](https://devenv.sh).

```sh
devenv shell -- pnpm install
devenv shell -- pnpm build
devenv shell -- pnpm dev
```

Then open `http://localhost:5173` to play the example game in `examples/starter`.

## Docs

The docs site is in [`packages/docs`](./packages/docs). Run it on your computer:

```sh
devenv shell -- pnpm --filter @wovel/docs dev
```

## Packages

| Package            | What it is                                                   |
| ------------------ | ------------------------------------------------------------ |
| `@wovel/core`      | Story model, interpreter, state repository, and Game service |
| `@wovel/parser`    | MDW compiler and lint                                        |
| `@wovel/web`       | DOM renderer, input, audio, and IndexedDB saves              |
| `@wovel/vite`      | Vite plugin                                                  |
| `@wovel/docs`      | The docs site                                                |
| `examples/starter` | An example game                                              |

## Work on the code

```sh
devenv shell -- pnpm build
devenv shell -- pnpm typecheck
devenv shell -- pnpm -r test
```

Read [AGENTS.md](./AGENTS.md) for the rules of the project.

## License

Wovel is dual licensed under the [MIT License](./LICENSE-MIT) or the [Apache License 2.0](./LICENSE-APACHE). You may pick either one.

Unless you say otherwise, any contribution that you submit for inclusion in Wovel is dual licensed as above, with no extra terms.
