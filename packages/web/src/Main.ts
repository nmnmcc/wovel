// This file is the entry point of a game, so it provides the layers.
// @effect-diagnostics strictEffectProvide:off
import {
	Evaluator,
	Game,
	MemoryPersistence,
	Persistence,
	Story,
	WebCrypto,
} from "@wovel/core"
import { Cause, Deferred, Effect, Fiber, Layer } from "effect"
import * as IndexedDbPersistence from "./IndexedDbPersistence.ts"
import * as Renderer from "./Renderer.ts"

export interface Options extends Renderer.Options {
	/** The compiled story, for example the default export of `virtual:wovel/story`. */
	readonly story: unknown
	/**
	 * Where saves go. A name keeps them in IndexedDB under that name. `false`
	 * keeps them in memory, so they are gone when the page closes.
	 */
	readonly saves?: string | false
}

export interface Running {
	/**
	 * Use a new version of the story without losing the place, for hot reload.
	 * It rejects when the story is not valid or the game did not start.
	 */
	readonly replace: (story: unknown) => Promise<void>
	readonly stop: () => Promise<void>
}

/** Start a game in the browser. This is the host boundary: it runs the Effect program. */
export const start = (options: Options): Running => {
	const persistence: Layer.Layer<
		Persistence.Persistence,
		Persistence.PersistenceError
	> =
		options.saves === false
			? MemoryPersistence.layer
			: IndexedDbPersistence.layer({ name: options.saves ?? "default" })
	const ready = Deferred.makeUnsafe<
		typeof Game.Game.Service,
		Game.Failure | Story.StoryError | Persistence.PersistenceError
	>()
	const program = Effect.gen(function* () {
		const story = yield* Story.decode(options.story)
		const game = yield* Game.make({ story })
		yield* Deferred.succeed(ready, game)
		return yield* Renderer.mount(options).pipe(
			Effect.provideService(Game.Game, game),
		)
	}).pipe(
		Effect.scoped,
		Effect.provide(
			Layer.mergeAll(persistence, Evaluator.layer, WebCrypto.layer),
		),
		// When the game does not start, replace() must not wait for it forever.
		Effect.tapCause((cause) => Deferred.failCause(ready, cause)),
		// stop() interrupts the program. That is not an error to show.
		Effect.tapCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) =>
				Effect.logError("The game could not run", cause).pipe(
					Effect.andThen(
						Effect.sync(() => {
							options.root.textContent = Cause.pretty(cause)
						}),
					),
				),
		),
	)
	const fiber = Effect.runFork(program)
	return {
		replace: (story) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const game = yield* Deferred.await(ready)
					yield* game.replace(yield* Story.decode(story))
				}),
			),
		stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
	}
}
