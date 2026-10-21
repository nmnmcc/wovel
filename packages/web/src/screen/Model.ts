import { State } from "@wovel/core"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

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

/** What the player asks for, after keys, clicks, and the wheel are read. */
export const Action = Schema.TaggedUnion({
	Advance: {},
	Choose: { index: Schema.Int },
	Rollback: {},
	Rollforward: {},
	Save: {},
	Load: {},
	History: {},
	Restart: {},
	ToggleInterface: {},
	Close: {},
})
export type Action = typeof Action.Type

/** A sprite that left the stage and still fades out. */
export const Leaving = Schema.Struct({
	key: Schema.String,
	sprite: State.Sprite,
})
export type Leaving = typeof Leaving.Type

/**
 * A `fade` transition. The overlay goes dark, the stage changes to `next`, and
 * the overlay clears again. Each half takes `duration` milliseconds.
 */
export const Fade = Schema.Struct({
	phase: Schema.Literals(["Out", "In"]),
	duration: Schema.Finite,
	next: State.Stage,
})
export type Fade = typeof Fade.Type

export const Notice = Schema.Struct({ id: Schema.Int, text: Schema.String })
export type Notice = typeof Notice.Type

/**
 * Everything the screen shows. The game state stays in `Game`: this is only
 * the last view of it and the state of the interface around it.
 */
export const Model = Schema.Struct({
	/** The id of the root element. Selectors use it to find this game's nodes. */
	id: Schema.String,
	labels: Labels,
	/** 0 shows each line at once. */
	charactersPerSecond: Schema.Finite,
	reducedMotion: Schema.Boolean,
	/** The image names of the story and their URLs. */
	images: Schema.Record(Schema.String, Schema.String),
	waiting: State.Waiting,
	/** The stage on the screen. During a fade it is still the old one. */
	stage: State.Stage,
	canRollback: Schema.Boolean,
	/** How many graphemes of the line show. None when the whole line shows. */
	typing: Schema.OptionFromNullOr(Schema.Int),
	/** How long new pictures take to appear, in milliseconds. */
	dissolve: Schema.Finite,
	/** The background that the new one fades in over. */
	previousBackground: Schema.OptionFromNullOr(Schema.String),
	leaving: Schema.Array(Leaving),
	fade: Schema.OptionFromNullOr(Fade),
	/** The history panel, with the lines in reading order. */
	history: Schema.OptionFromNullOr(Schema.Array(State.Line)),
	hideInterface: Schema.Boolean,
	notices: Schema.Array(Notice),
	/** A counter for the keys of notices and leaving sprites. */
	nextKey: Schema.Int,
	error: Schema.OptionFromNullOr(Schema.String),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	/** The game shows a new view. `plays` is true when the screen should play it as new. */
	ChangedView: {
		waiting: State.Waiting,
		stage: State.Stage,
		canRollback: Schema.Boolean,
		plays: Schema.Boolean,
		images: Schema.Record(Schema.String, Schema.String),
		audio: Schema.Record(Schema.String, Schema.String),
	},
	Asked: { action: Action },
	ClickedLink: {},
	ClickedPanel: {},
	TickedTypewriter: {},
	CompletedGameAction: {},
	FailedGameAction: { text: Schema.String },
	SavedGame: {},
	FoundNoSave: {},
	GotHistory: { lines: Schema.Array(State.Line) },
	ExpiredNotice: { id: Schema.Int },
	ShowedBackground: { name: Schema.String },
	ShowedSprite: {},
	FadedOutSprite: { key: Schema.String },
	FadedOverlay: { phase: Schema.Literals(["Out", "In"]) },
	CompletedApplyAudio: {},
	CompletedFocusChoice: {},
})
export type Message = typeof Message.Type
