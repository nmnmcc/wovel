import { Record, Schema } from "effect"

/** How a piece of text looks. Every mark is optional, so plain text has an empty style. */
export const Style = Schema.Struct({
	strong: Schema.optionalKey(Schema.Boolean),
	emphasis: Schema.optionalKey(Schema.Boolean),
	strike: Schema.optionalKey(Schema.Boolean),
	code: Schema.optionalKey(Schema.Boolean),
	link: Schema.optionalKey(Schema.String),
	/** Attributes from an inline `:span[text]{color=red}` directive. */
	attributes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
export type Style = typeof Style.Type

/**
 * One piece of script text. A line of dialogue is a flat list of spans, so the
 * typewriter can reveal it in order without walking a tree.
 */
export const Span = Schema.TaggedUnion({
	Text: { value: Schema.String, style: Style },
	/** `{name}` or `{name|upper}`. The value comes from the store when the line shows. */
	Interpolation: {
		expression: Schema.String,
		filters: Schema.Array(Schema.String),
		style: Style,
	},
	/** `{漢字|かんじ}`. It becomes a `<ruby>` element. */
	Ruby: { base: Schema.String, annotation: Schema.String, style: Style },
	Break: {},
})
export type Span = typeof Span.Type

export const Text = Schema.Array(Span)
export type Text = typeof Text.Type

/** A span after interpolation. Only these spans reach the screen and the commits. */
export const Rendered = Schema.TaggedUnion({
	Text: { value: Schema.String, style: Style },
	Ruby: { base: Schema.String, annotation: Schema.String, style: Style },
	Break: {},
})
export type Rendered = typeof Rendered.Type

export const RenderedText = Schema.Array(Rendered)
export type RenderedText = typeof RenderedText.Type

/** The filters that `{value|filter}` can use. */
export const filters: Readonly<Record<string, (value: string) => string>> = {
	upper: (value) => value.toUpperCase(),
	lower: (value) => value.toLowerCase(),
	capitalize: (value) => value.charAt(0).toUpperCase() + value.slice(1),
	trim: (value) => value.trim(),
}

export const isFilter = (name: string): boolean => Record.has(filters, name)

/** The text of the spans with no style, for history, logs, and save names. */
export const plain = (text: RenderedText): string =>
	text
		.map(
			Rendered.match({
				Text: (span) => span.value,
				Ruby: (span) => span.base,
				Break: () => "\n",
			}),
		)
		.join("")
