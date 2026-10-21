import {
	Array as EffectArray,
	Clock,
	Context,
	Crypto,
	Effect,
	Layer,
	Option,
	Random as EffectRandom,
	Ref,
	Schema,
	Semaphore,
	Stream,
	SubscriptionRef,
} from "effect"
import { Evaluator, type ScriptError } from "../runtime/Evaluator.ts"
import * as Interpreter from "../runtime/Interpreter.ts"
import type * as State from "../runtime/State.ts"
import type * as Commit from "../repository/Commit.ts"
import {
	Persistence,
	type PersistenceError,
} from "../repository/Persistence.ts"
import * as Repository from "../repository/Repository.ts"
import type * as Story from "../story/Story.ts"

export class GameError extends Schema.TaggedError<GameError>()("GameError", {
	reason: Schema.Literals(["no-parent", "no-forward", "slot-missing"]),
	message: Schema.String,
}) {}

export type Failure =
	GameError | ScriptError | PersistenceError | Commit.CommitError

/** How the game got to a view. */
export type Move = "start" | "step" | "rollback" | "rollforward" | "load"

/**
 * True when the screen should play the view as new: type the line, play the
 * transitions and sounds. A rollback or a load jumps to its view at once.
 */
export const plays = (move: Move): boolean =>
	move === "start" || move === "step" || move === "rollforward"

/** What the screen shows now. */
export interface View {
	readonly commit: Commit.Commit
	readonly move: Move
	readonly canRollback: boolean
	readonly canRollforward: boolean
}

export class Game extends Context.Service<
	Game,
	{
		readonly story: Effect.Effect<Story.Story>
		readonly view: Effect.Effect<View>
		/** The current view, then every new view. */
		readonly changes: Stream.Stream<View>
		readonly advance: Effect.Effect<void, Failure>
		readonly choose: (index: number) => Effect.Effect<void, Failure>
		/** Go to the parent commit. Only the pointer moves. */
		readonly rollback: Effect.Effect<void, Failure>
		/** Go back along the path that the last rollbacks left. */
		readonly rollforward: Effect.Effect<void, Failure>
		readonly restart: Effect.Effect<void, Failure>
		/** Point a ref at the current commit. See {@link Repository.refs} for names. */
		readonly save: (ref: string) => Effect.Effect<void, Failure>
		readonly load: (ref: string) => Effect.Effect<void, Failure>
		readonly remove: (ref: string) => Effect.Effect<void, Failure>
		readonly slots: Effect.Effect<ReadonlyArray<Repository.Slot>, Failure>
		readonly history: Effect.Effect<ReadonlyArray<Repository.Entry>, Failure>
		/**
		 * Use a new version of the story, for example after a hot reload. The
		 * current commit stays; the next step finds its statement in the new story.
		 */
		readonly replace: (story: Story.Story) => Effect.Effect<void>
	}
>()("@wovel/core/game/Game") {}

interface Position {
	readonly commit: Commit.Commit
	readonly move: Move
	/** Commits that rollback left, the next one last. */
	readonly forward: ReadonlyArray<Commit.Id>
}

const view = (position: Position): View => ({
	commit: position.commit,
	move: position.move,
	canRollback: Option.isSome(position.commit.parent),
	canRollforward: position.forward.length > 0,
})

