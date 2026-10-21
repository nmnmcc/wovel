# Rules for working on Wovel

## Commands

- Run every command as `devenv shell -- <command>`.

## Product

- Wovel is a Web Native visual novel engine. Scripts are Markdown (MDW). The screen is DOM and CSS. The game state is a graph of immutable commits, like Git.
- `packages/docs/content/docs/design.md` is the design. Read the part for a feature before you build it, and update `progress.md` when you finish it.
- A new script feature goes into the story model in `@wovel/core` first. Then the compiler in `@wovel/parser`, then the renderer in `@wovel/web`.
- The encoded interpreter state must stay pure JSON data. Animation frames and DOM state never go into a commit.

## Language

- Write code, comments, error messages, logs, test names, and commit messages in [Simple English](https://en.wikipedia.org/wiki/Simple_English): short sentences, common words, active voice.
- Write the docs site in Simplified Chinese. Example scripts and test scripts may use Chinese text.

## Docs

- All docs live on the docs site, as pages in `packages/docs/content/docs`. Do not add other documentation files. The root `README.md` gives only a short overview.
- When you change how something works, update its page in the same change.

## Code

- Build with Effect. Model data with Schema, dependencies with `Context.Service` and `Layer`, resources with `Scope`, and errors with tagged errors.
- Do not use `null` for a missing value. Use `Option`. In a Schema, use `Schema.OptionFromNullOr`, so the encoded JSON keeps `null`. Turn a `null` from a DOM or library API into an `Option` where you get it.
- Name a function that returns `Effect.gen` with `Effect.fn("Module.name")`. Use `Effect.fnUntraced` for hot inner helpers.
- Use Effect services, not globals: `FileSystem`, `Path`, `Clock`, `Random`, `Crypto`, and `Effect.log*`. Wrap DOM writes inside Effect code in `Effect.sync`.
- Put every failure a caller can handle in the error channel. Use `orDie` only for real invariants, and say why in a comment. Catch only the failure you expect (`catchIf` on the reason), not every error of a tag.
- Use Effect immutable data structures first. Use mutable JavaScript structures only when you really need them, for example while one compile walks a tree.
- Run an Effect only at a host boundary: `start()` in `@wovel/web`, the hooks of the Vite plugin, and tests.
- Put code in the folder of the feature it belongs to. Packages use each other only through their public entry points.
- Importing a module must not start any I/O.
- `pnpm typecheck` runs the Effect language service. Fix its warnings too. Turn a rule off only with a comment that says why.

## Changes

- Do not keep old behavior for old callers or old stories. Make the breaking change and keep one current model. Saves are the one exception: a save must load after a script change, through statement ids and content hashes.
- When you must work around a bug in a dependency or a tool, explain the bug in a comment next to the workaround.

## Checks

- Before you finish, run `pnpm build`, `pnpm typecheck`, and the tests of the packages you changed (`pnpm --filter <package> test`).
