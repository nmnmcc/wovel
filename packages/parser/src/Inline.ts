import { Text } from "@wovel/core"
import { Equal, Option, Record as EffectRecord } from "effect"
import type { PhrasingContent } from "mdast"
import type { TextDirective } from "mdast-util-directive"
import { toString } from "mdast-util-to-string"

const cjk = /[　-ヿ㐀-鿿豈-﫿＀-￯]/u

/**
 * A soft line break inside a paragraph. Between two CJK characters it is
 * nothing, as a writer expects. Elsewhere it is a space.
 */
const softBreaks = (value: string) =>
	value.replace(/\n/g, (_match, offset: number) =>
		cjk.test(value.charAt(offset - 1)) && cjk.test(value.charAt(offset + 1))
			? ""
			: " ",
	)

/**
 * `{name}` and `{name|upper}` are interpolations. `{漢字|かんじ}` is ruby: a
 * pipe that is not followed by known filters starts a reading.
 */
const braces = (value: string, style: Text.Style): ReadonlyArray<Text.Span> => {
	const spans: Array<Text.Span> = []
	let last = 0
	for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
		if (match.index > last)
			spans.push({ _tag: "Text", value: value.slice(last, match.index), style })
		const [first = "", ...rest] = (match[1] ?? "").split("|")
		if (rest.length > 0 && !rest.every((name) => Text.isFilter(name.trim())))
			spans.push({
				_tag: "Ruby",
				base: first,
				annotation: rest.join("|"),
				style,
			})
		else
			spans.push({
				_tag: "Interpolation",
				expression: first.trim(),
				filters: rest.map((name) => name.trim()),
				style,
			})
		last = match.index + match[0].length
	}
	if (last < value.length)
		spans.push({ _tag: "Text", value: value.slice(last), style })
	return spans
}

/** The attributes that have a value. mdast uses null for one with no value. */
const attributes = (input: TextDirective["attributes"]) =>
	EffectRecord.getSomes(
		EffectRecord.map(input ?? {}, (value) => Option.fromNullishOr(value)),
	)

const convert = (
	nodes: ReadonlyArray<PhrasingContent>,
	style: Text.Style,
): ReadonlyArray<Text.Span> =>
	nodes.flatMap((node): ReadonlyArray<Text.Span> => {
		switch (node.type) {
			case "text":
				return braces(softBreaks(node.value), style)
			case "strong":
				return convert(node.children, { ...style, strong: true })
			case "emphasis":
				return convert(node.children, { ...style, emphasis: true })
			case "delete":
				return convert(node.children, { ...style, strike: true })
			case "inlineCode":
				return [
					{ _tag: "Text", value: node.value, style: { ...style, code: true } },
				]
			case "link":
				return convert(node.children, { ...style, link: node.url })
			case "break":
				return [{ _tag: "Break" }]
			case "image":
				return Option.match(
					Option.filter(Option.fromNullishOr(node.alt), (alt) => alt !== ""),
					{
						onNone: () => [],
						onSome: (alt) => [{ _tag: "Text", value: alt, style }],
					},
				)
			case "textDirective":
				if (node.name === "span")
					return convert(node.children, {
						...style,
						attributes: { ...style.attributes, ...attributes(node.attributes) },
					})
				// `a:b` in plain text parses as a directive. Give the text back.
				return [
					{ _tag: "Text", value: `:${node.name}`, style },
					...(node.children.length > 0
						? [
								{ _tag: "Text" as const, value: "[", style },
								...convert(node.children, style),
								{ _tag: "Text" as const, value: "]", style },
							]
						: []),
				]
			default:
				return []
		}
	})

/** Styles built in a different key order are still the same. */
const sameStyle = (a: Text.Style, b: Text.Style) => Equal.equals(a, b)

/** Join neighbor text spans that look the same. */
const merge = (spans: ReadonlyArray<Text.Span>): ReadonlyArray<Text.Span> =>
	spans.reduce<Array<Text.Span>>((all, span) => {
		const previous = all.at(-1)
		if (
			previous?._tag === "Text" &&
			span._tag === "Text" &&
			sameStyle(previous.style, span.style)
		)
			all[all.length - 1] = { ...previous, value: previous.value + span.value }
		else all.push(span)
		return all
	}, [])

/** Trim the space at the two ends of the line. */
const trim = (spans: ReadonlyArray<Text.Span>): ReadonlyArray<Text.Span> =>
	spans
		.map((span, index) =>
			span._tag !== "Text"
				? span
				: {
						...span,
						value:
							index === 0
								? index === spans.length - 1
									? span.value.trim()
									: span.value.trimStart()
								: index === spans.length - 1
									? span.value.trimEnd()
									: span.value,
					},
		)
		.filter((span) => span._tag !== "Text" || span.value !== "")

export const text = (nodes: ReadonlyArray<PhrasingContent>): Text.Text =>
	trim(merge(convert(nodes, {})))

export const plain = (nodes: ReadonlyArray<PhrasingContent>): string =>
	nodes
		.map((node) => toString(node))
		.join("")
		.trim()

/**
 * Read `{key=value key="a b" flag}` from the start of a string. It returns the
 * attributes and the rest of the string, or None when there is no such block.
 */
export const braceAttributes = (
	value: string,
): Option.Option<{
	readonly attributes: Record<string, string>
	readonly rest: string
}> =>
	Option.map(Option.fromNullishOr(/^\s*\{([^{}]*)\}/.exec(value)), (match) => {
		const found: Record<string, string> = {}
		for (const part of (match[1] ?? "").matchAll(
			/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g,
		)) {
			const key = part[1]
			if (key !== undefined) found[key] = part[2] ?? part[3] ?? part[4] ?? ""
		}
		return { attributes: found, rest: value.slice(match[0].length) }
	})
