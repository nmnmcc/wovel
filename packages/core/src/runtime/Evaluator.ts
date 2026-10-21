import { Context, Effect, Layer, Option, Schema } from "effect"
import * as Instruction from "../story/Instruction.ts"
import * as Random from "./Random.ts"
import * as State from "./State.ts"

export class ScriptError extends Schema.TaggedError<ScriptError>()(
	"ScriptError",
	{
		reason: Schema.Literals([
			"evaluation-failed",
			"invalid-value",
			"unknown-scene",
			"invalid-input",
			"story-changed",
			"loop-limit",
		]),
		message: Schema.String,
		source: Schema.optionalKey(Instruction.Source),
		/** What the script code threw, if it threw. */
		cause: Schema.optionalKey(Schema.Defect()),
	},
) {}

/** What script code can see: the store and the seed of `wovel.random()`. */
export interface Bindings {
	readonly store: State.Store
	readonly seed: State.Seed
}

/** What a code block did. A block can change the store and ask for a jump. */
export interface Outcome extends Bindings {
	readonly jump: Option.Option<string>
	readonly call: Option.Option<string>
}

/**
 * Runs the JavaScript in a script: conditions, `::set` values, interpolation,
 * and ```` ```js ```` blocks. A host can replace it, for example with one that
 * runs code in a Web Worker for stories it does not trust.
 */
export class Evaluator extends Context.Service<
	Evaluator,
	{
		readonly evaluate: (
			expression: string,
			bindings: Bindings,
		) => Effect.Effect<unknown, ScriptError>
		readonly execute: (
			code: string,
			bindings: Bindings,
		) => Effect.Effect<Outcome, ScriptError>
	}
>()("@wovel/core/runtime/Evaluator") {}

/** Names that the script can not use as store variables. */
const reserved = new Set(["wovel", "__scope"])

/**
 * A scope for `with`. Store variables come first. Names that are not globals
 * also go to the store, so `x = 1` makes a store variable, not a global.
 */
const sandbox = (store: Record<string, unknown>) =>
	new Proxy(store, {
		has: (target, key) =>
			typeof key === "string" &&
			!reserved.has(key) &&
			(Object.hasOwn(target, key) || !(key in globalThis)),
		get: (target, key) =>
			key === Symbol.unscopables ? undefined : Reflect.get(target, key),
	})

const run = (body: string, bindings: Bindings) => {
	let seed = bindings.seed
	const jumps = { jump: Option.none<string>(), call: Option.none<string>() }
	const store: Record<string, unknown> = structuredClone(bindings.store)
	const api = {
		random: () => {
			const [value, next] = Random.next(seed)
			seed = next
			return value
		},
		jump: (scene: string) => {
			jumps.jump = Option.some(scene)
		},
		call: (scene: string) => {
			jumps.call = Option.some(scene)
		},
	}
	// Code in a script is not strict mode code, so `with` works here.
	const value: unknown = new Function(
		"__scope",
		"wovel",
		`with (__scope) {\n${body}\n}`,
	)(sandbox(store), api)
	return { value, store, seed, ...jumps }
}

const isStore = Schema.is(State.Store)

const failed = (cause: unknown) =>
	ScriptError.make({
		reason: "evaluation-failed",
		// String() can throw too, for example on Object.create(null).
		message:
			cause instanceof Error
				? cause.message
				: typeof cause === "string"
					? cause
					: "The script threw a value that is not an Error",
		cause,
	})

export const make = Evaluator.of({
	evaluate: (expression, bindings) =>
		Effect.try({
			try: () => run(`return (${expression});`, bindings).value,
			catch: failed,
		}),
	execute: (code, bindings) =>
		Effect.try({ try: () => run(code, bindings), catch: failed }).pipe(
			Effect.flatMap((outcome) =>
				isStore(outcome.store)
					? Effect.succeed({
							store: outcome.store,
							seed: outcome.seed,
							jump: outcome.jump,
							call: outcome.call,
						})
					: Effect.fail(
							ScriptError.make({
								reason: "invalid-value",
								message:
									"A store variable must be JSON: a string, a number, a boolean, null, an array, or a plain object",
							}),
						),
			),
		),
})

export const layer = Layer.succeed(Evaluator, make)
