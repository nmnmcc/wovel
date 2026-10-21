import { Game, State } from "@wovel/core"
import { Effect, Layer, Option, Random, type Scope } from "effect"
import { Runtime } from "foldkit"
import * as Audio from "./Audio.ts"
import { Labels, Model } from "./screen/Model.ts"
import { subscriptions } from "./screen/Subscription.ts"
import { update } from "./screen/Update.ts"
import { view } from "./screen/View.ts"
import { css } from "./Style.ts"

export { Labels }

export interface Options {
	readonly root: HTMLElement
	readonly labels?: Partial<Labels>
	/** How fast the text appears. 0 shows each line at once. The default is 40. */
	readonly charactersPerSecond?: number
}

/**
 * Show a game in an element and read the player's input. The screen is a
 * Foldkit program: a Model, an update function, and a view. It runs until the
 * Scope closes, and closing the Scope removes its DOM nodes, listeners, and
 * sounds.
 */
export const mount = Effect.fn("Renderer.mount")(function* (
	options: Options,
): Effect.fn.Return<never, never, Game.Game | Scope.Scope> {
	const game = yield* Game.Game
	const document = options.root.ownerDocument
	// Foldkit needs an id on its container. Each game on a page gets its own.
	const id = `wovel-${yield* Random.nextIntBetween(0, 2 ** 31)}`
	const reducedMotion = yield* Effect.sync(
		() =>
			document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
				.matches ?? false,
	)
	// Foldkit replaces this element with the screen, and puts it back when it stops.
	const container = yield* Effect.acquireRelease(
		Effect.sync(() => {
			const style = document.createElement("style")
			style.textContent = css
			const container = document.createElement("div")
			container.id = id
			options.root.append(style, container)
			return { style, container }
		}),
		({ style, container }) =>
			Effect.sync(() => {
				style.remove()
				container.remove()
			}),
	)
	const initial: Model = {
		id,
		labels: { ...Labels.default, ...options.labels },
		charactersPerSecond: options.charactersPerSecond ?? 40,
		reducedMotion,
		images: {},
		// The screen shows nothing until the first view of the game comes.
		waiting: { _tag: "Pause" },
		stage: State.Stage.empty,
		canRollback: false,
		typing: Option.none(),
		dissolve: 0,
		previousBackground: Option.none(),
		leaving: [],
		fade: Option.none(),
		history: Option.none(),
		hideInterface: false,
		notices: [],
		nextKey: 0,
		error: Option.none(),
	}
	const program = Runtime.makeElement({
		Model,
		init: () => ({ model: initial }),
		update,
		view,
		subscriptions,
		container: container.container,
		resources: Layer.mergeAll(
			Layer.succeed(Game.Game, game),
			Audio.layer(options.root),
		),
		crash: {
			// The update loop has stopped, so the screen can only show the error.
			view: ({ error }, h) =>
				h.div(
					[h.Id(id), h.Class("wovel")],
					[h.div([h.Class("wovel-error"), h.Role("alert")], [error.message])],
				),
		},
	})
	// The program runs until it is interrupted, and then removes its nodes.
	yield* program.start()
	return yield* Effect.never
})
