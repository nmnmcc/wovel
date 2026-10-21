import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem"
import * as NodePath from "@effect/platform-node-shared/NodePath"
import type { Story } from "@wovel/core"
import { Compiler, Diagnostic, Lint } from "@wovel/parser"
import {
	Array as EffectArray,
	Effect,
	FileSystem,
	Layer,
	ManagedRuntime,
	Match,
	Option,
	Order,
	Path,
	type PlatformError,
	Schema,
} from "effect"
import type { Plugin, ViteDevServer } from "vite"

export interface Options {
	/** The folder with the scripts, relative to the Vite root. The default is `story`. */
	readonly scripts?: string
	/**
	 * Also read `.md` files in the scripts folder. `.mdw` files are always
	 * scripts. Turn this on to keep scripts readable on GitHub.
	 */
	readonly markdown?: boolean
	/** The folder of images. `images/bg/room.webp` becomes the image `bg room`. */
	readonly images?: string
	/** The folder of audio. `audio/rain.ogg` becomes the audio `rain`. */
	readonly audio?: string
}

export const id = "virtual:wovel/story"
const resolved = `\0${id}`

/** A script or asset folder could not be read. */
export class ReadError extends Schema.TaggedError<ReadError>()("ReadError", {
	path: Schema.String,
	message: Schema.String,
	cause: Schema.Defect(),
}) {}

const readError = (path: string) => (cause: PlatformError.PlatformError) =>
	ReadError.make({ path, message: cause.message, cause })

const isNotFound = (error: PlatformError.PlatformError) =>
	error.reason._tag === "NotFound"

/** All files under a folder, as paths relative to it with `/`. A missing folder is empty. */
const list = Effect.fnUntraced(function* (folder: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const entries = yield* fs.readDirectory(folder, { recursive: true }).pipe(
		// Only a missing folder is empty. Other errors, such as no permission, fail.
		Effect.catchIf(isNotFound, () => Effect.succeed<Array<string>>([])),
		Effect.mapError(readError(folder)),
	)
	const files = yield* Effect.filter(entries, (entry) =>
		fs.stat(path.join(folder, entry)).pipe(
			Effect.map((info) => info.type === "File"),
			Effect.mapError(readError(path.join(folder, entry))),
		),
	)
	return EffectArray.sort(
		files.map((entry) => entry.split(path.sep).join("/")),
		Order.String,
	)
})

/** The asset name of a path: no extension, and a space for each folder. */
export const assetName = (path: string): string =>
	path
		.replace(/\.[^./]*$/, "")
		.split("/")
		.join(" ")

/**
 * `index` and `start` files come first, so their first scene starts the game.
 * Then code-unit order, so every machine builds the same story.
 */
const scriptOrder = Order.combine(
	Order.mapInput(Order.Number, (path: string) =>
		/(^|\/)(index|start)\.mdw?$/.test(path) ? 0 : 1,
	),
	Order.String,
)

/** The folders of a game, as absolute paths. */
const foldersOf = (path: Path.Path, root: string, options: Options) => ({
	scripts: path.resolve(root, options.scripts ?? "story"),
	images: path.resolve(root, options.images ?? "images"),
	audio: path.resolve(root, options.audio ?? "audio"),
})

interface Built {
	readonly code: string
	readonly watch: ReadonlyArray<string>
	readonly warnings: ReadonlyArray<Diagnostic.Diagnostic>
}

