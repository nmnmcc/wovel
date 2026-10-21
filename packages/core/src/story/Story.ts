import { Array as EffectArray, Effect, Option, Record, Schema } from "effect"
import { dual } from "effect/Function"
import * as ContentHash from "./ContentHash.ts"
import * as Instruction from "./Instruction.ts"

export const Character = Schema.Struct({
	name: Schema.String,
	/** The color of the name in the dialogue box. Any CSS color. */
	color: Schema.optionalKey(Schema.String),
	/** The image tag that `**name**{expr=happy}：` shows. The default is the character id. */
	image: Schema.optionalKey(Schema.String),
	/** Text before and after each line, for example `（` and `）` for inner thoughts. */
	prefix: Schema.optionalKey(Schema.String),
	suffix: Schema.optionalKey(Schema.String),
})
export type Character = typeof Character.Type

export const Scene = Schema.Struct({
	/** The heading text, as the writer wrote it. */
	title: Schema.String,
	/** The index of the first instruction of the scene. */
	index: Schema.Int,
	file: Schema.String,
})
export type Scene = typeof Scene.Type

/**
 * A compiled story. It is plain JSON, so a build tool can write it to a file and
 * the game can read it back with {@link decode}.
 */
export const Story = Schema.Struct({
	title: Schema.String,
	/** The scene where a new game starts. */
	start: Schema.String,
	/** Store variables and their first values. Old saves get missing ones on load. */
	defaults: Schema.Record(Schema.String, Schema.Json),
	characters: Schema.Record(Schema.String, Character),
	/** Image names such as `eileen happy` or `bg room`, and their URLs. */
	images: Schema.Record(Schema.String, Schema.String),
	/** Audio names such as `theme`, and their URLs. */
	audio: Schema.Record(Schema.String, Schema.String),
	scenes: Schema.Record(Schema.String, Scene),
	instructions: Schema.Array(Instruction.Instruction),
})
export type Story = typeof Story.Type

export class StoryError extends Schema.TaggedError<StoryError>()("StoryError", {
	reason: Schema.Literals(["invalid-story", "unknown-scene"]),
	message: Schema.String,
}) {}

export const decode = (input: unknown): Effect.Effect<Story, StoryError> =>
	Schema.decodeUnknownEffect(Story)(input).pipe(
		Effect.mapError((error) =>
			StoryError.make({
				reason: "invalid-story",
				message: `The story is not valid: ${error.message}`,
			}),
		),
	)

/** The place of a statement. Commits keep pointers, not indexes, so they survive edits. */
export const Pointer = Schema.Struct({
	id: Instruction.StatementId,
	hash: ContentHash.Hash,
})
export type Pointer = typeof Pointer.Type

export const pointer = (instruction: Instruction.Instruction): Pointer => ({
	id: instruction.id,
	hash: instruction.hash,
})

/**
 * Find a statement in the story.
 *
 * 1. The same id with the same content: nothing changed.
 * 2. The only statement with the same content: the statement moved.
 * 3. The same id: the statement changed, but its place is the same.
 */
export const locate: {
	(at: Pointer): (story: Story) => Option.Option<number>
	(story: Story, at: Pointer): Option.Option<number>
} = dual(2, (story: Story, at: Pointer): Option.Option<number> => {
	const byId = EffectArray.findFirstIndex(
		story.instructions,
		(instruction) => instruction.id === at.id,
	)
	const exact = Option.filter(
		byId,
		(index) => story.instructions[index]?.hash === at.hash,
	)
	if (Option.isSome(exact)) return exact
	const sameContent = story.instructions.flatMap((instruction, index) =>
		instruction.hash === at.hash ? [index] : [],
	)
	if (sameContent.length === 1) return EffectArray.head(sameContent)
	return byId
})

export const scene: {
	(name: string): (story: Story) => Effect.Effect<Scene, StoryError>
	(story: Story, name: string): Effect.Effect<Scene, StoryError>
} = dual(2, (story: Story, name: string): Effect.Effect<Scene, StoryError> =>
	Effect.fromOption(Record.get(story.scenes, name), () =>
		StoryError.make({
			reason: "unknown-scene",
			message: `There is no scene named "${name}"`,
		}),
	),
)

export interface Display {
	readonly name: Option.Option<string>
	readonly color: Option.Option<string>
}

/** The display name and color of a speaker. A name with no character is shown as written. */
export const speaker: {
	(speaker: Instruction.Speaker): (story: Story) => Display
	(story: Story, speaker: Instruction.Speaker): Display
} = dual(2, (story: Story, { who, name }: Instruction.Speaker): Display => {
	if (who === undefined)
		return { name: Option.fromUndefinedOr(name), color: Option.none() }
	const character = Record.get(story.characters, who)
	return {
		name: Option.some(
			name ??
				Option.match(character, {
					onNone: () => who,
					onSome: (character) => character.name,
				}),
		),
		color: Option.flatMap(character, (c) => Option.fromUndefinedOr(c.color)),
	}
})
