import {
	Array as EffectArray,
	Effect,
	HashMap,
	Layer,
	Order,
	Ref,
} from "effect"
import type * as Commit from "./Commit.ts"
import { Persistence } from "./Persistence.ts"

/** Code-unit order, so the list does not depend on the locale of the machine. */
const byName = Order.mapInput(
	Order.String,
	(ref: { readonly name: string }) => ref.name,
)

/** Keeps commits and refs in memory. Tests and scene replays use it. */
export const make = Effect.gen(function* () {
	const state = yield* Ref.make({
		commits: HashMap.empty<Commit.Id, Commit.Commit>(),
		refs: HashMap.empty<string, Commit.Id>(),
	})
	return Persistence.of({
		read: (id) =>
			Ref.get(state).pipe(Effect.map((s) => HashMap.get(s.commits, id))),
		write: (commits) =>
			Ref.update(state, (s) => ({
				...s,
				commits: commits.reduce(
					(all, commit) =>
						HashMap.has(all, commit.id)
							? all
							: HashMap.set(all, commit.id, commit),
					s.commits,
				),
			})),
		ref: (name) =>
			Ref.get(state).pipe(Effect.map((s) => HashMap.get(s.refs, name))),
		setRef: (ref) =>
			Ref.update(state, (s) => ({
				...s,
				refs: HashMap.set(s.refs, ref.name, ref.commit),
			})),
		removeRef: (name) =>
			Ref.update(state, (s) => ({ ...s, refs: HashMap.remove(s.refs, name) })),
		refs: Ref.get(state).pipe(
			Effect.map((s) =>
				EffectArray.sort(
					EffectArray.map(HashMap.toEntries(s.refs), ([name, commit]) => ({
						name,
						commit,
					})),
					byName,
				),
			),
		),
	})
})

export const layer = Layer.effect(Persistence, make)
