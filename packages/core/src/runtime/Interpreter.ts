import {
	Array as EffectArray,
	Data,
	Effect,
	Option,
	Record,
	Schema,
} from "effect"
import { dual } from "effect/Function"
import type * as Instruction from "../story/Instruction.ts"
import * as Story from "../story/Story.ts"
import * as Text from "../story/Text.ts"
import { Evaluator, ScriptError } from "./Evaluator.ts"
import * as Random from "./Random.ts"
import * as State from "./State.ts"

/** What the player did. */
export const Input = Schema.TaggedUnion({
	Advance: {},
	Choose: { index: Schema.Int },
})
export type Input = typeof Input.Type

/** The interpreter stops after this many statements without a wait, so a loop can not hang the game. */
const limit = 100_000

/** The part of the state that changes while the interpreter runs. */
interface RunContext {
	readonly stack: ReadonlyArray<Story.Pointer>
	readonly store: State.Store
	readonly seed: State.Seed
	readonly stage: State.Stage
	/** The last line, for `+ extend`. */
	readonly line: Option.Option<State.Line>
}

const isJson = Schema.is(Schema.Json)

/**
 * The text of a value from script code. The value can be anything, and both
 * `JSON.stringify` and `String` can throw, so this is an Effect.
 */
const stringify = (value: unknown): Effect.Effect<string, ScriptError> =>
	Effect.try({
		try: () =>
			value === null || value === undefined
				? ""
				: typeof value === "object"
					? (JSON.stringify(value) ?? "")
					: String(value),
		catch: (cause) =>
			ScriptError.make({
				reason: "invalid-value",
				message: "The value can not be turned into text",
				cause,
			}),
	})

/** The text of the spans as the writer wrote it. Menu sets use it as the key of an option. */
export const caption = (text: Text.Text): string =>
	text
		.map((span) =>
			span._tag === "Text"
				? span.value
				: span._tag === "Interpolation"
					? `{${[span.expression, ...span.filters].join("|")}}`
					: span._tag === "Ruby"
						? span.base
						: "\n",
		)
		.join("")

const render = Effect.fnUntraced(function* (
	text: Text.Text,
	context: RunContext,
) {
	const evaluator = yield* Evaluator
	return yield* Effect.forEach(
		text,
		(span): Effect.Effect<Text.Rendered, ScriptError> =>
			span._tag === "Interpolation"
				? evaluator.evaluate(span.expression, context).pipe(
						Effect.flatMap(stringify),
						Effect.map((value) => ({
							_tag: "Text" as const,
							value: span.filters.reduce(
								(text, filter) =>
									Option.match(Record.get(Text.filters, filter), {
										onNone: () => text,
										onSome: (apply) => apply(text),
									}),
								value,
							),
							style: span.style,
						})),
					)
				: Effect.succeed(span),
	)
})

const line = Effect.fnUntraced(function* (
	story: Story.Story,
	speaker: Instruction.Speaker,
	text: Text.Text,
	context: RunContext,
) {
	const who = Option.fromUndefinedOr(speaker.who)
	const character = Option.flatMap(who, (who) =>
		Record.get(story.characters, who),
	)
	const affix = (
		pick: (character: Story.Character) => string | undefined,
	): Text.RenderedText =>
		Option.match(
			Option.flatMap(character, (c) => Option.fromUndefinedOr(pick(c))),
			{
				onNone: () => [],
				onSome: (value) => [{ _tag: "Text", value, style: {} }],
			},
		)
	const body = yield* render(text, context)
	const { name, color } = Story.speaker(story, speaker)
	return {
		who,
		name,
		color,
		text: [...affix((c) => c.prefix), ...body, ...affix((c) => c.suffix)],
	} satisfies State.Line
})

const truthy = (expression: string, context: RunContext) =>
	Effect.flatMap(Evaluator, (evaluator) =>
		evaluator.evaluate(expression, context),
	).pipe(Effect.map(Boolean))

const sceneIndex = (story: Story.Story, name: string) =>
	Story.scene(story, name).pipe(
		Effect.map((scene) => scene.index),
		Effect.mapError((error) =>
			ScriptError.make({ reason: "unknown-scene", message: error.message }),
		),
	)

