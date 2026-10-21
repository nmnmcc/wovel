import { Game, Repository, type State, type Story } from "@wovel/core"
import {
	Cause,
	Data,
	Equal,
	Effect,
	Fiber,
	Option,
	Queue,
	Record,
	Ref,
	Schema,
	Stream,
	type Scope,
} from "effect"
import * as Audio from "./Audio.ts"
import * as Dom from "./Dom.ts"
import { css } from "./Style.ts"

/** The words of the buttons and notices. A game can change any of them. */
export class Labels extends Schema.Opaque<Labels>()(
	Schema.Struct({
		back: Schema.String,
		forward: Schema.String,
		save: Schema.String,
		load: Schema.String,
		history: Schema.String,
		restart: Schema.String,
		close: Schema.String,
		end: Schema.String,
		saved: Schema.String,
		noSave: Schema.String,
	}),
) {
	static readonly default: Labels = {
		back: "Back",
		forward: "Forward",
		save: "Save",
		load: "Load",
		history: "History",
		restart: "Restart",
		close: "Close",
		end: "The End",
		saved: "Saved",
		noSave: "There is no save yet",
	}
}

export interface Options {
	readonly root: HTMLElement
	readonly labels?: Partial<Labels>
	/** How fast the text appears. 0 shows each line at once. The default is 40. */
	readonly charactersPerSecond?: number
}

/** What the player asks for, after keys, clicks, and the wheel are read. */
type Action = Data.TaggedEnum<{
	Advance: {}
	Choose: { readonly index: number }
	Rollback: {}
	Rollforward: {}
	Save: {}
	Load: {}
	History: {}
	Restart: {}
	ToggleInterface: {}
	Close: {}
}>
const Action = Data.taggedEnum<Action>()

/**
 * What the screen reacts to: a new view of the game, or an action. One fiber
 * takes both in order, so an action always sees the screen of the last view.
 */
type Event = Data.TaggedEnum<{
	Show: { readonly view: Game.View }
	Act: { readonly action: Action }
}>
const Event = Data.taggedEnum<Event>()

const keys: Readonly<Record<string, Action>> = {
	" ": Action.Advance(),
	Enter: Action.Advance(),
	PageUp: Action.Rollback(),
	PageDown: Action.Rollforward(),
	h: Action.ToggleInterface(),
	H: Action.ToggleInterface(),
	Escape: Action.Close(),
}

const durations: Readonly<Record<string, number>> = {
	dissolve: 500,
	fade: 1000,
}

/** Run an animation to its end. Interrupting the fiber ends it at once. */
const animate = (
	node: Element,
	keyframes: ReadonlyArray<Keyframe>,
	duration: number,
): Effect.Effect<void> =>
	duration <= 0
		? Effect.void
		: Effect.callback<void>((resume) => {
				const animation = node.animate([...keyframes], {
					duration,
					easing: "ease",
					fill: "forwards",
				})
				// A cancelled animation is over too. It is not an error.
				animation.onfinish = () => resume(Effect.void)
				animation.oncancel = () => resume(Effect.void)
				return Effect.sync(() => animation.finish())
			})

/**
 * Show a game in an element and read the player's input. The DOM nodes and
 * the event listeners belong to the Scope, so closing it removes them. It runs
 * until the Scope closes.
 */
