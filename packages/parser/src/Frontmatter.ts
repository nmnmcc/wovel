import { Story } from "@wovel/core"
import { Result, Schema, SchemaTransformation } from "effect"
import { parse } from "yaml"

/** `characters:` takes a full character, or only a name. Both decode to a character. */
const CharacterEntry = Schema.Union([
	Story.Character,
	Schema.String.pipe(
		Schema.decodeTo(
			Story.Character,
			SchemaTransformation.transform({
				decode: (name: string) => ({ name }),
				encode: (character) => character.name,
			}),
		),
	),
])

export const Frontmatter = Schema.Struct({
	title: Schema.optionalKey(Schema.String),
	start: Schema.optionalKey(Schema.String),
	defaults: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
	characters: Schema.optionalKey(Schema.Record(Schema.String, CharacterEntry)),
	images: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	audio: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
export type Frontmatter = typeof Frontmatter.Type

/** The frontmatter of a script is not valid YAML, or not valid settings. */
export class FrontmatterError extends Schema.TaggedError<FrontmatterError>()(
	"FrontmatterError",
	{ message: Schema.String, cause: Schema.Defect() },
) {}

const decodeFrontmatter = Schema.decodeUnknownResult(Frontmatter)

/** Read the frontmatter of a script. It is pure work, so it gives a Result. */
export const decode = (
	source: string,
): Result.Result<Frontmatter, FrontmatterError> =>
	Result.try({
		try: (): unknown => parse(source) ?? {},
		catch: (cause) =>
			FrontmatterError.make({
				message: `The frontmatter is not valid YAML: ${cause instanceof Error ? cause.message : "unknown error"}`,
				cause,
			}),
	}).pipe(
		Result.flatMap((value) =>
			Result.mapError(decodeFrontmatter(value), (cause) =>
				FrontmatterError.make({
					message: `The frontmatter is not valid: ${cause.message}`,
					cause,
				}),
			),
		),
	)
