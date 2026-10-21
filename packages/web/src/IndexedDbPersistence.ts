import { Commit, Persistence } from "@wovel/core"
import {
	Array as EffectArray,
	Effect,
	Layer,
	Option,
	Result,
	Schema,
} from "effect"

type Failure = Persistence.PersistenceError

const failed = (message: string) => (cause: unknown) =>
	Persistence.PersistenceError.make({
		reason: "storage-failed",
		message: `${message}: ${cause instanceof Error ? cause.message : "unknown error"}`,
	})

type StoreName = "commits" | "refs"

/**
 * Run requests in one transaction. It succeeds when the transaction completes,
 * not when the request succeeds: a write can still fail after that, for
 * example when the disk is full. Interrupting it aborts the transaction.
 */
const transact = <A>(
	database: IDBDatabase,
	name: StoreName,
	mode: IDBTransactionMode,
	use: (store: IDBObjectStore) => IDBRequest<A> | undefined,
	message: string,
): Effect.Effect<Option.Option<A>, Failure> =>
	Effect.callback<Option.Option<A>, Failure>((resume) => {
		// The requests must start in the same task as the transaction, or it
		// commits empty. So everything happens here, not in later Effect steps.
		const started = Result.try({
			try: () => {
				const transaction = database.transaction(name, mode)
				return { transaction, request: use(transaction.objectStore(name)) }
			},
			catch: failed(message),
		})
		if (Result.isFailure(started)) return resume(Effect.fail(started.failure))
		const { transaction, request } = started.success
		transaction.oncomplete = () =>
			resume(
				Effect.succeed(
					Option.map(Option.fromUndefinedOr(request), (r) => r.result),
				),
			)
		transaction.onabort = () =>
			resume(Effect.fail(failed(message)(transaction.error)))
		// abort() throws when the transaction is already over. Then there is nothing to do.
		return Effect.sync(() => Result.try(() => transaction.abort()))
	})

const open = (name: string) =>
	Effect.callback<IDBDatabase, Failure>((resume) => {
		const started = Result.try({
			try: () => indexedDB.open(`wovel:${name}`, 1),
			catch: failed("Could not open the save database"),
		})
		if (Result.isFailure(started)) return resume(Effect.fail(started.failure))
		const request = started.success
		request.onupgradeneeded = () => {
			request.result.createObjectStore("commits", { keyPath: "id" })
			request.result.createObjectStore("refs", { keyPath: "name" })
		}
		request.onsuccess = () => resume(Effect.succeed(request.result))
		request.onerror = () =>
			resume(
				Effect.fail(failed("Could not open the save database")(request.error)),
			)
		request.onblocked = () =>
			resume(
				Effect.fail(
					failed("Could not open the save database")(
						new Error("another tab uses an older version of it"),
					),
				),
			)
	})

const decodeCommit = Schema.decodeUnknownEffect(Commit.Commit)
const encodeCommit = Schema.encodeEffect(Commit.Commit)
const decodeRef = Schema.decodeUnknownEffect(Persistence.Ref)
const encodeRef = Schema.encodeEffect(Persistence.Ref)

const invalid = (error: Schema.SchemaError) =>
	Persistence.PersistenceError.make({
		reason: "decode-failed",
		message: `A save is not valid: ${error.message}`,
	})

/**
 * Keep commits and refs in IndexedDB. Each game uses its own database name, so
 * two games on the same site do not share saves.
 */
export const layer = (options: {
	readonly name: string
}): Layer.Layer<Persistence.Persistence, Persistence.PersistenceError> =>
	Layer.effect(
		Persistence.Persistence,
		Effect.gen(function* () {
			const database = yield* Effect.acquireRelease(
				open(options.name),
				(database) => Effect.sync(() => database.close()),
			)
			// A newer version of the game in another tab wants the database. Let it go.
			yield* Effect.sync(() => {
				database.onversionchange = () => database.close()
			})
			// Ask the browser not to clear saves when the disk is full. It may say no.
			yield* Effect.tryPromise({
				try: () => navigator.storage?.persist?.() ?? Promise.resolve(false),
				catch: failed("Could not ask for lasting storage"),
			}).pipe(Effect.ignore({ log: "Debug" }))
			const read = <A>(
				name: StoreName,
				use: (store: IDBObjectStore) => IDBRequest<A>,
				message: string,
			) =>
				transact(database, name, "readonly", use, message).pipe(
					// A read always has a request, so it always has a result.
					Effect.map((result) => Option.getOrUndefined(result)),
				)
			return Persistence.Persistence.of({
				read: (id) =>
					read(
						"commits",
						(store) => store.get(id),
						"Could not read a commit",
					).pipe(
						Effect.flatMap((value) =>
							value === undefined
								? Effect.succeedNone
								: decodeCommit(value).pipe(
										Effect.mapError(invalid),
										Effect.asSome,
									),
						),
					),
				write: (commits) =>
					Effect.gen(function* () {
						// IndexedDB keeps the JSON form. An Option does not survive structured clone.
						const encoded = yield* Effect.forEach(commits, (commit) =>
							encodeCommit(commit).pipe(Effect.mapError(invalid)),
						)
						// Commits never change and their id is their content, so put() over
						// an existing commit writes the same value again. All go in one transaction.
						yield* transact(
							database,
							"commits",
							"readwrite",
							(store) => {
								for (const commit of encoded) store.put(commit)
								return undefined
							},
							"Could not write a commit",
						)
					}),
				ref: (name) =>
					read(
						"refs",
						(store) => store.get(name),
						"Could not read a save",
					).pipe(
						Effect.flatMap((value) =>
							value === undefined
								? Effect.succeedNone
								: decodeRef(value).pipe(
										Effect.mapError(invalid),
										Effect.map((ref) => Option.some(ref.commit)),
									),
						),
					),
				setRef: (ref) =>
					encodeRef(ref).pipe(
						Effect.mapError(invalid),
						Effect.flatMap((encoded) =>
							transact(
								database,
								"refs",
								"readwrite",
								(store) => store.put(encoded),
								"Could not write a save",
							),
						),
						Effect.asVoid,
					),
				removeRef: (name) =>
					transact(
						database,
						"refs",
						"readwrite",
						(store) => store.delete(name),
						"Could not delete a save",
					).pipe(Effect.asVoid),
				refs: read(
					"refs",
					(store) => store.getAll(),
					"Could not list saves",
				).pipe(
					Effect.map((values) => values ?? []),
					Effect.flatMap((values) =>
						// One broken save is left out, so the others still show.
						Effect.forEach(values, (value) =>
							decodeRef(value).pipe(
								Effect.tapError((error) =>
									Effect.logWarning("A save is not valid", error.message),
								),
								Effect.option,
							),
						),
					),
					Effect.map(EffectArray.getSomes),
				),
			})
		}),
	)
