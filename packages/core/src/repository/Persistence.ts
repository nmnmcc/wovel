import { Context, Schema, type Effect, type Option } from "effect"
import * as Commit from "./Commit.ts"

export class PersistenceError extends Schema.TaggedError<PersistenceError>()(
	"PersistenceError",
	{
		reason: Schema.Literals([
			"storage-failed",
			"decode-failed",
			"missing-commit",
		]),
		message: Schema.String,
	},
) {}

export const Ref = Schema.Struct({
	name: Schema.String,
	commit: Commit.Id,
})
export type Ref = typeof Ref.Type

/**
 * Where commits and refs live. The core has a memory store; `@wovel/web` has
 * one on IndexedDB. A desktop shell can add one on the file system.
 */
export class Persistence extends Context.Service<
	Persistence,
	{
		readonly read: (
			id: Commit.Id,
		) => Effect.Effect<Option.Option<Commit.Commit>, PersistenceError>
		/** Write commits. A commit that is already there stays as it is. */
		readonly write: (
			commits: ReadonlyArray<Commit.Commit>,
		) => Effect.Effect<void, PersistenceError>
		readonly ref: (
			name: string,
		) => Effect.Effect<Option.Option<Commit.Id>, PersistenceError>
		readonly setRef: (ref: Ref) => Effect.Effect<void, PersistenceError>
		readonly removeRef: (name: string) => Effect.Effect<void, PersistenceError>
		readonly refs: Effect.Effect<ReadonlyArray<Ref>, PersistenceError>
	}
>()("@wovel/core/repository/Persistence") {}
