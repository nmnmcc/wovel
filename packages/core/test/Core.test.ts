// @effect-diagnostics strictEffectProvide:off -- each test is an entry point: it builds its own short-lived layers and runs once.
import assert from "node:assert/strict"
import { test } from "node:test"
import {
	Commit,
	ContentHash,
	Evaluator,
	Game,
	Interpreter,
	MemoryPersistence,
	Persistence,
	Random,
	Repository,
	Story,
	WebCrypto,
	type Instruction,
} from "@wovel/core"
import { Crypto, Effect, Layer, Option } from "effect"

type Body = Instruction.Instruction extends infer I
	? I extends Instruction.Instruction
		? Omit<I, "id" | "hash" | "source">
		: never
	: never

/** A story from instruction bodies. Scene names map to the index where they start. */
const story = (
	bodies: ReadonlyArray<Body>,
	scenes: Record<string, number>,
	defaults: Story.Story["defaults"] = {},
): Story.Story => ({
	title: "test",
	start: Object.keys(scenes)[0] ?? "",
	defaults,
	characters: {},
	images: {},
	audio: {},
	scenes: Object.fromEntries(
		Object.entries(scenes).map(([name, index]) => [
			name,
			{ title: name, index, file: "test.mdw" },
		]),
	),
	instructions: bodies.map(
		(body, n) =>
			({
				...body,
				id: `s-${n}`,
				hash: ContentHash.contentHash(body),
				source: { file: "test.mdw", line: n + 1 },
			}) as Instruction.Instruction,
	),
})

/** A line that shows the value of one expression. */
const show = (expression: string): Body => ({
	_tag: "Say",
	text: [{ _tag: "Interpolation", expression, filters: [], style: {} }],
	extend: false,
})

const say = (value: string): Body => ({
	_tag: "Say",
	text: [{ _tag: "Text", value, style: {} }],
	extend: false,
})

/** Everything a game needs, in memory. Each test gets its own store. */
const services = () =>
	Layer.mergeAll(Evaluator.layer, MemoryPersistence.layer, WebCrypto.layer)

type Services = Evaluator.Evaluator | Persistence.Persistence | Crypto.Crypto

const run = <A, E>(effect: Effect.Effect<A, E, Services>) =>
	Effect.runPromise(Effect.provide(effect, services()))

/** The typed failure of an effect. It fails the test on success or on a defect. */
const failure = <A, E>(effect: Effect.Effect<A, E, Services>) =>
	run(Effect.flip(effect))

test("canonical JSON does not depend on key order", () => {
	assert.equal(
		ContentHash.canonical({ b: 1, a: [1, { d: 2, c: 3 }] }),
		ContentHash.canonical({ a: [1, { c: 3, d: 2 }], b: 1 }),
	)
	assert.equal(
		ContentHash.contentHash({ a: 1 }),
		ContentHash.contentHash({ a: 1 }),
	)
	assert.notEqual(
		ContentHash.contentHash({ a: 1 }),
		ContentHash.contentHash({ a: 2 }),
	)
})

test("the random generator gives the same numbers for the same seed", () => {
	const [a, seedA] = Random.next(Random.seed(42))
	const [b] = Random.next(Random.seed(42))
	const [c] = Random.next(seedA)
	assert.equal(a, b)
	assert.notEqual(a, c)
	assert.ok(a >= 0 && a < 1)
})

test("code writes new names to the store, not to the global object", async () => {
	const outcome = await run(
		Effect.flatMap(Evaluator.Evaluator, (evaluator) =>
			evaluator.execute(
				"leaked = Math.max(1, 2); count += 1; wovel.jump('next')",
				{
					store: { count: 1 },
					seed: Random.seed(1),
				},
			),
		),
	)
	assert.deepEqual(outcome.store, { count: 2, leaked: 2 })
	assert.equal("leaked" in globalThis, false)
	assert.deepEqual(outcome.jump, Option.some("next"))
})

test("a store value that is not JSON is an error", async () => {
	const error = await failure(
		Evaluator.make.execute("when = new Date()", {
			store: {},
			seed: Random.seed(1),
		}),
	)
	assert.equal(error.reason, "invalid-value")
})

