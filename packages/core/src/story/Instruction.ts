import { Schema } from "effect"
import { Hash } from "./ContentHash.ts"
import * as Text from "./Text.ts"

/** Where a statement is in the script. Errors and the dev tools use it. */
export const Source = Schema.Struct({
	file: Schema.String,
	line: Schema.Int,
})
export type Source = typeof Source.Type

/** The id of a statement, such as `scene-3`. */
export const StatementId = Schema.String.pipe(
	Schema.brand("@wovel/core/StatementId"),
)
export type StatementId = typeof StatementId.Type

/**
 * The fields that every instruction has.
 *
 * `id` is stable while the scene keeps its name and order: `scene-3` is the
 * fourth statement of `# scene`. `hash` comes from the content of the
 * statement. A save keeps both, so it can find its place again after the
 * script changes.
 */
const head = {
	id: StatementId,
	hash: Hash,
	source: Source,
}

/** A jump goes to a scene by name, or to an index that the compiler made. */
export const Target = Schema.TaggedUnion({
	Scene: { scene: Schema.String },
	/** A JavaScript expression that gives a scene name. */
	Expression: { expression: Schema.String },
	Index: { index: Schema.Int },
})
export type Target = typeof Target.Type

export const Speaker = Schema.Struct({
	/** A character id, or a name that the script wrote by hand, such as `???`. */
	who: Schema.optionalKey(Schema.String),
	/** A display name that replaces the character name for this line. */
	name: Schema.optionalKey(Schema.String),
})
export type Speaker = typeof Speaker.Type

export const Option = Schema.Struct({
	text: Text.Text,
	target: Target,
	condition: Schema.optionalKey(Schema.String),
})
export type Option = typeof Option.Type

export const Assignment = Schema.Struct({
	name: Schema.String,
	operator: Schema.Literals(["=", "+=", "-="]),
	expression: Schema.String,
})
export type Assignment = typeof Assignment.Type

export const Instruction = Schema.TaggedUnion({
	/** A line of dialogue or narration. The player clicks to go on. */
	Say: {
		...head,
		...Speaker.fields,
		text: Text.Text,
		/** `+ text` adds to the line before it instead of starting a new one. */
		extend: Schema.Boolean,
	},
	/** A list of links. The player picks one. */
	Menu: {
		...head,
		prompt: Schema.optionalKey(
			Schema.Struct({ ...Speaker.fields, text: Text.Text }),
		),
		/** The store variable that remembers picked options. Picked options hide. */
		set: Schema.optionalKey(Schema.String),
		options: Schema.Array(Option),
	},
	/** Wait for a click without a new line. */
	Pause: { ...head },
	Jump: { ...head, target: Target },
	Call: { ...head, target: Target },
	Return: { ...head },
	/** Go on when the condition is true. Otherwise go to `otherwise`. */
	Branch: { ...head, condition: Schema.String, otherwise: Schema.Int },
	Set: { ...head, assignments: Schema.Array(Assignment) },
	Code: { ...head, code: Schema.String },
	Show: {
		...head,
		tag: Schema.String,
		attributes: Schema.Array(Schema.String),
		position: Schema.optionalKey(Schema.String),
		layer: Schema.optionalKey(Schema.String),
		transition: Schema.optionalKey(Schema.String),
	},
	Hide: {
		...head,
		tag: Schema.String,
		transition: Schema.optionalKey(Schema.String),
	},
	/** `::bg[room]` sets the background and clears the sprites. */
	Background: {
		...head,
		image: Schema.String,
		transition: Schema.optionalKey(Schema.String),
	},
	Play: {
		...head,
		channel: Schema.String,
		file: Schema.String,
		loop: Schema.Boolean,
		fade: Schema.optionalKey(Schema.Finite),
	},
	Stop: {
		...head,
		channel: Schema.String,
		fade: Schema.optionalKey(Schema.Finite),
	},
	End: { ...head },
})
export type Instruction = typeof Instruction.Type

export type Tag = Instruction["_tag"]

/** The instructions that stop and wait for the player. A commit points at one of them. */
export const waits = Instruction.isAnyOf(["Say", "Menu", "Pause", "End"])
