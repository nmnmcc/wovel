import { Game, Repository, State } from "@wovel/core"
import { Array, Effect, Equal, Option, Record, Schema } from "effect"
import { Command, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { modifyFields } from "foldkit/struct"
import * as Audio from "../Audio.ts"
import { graphemeCount } from "./Text.ts"
import { type Action, Message, type Model } from "./Model.ts"

type Return = Update.Return<Model, Message, Game.Game | Audio.Player>

/** The text that the error box shows for a failure. */
const describe = (error: Game.Failure): string =>
	error._tag === "ScriptError" && error.source !== undefined
		? `${error.source.file}:${error.source.line}\n${error.message}`
		: error.message

/** Turn a failure of the game into a Message, so the screen can show it. */
const report = <A>(
	effect: Effect.Effect<A, Game.Failure, Game.Game>,
): Effect.Effect<A | typeof Message.FailedGameAction.Type, never, Game.Game> =>
	effect.pipe(
		Effect.catch((error) =>
			Effect.logError("The game failed", error).pipe(
				Effect.as(Message.FailedGameAction({ text: describe(error) })),
			),
		),
	)

/** Rollback at the first step and rollforward at the last do nothing. */
const atEdge = (error: Game.Failure) =>
	error._tag === "GameError" &&
	(error.reason === "no-parent" || error.reason === "no-forward")

const step = (
	name: string,
	use: (game: typeof Game.Game.Service) => Effect.Effect<void, Game.Failure>,
) =>
	Command.define(name, {
		messages: [Message.CompletedGameAction, Message.FailedGameAction],
		execute: report(
			Effect.flatMap(Game.Game, use).pipe(
				Effect.as(Message.CompletedGameAction()),
			),
		),
	})

const Advance = step("Advance", (game) => game.advance)
const Rollback = step("Rollback", (game) =>
	game.rollback.pipe(Effect.catchIf(atEdge, () => Effect.void)),
)
const Rollforward = step("Rollforward", (game) =>
	game.rollforward.pipe(Effect.catchIf(atEdge, () => Effect.void)),
)
const Restart = step("Restart", (game) => game.restart)

const Choose = Command.define("Choose", {
	args: { index: Schema.Int },
	messages: [Message.CompletedGameAction, Message.FailedGameAction],
	execute: ({ index }) =>
		report(
			Effect.flatMap(Game.Game, (game) => game.choose(index)).pipe(
				Effect.as(Message.CompletedGameAction()),
			),
		),
})

const Save = Command.define("Save", {
	messages: [Message.SavedGame, Message.FailedGameAction],
	execute: report(
		Effect.flatMap(Game.Game, (game) => game.save(Repository.refs.quick)).pipe(
			Effect.as(Message.SavedGame()),
		),
	),
})

const Load = Command.define("Load", {
	messages: [
		Message.CompletedGameAction,
		Message.FoundNoSave,
		Message.FailedGameAction,
	],
	execute: report(
		Effect.flatMap(Game.Game, (game) => game.load(Repository.refs.quick)).pipe(
			Effect.as(Message.CompletedGameAction()),
			Effect.catchIf(
				(error) =>
					error._tag === "GameError" && error.reason === "slot-missing",
				() => Effect.succeed(Message.FoundNoSave()),
			),
		),
	),
})

const LoadHistory = Command.define("LoadHistory", {
	messages: [Message.GotHistory, Message.FailedGameAction],
	execute: report(
		Effect.flatMap(Game.Game, (game) => game.history).pipe(
			Effect.map((entries) =>
				Message.GotHistory({ lines: entries.map((entry) => entry.line) }),
			),
		),
	),
})

const ExpireNotice = Command.define("ExpireNotice", {
	args: { id: Schema.Int },
	messages: [Message.ExpiredNotice],
	execute: ({ id }) =>
		Effect.sleep("1500 millis").pipe(Effect.as(Message.ExpiredNotice({ id }))),
})

const ApplyAudio = Command.define("ApplyAudio", {
	args: {
		files: Schema.Record(Schema.String, Schema.String),
		stage: State.Stage,
		cues: Schema.Boolean,
	},
	messages: [Message.CompletedApplyAudio],
	execute: ({ files, stage, cues }) =>
		Effect.flatMap(Audio.Player, (player) =>
			player.apply(files, stage, cues),
		).pipe(Effect.as(Message.CompletedApplyAudio())),
})

const FocusChoice = Command.define("FocusChoice", {
	args: { id: Schema.String },
	messages: [Message.CompletedFocusChoice],
	execute: ({ id }) =>
		Dom.focus(`#${CSS.escape(id)} .wovel-menu button`).pipe(
			// The menu can be gone before the focus runs, for example after a
			// fast rollback. Then there is nothing to focus.
			Effect.catchTag("ElementNotFound", () => Effect.void),
			Effect.as(Message.CompletedFocusChoice()),
		),
})

const durations: Readonly<Record<string, number>> = {
	dissolve: 500,
	fade: 1000,
}

/**
 * Put a stage on the screen. Pictures that are new fade in for `dissolve`
 * milliseconds, and sprites that leave fade out. With 0 they change at once.
 */
const showStage = (
	model: Model,
	next: State.Stage,
	dissolve: number,
): Model => {
	const tags = new Set(next.sprites.map((sprite) => sprite.tag))
	const left =
		dissolve > 0
			? model.stage.sprites.filter((sprite) => !tags.has(sprite.tag))
			: []
	const keep = model.leaving.filter((leaving) => !tags.has(leaving.sprite.tag))
	const changed = !Equal.equals(model.stage.background, next.background)
	return modifyFields(model, {
		stage: () => next,
		dissolve: () => dissolve,
		previousBackground: (previous) =>
			dissolve > 0 && changed && Option.isSome(next.background)
				? model.stage.background
				: changed
					? Option.none()
					: previous,
		leaving: () =>
			dissolve > 0
				? [
						...keep,
						...left.map((sprite, index) => ({
							key: `${sprite.tag}#${model.nextKey + index}`,
							sprite,
						})),
					]
				: [],
		nextKey: (key) => key + left.length,
	})
}

const changeView = (
	model: Model,
	view: typeof Message.ChangedView.Type,
): Return => {
	// A new game and a step forward type the line and play transitions and
	// sounds. A rollback or a load jumps there.
	const transition = view.plays ? view.stage.transition : Option.none()
	const duration = model.reducedMotion
		? 0
		: Option.match(transition, {
				onNone: () => 0,
				onSome: (name) =>
					Option.getOrElse(Record.get(durations, name), () => 500),
			})
	const fade = duration > 0 && Option.contains(transition, "fade")
	const typing =
		view.plays &&
		view.waiting._tag === "Say" &&
		model.charactersPerSecond > 0 &&
		!model.reducedMotion
	const shown = modifyFields(model, {
		waiting: () => view.waiting,
		canRollback: () => view.canRollback,
		images: () => view.images,
		typing: () => (typing ? Option.some(0) : Option.none()),
		fade: () =>
			fade
				? Option.some({
						phase: "Out" as const,
						duration: duration / 2,
						next: view.stage,
					})
				: Option.none(),
	})
	return {
		model: fade
			? showStage(shown, shown.stage, 0)
			: showStage(shown, view.stage, duration),
		commands: [
			ApplyAudio({ files: view.audio, stage: view.stage, cues: view.plays }),
			...(view.waiting._tag === "Menu" ? [FocusChoice({ id: model.id })] : []),
		],
	}
}

const notice = (model: Model, text: string): Return => ({
	model: modifyFields(model, {
		notices: (notices) => [...notices, { id: model.nextKey, text }],
		nextKey: (key) => key + 1,
	}),
	commands: [ExpireNotice({ id: model.nextKey })],
})

/** A click, Space, or Enter. */
const advance = (model: Model): Return => {
	if (Option.isSome(model.history))
		return { model: modifyFields(model, { history: () => Option.none() }) }
	if (model.hideInterface)
		return { model: modifyFields(model, { hideInterface: () => false }) }
	if (Option.isSome(model.typing))
		return { model: modifyFields(model, { typing: () => Option.none() }) }
	const waiting = model.waiting._tag
	return {
		model,
		commands: waiting === "Say" || waiting === "Pause" ? [Advance()] : [],
	}
}

const act = (model: Model, action: Action): Return => {
	switch (action._tag) {
		case "Advance":
			return advance(model)
		case "Choose":
			return { model, commands: [Choose({ index: action.index })] }
		case "Rollback":
			return { model, commands: [Rollback()] }
		case "Rollforward":
			return { model, commands: [Rollforward()] }
		case "Save":
			return { model, commands: [Save()] }
		case "Load":
			return { model, commands: [Load()] }
		case "History":
			return { model, commands: [LoadHistory()] }
		case "Restart":
			return { model, commands: [Restart()] }
		case "ToggleInterface":
			return {
				model: modifyFields(model, { hideInterface: (hidden) => !hidden }),
			}
		case "Close":
			return {
				model: modifyFields(model, {
					history: () => Option.none(),
					hideInterface: () => false,
				}),
			}
	}
}

// Foldkit calls update with the Model and the Message. It has no pipeable form.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ChangedView: (view) => changeView(model, view),
		// Each new action clears the error of the last one.
		Asked: ({ action }) =>
			act(modifyFields(model, { error: () => Option.none() }), action),
		ClickedLink: () => ({ model }),
		ClickedPanel: () => ({ model }),
		TickedTypewriter: () => {
			const { typing, waiting } = model
			if (Option.isNone(typing) || waiting._tag !== "Say") return { model }
			const next = typing.value + 1
			return {
				model: modifyFields(model, {
					typing: () =>
						next >= graphemeCount(waiting.line.text)
							? Option.none()
							: Option.some(next),
				}),
			}
		},
		CompletedGameAction: () => ({ model }),
		FailedGameAction: ({ text }) => ({
			model: modifyFields(model, { error: () => Option.some(text) }),
		}),
		SavedGame: () => notice(model, model.labels.saved),
		FoundNoSave: () => notice(model, model.labels.noSave),
		GotHistory: ({ lines }) => ({
			model: modifyFields(model, { history: () => Option.some(lines) }),
		}),
		ExpiredNotice: ({ id }) => ({
			model: modifyFields(model, {
				notices: Array.filter((notice) => notice.id !== id),
			}),
		}),
		ShowedBackground: ({ name }) => ({
			model: Option.contains(model.stage.background, name)
				? modifyFields(model, { previousBackground: () => Option.none() })
				: model,
		}),
		ShowedSprite: () => ({ model }),
		FadedOutSprite: ({ key }) => ({
			model: modifyFields(model, {
				leaving: Array.filter((leaving) => leaving.key !== key),
			}),
		}),
		FadedOverlay: ({ phase }) =>
			Option.match(
				Option.filter(model.fade, (fade) => fade.phase === phase),
				{
					// An old fade that a newer view replaced.
					onNone: () => ({ model }),
					onSome: (fade) =>
						fade.phase === "Out"
							? {
									model: modifyFields(showStage(model, fade.next, 0), {
										fade: () => Option.some({ ...fade, phase: "In" as const }),
									}),
								}
							: { model: modifyFields(model, { fade: () => Option.none() }) },
				},
			),
		CompletedApplyAudio: () => ({ model }),
		CompletedFocusChoice: () => ({ model }),
	})
