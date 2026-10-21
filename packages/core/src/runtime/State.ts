import { Option, Schema } from "effect"
import * as Story from "../story/Story.ts"
import * as Text from "../story/Text.ts"

/** The variables of the game. They are JSON, so a commit can hold them. */
export const Store = Schema.Record(Schema.String, Schema.Json)
export type Store = typeof Store.Type

/** The state of the xoshiro128** random generator. */
export const Seed = Schema.Tuple([
	Schema.Int,
	Schema.Int,
	Schema.Int,
	Schema.Int,
])
export type Seed = typeof Seed.Type

export const Sprite = Schema.Struct({
	tag: Schema.String,
	attributes: Schema.Array(Schema.String),
	position: Schema.String,
	layer: Schema.String,
})
export type Sprite = typeof Sprite.Type

export const Track = Schema.Struct({
	file: Schema.String,
	loop: Schema.Boolean,
})
export type Track = typeof Track.Type

/**
 * What is on the screen, as data. The renderer compares two stages and changes
 * only the DOM nodes that differ. Animation frames never go in here.
 * Optional fields are an `Option` in memory and `null` in the encoded JSON.
 */
export class Stage extends Schema.Opaque<Stage>()(
	Schema.Struct({
		background: Schema.OptionFromNullOr(Schema.String),
		/** In draw order: later sprites are on top. */
		sprites: Schema.Array(Sprite),
		/** The track that plays on each audio channel. */
		audio: Schema.Record(Schema.String, Track),
		/** The transition to play when the screen changes to this stage. */
		transition: Schema.OptionFromNullOr(Schema.String),
		/** Sounds that play once, when the screen changes to this stage. */
		cues: Schema.Array(
			Schema.Struct({ channel: Schema.String, file: Schema.String }),
		),
	}),
) {
	/** The screen before the story shows anything. */
	static readonly empty: Stage = {
		background: Option.none(),
		sprites: [],
		audio: {},
		transition: Option.none(),
		cues: [],
	}
}

export const Line = Schema.Struct({
	/** The character id, or the hand-written name. None for narration. */
	who: Schema.OptionFromNullOr(Schema.String),
	name: Schema.OptionFromNullOr(Schema.String),
	color: Schema.OptionFromNullOr(Schema.String),
	text: Text.RenderedText,
})
export type Line = typeof Line.Type

export const Choice = Schema.Struct({
	/** The index of the option in the Menu instruction. */
	index: Schema.Int,
	text: Text.RenderedText,
})
export type Choice = typeof Choice.Type

/** Why the interpreter stopped. */
export const Waiting = Schema.TaggedUnion({
	Say: { line: Line },
	Menu: {
		prompt: Schema.OptionFromNullOr(Line),
		choices: Schema.Array(Choice),
	},
	Pause: {},
	End: {},
})
export type Waiting = typeof Waiting.Type

/**
 * Everything the interpreter needs to go on. It is pure data, so it can be
 * hashed, saved, and restored.
 */
export const State = Schema.Struct({
	/** The statement where the interpreter waits. */
	at: Story.Pointer,
	/** Return points of `::call`. Each one points at the Call statement. */
	stack: Schema.Array(Story.Pointer),
	store: Store,
	seed: Seed,
	stage: Stage,
	waiting: Waiting,
	/** The scene of the statement at `at`. Save screens show it. */
	scene: Schema.String,
})
export type State = typeof State.Type
