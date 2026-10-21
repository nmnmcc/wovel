import type { Story } from "@wovel/core"
import { Option, Record } from "effect"
import { dual } from "effect/Function"

/** Sprite positions. A game can add its own with CSS on `[data-position]`. */
export const positions: Readonly<Record<string, string>> = {
	farleft: "12%",
	left: "26%",
	center: "50%",
	right: "74%",
	farright: "88%",
}

/**
 * The URL of an image name. `eileen happy` looks for `eileen happy`, then
 * `eileen`, so a sprite with one image does not need attributes.
 */
export const imageUrl: {
	(name: string): (images: Story.Story["images"]) => Option.Option<string>
	(images: Story.Story["images"], name: string): Option.Option<string>
} = dual(
	2,
	(images: Story.Story["images"], name: string): Option.Option<string> => {
		const words = name.split(" ")
		for (let length = words.length; length > 0; length--) {
			const url = Record.get(images, words.slice(0, length).join(" "))
			if (Option.isSome(url)) return url
		}
		return Option.none()
	},
)

/**
 * The target of an event as an element. It checks the node type, not
 * `instanceof Element`, so it also works for a game inside an iframe.
 */
export const asElement = (target: EventTarget | null): Option.Option<Element> =>
	Option.fromNullishOr(target).pipe(
		Option.filter(
			(target): target is Element =>
				"nodeType" in target && target.nodeType === 1,
		),
	)