/** Read the scripts and assets of a game and write the code of the story module. */
export const generate = Effect.fn("Plugin.generate")(function* ({
	root,
	...options
}: Options & { readonly root: string }): Effect.fn.Return<
	Built,
	ReadError | Diagnostic.CompileError,
	FileSystem.FileSystem | Path.Path
> {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const { scripts, images, audio } = foldersOf(path, root, options)
	const isScript = (file: string) =>
		file.endsWith(".mdw") || (options.markdown === true && file.endsWith(".md"))
	const paths = EffectArray.sort(
		(yield* list(scripts)).filter(isScript),
		scriptOrder,
	)
	const files = yield* Effect.forEach(paths, (file) =>
		fs.readFileString(path.join(scripts, file)).pipe(
			Effect.mapError(readError(file)),
			Effect.map((source) => ({ path: file, source })),
		),
	)
	const compiled = yield* Compiler.compile(files)
	const imageFiles = yield* list(images)
	const audioFiles = yield* list(audio)
	// Names in the frontmatter win over names from the folders.
	const assets = (
		folder: string,
		found: ReadonlyArray<string>,
		named: Story.Story["images"],
	) =>
		found
			.filter((file) => !Object.hasOwn(named, assetName(file)))
			.map((file) => ({
				name: assetName(file),
				file: path.join(folder, file),
			}))
	const story = compiled.story
	const imageAssets = assets(images, imageFiles, story.images)
	const audioAssets = assets(audio, audioFiles, story.audio)
	const full = {
		...story,
		images: {
			...story.images,
			...Object.fromEntries(imageAssets.map((a) => [a.name, a.file])),
		},
		audio: {
			...story.audio,
			...Object.fromEntries(audioAssets.map((a) => [a.name, a.file])),
		},
	}
	const imports = [...imageAssets, ...audioAssets].map(
		(asset, n) =>
			`import asset${n} from ${JSON.stringify(`${asset.file}?url`)}`,
	)
	const entries = (
		list: ReadonlyArray<{ readonly name: string }>,
		offset: number,
	) =>
		list
			.map((asset, n) => `${JSON.stringify(asset.name)}: asset${n + offset}`)
			.join(",\n\t\t")
	const code = [
		...imports,
		`const story = ${JSON.stringify(story)}`,
		`story.images = {\n\t\t...story.images,\n\t\t${entries(imageAssets, 0)}\n\t}`,
		`story.audio = {\n\t\t...story.audio,\n\t\t${entries(audioAssets, imageAssets.length)}\n\t}`,
		"export default story",
	].join("\n")
	return {
		code,
		watch: paths.map((file) => path.join(scripts, file)),
		warnings: [...compiled.diagnostics, ...Lint.check(full)],
	}
})

/** The Node services that {@link generate} needs. */
export const layer: Layer.Layer<FileSystem.FileSystem | Path.Path> =
	Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

/** A diagnostic as a Vite log, so Vite shows its place in the file. */
const log = (diagnostic: Diagnostic.Diagnostic) => ({
	message: `${diagnostic.message} (${diagnostic.rule})`,
	loc: {
		file: diagnostic.file,
		line: diagnostic.line,
		column: diagnostic.column,
	},
})

/**
 * Compile the MDW scripts of a game into `virtual:wovel/story`. A change to a
 * script updates the running game in place; it keeps the player's place.
 */
export const wovel = (options: Options = {}): Plugin => {
	let root = process.cwd()
	let folders = { scripts: "", images: "", audio: "" }
	// The runtime is made when a hook first needs it and closed in closeBundle.
	// A watch build calls closeBundle after each build, so it is made again.
	let current =
		Option.none<
			ManagedRuntime.ManagedRuntime<FileSystem.FileSystem | Path.Path, never>
		>()
	const runtime = () => {
		if (Option.isSome(current)) return current.value
		const made = ManagedRuntime.make(layer)
		current = Option.some(made)
		return made
	}
	const inside = (folder: string, file: string) =>
		file.startsWith(folder + "/") || file.startsWith(folder + "\\")
	const reload = (server: ViteDevServer, file: string) => {
		if (!Object.values(folders).some((folder) => inside(folder, file))) return
		const module = server.moduleGraph.getModuleById(resolved)
		if (module === undefined) return
		server.moduleGraph.invalidateModule(module)
		server.ws.send({ type: "full-reload" })
	}
	return {
		name: "wovel",
		async configResolved(config) {
			root = config.root
			folders = await runtime().runPromise(
				Effect.map(Path.Path, (path) => foldersOf(path, root, options)),
			)
		},
		async closeBundle() {
			if (Option.isNone(current)) return
			const closing = current.value
			current = Option.none()
			await closing.dispose()
		},
		resolveId(source) {
			return source === id ? resolved : null
		},
		async load(module) {
			if (module !== resolved) return null
			const result = await runtime().runPromise(
				Effect.result(generate({ ...options, root })),
			)
			if (result._tag === "Failure")
				return Match.valueTags(result.failure, {
					CompileError: (error) => {
						const [first] = error.diagnostics
						return this.error({
							message: `The scripts have errors:\n${error.message}`,
							...(first === undefined ? {} : { loc: log(first).loc }),
						})
					},
					ReadError: (error) =>
						this.error(`Could not read ${error.path}: ${error.message}`),
				})
			for (const file of result.success.watch) this.addWatchFile(file)
			for (const warning of result.success.warnings) this.warn(log(warning))
			return result.success.code
		},
		handleHotUpdate({ file, server }) {
			if (!inside(folders.scripts, file)) return
			const module = server.moduleGraph.getModuleById(resolved)
			if (module === undefined) return
			server.moduleGraph.invalidateModule(module)
			// The page accepts the new story and keeps the player's place.
			return [module]
		},
		configureServer(server) {
			// New or removed files change the asset list, so the page loads again.
			server.watcher.on("add", (file) => reload(server, file))
			server.watcher.on("unlink", (file) => reload(server, file))
		},
	}
}