test("a script error is a typed failure with the place of the statement", async () => {
	const s = story([show("nope.x")], { main: 0 })
	const error = await failure(Interpreter.start(s, 1))
	assert.equal(error.reason, "evaluation-failed")
	assert.deepEqual(error.source, { file: "test.mdw", line: 1 })
	assert.ok(error.cause instanceof TypeError)
})

test("a cyclic value can not become text, and that is a typed failure", async () => {
	const s = story([show("(() => { const a = {}; a.self = a; return a })()")], {
		main: 0,
	})
	const error = await failure(Interpreter.start(s, 1))
	assert.equal(error.reason, "invalid-value")
})

test("call and return come back to the statement after the call", async () => {
	const s = story(
		[
			{ _tag: "Call", target: { _tag: "Scene", scene: "side" } },
			say("back"),
			{ _tag: "End" },
			{
				_tag: "Set",
				assignments: [{ name: "x", operator: "+=", expression: "2" }],
			},
			say("side {x}"),
			{ _tag: "Return" },
		],
		{ main: 0, side: 3 },
		{ x: 1 },
	)
	const lines = await run(
		Effect.gen(function* () {
			const first = yield* Interpreter.start(s, 1)
			const second = yield* Interpreter.resume(s, first, { _tag: "Advance" })
			return [first, second]
		}),
	)
	assert.deepEqual(
		lines.map((state) => [state.at.id, state.scene, state.stack.length]),
		[
			["s-4", "side", 1],
			["s-1", "main", 0],
		],
	)
	assert.equal(lines[0]?.store["x"], 3)
})

test("a loop with no wait stops with an error", async () => {
	const s = story([{ _tag: "Jump", target: { _tag: "Index", index: 0 } }], {
		main: 0,
	})
	const error = await failure(Interpreter.start(s, 1))
	assert.equal(error.reason, "loop-limit")
})

test("a moved statement is found by its content", () => {
	const before = story([say("a"), say("b")], { main: 0 })
	const after = story([say("new"), say("a"), say("b")], { main: 0 })
	const b = before.instructions[1]
	assert.ok(b !== undefined)
	// "b" was s-1 and is s-2 now. Its content is the same, so it is found.
	assert.deepEqual(Story.locate(after, Story.pointer(b)), Option.some(2))
})

test("equal steps give equal commit ids", async () => {
	const s = story([say("a")], { main: 0 })
	const [a, b] = await run(
		Effect.gen(function* () {
			const state = yield* Interpreter.start(s, 1)
			const a = yield* Commit.make({ parent: Option.none(), state, time: 1 })
			const b = yield* Commit.make({ parent: Option.none(), state, time: 2 })
			return [a, b]
		}),
	)
	assert.equal(a?.id, b?.id)
})

test("each way of moving tells the view how it got there", async () => {
	const s = story([say("one"), say("two"), say("three"), { _tag: "End" }], {
		main: 0,
	})
	const seen = await run(
		Effect.gen(function* () {
			const game = yield* Game.make({ story: s, seed: 1 })
			const at = Effect.map(
				game.view,
				(view) => `${view.commit.state.at.id} ${view.move}`,
			)
			const steps: Array<string> = [yield* at]
			yield* game.advance
			yield* game.save("save/a")
			yield* game.advance
			steps.push(yield* at)
			yield* game.rollback
			steps.push(yield* at)
			yield* game.rollforward
			steps.push(yield* at)
			yield* game.load("save/a")
			steps.push(yield* at)
			yield* game.restart
			steps.push(yield* at)
			const slots = yield* game.slots
			return { steps, slots: slots.map((slot) => slot.name) }
		}),
	)
	assert.deepEqual(seen.steps, [
		"s-0 start",
		"s-2 step",
		"s-1 rollback",
		"s-2 rollforward",
		"s-1 load",
		"s-0 start",
	])
	assert.deepEqual(seen.slots, ["auto", "save/a"])
})

test("a save that points at a missing commit does not hide the others", async () => {
	const slots = await run(
		Effect.gen(function* () {
			const persistence = yield* Persistence.Persistence
			yield* persistence.setRef({
				name: "save/broken",
				commit: Commit.Id.make("missing"),
			})
			return yield* Repository.slots
		}),
	)
	assert.deepEqual(slots, [])
	const error = await failure(Repository.get(Commit.Id.make("missing")))
	assert.equal(error.reason, "missing-commit")
})