export const mount = Effect.fn("Renderer.mount")(function* (
	options: Options,
): Effect.fn.Return<never, never, Game.Game | Scope.Scope> {
	const game = yield* Game.Game
	const document = options.root.ownerDocument
	const labels = { ...Labels.default, ...options.labels }
	const speed = options.charactersPerSecond ?? 40
	const reducedMotion =
		document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
			.matches ?? false
	const dom = Dom.make(document)
	const h = dom.element

	const button = (
		label: string,
		action: Action,
		attributes: Record<string, string> = {},
	) => {
		const node = h("button", { type: "button", ...attributes }, [label])
		node.addEventListener("click", (event) => {
			event.stopPropagation()
			send(action)
		})
		return node
	}

	const background = h("div", {
		class: "wovel-layer",
		"data-layer": "background",
	})
	const master = h("div", { class: "wovel-layer", "data-layer": "master" })
	const screens = h("div", { class: "wovel-layer", "data-layer": "screens" })
	const overlay = h("div", { class: "wovel-overlay" })
	const name = h("div", { class: "wovel-name" })
	const text = h("p", { class: "wovel-text", "aria-live": "polite" })
	const say = h("div", { class: "wovel-say" }, [name, text])
	const menu = h("div", { class: "wovel-menu", role: "menu" })
	const back = button(labels.back, Action.Rollback())
	const quick = h("nav", { class: "wovel-quick" }, [
		back,
		button(labels.history, Action.History()),
		button(labels.save, Action.Save()),
		button(labels.load, Action.Load()),
	])
	const message = h("div", {
		class: "wovel-error",
		role: "alert",
		hidden: "",
	})
	screens.append(say, menu, quick, message)
	const stage = h("div", { class: "wovel-stage" }, [
		background,
		master,
		screens,
		overlay,
	])
	const container = h("div", { class: "wovel", tabindex: "0" }, [stage])
	const style = h("style", {}, [css])

	const actions = yield* Queue.unbounded<Action>()
	const audio = yield* Audio.make(document)
	// Listeners are plain callbacks, so they put actions in a queue for the fiber.
	const send = (action: Action) => {
		audio.unlock()
		Queue.offerUnsafe(actions, action)
	}

	yield* Effect.acquireRelease(
		Effect.sync(() => {
			options.root.append(style, container)
			container.focus()
		}),
		() =>
			Effect.sync(() => {
				style.remove()
				container.remove()
			}),
	)

	const listen = <K extends keyof HTMLElementEventMap>(
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
	) =>
		Effect.acquireRelease(
			Effect.sync(() => container.addEventListener(type, listener)),
			() => Effect.sync(() => container.removeEventListener(type, listener)),
		)

	yield* listen("click", (event) => {
		if (
			Option.exists(
				Dom.asElement(event.target),
				// closest() gives null when no ancestor matches.
				(target) => target.closest(".wovel-panel, a") !== null,
			)
		)
			return
		send(Action.Advance())
	})
	yield* listen("keydown", (event) => {
		const found = Record.get(keys, event.key)
		if (Option.isNone(found)) return
		const action = found.value
		// Enter on a focused button clicks it. Do not also advance.
		if (
			action._tag === "Advance" &&
			Option.exists(
				Dom.asElement(event.target),
				(target) => target.tagName === "BUTTON",
			)
		)
			return
		event.preventDefault()
		send(action)
	})
	let lastWheel = 0
	yield* listen("wheel", (event) => {
		if (event.timeStamp - lastWheel < 200) return
		lastWheel = event.timeStamp
		send(event.deltaY < 0 ? Action.Rollback() : Action.Rollforward())
	})

	/** The fiber that types the current line. Interrupting it shows the whole line. */
	const typing = yield* Ref.make(Option.none<Fiber.Fiber<void>>())
	const panel = yield* Ref.make(Option.none<HTMLElement>())

	const finishTyping = Effect.flatMap(
		Ref.getAndSet(typing, Option.none()),
		Option.match({
			onNone: () => Effect.succeed(false),
			onSome: (fiber) => Effect.as(Fiber.interrupt(fiber), true),
		}),
	)

	const closePanel = Effect.flatMap(
		Ref.getAndSet(panel, Option.none()),
		(current) =>
			Effect.sync(() => {
				if (Option.isSome(current)) current.value.remove()
			}),
	)

	const openPanel = Effect.fnUntraced(function* (
		title: string,
		children: ReadonlyArray<Node>,
	) {
		yield* closePanel
		const node = yield* Effect.sync(() => {
			const node = h("section", { class: "wovel-panel", role: "dialog" }, [
				h("h2", {}, [title]),
				...children,
				button(labels.close, Action.Close()),
			])
			screens.append(node)
			return node
		})
		yield* Ref.set(panel, Option.some(node))
	})

	const picture = (
		story: Story.Story,
		imageName: string,
		className: string,
	) => {
		const url = Dom.imageUrl(story, imageName)
		const node = Option.match(url, {
			onNone: () =>
				h("div", { class: `${className} wovel-placeholder` }, [imageName]),
			onSome: (src) =>
				h("img", {
					class: className,
					src,
					alt: imageName,
					draggable: "false",
				}),
		})
		node.dataset["name"] = imageName
		return node
	}

	const applyStage = Effect.fnUntraced(function* (
		story: Story.Story,
		next: State.Stage,
		transition: Option.Option<string>,
	) {
		const duration = reducedMotion
			? 0
			: Option.match(transition, {
					onNone: () => 0,
					onSome: (name) =>
						Option.getOrElse(Record.get(durations, name), () => 500),
				})
		const fade = Option.contains(transition, "fade")
		const dissolve = fade ? 0 : duration
		if (fade)
			yield* animate(overlay, [{ opacity: 0 }, { opacity: 1 }], duration / 2)

		// Change the DOM now, and keep the animations to run after.
		const fading = yield* Effect.sync(() => {
			const fading: Array<Effect.Effect<void>> = []
			const nameOf = (child: Element) =>
				Option.fromUndefinedOr((child as HTMLElement).dataset["name"])
			const current = Option.flatMap(
				Option.fromNullishOr(background.firstElementChild),
				nameOf,
			)
			if (!Equal.equals(current, next.background)) {
				if (Option.isSome(next.background)) {
					const node = picture(story, next.background.value, "wovel-background")
					background.append(node)
					fading.push(animate(node, [{ opacity: 0 }, { opacity: 1 }], dissolve))
				}
				const old = Array.from(background.children).filter(
					(child) => !Equal.equals(nameOf(child), next.background),
				)
				fading.push(Effect.sync(() => old.forEach((child) => child.remove())))
			}

			const existing = new Map(
				Array.from(master.children, (child) => [
					(child as HTMLElement).dataset["tag"] ?? "",
					child as HTMLElement,
				]),
			)
			for (const sprite of next.sprites) {
				const imageName = [sprite.tag, ...sprite.attributes].join(" ")
				let node = existing.get(sprite.tag)
				existing.delete(sprite.tag)
				if (node === undefined || node.dataset["name"] !== imageName) {
					const created = picture(story, imageName, "wovel-sprite")
					created.dataset["tag"] = sprite.tag
					if (node === undefined)
						fading.push(
							animate(created, [{ opacity: 0 }, { opacity: 1 }], dissolve),
						)
					node?.replaceWith(created)
					node = created
				}
				node.dataset["position"] = sprite.position
				node.style.setProperty(
					"--x",
					Option.getOrElse(
						Record.get(Dom.positions, sprite.position),
						() => sprite.position,
					),
				)
				master.append(node)
			}
			for (const node of existing.values())
				fading.push(
					animate(node, [{ opacity: 1 }, { opacity: 0 }], dissolve).pipe(
						Effect.andThen(Effect.sync(() => node.remove())),
					),
				)
			return fading
		})
		yield* Effect.all(fading, { concurrency: "unbounded", discard: true })
		if (fade)
			yield* animate(overlay, [{ opacity: 1 }, { opacity: 0 }], duration / 2)
	})

	const showLine = Effect.fnUntraced(function* (
		line: State.Line,
		type: boolean,
	) {
		const graphemes = yield* Effect.sync(() => {
			say.hidden = false
			name.textContent = Option.getOrElse(line.name, () => "")
			Option.match(line.color, {
				onNone: () => say.style.removeProperty("--wovel-name-color"),
				onSome: (color) => say.style.setProperty("--wovel-name-color", color),
			})
			const rendered = dom.text(line.text)
			text.replaceChildren(...rendered.nodes)
			return rendered.graphemes
		})
		if (!type || speed <= 0 || reducedMotion) return
		const reveal = Effect.sync(() =>
			graphemes.forEach((node) => node.removeAttribute("data-hidden")),
		)
		yield* Effect.sync(() =>
			graphemes.forEach((node) => node.setAttribute("data-hidden", "")),
		)
		const fiber = yield* Effect.forkChild(
			Effect.gen(function* () {
				for (const node of graphemes) {
					yield* Effect.sync(() => node.removeAttribute("data-hidden"))
					yield* Effect.sleep(1000 / speed)
				}
				yield* Ref.set(typing, Option.none())
			}).pipe(Effect.onInterrupt(() => reveal)),
		)
		yield* Ref.set(typing, Option.some(fiber))
	})

	const showWaiting = Effect.fnUntraced(function* (
		waiting: State.Waiting,
		fresh: boolean,
	) {
		yield* finishTyping
		yield* Effect.sync(() => {
			menu.replaceChildren()
			container.querySelector(".wovel-end")?.remove()
		})
		switch (waiting._tag) {
			case "Say":
				return yield* showLine(waiting.line, fresh)
			case "Menu":
				if (Option.isSome(waiting.prompt))
					yield* showLine(waiting.prompt.value, false)
				return yield* Effect.sync(() => {
					if (Option.isNone(waiting.prompt)) say.hidden = true
					menu.append(
						...waiting.choices.map((choice) => {
							const node = button("", Action.Choose({ index: choice.index }), {
								role: "menuitem",
							})
							node.replaceChildren(...dom.text(choice.text).nodes)
							return node
						}),
					)
					menu.querySelector<HTMLElement>("button")?.focus()
				})
			case "Pause":
				return yield* Effect.sync(() => {
					say.hidden = true
				})
			case "End":
				return yield* Effect.sync(() => {
					say.hidden = true
					screens.append(
						h("div", { class: "wovel-end" }, [
							h("div", {}, [labels.end]),
							button(labels.restart, Action.Restart()),
						]),
					)
				})
		}
	})

	const render = Effect.fnUntraced(function* (view: Game.View) {
		const story = yield* game.story
		// A new game and a step forward type the line and play transitions and
		// sounds. A rollback or a load jumps there.
		const fresh = Game.plays(view.move)
		const next = view.commit.state.stage
		yield* Effect.sync(() => {
			back.disabled = !view.canRollback
		})
		yield* audio.apply(story, next, fresh)
		yield* showWaiting(view.commit.state.waiting, fresh)
		yield* applyStage(story, next, fresh ? next.transition : Option.none())
	})

	const showError = (cause: Cause.Cause<Game.Failure>) =>
		Effect.logError("The game failed", cause).pipe(
			Effect.andThen(
				Effect.sync(() => {
					const error = Cause.findErrorOption(cause)
					message.hidden = false
					message.textContent = Option.match(error, {
						onNone: () => Cause.pretty(cause),
						onSome: (error) =>
							error._tag === "ScriptError" && error.source !== undefined
								? `${error.source.file}:${error.source.line}\n${error.message}`
								: error.message,
					})
				}),
			),
		)

	const notice = (value: string) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const node = h("div", { class: "wovel-notice", role: "status" }, [
					value,
				])
				screens.append(node)
				return node
			}),
			(node) => Effect.sync(() => node.remove()),
		).pipe(
			Effect.andThen(Effect.sleep("1500 millis")),
			Effect.scoped,
			Effect.forkChild,
			Effect.asVoid,
		)

	const historyPanel = Effect.gen(function* () {
		const entries = yield* game.history
		yield* openPanel(
			labels.history,
			entries.map((entry) =>
				h("p", {}, [
					...Option.match(entry.line.name, {
						onNone: () => [],
						onSome: (who) => [h("span", { class: "wovel-who" }, [who])],
					}),
					...dom.text(entry.line.text).nodes,
				]),
			),
		)
	})

	/** Rollback at the first step and rollforward at the last do nothing. */
	const atEdge = (error: Game.Failure) =>
		error._tag === "GameError" &&
		(error.reason === "no-parent" || error.reason === "no-forward")

	const handle = Effect.fnUntraced(function* (
		action: Action,
	): Effect.fn.Return<void, Game.Failure> {
		yield* Effect.sync(() => {
			message.hidden = true
		})
		switch (action._tag) {
			case "Advance": {
				if (Option.isSome(yield* Ref.get(panel))) return yield* closePanel
				const hidden = yield* Effect.sync(() =>
					container.hasAttribute("data-hide-ui"),
				)
				if (hidden)
					return yield* Effect.sync(() =>
						container.removeAttribute("data-hide-ui"),
					)
				if (yield* finishTyping) return
				const view = yield* game.view
				const waiting = view.commit.state.waiting._tag
				if (waiting === "Say" || waiting === "Pause") yield* game.advance
				return
			}
			case "Choose":
				return yield* game.choose(action.index)
			case "Rollback":
				return yield* game.rollback.pipe(
					Effect.catchIf(atEdge, () => Effect.void),
				)
			case "Rollforward":
				return yield* game.rollforward.pipe(
					Effect.catchIf(atEdge, () => Effect.void),
				)
			case "Save":
				yield* game.save(Repository.refs.quick)
				return yield* notice(labels.saved)
			case "Load":
				return yield* game.load(Repository.refs.quick).pipe(
					Effect.catchIf(
						(error) =>
							error._tag === "GameError" && error.reason === "slot-missing",
						() => notice(labels.noSave),
					),
				)
			case "History":
				return yield* historyPanel
			case "Restart":
				return yield* game.restart
			case "ToggleInterface":
				return yield* Effect.sync(() => {
					container.toggleAttribute("data-hide-ui")
				})
			case "Close":
				yield* closePanel
				return yield* Effect.sync(() =>
					container.removeAttribute("data-hide-ui"),
				)
		}
	})

	// One fiber shows each view and runs each action, in the order they come.
	// It runs in the mount fiber, so a defect here reaches the caller of mount.
	return yield* Stream.merge(
		game.changes.pipe(Stream.map((view) => Event.Show({ view }))),
		Stream.fromQueue(actions).pipe(
			Stream.map((action) => Event.Act({ action })),
		),
	).pipe(
		Stream.runForEach(
			Event.$match({
				Show: ({ view }) => render(view),
				Act: ({ action }) => handle(action).pipe(Effect.catchCause(showError)),
			}),
		),
		Effect.andThen(Effect.never),
	)
})