export const make = Effect.fn("Game.make")(function* (options: {
	readonly story: Story.Story
	/** The seed of a new game. The default is a random one. */
	readonly seed?: number
}): Effect.fn.Return<
	typeof Game.Service,
	Failure,
	Persistence | Evaluator | Crypto.Crypto
> {
	const services = yield* Effect.context<
		Persistence | Evaluator | Crypto.Crypto
	>()
	const story = yield* Ref.make(options.story)
	const lock = yield* Semaphore.make(1)
	const run = <A, E>(
		effect: Effect.Effect<A, E, Persistence | Evaluator | Crypto.Crypto>,
	): Effect.Effect<A, E> =>
		effect.pipe(Effect.provideContext(services), lock.withPermits(1))

	const record = (parent: Option.Option<Commit.Id>, state: State.State) =>
		Effect.gen(function* () {
			const time = yield* Clock.currentTimeMillis
			const made = yield* Repository.commit({ parent, state, time })
			const persistence = yield* Persistence
			yield* persistence.setRef({
				name: Repository.refs.auto,
				commit: made.id,
			})
			return made
		})

	const fresh = Effect.gen(function* () {
		const seed = options.seed ?? (yield* EffectRandom.nextInt)
		return yield* record(
			Option.none(),
			yield* Interpreter.start(yield* Ref.get(story), seed),
		)
	})

	const position = yield* SubscriptionRef.make<Position>({
		commit: yield* fresh.pipe(Effect.provideContext(services)),
		move: "start",
		forward: [],
	})

	const step = (input: Interpreter.Input) =>
		run(
			Effect.gen(function* () {
				const current = yield* SubscriptionRef.get(position)
				const state = yield* Interpreter.resume(
					yield* Ref.get(story),
					current.commit.state,
					input,
				)
				// The auto save and the screen move together, or not at all.
				yield* Effect.uninterruptible(
					Effect.gen(function* () {
						const made = yield* record(Option.some(current.commit.id), state)
						// The same step after a rollback gives the same commit id, so the forward path stays.
						const forward = Option.contains(
							EffectArray.last(current.forward),
							made.id,
						)
							? current.forward.slice(0, -1)
							: []
						yield* SubscriptionRef.set(position, {
							commit: made,
							move: "step",
							forward,
						})
					}),
				)
			}),
		)

	const move = (
		pick: (current: Position) => Effect.Effect<Position, Failure, Persistence>,
	) =>
		run(
			Effect.gen(function* () {
				const next = yield* pick(yield* SubscriptionRef.get(position))
				yield* SubscriptionRef.set(position, next)
			}),
		)

	const slotMissing = (ref: string) =>
		GameError.make({
			reason: "slot-missing",
			message: `There is no save named "${ref}"`,
		})

	return Game.of({
		story: Ref.get(story),
		view: Effect.map(SubscriptionRef.get(position), view),
		changes: SubscriptionRef.changes(position).pipe(Stream.map(view)),
		advance: step({ _tag: "Advance" }),
		choose: (index) => step({ _tag: "Choose", index }),
		rollback: move((current) =>
			Option.match(current.commit.parent, {
				onNone: () =>
					Effect.fail(
						GameError.make({
							reason: "no-parent",
							message: "This is the first step of the game",
						}),
					),
				onSome: (parent) =>
					Effect.map(Repository.get(parent), (commit) => ({
						commit,
						move: "rollback" as const,
						forward: [...current.forward, current.commit.id],
					})),
			}),
		),
		rollforward: move((current) =>
			Option.match(EffectArray.last(current.forward), {
				onNone: () =>
					Effect.fail(
						GameError.make({
							reason: "no-forward",
							message: "There is nothing to go forward to",
						}),
					),
				onSome: (next) =>
					Effect.map(Repository.get(next), (commit) => ({
						commit,
						move: "rollforward" as const,
						forward: current.forward.slice(0, -1),
					})),
			}),
		),
		restart: run(
			Effect.gen(function* () {
				const commit = yield* fresh
				yield* SubscriptionRef.set(position, {
					commit,
					move: "start",
					forward: [],
				})
			}),
		),
		save: (ref) =>
			run(
				Effect.gen(function* () {
					const persistence = yield* Persistence
					const current = yield* SubscriptionRef.get(position)
					yield* persistence.setRef({ name: ref, commit: current.commit.id })
				}),
			),
		load: (ref) =>
			move(() =>
				Effect.gen(function* () {
					const persistence = yield* Persistence
					const id = yield* persistence.ref(ref)
					if (Option.isNone(id)) return yield* slotMissing(ref)
					return {
						commit: yield* Repository.get(id.value),
						move: "load" as const,
						forward: [],
					}
				}),
			),
		remove: (ref) =>
			run(
				Effect.flatMap(Persistence, (persistence) =>
					persistence.removeRef(ref),
				),
			),
		slots: run(Repository.slots),
		history: run(
			Effect.flatMap(SubscriptionRef.get(position), (current) =>
				Repository.history(current.commit),
			),
		),
		replace: (next) => Ref.set(story, next),
	})
})

export const layer = (options: {
	readonly story: Story.Story
	readonly seed?: number
}): Layer.Layer<Game, Failure, Persistence | Evaluator | Crypto.Crypto> =>
	Layer.effect(Game, make(options))