const resolve = (
	story: Story.Story,
	target: Instruction.Target,
	context: RunContext,
): Effect.Effect<number, ScriptError, Evaluator> => {
	switch (target._tag) {
		case "Index":
			return Effect.succeed(target.index)
		case "Scene":
			return sceneIndex(story, target.scene)
		case "Expression":
			return Effect.flatMap(Evaluator, (evaluator) =>
				evaluator.evaluate(target.expression, context),
			).pipe(
				Effect.flatMap(stringify),
				Effect.flatMap((name) => sceneIndex(story, name)),
			)
	}
}

/** The scene that holds the statement at an index: the last scene that starts at or before it. */
export const sceneAt: {
	(index: number): (story: Story.Story) => string
	(story: Story.Story, index: number): string
} = dual(
	2,
	(story: Story.Story, index: number): string =>
		Record.toEntries(story.scenes).reduce(
			(best, [name, scene]) =>
				scene.index <= index && scene.index >= best.index
					? { name, index: scene.index }
					: best,
			{ name: story.start, index: -1 },
		).name,
)

const show = (
	stage: State.Stage,
	instruction: Extract<Instruction.Instruction, { _tag: "Show" }>,
): State.Stage => {
	const current = EffectArray.findFirst(
		stage.sprites,
		(sprite) => sprite.tag === instruction.tag,
	)
	const sprite: State.Sprite = {
		tag: instruction.tag,
		attributes: Option.match(current, {
			onNone: () => instruction.attributes,
			onSome: (current) =>
				instruction.attributes.length > 0
					? instruction.attributes
					: current.attributes,
		}),
		position:
			instruction.position ??
			Option.match(current, {
				onNone: () => "center",
				onSome: (current) => current.position,
			}),
		layer:
			instruction.layer ??
			Option.match(current, {
				onNone: () => "master",
				onSome: (current) => current.layer,
			}),
	}
	return {
		...stage,
		sprites: Option.isNone(current)
			? [...stage.sprites, sprite]
			: stage.sprites.map((s) => (s.tag === instruction.tag ? sprite : s)),
		transition: Option.orElse(
			Option.fromUndefinedOr(instruction.transition),
			() => stage.transition,
		),
	}
}

const assign = Effect.fnUntraced(function* (
	assignment: Instruction.Assignment,
	context: RunContext,
) {
	const evaluator = yield* Evaluator
	const value = yield* evaluator.evaluate(assignment.expression, context)
	const current = context.store[assignment.name]
	const invalid = (cause?: unknown) =>
		ScriptError.make({
			reason: "invalid-value",
			message: `The value of "${assignment.name}" must be JSON`,
			...(cause === undefined ? {} : { cause }),
		})
	const next =
		assignment.operator === "="
			? value
			: assignment.operator === "+=" && typeof current === "string"
				? current + (yield* stringify(value))
				: yield* Effect.try({
						// Number() throws on a Symbol.
						try: () =>
							assignment.operator === "+="
								? Number(current ?? 0) + Number(value)
								: Number(current ?? 0) - Number(value),
						catch: invalid,
					})
	if (!isJson(next)) return yield* invalid()
	return { ...context.store, [assignment.name]: next }
})

const wait = (
	story: Story.Story,
	index: number,
	instruction: Instruction.Instruction,
	context: RunContext,
	waiting: State.Waiting,
): State.State => ({
	at: Story.pointer(instruction),
	stack: context.stack,
	store: context.store,
	seed: context.seed,
	stage: context.stage,
	waiting,
	scene: sceneAt(story, index),
})

/** Add the place of a statement to an error that has none. */
const at = (error: ScriptError, source: Instruction.Source): ScriptError =>
	error.source === undefined
		? // Spread does not work here: `message` is not an own field of an error.
			ScriptError.make({
				reason: error.reason,
				message: error.message,
				source,
				...(error.cause === undefined ? {} : { cause: error.cause }),
			})
		: error

/** Run from an index until a statement waits for the player. */
const run = Effect.fnUntraced(function* (
	story: Story.Story,
	start: number,
	initial: RunContext,
) {
	let index = start
	let context = initial
	for (let step = 0; step < limit; step++) {
		const instruction = story.instructions[index]
		if (instruction === undefined) {
			// The compiler ends every file with Return, so this only happens with a broken story.
			return yield* ScriptError.make({
				reason: "story-changed",
				message: `There is no statement at index ${index}`,
			})
		}
		const result = yield* execute(story, index, instruction, context).pipe(
			Effect.mapError((error) => at(error, instruction.source)),
		)
		if (result._tag === "Wait") return result.state
		index = result.index
		context = result.context
	}
	return yield* ScriptError.make({
		reason: "loop-limit",
		message: `The story ran ${limit} statements without waiting for the player. Check for a loop that never ends.`,
	})
})

