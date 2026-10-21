import { Effect, Option, Record, Schema, Stream } from "effect"
import { Mount } from "foldkit"
import * as FoldkitDom from "foldkit/dom"
import * as Dom from "../Dom.ts"
import { Action, Message } from "./Model.ts"

/** Run an animation to its end. Interrupting it, as an unmount does, ends it at once. */
const animate = (
	element: Element,
	keyframes: ReadonlyArray<Keyframe>,
	duration: number,
): Effect.Effect<void> =>
	duration <= 0
		? Effect.void
		: Effect.callback<void>((resume) => {
				const animation = element.animate([...keyframes], {
					duration,
					easing: "ease",
					fill: "forwards",
				})
				// A cancelled animation is over too. It is not an error.
				animation.onfinish = () => resume(Effect.void)
				animation.oncancel = () => resume(Effect.void)
				return Effect.sync(() => animation.finish())
			})

const fadeIn = [{ opacity: 0 }, { opacity: 1 }]
const fadeOut = [{ opacity: 1 }, { opacity: 0 }]

export const ShowBackground = Mount.define("ShowBackground", {
	args: { name: Schema.String, duration: Schema.Finite },
	messages: [Message.ShowedBackground],
	execute: ({ element, name, duration }) =>
		animate(element, fadeIn, duration).pipe(
			Effect.as(Message.ShowedBackground({ name })),
		),
})

export const ShowSprite = Mount.define("ShowSprite", {
	args: { duration: Schema.Finite },
	messages: [Message.ShowedSprite],
	execute: ({ element, duration }) =>
		animate(element, fadeIn, duration).pipe(Effect.as(Message.ShowedSprite())),
})

export const FadeOutSprite = Mount.define("FadeOutSprite", {
	args: { key: Schema.String, duration: Schema.Finite },
	messages: [Message.FadedOutSprite],
	execute: ({ element, key, duration }) =>
		animate(element, fadeOut, duration).pipe(
			Effect.as(Message.FadedOutSprite({ key })),
		),
})

export const FadeOverlay = Mount.define("FadeOverlay", {
	args: { phase: Schema.Literals(["Out", "In"]), duration: Schema.Finite },
	messages: [Message.FadedOverlay],
	execute: ({ element, phase, duration }) =>
		animate(element, phase === "Out" ? fadeIn : fadeOut, duration).pipe(
			Effect.as(Message.FadedOverlay({ phase })),
		),
})

const keys: Readonly<Record<string, Action>> = {
	" ": Action.cases.Advance.make({}),
	Enter: Action.cases.Advance.make({}),
	PageUp: Action.cases.Rollback.make({}),
	PageDown: Action.cases.Rollforward.make({}),
	h: Action.cases.ToggleInterface.make({}),
	H: Action.cases.ToggleInterface.make({}),
	Escape: Action.cases.Close.make({}),
}

/**
 * Read keys and the wheel on the game element, and focus it. Keys need the
 * event target, and the wheel needs its direction, so they cannot be plain
 * view attributes.
 */
export const ReadInput = Mount.defineStream("ReadInput", {
	messages: [Message.Asked],
	execute: ({ element }) =>
		Stream.unwrap(
			Effect.sync(() => {
				if ("focus" in element && typeof element.focus === "function")
					element.focus()
				const keyboard = FoldkitDom.streamFromEventFilterMapPreventDefault({
					target: element,
					type: "keydown",
					filterMapEvent: (event: KeyboardEvent) =>
						Record.get(keys, event.key).pipe(
							// Enter on a focused button clicks it. Do not also advance.
							Option.filter(
								(action) =>
									action._tag !== "Advance" ||
									!Option.exists(
										Dom.asElement(event.target),
										(target) => target.tagName === "BUTTON",
									),
							),
							Option.map((action) => Message.Asked({ action })),
						),
				})
				const wheel = FoldkitDom.streamFromEvent({
					target: element,
					type: "wheel",
					mapEvent: (event: WheelEvent) =>
						Message.Asked({
							action:
								event.deltaY < 0
									? Action.cases.Rollback.make({})
									: Action.cases.Rollforward.make({}),
						}),
				}).pipe(
					// One wheel turn sends many events. Take one step for each turn.
					Stream.throttle({
						cost: (events) => events.length,
						units: 1,
						duration: "200 millis",
						strategy: "enforce",
					}),
				)
				return Stream.merge(keyboard, wheel)
			}),
		),
})
