// @effect-diagnostics strictEffectProvide:off -- each test is an entry point: it builds its own short-lived layers and runs once.
import {
	Commit,
	ContentHash,
	Instruction,
	Persistence,
	Repository,
	State,
	WebCrypto,
} from "@wovel/core"
import { IndexedDbPersistence } from "@wovel/web"
import { Crypto, Effect, Layer, Option } from "effect"
import { expect, test } from "vitest"

const state: State.State = {
	at: {
		id: Instruction.StatementId.make("a-0"),
		hash: ContentHash.Hash.make("h"),
	},
	stack: [],
	store: { count: 1 },
	seed: [1, 2, 3, 4],
	stage: State.Stage.empty,
	waiting: {
		_tag: "Menu",
		prompt: Option.none(),
		choices: [],
	},
	scene: "a",
}

let databases = 0
const run = <A, E>(
	effect: Effect.Effect<A, E, Persistence.Persistence | Crypto.Crypto>,
) =>
	Effect.runPromise(
		Effect.provide(
			effect,
			Layer.mergeAll(
				// Each test gets its own database in the real IndexedDB of the browser.
				IndexedDbPersistence.layer({ name: `test-${databases++}` }),
				WebCrypto.layer,
			),
		),
	)

test("a commit with Option fields comes back the same", async () => {
	const [made, read] = await run(
		Effect.gen(function* () {
			const persistence = yield* Persistence.Persistence
			const made = yield* Repository.commit({
				parent: Option.none(),
				state,
				time: 1,
			})
			// Writing the same commit again is fine.
			yield* persistence.write([made])
			return [made, yield* Repository.get(made.id)] as const
		}),
	)
	expect(read).toStrictEqual(made)
})

test("refs are written, listed, and removed", async () => {
	const names = await run(
		Effect.gen(function* () {
			const persistence = yield* Persistence.Persistence
			const made = yield* Repository.commit({
				parent: Option.none(),
				state,
				time: 1,
			})
			yield* persistence.setRef({ name: "save/b", commit: made.id })
			yield* persistence.setRef({ name: "save/a", commit: made.id })
			yield* persistence.removeRef("save/b")
			const one = yield* persistence.ref("save/a")
			expect(one).toStrictEqual(Option.some(made.id))
			return (yield* persistence.refs).map((ref) => ref.name)
		}),
	)
	expect(names).toEqual(["save/a"])
})

test("a missing commit reads as None", async () => {
	const found = await run(
		Effect.flatMap(Persistence.Persistence, (persistence) =>
			persistence.read(Commit.Id.make("missing")),
		),
	)
	expect(found).toStrictEqual(Option.none())
})
