import { Game } from "@wovel/core"
import { Effect, Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { Message, type Model } from "./Model.ts"

/** Every view of the game, from the current one on. */
const views = Stream.unwrap(
	Effect.map(Game.Game, (game) =>
		game.changes.pipe(
			// The story can change with a hot reload, so each view reads it again.
			Stream.mapEffect((view) =>
				Effect.map(game.story, (story) =>
					Message.ChangedView({
						waiting: view.commit.state.waiting,
						stage: view.commit.state.stage,
						canRollback: view.canRollback,
						plays: Game.plays(view.move),
						images: story.images,
						audio: story.audio,
					}),
				),
			),
		),
	),
)

export const subscriptions: Subscription.Subscriptions<
	Model,
	Message,
	Game.Game
> = Subscription.make<Model, Message, Game.Game>()((entry) => ({
	views: Subscription.persistentEntry(views),
	typewriter: entry(
		{ typing: Schema.Boolean, interval: Schema.Finite },
		{
			modelToDependencies: (model) => ({
				typing: Option.isSome(model.typing),
				// The typewriter runs only when the speed is above 0.
				interval:
					model.charactersPerSecond > 0 ? 1000 / model.charactersPerSecond : 0,
			}),
			// The first tick comes at once, so the first grapheme shows with the line.
			dependenciesToStream: ({ typing, interval }) =>
				typing
					? Stream.tick(`${interval} millis`).pipe(
							Stream.map(() => Message.TickedTypewriter()),
						)
					: Stream.empty,
		},
	),
}))