type Step = Data.TaggedEnum<{
	Wait: { readonly state: State.State }
	Next: { readonly index: number; readonly context: RunContext }
}>
const Step = Data.taggedEnum<Step>()

const next = (index: number, context: RunContext): Step =>
	Step.Next({ index, context })

const execute = Effect.fnUntraced(function* (
	story: Story.Story,
	index: number,
	instruction: Instruction.Instruction,
	context: RunContext,
): Effect.fn.Return<Step, ScriptError, Evaluator> {
	const stop = (waiting: State.Waiting): Step =>
		Step.Wait({ state: wait(story, index, instruction, context, waiting) })
	switch (instruction._tag) {
		case "Say": {
			const said = yield* line(story, instruction, instruction.text, context)
			const shown =
				instruction.extend && Option.isSome(context.line)
					? {
							...context.line.value,
							text: [...context.line.value.text, ...said.text],
						}
					: said
			return stop({ _tag: "Say", line: shown })
		}
		case "Menu": {
			const picked = Option.match(Option.fromNullishOr(instruction.set), {
				onNone: () => [] as ReadonlyArray<unknown>,
				onSome: (name) => {
					const value = context.store[name]
					return Array.isArray(value) ? value : []
				},
			})
			const offered = yield* Effect.filter(
				instruction.options.map((option, index) => ({ option, index })),
				({ option }) =>
					picked.includes(caption(option.text))
						? Effect.succeed(false)
						: option.condition === undefined
							? Effect.succeed(true)
							: truthy(option.condition, context),
			)
			// A menu with no options left is skipped, like in Ren'Py.
			if (offered.length === 0) return next(index + 1, context)
			const choices = yield* Effect.forEach(offered, ({ option, index }) =>
				Effect.map(render(option.text, context), (text) => ({ index, text })),
			)
			const prompt =
				instruction.prompt === undefined
					? Option.none()
					: Option.some(
							yield* line(
								story,
								instruction.prompt,
								instruction.prompt.text,
								context,
							),
						)
			return stop({ _tag: "Menu", prompt, choices })
		}
		case "Pause":
			return stop({ _tag: "Pause" })
		case "End":
			return stop({ _tag: "End" })
		case "Jump":
			return next(yield* resolve(story, instruction.target, context), context)
		case "Call":
			return next(yield* resolve(story, instruction.target, context), {
				...context,
				stack: [...context.stack, Story.pointer(instruction)],
			})
		case "Return": {
			const top = EffectArray.last(context.stack)
			if (Option.isNone(top)) return stop({ _tag: "End" })
			const from = yield* Effect.fromOption(
				Story.locate(story, top.value),
				() =>
					ScriptError.make({
						reason: "story-changed",
						message: "The statement that called this scene is gone",
					}),
			)
			return next(from + 1, { ...context, stack: context.stack.slice(0, -1) })
		}
		case "Branch":
			return next(
				(yield* truthy(instruction.condition, context))
					? index + 1
					: instruction.otherwise,
				context,
			)
		case "Set": {
			let current = context
			for (const assignment of instruction.assignments)
				current = { ...current, store: yield* assign(assignment, current) }
			return next(index + 1, current)
		}
		case "Code": {
			const evaluator = yield* Evaluator
			const outcome = yield* evaluator.execute(instruction.code, context)
			const changed = { ...context, store: outcome.store, seed: outcome.seed }
			if (Option.isSome(outcome.call))
				return next(yield* sceneIndex(story, outcome.call.value), {
					...changed,
					stack: [...changed.stack, Story.pointer(instruction)],
				})
			if (Option.isSome(outcome.jump))
				return next(yield* sceneIndex(story, outcome.jump.value), changed)
			return next(index + 1, changed)
		}
		case "Show":
			return next(index + 1, {
				...context,
				stage: show(context.stage, instruction),
			})
		case "Hide":
			return next(index + 1, {
				...context,
				stage: {
					...context.stage,
					sprites: context.stage.sprites.filter(
						(sprite) => sprite.tag !== instruction.tag,
					),
					transition: Option.orElse(
						Option.fromUndefinedOr(instruction.transition),
						() => context.stage.transition,
					),
				},
			})
		case "Background":
			return next(index + 1, {
				...context,
				stage: {
					...context.stage,
					background: Option.some(instruction.image),
					sprites: context.stage.sprites.filter(
						(sprite) => sprite.layer !== "master",
					),
					transition: Option.orElse(
						Option.fromUndefinedOr(instruction.transition),
						() => context.stage.transition,
					),
				},
			})
		case "Play":
			return next(index + 1, {
				...context,
				stage:
					instruction.loop === false
						? {
								...context.stage,
								cues: [
									...context.stage.cues,
									{ channel: instruction.channel, file: instruction.file },
								],
							}
						: {
								...context.stage,
								audio: {
									...context.stage.audio,
									[instruction.channel]: {
										file: instruction.file,
										loop: instruction.loop,
									},
								},
							},
			})
		case "Stop":
			return next(index + 1, {
				...context,
				stage: {
					...context.stage,
					audio: Record.remove(context.stage.audio, instruction.channel),
				},
			})
	}
})

