import { Crypto, Effect, type Option, Schema } from "effect"
import { Hex } from "effect/encoding"
import { canonical } from "../story/ContentHash.ts"
import * as State from "../runtime/State.ts"

/** The SHA-256 of the parent and the state, in hex. Equal steps give equal ids. */
export const Id = Schema.String.pipe(Schema.brand("@wovel/core/CommitId"))
export type Id = typeof Id.Type

/**
 * One step of the game. Commits never change. A save is a ref that points at
 * a commit, and a rollback moves to the parent.
 */
export const Commit = Schema.Struct({
	id: Id,
	parent: Schema.OptionFromNullOr(Id),
	state: State.State,
	/** When the step happened, in milliseconds since 1970. It is not part of the id. */
	time: Schema.Int,
})
export type Commit = typeof Commit.Type

/** The part of a commit that its id hashes. */
const Content = Schema.Struct({
	parent: Commit.fields.parent,
	state: Commit.fields.state,
})

/**
 * The commit id could not be made. Web Crypto is missing outside a secure
 * context, for example on a page served over plain `http://` from a LAN address.
 */
export class CommitError extends Schema.TaggedError<CommitError>()(
	"CommitError",
	{ message: Schema.String, cause: Schema.Defect() },
) {}

const encoder = new TextEncoder()

export const make = Effect.fn("Commit.make")(function* (input: {
	readonly parent: Option.Option<Id>
	readonly state: State.State
	readonly time: number
}): Effect.fn.Return<Commit, CommitError, Crypto.Crypto> {
	const crypto = yield* Crypto.Crypto
	// Hash the JSON form, so an Option hashes like the null it stands for.
	// A valid state always encodes, so a failure here is a bug.
	const content = yield* Schema.encodeEffect(Content)(input).pipe(Effect.orDie)
	const digest = yield* crypto
		.digest("SHA-256", encoder.encode(canonical(content)))
		.pipe(
			Effect.mapError((cause) =>
				CommitError.make({
					message: `Could not hash the commit: ${cause.message}`,
					cause,
				}),
			),
		)
	return { ...input, id: Id.make(Hex.encode(digest)) }
})
