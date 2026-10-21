import { ContentHash, Instruction, type Story } from "@wovel/core"
import { Array as EffectArray, Effect, Option, Record } from "effect"
import { slug } from "github-slugger"
import type {
	Code,
	Heading,
	List,
	ListItem,
	Node,
	Paragraph,
	PhrasingContent,
	RootContent,
} from "mdast"
import type { ContainerDirective, LeafDirective } from "mdast-util-directive"
import { CompileError, type Diagnostic } from "./Diagnostic.ts"
import * as Frontmatter from "./Frontmatter.ts"
import * as Inline from "./Inline.ts"
import * as Markdown from "./Markdown.ts"

export interface File {
	/** The path of the file, relative to the project. Diagnostics and scene records use it. */
	readonly path: string
	readonly source: string
}

export interface Compiled {
	readonly story: Story.Story
	/** Warnings. Errors fail the compile with {@link CompileError}. */
	readonly diagnostics: ReadonlyArray<Diagnostic>
}

/** An instruction before the compiler gives it an id and a hash. */
type Body = Instruction.Instruction extends infer I
	? I extends Instruction.Instruction
		? Omit<I, "id" | "hash" | "source">
		: never
	: never

interface Entry {
	body: Body
	readonly source: Instruction.Source
	readonly scene: string
	/** The node, for diagnostics found after the walk. */
	readonly node: Node
}

/** The scene id of a heading, a jump label, or a link. Same rules as GitHub anchors. */
export const sceneId = (name: string): string => slug(name.trim())

const decodeFragment = Option.liftThrowable(decodeURIComponent)

const targetOf = (href: string): Option.Option<string> => {
	const hash = href.indexOf("#")
	if (hash < 0) return Option.none()
	const fragment = href.slice(hash + 1)
	// A fragment with a bad `%` escape is used as it is.
	return Option.some(
		sceneId(Option.getOrElse(decodeFragment(fragment), () => fragment)),
	)
}

const words = (value: Option.Option<string>): ReadonlyArray<string> =>
	Option.getOrElse(value, () => "")
		.split(/\s+/)
		.filter((word) => word !== "")

/**
 * An optional field of an instruction. The story model is JSON, so a missing
 * value is a missing key, not an Option.
 */
const optional = <K extends string, V>(
	key: K,
	value: Option.Option<V>,
): { readonly [P in K]?: V } =>
	Option.match(value, {
		onNone: () => ({}),
		onSome: (value) => ({ [key]: value }),
	}) as { readonly [P in K]?: V }

/** The first of the keys that the directive sets. */
const option = (
	attributes: LeafDirective["attributes"],
	...keys: ReadonlyArray<string>
): Option.Option<string> =>
	Option.firstSomeOf(
		// mdast uses null for an attribute with no value.
		keys.map((key) => Option.fromNullishOr(attributes?.[key])),
	)

/** Trailing `{if="x"}` at the end of a menu option. */
const trailing = /\{\s*[\w-]+=[^{}]*\}\s*$/

