// @effect-diagnostics strictEffectProvide:off -- each test is an entry point: it builds its own short-lived layers and runs once.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import {
	Evaluator,
	Game,
	MemoryPersistence,
	Text,
	type State,
	WebCrypto,
} from "@wovel/core"
import { Compiler, Lint } from "@wovel/parser"
import { Effect, Layer, Option } from "effect"

const fixture = async (name: string) => ({
	path: name,
	source: await readFile(
		new URL(`./fixtures/${name}`, import.meta.url),
		"utf8",
	),
})

const compile = (files: ReadonlyArray<Compiler.File>) =>
	Effect.runPromise(Compiler.compile(files))

const play = <A, E>(
	story: Parameters<typeof Game.make>[0]["story"],
	program: (game: typeof Game.Game.Service) => Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const game = yield* Game.make({ story, seed: 1 })
			return yield* program(game)
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					MemoryPersistence.layer,
					Evaluator.layer,
					WebCrypto.layer,
				),
			),
		),
	)

const waiting = (game: typeof Game.Game.Service) =>
	Effect.map(game.view, (view) => view.commit.state.waiting)

const said = (waiting: State.Waiting) =>
	waiting._tag === "Say"
		? `${Option.getOrElse(waiting.line.name, () => "")}:${Text.plain(waiting.line.text)}`
		: waiting._tag

test("a script compiles to scenes, lines, and a menu", async () => {
	const { story } = await compile([await fixture("rain.mdw")])
	assert.equal(story.title, "雨夜")
	assert.equal(story.start, "开场")
	assert.deepEqual(Object.keys(story.scenes), ["开场", "让伞", "名字", "结局"])
	assert.equal(story.characters["me"]?.name, "我")
	const menu = story.instructions.find((i) => i._tag === "Menu")
	assert.ok(menu?._tag === "Menu")
	assert.equal(menu.set, "asked")
	assert.equal(menu.options.length, 3)
	assert.equal(menu.options[2]?.condition, "affection >= 1")
	assert.equal(
		Text.plain(
			menu.prompt?.text.flatMap((s) =>
				s._tag === "Interpolation" ? [] : [s],
			) ?? [],
		),
		"你要怎么做？",
	)
	// The two lines of narration join with no space between CJK characters.
	const first = story.instructions.find((i) => i._tag === "Say")
	assert.ok(first?._tag === "Say")
	assert.deepEqual(first.text, [
		{ _tag: "Text", value: "雨下得很大。街上没有人。", style: {} },
	])
	assert.ok(
		story.instructions.every(
			(i, n, all) => all.findIndex((o) => o.id === i.id) === n,
		),
	)
})

test("a game plays through a menu with an inline option, rolls back, and rolls forward", async () => {
	const { story } = await compile([await fixture("rain.mdw")])
	const result = await play(story, (game) =>
		Effect.gen(function* () {
			const lines: Array<string> = [said(yield* waiting(game))]
			yield* game.advance
			const greeting = yield* waiting(game)
			lines.push(said(greeting))
			const stage = (yield* game.view).commit.state.stage
			yield* game.advance
			lines.push(said(yield* waiting(game)))
			yield* game.advance
			const menu = yield* waiting(game)
			assert.ok(menu._tag === "Menu")
			// The third option needs affection >= 1.
			assert.deepEqual(
				menu.choices.map((c) => c.index),
				[0, 1],
			)
			yield* game.choose(1)
			lines.push(said(yield* waiting(game)))
			yield* game.rollback
			assert.equal((yield* waiting(game))._tag, "Menu")
			const back = yield* game.view
			assert.equal(back.canRollforward, true)
			yield* game.rollforward
			yield* game.advance
			lines.push(said(yield* waiting(game)))
			yield* game.advance
			const end = yield* game.view
			return { lines, greeting, stage, end }
		}),
	)
	assert.deepEqual(result.lines, [
		":雨下得很大。街上没有人。",
		"小雪:你好，旅人。明日也会下雨吗？",
		"我:你也没带伞吗？",
		"小雪:嗯，一起等吧。",
		"小雪:雨停了呢。",
	])
	assert.ok(result.greeting._tag === "Say")
	assert.deepStrictEqual(result.greeting.line.color, Option.some("#c8a2c8"))
	assert.deepEqual(
		result.greeting.line.text.find((s) => s._tag === "Ruby"),
		{
			_tag: "Ruby",
			base: "明日",
			annotation: "あした",
			style: {},
		},
	)
	assert.deepEqual(result.stage.sprites, [
		{ tag: "xue", attributes: ["smile"], position: "left", layer: "master" },
	])
	assert.deepStrictEqual(result.stage.background, Option.some("bg street"))
	assert.deepEqual(result.stage.audio, { music: { file: "rain", loop: true } })
	assert.equal(result.end.commit.state.waiting._tag, "End")
	assert.equal(result.end.commit.state.store["affection"], 1)
	assert.equal(result.end.commit.state.store["visits"], 1)
	assert.deepEqual(result.end.commit.state.store["asked"], ["和她一起等雨停"])
})

test("extend lines add to the line before them", async () => {
	const { story } = await compile([await fixture("rain.mdw")])
	const line = await play(story, (game) =>
		Effect.gen(function* () {
			for (let i = 0; i < 3; i++) yield* game.advance
			yield* game.choose(0)
			yield* game.advance
			return said(yield* waiting(game))
		}),
	)
	assert.equal(line, "小雪:谢谢你。你会感冒的。")
})

test("a save is a ref, and a load returns to it", async () => {
	const { story } = await compile([await fixture("rain.mdw")])
	const lines = await play(story, (game) =>
		Effect.gen(function* () {
			yield* game.advance
			yield* game.save("save/1")
			yield* game.advance
			yield* game.load("save/1")
			const slots = yield* game.slots
			return {
				line: said(yield* waiting(game)),
				slots: slots.map((s) => s.name),
			}
		}),
	)
	assert.equal(lines.line, "小雪:你好，旅人。明日也会下雨吗？")
	assert.deepEqual(lines.slots, ["auto", "save/1"])
})

test("a save finds its statement again after the script changes", async () => {
	const file = await fixture("rain.mdw")
	const { story } = await compile([file])
	const edited = await compile([
		{
			...file,
			source: file.source.replace(
				"雨下得很大。",
				"雨下得很大。\n\n::pause\n\n天很黑。",
			),
		},
	])
	const line = await play(story, (game) =>
		Effect.gen(function* () {
			yield* game.advance
			yield* game.replace(edited.story)
			yield* game.advance
			return said(yield* waiting(game))
		}),
	)
	assert.equal(line, "我:你也没带伞吗？")
})

test("unknown scenes and directives fail with their place", async () => {
	const error = await Effect.runPromise(
		Effect.flip(
			Compiler.compile([
				{ path: "bad.mdw", source: "# a\n\n[→](#nowhere)\n\n::dance\n" },
			]),
		),
	)
	assert.deepEqual(
		error.diagnostics.map((d) => [d.line, d.rule]),
		[
			[5, "unknown-directive"],
			[3, "unknown-scene"],
		],
	)
})

test("lint finds unknown images and unreachable scenes", async () => {
	const { story } = await compile([
		{
			path: "a.mdw",
			source: "# a\n\n::show[eileen happy]\n\nHi.\n\n::end\n\n# b\n\nAlone.\n",
		},
	])
	const found = Lint.check({ ...story, images: { "eileen sad": "/e.png" } })
	assert.deepEqual(
		found.map((d) => d.rule),
		["unknown-image", "unreachable-scene"],
	)
})
