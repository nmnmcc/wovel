import { Interpreter, type Instruction, type Story } from "@wovel/core"
import type { Diagnostic } from "./Diagnostic.ts"

const at = (
	instruction: Instruction.Instruction,
	rule: string,
	message: string,
): Diagnostic => ({
	file: instruction.source.file,
	line: instruction.source.line,
	column: 1,
	severity: "warning",
	rule,
	message,
})

/** An image name is known when the story has it, or has a longer name that starts with it. */
const knownImage = (story: Story.Story, name: string) =>
	Object.hasOwn(story.images, name) ||
	Object.keys(story.images).some((key) => key.startsWith(`${name} `))

/** Instructions after which the next one does not run by itself. */
const stops: ReadonlySet<Instruction.Tag> = new Set(["Jump", "Return", "End"])

/**
 * Check a compiled story for things that are allowed but are likely mistakes.
 * Run it after the build tool has added the images and audio it found.
 */
export const check = (story: Story.Story): ReadonlyArray<Diagnostic> => {
	const found: Array<Diagnostic> = []
	const targeted = new Set<string>([story.start])
	const mark = (target: Instruction.Target) => {
		if (target._tag === "Scene") targeted.add(target.scene)
	}
	const hasImages = Object.keys(story.images).length > 0
	for (const instruction of story.instructions) {
		switch (instruction._tag) {
			case "Say":
				if (
					instruction.who !== undefined &&
					!Object.hasOwn(story.characters, instruction.who)
				)
					found.push(
						at(
							instruction,
							"unknown-character",
							`"${instruction.who}" is not in characters. Add it to the frontmatter, or ignore this for a one-time name.`,
						),
					)
				break
			case "Show": {
				const name = [instruction.tag, ...instruction.attributes].join(" ")
				if (hasImages && !knownImage(story, name))
					found.push(
						at(instruction, "unknown-image", `There is no image "${name}"`),
					)
				break
			}
			case "Background":
				if (hasImages && !knownImage(story, instruction.image))
					found.push(
						at(
							instruction,
							"unknown-image",
							`There is no image "${instruction.image}"`,
						),
					)
				break
			case "Play":
				if (!Object.hasOwn(story.audio, instruction.file))
					found.push(
						at(
							instruction,
							"unknown-audio",
							`There is no audio "${instruction.file}"`,
						),
					)
				break
			case "Jump":
			case "Call":
				mark(instruction.target)
				break
			case "Menu":
				instruction.options.forEach((option) => mark(option.target))
				break
		}
	}
	for (const [name, scene] of Object.entries(story.scenes)) {
		const before = story.instructions[scene.index - 1]
		const fallsIn =
			before !== undefined &&
			!stops.has(before._tag) &&
			Interpreter.sceneAt(story, scene.index - 1) !== name
		const instruction = story.instructions[scene.index]
		if (!targeted.has(name) && !fallsIn && instruction !== undefined)
			found.push(
				at(
					instruction,
					"unreachable-scene",
					`No jump, call, or menu goes to the scene "${name}"`,
				),
			)
	}
	return found
}

export interface Stats {
	readonly scenes: number
	readonly lines: number
	readonly menus: number
	/** Characters of text, by speaker. Narration is under `""`. */
	readonly characters: Readonly<Record<string, number>>
}

/** Count scenes, lines, menus, and the length of the text of each speaker. */
export const stats = (story: Story.Story): Stats => {
	const characters: Record<string, number> = {}
	let lines = 0
	let menus = 0
	for (const instruction of story.instructions) {
		if (instruction._tag === "Menu") menus++
		if (instruction._tag !== "Say") continue
		lines++
		const who = instruction.who ?? ""
		characters[who] =
			(characters[who] ?? 0) + [...Interpreter.caption(instruction.text)].length
	}
	return { scenes: Object.keys(story.scenes).length, lines, menus, characters }
}
