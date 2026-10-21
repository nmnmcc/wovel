import type { Story, Text } from "@wovel/core"
import { Option } from "effect"
import { dual } from "effect/Function"

const element = <K extends keyof HTMLElementTagNameMap>(
	document: Document,
	tag: K,
	attributes: Readonly<Record<string, string>> = {},
	children: ReadonlyArray<Node | string> = [],
): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag)
	for (const [key, value] of Object.entries(attributes))
		node.setAttribute(key, value)
	node.append(...children)
	return node
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * Split text into graphemes, each in its own span, so the typewriter can show
 * them one by one. Emoji and combined characters stay whole.
 */
const graphemes = (
	document: Document,
	value: string,
): ReadonlyArray<HTMLElement> =>
	Array.from(segmenter.segment(value), ({ segment }) =>
		element(document, "span", { class: "wovel-g" }, [segment]),
	)

const styled = (
	document: Document,
	style: Text.Style,
	inner: ReadonlyArray<Node>,
): Node => {
	let node: ReadonlyArray<Node> = inner
	const wrap = (
		tag: keyof HTMLElementTagNameMap,
		attributes: Record<string, string> = {},
	) => {
		node = [element(document, tag, attributes, node)]
	}
	if (style.code === true) wrap("code")
	if (style.strike === true) wrap("s")
	if (style.emphasis === true) wrap("em")
	if (style.strong === true) wrap("strong")
	if (style.attributes !== undefined) {
		const { color, size, font, ...rest } = style.attributes
		const css = [
			color === undefined ? "" : `color:${color};`,
			size === undefined ? "" : `font-size:${size};`,
			font === undefined ? "" : `font-family:${font};`,
		].join("")
		wrap("span", { ...rest, ...(css === "" ? {} : { style: css }) })
	}
	if (style.link !== undefined)
		wrap("a", { href: style.link, target: "_blank", rel: "noopener" })
	return node.length === 1 && node[0] !== undefined
		? node[0]
		: element(document, "span", {}, node)
}

const text = (
	document: Document,
	spans: Text.RenderedText,
): {
	readonly nodes: ReadonlyArray<Node>
	readonly graphemes: ReadonlyArray<HTMLElement>
} => {
	const all: Array<HTMLElement> = []
	const nodes = spans.map((span): Node => {
		switch (span._tag) {
			case "Break":
				return element(document, "br")
			case "Text": {
				const parts = graphemes(document, span.value)
				all.push(...parts)
				return styled(document, span.style, parts)
			}
			case "Ruby": {
				// A ruby shows as one unit, so it appears at once with its reading.
				const ruby = element(document, "ruby", { class: "wovel-g" }, [
					span.base,
					element(document, "rt", {}, [span.annotation]),
				])
				all.push(ruby)
				return styled(document, span.style, [ruby])
			}
		}
	})
	return { nodes, graphemes: all }
}

export interface Builder {
	readonly element: <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		attributes?: Readonly<Record<string, string>>,
		children?: ReadonlyArray<Node | string>,
	) => HTMLElementTagNameMap[K]
	/** Render a line. It returns the nodes and the grapheme spans in reading order. */
	readonly text: (spans: Text.RenderedText) => {
		readonly nodes: ReadonlyArray<Node>
		readonly graphemes: ReadonlyArray<HTMLElement>
	}
}

/** Helpers that make nodes in one document. */
export const make = (document: Document): Builder => ({
	element: (tag, attributes, children) =>
		element(document, tag, attributes, children),
	text: (spans) => text(document, spans),
})

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
	(name: string): (story: Story.Story) => Option.Option<string>
	(story: Story.Story, name: string): Option.Option<string>
} = dual(2, (story: Story.Story, name: string): Option.Option<string> => {
	const words = name.split(" ")
	for (let length = words.length; length > 0; length--) {
		const key = words.slice(0, length).join(" ")
		const url = story.images[key]
		if (url !== undefined) return Option.some(url)
	}
	return Option.none()
})

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