export const compile = Effect.fn("Compiler.compile")(function* (
	files: ReadonlyArray<File>,
): Effect.fn.Return<Compiled, CompileError> {
	const diagnostics: Array<Diagnostic> = []
	const report = (
		file: string,
		node: Node | undefined,
		severity: Diagnostic["severity"],
		rule: string,
		message: string,
	) =>
		diagnostics.push({
			file,
			line: node?.position?.start.line ?? 1,
			column: node?.position?.start.column ?? 1,
			severity,
			rule,
			message,
		})

	const trees = files.map((file) => ({
		file,
		root: Markdown.parse(file.source),
	}))

	// Read all frontmatter first. Characters must be known before the first line.
	let title = Option.none<string>()
	let start = Option.none<string>()
	const defaults: Record<string, Story.Story["defaults"][string]> = {}
	const characters: Record<string, Story.Character> = {}
	const images: Record<string, string> = {}
	const audio: Record<string, string> = {}
	for (const { file, root } of trees)
		for (const node of root.children) {
			if (node.type !== "yaml") continue
			const result = Frontmatter.decode(node.value)
			if (result._tag === "Failure") {
				report(
					file.path,
					node,
					"error",
					"invalid-frontmatter",
					result.failure.message,
				)
				continue
			}
			const value = result.success
			title = Option.orElse(title, () => Option.fromUndefinedOr(value.title))
			start = Option.orElse(start, () =>
				Option.map(Option.fromUndefinedOr(value.start), sceneId),
			)
			Object.assign(defaults, value.defaults)
			Object.assign(characters, value.characters)
			Object.assign(images, value.images)
			Object.assign(audio, value.audio)
		}

	const characterOf = (name: string): string =>
		Record.has(characters, name)
			? name
			: Option.match(
					EffectArray.findFirst(
						Record.toEntries(characters),
						([, c]) => c.name === name,
					),
					{ onNone: () => name, onSome: ([id]) => id },
				)

	const entries: Array<Entry> = []
	const scenes: Record<string, Story.Scene> = {}

	for (const { file, root } of trees) {
		let scene: Option.Option<string> = Option.none()
		const ensureScene = (node: Node): string => {
			if (Option.isSome(scene)) return scene.value
			// Statements before the first heading belong to a scene named after the file.
			const name =
				file.path
					.split("/")
					.at(-1)
					?.replace(/\.[^.]*$/, "") ?? file.path
			const id = sceneId(name)
			scene = Option.some(id)
			if (!Object.hasOwn(scenes, id))
				scenes[id] = {
					title: name,
					index: entries.length,
					file: file.path,
				}
			else
				report(
					file.path,
					node,
					"error",
					"duplicate-scene",
					`There is already a scene named "${id}"`,
				)
			return id
		}
		const emit = (node: Node, body: Body): number => {
			entries.push({
				body,
				node,
				scene: ensureScene(node),
				source: { file: file.path, line: node.position?.start.line ?? 1 },
			})
			return entries.length - 1
		}
		const error = (node: Node, rule: string, message: string) =>
			report(file.path, node, "error", rule, message)
		const warn = (node: Node, rule: string, message: string) =>
			report(file.path, node, "warning", rule, message)

		const sceneTarget = (node: Node, label: string): Instruction.Target => {
			const id = sceneId(label)
			if (id === "") error(node, "empty-target", "A jump needs a scene name")
			return { _tag: "Scene", scene: id }
		}

		let menuSet = Option.none<string>()

		const say = (paragraph: Paragraph) => {
			const [first, second, ...others] = paragraph.children
			if (first?.type !== "strong") return Option.none()
			const label = Inline.plain(first.children)
			const colon = /[:：]\s*$/u
			if (colon.test(label))
				return Option.some({
					name: label.replace(colon, "").trim(),
					attributes: {} as Record<string, string>,
					rest: paragraph.children.slice(1),
				})
			if (second?.type !== "text") return Option.none()
			const braces = Inline.braceAttributes(second.value)
			const after = Option.match(braces, {
				onNone: () => second.value,
				onSome: (b) => b.rest,
			})
			return Option.map(
				Option.fromNullishOr(/^\s*[:：]\s*/u.exec(after)),
				(separator) => {
					const text = after.slice(separator[0].length)
					return {
						name: label,
						attributes: Option.match(braces, {
							onNone: (): Record<string, string> => ({}),
							onSome: (b) => b.attributes,
						}),
						rest: [
							...(text === "" ? [] : [{ ...second, value: text }]),
							...others,
						] as ReadonlyArray<PhrasingContent>,
					}
				},
			)
		}

		const line = (paragraph: Paragraph, extend: boolean) => {
			const said = say(paragraph)
			if (Option.isNone(said)) {
				emit(paragraph, {
					_tag: "Say",
					text: Inline.text(paragraph.children),
					extend,
				})
				return
			}
			const spoken = said.value
			const who = characterOf(spoken.name)
			const expression = option(spoken.attributes, "expr")
			const position = option(spoken.attributes, "at")
			if (Option.isSome(expression) || Option.isSome(position))
				emit(paragraph, {
					_tag: "Show",
					tag: characters[who]?.image ?? who,
					attributes: words(expression),
					...optional("position", position),
					...optional(
						"transition",
						option(spoken.attributes, "transition", "with"),
					),
				})
			emit(paragraph, {
				_tag: "Say",
				who,
				...optional("name", option(spoken.attributes, "as")),
				text: Inline.text(spoken.rest),
				extend,
			})
		}

		/** The scene of a paragraph that is only a link. */
		const jumpOf = (paragraph: Paragraph): Option.Option<string> => {
			const content = paragraph.children.filter(
				(child) => !(child.type === "text" && child.value.trim() === ""),
			)
			const [only] = content
			return content.length === 1 && only?.type === "link"
				? targetOf(only.url)
				: Option.none()
		}

		const menu = (list: List) => {
			const options = list.children.map((item: ListItem) => {
				const [head, ...body] = item.children
				if (head?.type !== "paragraph") return Option.none()
				const link = head.children.find((child) => child.type === "link")
				if (link !== undefined && body.length === 0)
					return Option.map(targetOf(link.url), (target) => {
						const after = Inline.plain(
							head.children.slice(head.children.indexOf(link) + 1),
						)
						const condition = Option.flatMap(
							Inline.braceAttributes(after),
							(b) => Record.get(b.attributes, "if"),
						)
						return {
							item,
							text: Inline.text(link.children),
							target: Option.some<Instruction.Target>({
								_tag: "Scene",
								scene: target,
							}),
							body: [] as ReadonlyArray<RootContent>,
							condition,
						}
					})
				if (body.length === 0) return Option.none()
				const children = [...head.children]
				const last = children.at(-1)
				let condition = Option.none<string>()
				if (last?.type === "text" && trailing.test(last.value)) {
					const at = last.value.search(trailing)
					condition = Option.flatMap(
						Inline.braceAttributes(last.value.slice(at)),
						(b) => Record.get(b.attributes, "if"),
					)
					children[children.length - 1] = {
						...last,
						value: last.value.slice(0, at),
					}
				}
				return Option.some({
					item,
					text: Inline.text(children),
					target: Option.none<Instruction.Target>(),
					body: body as ReadonlyArray<RootContent>,
					condition,
				})
			})
			if (options.some(Option.isNone)) return false

			// The line right before the menu is its question.
			const previous = entries.at(-1)
			const prompt =
				previous !== undefined &&
				previous.body._tag === "Say" &&
				!previous.body.extend &&
				previous.source.file === file.path
					? (entries.pop()?.body as Extract<Body, { _tag: "Say" }>)
					: undefined
			const at = emit(list, {
				_tag: "Menu",
				...(prompt === undefined
					? {}
					: {
							prompt: {
								...optional("who", Option.fromUndefinedOr(prompt.who)),
								...optional("name", Option.fromUndefinedOr(prompt.name)),
								text: prompt.text,
							},
						}),
				...optional("set", menuSet),
				options: [],
			})
			menuSet = Option.none()
			// A skipped menu goes on after all the option bodies.
			const skip = emit(list, {
				_tag: "Jump",
				target: { _tag: "Index", index: -1 },
			})
			const ends: Array<number> = [skip]
			const compiled: Array<Instruction.Option> = []
			for (const o of options) {
				if (Option.isNone(o)) continue
				const { item, body } = o.value
				const target = Option.getOrElse(o.value.target, () => {
					const start: Instruction.Target = {
						_tag: "Index",
						index: entries.length,
					}
					blocks(body)
					ends.push(
						emit(item, {
							_tag: "Jump",
							target: { _tag: "Index", index: -1 },
						}),
					)
					return start
				})
				compiled.push({
					text: o.value.text,
					target,
					...optional("condition", o.value.condition),
				})
			}
			const entry = entries[at]
			if (entry !== undefined && entry.body._tag === "Menu")
				entry.body = { ...entry.body, options: compiled }
			for (const end of ends) patchJump(end, entries.length)
			return true
		}

		const patchJump = (at: number, index: number) => {
			const entry = entries[at]
			if (entry !== undefined && entry.body._tag === "Jump")
				entry.body = { ...entry.body, target: { _tag: "Index", index } }
		}

		const condition = (node: ContainerDirective | LeafDirective) =>
			Option.getOrElse(
				option(node.attributes, "cond", "condition", "if"),
				() => {
					error(
						node,
						"missing-condition",
						`::${node.name} needs a cond="…" attribute`,
					)
					return "false"
				},
			)

		const container = (node: ContainerDirective) => {
			const children = node.children.filter(
				(child) =>
					!(child.type === "paragraph" && child.data?.directiveLabel === true),
			)
			switch (node.name) {
				case "if": {
					// Split the body at ::elif and ::else.
					const branches: Array<{
						condition: Option.Option<string>
						node: Node
						body: Array<RootContent>
					}> = [{ condition: Option.some(condition(node)), node, body: [] }]
					for (const child of children) {
						if (
							child.type === "leafDirective" &&
							(child.name === "elif" || child.name === "else")
						) {
							branches.push({
								condition:
									child.name === "else"
										? Option.none()
										: Option.some(condition(child)),
								node: child,
								body: [],
							})
							continue
						}
						branches.at(-1)?.body.push(child)
					}
					const ends: Array<number> = []
					for (const branch of branches) {
						const test = Option.map(branch.condition, (condition) =>
							emit(branch.node, {
								_tag: "Branch",
								condition,
								otherwise: -1,
							}),
						)
						blocks(branch.body)
						ends.push(
							emit(branch.node, {
								_tag: "Jump",
								target: { _tag: "Index", index: -1 },
							}),
						)
						if (Option.isSome(test)) {
							const entry = entries[test.value]
							if (entry !== undefined && entry.body._tag === "Branch")
								entry.body = { ...entry.body, otherwise: entries.length }
						}
					}
					for (const end of ends) patchJump(end, entries.length)
					return
				}
				case "while": {
					const top = entries.length
					const test = emit(node, {
						_tag: "Branch",
						condition: condition(node),
						otherwise: -1,
					})
					blocks(children)
					emit(node, { _tag: "Jump", target: { _tag: "Index", index: top } })
					const entry = entries[test]
					if (entry !== undefined && entry.body._tag === "Branch")
						entry.body = { ...entry.body, otherwise: entries.length }
					return
				}
				default:
					error(node, "unknown-directive", `There is no :::${node.name} block`)
			}
		}

		const leaf = (node: LeafDirective) => {
			const label = Inline.plain(node.children)
			const attributes = node.attributes ?? {}
			const transition = option(attributes, "transition", "with")
			const fadeSeconds = Option.map(option(attributes, "fade"), Number)
			switch (node.name) {
				case "jump":
				case "call": {
					const target = Option.match(
						option(attributes, "expr", "expression"),
						{
							onNone: () => sceneTarget(node, label),
							onSome: (expression): Instruction.Target => ({
								_tag: "Expression",
								expression,
							}),
						},
					)
					emit(
						node,
						node.name === "jump"
							? { _tag: "Jump", target }
							: { _tag: "Call", target },
					)
					return
				}
				case "return":
					emit(node, { _tag: "Return" })
					return
				case "end":
					emit(node, { _tag: "End" })
					return
				case "pause":
					emit(node, { _tag: "Pause" })
					return
				case "set": {
					const assignments = Object.entries(attributes).flatMap(
						([name, value]): ReadonlyArray<Instruction.Assignment> => {
							// mdast uses null for an attribute with no value.
							if (value === null || value === undefined) return []
							const delta = Option.fromNullishOr(
								/^([+-])\s*(\d+(?:\.\d+)?)$/.exec(value.trim()),
							)
							return [
								Option.match(delta, {
									onNone: (): Instruction.Assignment => ({
										name,
										operator: "=",
										expression: value,
									}),
									onSome: (delta): Instruction.Assignment => ({
										name,
										operator: delta[1] === "+" ? "+=" : "-=",
										expression: delta[2] ?? "0",
									}),
								}),
							]
						},
					)
					if (assignments.length === 0)
						warn(node, "empty-set", "::set changes nothing")
					emit(node, { _tag: "Set", assignments })
					return
				}
				case "show": {
					const [tag = "", ...rest] = words(Option.some(label))
					if (tag === "")
						error(
							node,
							"missing-image",
							"::show needs an image, such as ::show[eileen happy]",
						)
					emit(node, {
						_tag: "Show",
						tag,
						attributes: [...rest, ...words(option(attributes, "expr"))],
						...optional("position", option(attributes, "at", "position")),
						...optional("layer", option(attributes, "layer")),
						...optional("transition", transition),
					})
					return
				}
				case "hide":
					emit(node, {
						_tag: "Hide",
						tag: words(Option.some(label))[0] ?? "",
						...optional("transition", transition),
					})
					return
				case "bg":
					emit(node, {
						_tag: "Background",
						image: `bg ${label.trim()}`,
						...optional("transition", transition),
					})
					return
				case "music":
				case "sound":
				case "voice":
				case "play": {
					const channel =
						node.name === "play"
							? Option.getOrElse(option(attributes, "channel"), () => "sound")
							: node.name
					const loop = option(attributes, "loop")
					emit(node, {
						_tag: "Play",
						channel,
						file: label.trim(),
						loop: Option.match(loop, {
							onNone: () => channel === "music",
							onSome: (loop) => loop !== "false",
						}),
						...optional("fade", fadeSeconds),
					})
					return
				}
				case "stop":
					emit(node, {
						_tag: "Stop",
						channel: label.trim() || "music",
						...optional("fade", fadeSeconds),
					})
					return
				case "menu":
					menuSet = option(attributes, "set")
					return
				case "elif":
				case "else":
					error(
						node,
						"misplaced-directive",
						`::${node.name} must be inside a :::if block`,
					)
					return
				default:
					error(
						node,
						"unknown-directive",
						`There is no ::${node.name} statement`,
					)
			}
		}

		const code = (node: Code) => {
			if (node.lang !== "js" && node.lang !== "javascript") {
				warn(
					node,
					"ignored-code",
					`A ${node.lang ?? "plain"} code block does nothing. Use \`\`\`js for logic.`,
				)
				return
			}
			if (
				Option.exists(
					Option.fromNullishOr(node.meta),
					(meta) => meta.trim() !== "",
				)
			) {
				error(
					node,
					"unsupported-code",
					`\`\`\`js ${node.meta} is not supported yet. Use frontmatter defaults.`,
				)
				return
			}
			emit(node, { _tag: "Code", code: node.value })
		}

		const heading = (node: Heading) => {
			const name = Inline.plain(node.children)
			const id = sceneId(name)
			if (Object.hasOwn(scenes, id)) {
				error(node, "duplicate-scene", `There is already a scene named "${id}"`)
				return
			}
			scene = Option.some(id)
			scenes[id] = { title: name, index: entries.length, file: file.path }
		}

		const block = (node: RootContent) => {
			switch (node.type) {
				case "yaml":
				case "html":
				case "thematicBreak":
				case "definition":
					return
				case "heading":
					return heading(node)
				case "paragraph": {
					const jump = jumpOf(node)
					if (Option.isSome(jump)) {
						emit(node, {
							_tag: "Jump",
							target: { _tag: "Scene", scene: jump.value },
						})
						return
					}
					return line(node, false)
				}
				case "list": {
					// `+ text` lines are a list in Markdown. In MDW they add to the line before them.
					const marker = file.source.charAt(node.position?.start.offset ?? -1)
					if (marker === "+") {
						for (const item of node.children)
							for (const child of item.children)
								if (child.type === "paragraph") line(child, true)
						return
					}
					if (!menu(node))
						error(
							node,
							"invalid-menu",
							"A list is a menu. Each item must be a link to a scene, or text with the statements of the option under it.",
						)
					return
				}
				case "code":
					return code(node)
				case "leafDirective":
					return leaf(node)
				case "containerDirective":
					return container(node)
				default:
					warn(node, "ignored-block", `A ${node.type} does nothing in a script`)
			}
		}

		function blocks(nodes: ReadonlyArray<RootContent>) {
			for (const node of nodes) block(node)
		}

		blocks(root.children)
		// The end of a file returns to the caller, or ends the game.
		if (Option.isSome(scene)) {
			const end = root.position?.end
			entries.push({
				body: { _tag: "Return" },
				node: root,
				scene: scene.value,
				source: { file: file.path, line: end?.line ?? 1 },
			})
		}
	}

	// Check jump targets now that all scenes are known.
	const check = (entry: Entry, target: Instruction.Target) => {
		if (target._tag === "Scene" && !Object.hasOwn(scenes, target.scene))
			report(
				entry.source.file,
				entry.node,
				"error",
				"unknown-scene",
				`There is no scene named "${target.scene}"`,
			)
	}
	for (const entry of entries) {
		const body = entry.body
		if (body._tag === "Jump" || body._tag === "Call") check(entry, body.target)
		if (body._tag === "Menu")
			for (const o of body.options) check(entry, o.target)
	}

	const first = Object.keys(scenes)[0]
	if (first === undefined)
		report(
			files[0]?.path ?? "story",
			undefined,
			"error",
			"no-scenes",
			"The story has no scenes. Start a scene with a # heading.",
		)
	if (Option.isSome(start) && !Object.hasOwn(scenes, start.value))
		report(
			files[0]?.path ?? "story",
			undefined,
			"error",
			"unknown-scene",
			`The start scene "${start.value}" does not exist`,
		)

	const errors = diagnostics.filter((d) => d.severity === "error")
	if (errors.length > 0)
		return yield* CompileError.make({ diagnostics: errors })

	const counters = new Map<string, number>()
	const instructions = entries.map((entry): Instruction.Instruction => {
		const n = counters.get(entry.scene) ?? 0
		counters.set(entry.scene, n + 1)
		return {
			...entry.body,
			id: Instruction.StatementId.make(`${entry.scene}-${n}`),
			hash: ContentHash.contentHash(entry.body),
			source: entry.source,
		} as Instruction.Instruction
	})

	return {
		story: {
			title: Option.getOrElse(title, () => "Untitled"),
			start: Option.getOrElse(start, () => first ?? ""),
			defaults,
			characters,
			images,
			audio,
			scenes,
			instructions,
		},
		diagnostics,
	}
})
