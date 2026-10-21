import type { Text } from "@wovel/core"
import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Message } from "./Model.ts"

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * Split text into graphemes, so the typewriter can show them one by one.
 * Emoji and combined characters stay whole.
 */
const graphemes = (value: string): ReadonlyArray<string> =>
	Array.from(segmenter.segment(value), ({ segment }) => segment)

/** How many steps the typewriter takes for a line. A ruby is one step. */
export const graphemeCount = (spans: Text.RenderedText): number =>
	spans.reduce(
		(count, span) =>
			count +
			(span._tag === "Text"
				? graphemes(span.value).length
				: span._tag === "Ruby"
					? 1
					: 0),
		0,
	)

const styled = (
	style: Text.Style,
	inner: ReadonlyArray<Html>,
	h: HtmlBuilder<Message>,
): Html => {
	let node: ReadonlyArray<Html> = inner
	if (style.code === true) node = [h.code([], node)]
	if (style.strike === true) node = [h.s([], node)]
	if (style.emphasis === true) node = [h.em([], node)]
	if (style.strong === true) node = [h.strong([], node)]
	if (style.attributes !== undefined) {
		const { color, size, font, ...rest } = style.attributes
		const css: Record<string, string> = {
			...(color === undefined ? {} : { color }),
			...(size === undefined ? {} : { "font-size": size }),
			...(font === undefined ? {} : { "font-family": font }),
		}
		node = [
			h.span(
				[
					...Object.entries(rest).map(([key, value]) =>
						h.Attribute(key, value),
					),
					...(Object.keys(css).length === 0 ? [] : [h.Style(css)]),
				],
				node,
			),
		]
	}
	if (style.link !== undefined)
		node = [
			h.a(
				[
					h.Href(style.link),
					h.Target("_blank"),
					h.Rel("noopener"),
					// A click on a link opens it. It does not also advance.
					h.OnClick(Message.ClickedLink(), { propagation: "Stop" }),
				],
				node,
			),
		]
	return node.length === 1 && node[0] !== undefined ? node[0] : h.span([], node)
}

/**
 * Render a line. With `shown`, only the first graphemes show; the others keep
 * their place but are hidden, so the line does not reflow while it types.
 */
// A view helper takes the builder last, as Foldkit views do. It has no pipeable form.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const text = (
	spans: Text.RenderedText,
	shown: Option.Option<number>,
	h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
	let index = 0
	const visibility = () => {
		const hidden = Option.exists(shown, (count) => index >= count)
		index++
		return hidden ? [h.DataAttribute("hidden", "")] : []
	}
	return spans.map((span) => {
		switch (span._tag) {
			case "Break":
				return h.br([])
			case "Text":
				return styled(
					span.style,
					graphemes(span.value).map((segment) =>
						h.span([h.Class("wovel-g"), ...visibility()], [segment]),
					),
					h,
				)
			case "Ruby":
				// A ruby shows as one unit, so it appears at once with its reading.
				return styled(
					span.style,
					[
						h.ruby(
							[h.Class("wovel-g"), ...visibility()],
							[span.base, h.rt([], [span.annotation])],
						),
					],
					h,
				)
		}
	})
}