/** Start a new game at the start scene. */
export const start: {
	(
		seed: number,
	): (story: Story.Story) => Effect.Effect<State.State, ScriptError, Evaluator>
	(
		story: Story.Story,
		seed: number,
	): Effect.Effect<State.State, ScriptError, Evaluator>
} = dual(
	2,
	(
		story: Story.Story,
		seed: number,
	): Effect.Effect<State.State, ScriptError, Evaluator> =>
		Effect.flatMap(sceneIndex(story, story.start), (index) =>
			run(story, index, {
				stack: [],
				store: story.defaults,
				seed: Random.seed(seed),
				stage: State.Stage.empty,
				line: Option.none(),
			}),
		),
)

/**
 * Go on from a state after the player acts. The state may come from an older
 * version of the story; {@link Story.locate} finds its statement again.
 */
export const resume: {
	(
		state: State.State,
		input: Input,
	): (story: Story.Story) => Effect.Effect<State.State, ScriptError, Evaluator>
	(
		story: Story.Story,
		state: State.State,
		input: Input,
	): Effect.Effect<State.State, ScriptError, Evaluator>
} = dual(
	3,
	(
		story: Story.Story,
		state: State.State,
		input: Input,
	): Effect.Effect<State.State, ScriptError, Evaluator> =>
		Effect.gen(function* () {
			const index = yield* locate(story, state)
			const instruction = story.instructions[index]
			const context: RunContext = {
				stack: state.stack,
				// Variables that the story added since the save get their defaults.
				store: { ...story.defaults, ...state.store },
				seed: state.seed,
				// Transitions and cues play once, when their stage first shows.
				stage: { ...state.stage, transition: Option.none(), cues: [] },
				line:
					state.waiting._tag === "Say"
						? Option.some(state.waiting.line)
						: Option.none(),
			}
			const invalid = (message: string) =>
				ScriptError.make({ reason: "invalid-input", message })
			switch (state.waiting._tag) {
				case "End":
					return yield* invalid("The story has ended")
				case "Say":
				case "Pause":
					if (input._tag !== "Advance")
						return yield* invalid("The game waits for a click, not a choice")
					return yield* run(story, index + 1, context)
				case "Menu": {
					if (input._tag !== "Choose" || instruction?._tag !== "Menu")
						return yield* invalid("The game waits for a choice")
					const offered = state.waiting.choices.some(
						(choice) => choice.index === input.index,
					)
					const option = instruction.options[input.index]
					if (!offered || option === undefined)
						return yield* invalid(`Option ${input.index} is not on the menu`)
					const store = Option.match(Option.fromNullishOr(instruction.set), {
						onNone: () => context.store,
						onSome: (name) => {
							const value = context.store[name]
							return {
								...context.store,
								[name]: [
									...(Array.isArray(value) ? value : []),
									caption(option.text),
								],
							}
						},
					})
					const chosen = { ...context, store, line: Option.none() }
					return yield* run(
						story,
						yield* resolve(story, option.target, chosen),
						chosen,
					)
				}
			}
		}),
)

/** The index of the statement where a state waits. */
export const locate: {
	(
		state: State.State,
	): (story: Story.Story) => Effect.Effect<number, ScriptError>
	(story: Story.Story, state: State.State): Effect.Effect<number, ScriptError>
} = dual(
	2,
	(
		story: Story.Story,
		state: State.State,
	): Effect.Effect<number, ScriptError> =>
		Effect.fromOption(Story.locate(story, state.at), () =>
			ScriptError.make({
				reason: "story-changed",
				message: `The statement "${state.at.id}" is not in the story any more`,
			}),
		),
)
