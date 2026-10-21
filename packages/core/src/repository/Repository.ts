import { Array as EffectArray, Crypto, Effect, Option, Predicate } from "effect"
import { dual } from "effect/Function"
import * as State from "../runtime/State.ts"
import * as Commit from "./Commit.ts"
import { Persistence, PersistenceError } from "./Persistence.ts"

/** Ref names. Saves, the quick save, and the auto save are only refs. */
export const refs = {
	save: (slot: string) => `save/${slot}`,
	quick: "quick",
	auto: "auto",
} as const

export const get = (
	id: Commit.Id,
): Effect.Effect<Commit.Commit, PersistenceError, Persistence> =>
	Effect.flatMap(Persistence, (persistence) => persistence.read(id)).pipe(
		Effect.flatMap((commit) =>
			Effect.fromOption(commit, () =>
				PersistenceError.make({
					reason: "missing-commit",
					message: `The commit ${id} is missing`,
				}),
			),
		),
	)

/** Make a commit on top of a parent and write it. */
export const commit = Effect.fn("Repository.commit")(function* (input: {
	readonly parent: Option.Option<Commit.Id>
	readonly state: State.State
	readonly time: number
}): Effect.fn.Return<
	Commit.Commit,
	PersistenceError | Commit.CommitError,
	Persistence | Crypto.Crypto
> {
	const persistence = yield* Persistence
	const made = yield* Commit.make(input)
	yield* persistence.write([made])
	return made
})

/** The data-first form starts with a commit. The data-last form starts with an optional limit. */
const isCommitFirst = (args: IArguments) => Predicate.isObject(args[0])

/**
 * The commits from a head back to the first one, newest first. It stops at a
 * missing commit, so the history shows what is still there.
 */
export const log: {
	(
		limit?: number,
	): (
		head: Commit.Commit,
	) => Effect.Effect<
		ReadonlyArray<Commit.Commit>,
		PersistenceError,
		Persistence
	>
	(
		head: Commit.Commit,
		limit?: number,
	): Effect.Effect<ReadonlyArray<Commit.Commit>, PersistenceError, Persistence>
} = dual(
	isCommitFirst,
	(
		head: Commit.Commit,
		limit: number = Number.POSITIVE_INFINITY,
	): Effect.Effect<
		ReadonlyArray<Commit.Commit>,
		PersistenceError,
		Persistence
	> =>
		Effect.gen(function* () {
			const persistence = yield* Persistence
			const found: Array<Commit.Commit> = [head]
			let parent = head.parent
			while (Option.isSome(parent) && found.length < limit) {
				const next = yield* persistence.read(parent.value)
				if (Option.isNone(next)) break
				found.push(next.value)
				parent = next.value.parent
			}
			return found
		}),
)

export interface Entry {
	readonly commit: Commit.Commit
	readonly line: State.Line
}

/** The lines the player saw, oldest first. The history screen does not need its own log. */
export const history: {
	(
		limit?: number,
	): (
		head: Commit.Commit,
	) => Effect.Effect<ReadonlyArray<Entry>, PersistenceError, Persistence>
	(
		head: Commit.Commit,
		limit?: number,
	): Effect.Effect<ReadonlyArray<Entry>, PersistenceError, Persistence>
} = dual(
	isCommitFirst,
	(
		head: Commit.Commit,
		limit?: number,
	): Effect.Effect<ReadonlyArray<Entry>, PersistenceError, Persistence> =>
		log(head, limit).pipe(
			Effect.map((commits) =>
				EffectArray.reverse(
					EffectArray.getSomes(
						commits.map((commit): Option.Option<Entry> => {
							const waiting = commit.state.waiting
							if (waiting._tag === "Say")
								return Option.some({ commit, line: waiting.line })
							if (waiting._tag === "Menu")
								return Option.map(waiting.prompt, (line) => ({ commit, line }))
							return Option.none()
						}),
					),
				),
			),
		),
)

export interface Slot {
	readonly name: string
	readonly commit: Commit.Commit
}

/**
 * The saved games, with their commits, for a save or load screen. A ref whose
 * commit is gone is left out, so one broken save does not hide the others.
 */
export const slots: Effect.Effect<
	ReadonlyArray<Slot>,
	PersistenceError,
	Persistence
> = Effect.gen(function* () {
	const persistence = yield* Persistence
	const all = yield* persistence.refs
	const found = yield* Effect.forEach(all, (ref) =>
		Effect.map(
			persistence.read(ref.commit),
			Option.map((commit) => ({ name: ref.name, commit })),
		),
	)
	return EffectArray.getSomes(found)
})
