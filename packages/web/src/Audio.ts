import type { State, Story } from "@wovel/core"
import { Effect, FiberSet, Option, Predicate, Record, type Scope } from "effect"

export interface Player {
	/** Make the channels match the stage. Cues play only when `cues` is true. */
	readonly apply: (
		story: Story.Story,
		stage: State.Stage,
		cues: boolean,
	) => Effect.Effect<void>
	/**
	 * Browsers block sound until the player acts. Call this on each input. It is
	 * not an Effect: `play()` must run inside the event handler of the input.
	 */
	readonly unlock: () => void
}

const stop = (audio: HTMLAudioElement) => {
	audio.pause()
	// Without a source the element stops loading the file.
	audio.removeAttribute("src")
	audio.load()
}

/**
 * One `<audio>` element per channel. This is enough for music and sound
 * effects; mixers, filters, and seamless loops will move to Web Audio. Closing
 * the Scope stops every sound.
 */
export const make = (
	document: Document,
): Effect.Effect<Player, never, Scope.Scope> =>
	Effect.gen(function* () {
		// play() reports its errors in a Promise, outside any fiber. This runs the log there.
		const run = yield* FiberSet.makeRuntime<never>()
		const channels = new Map<string, HTMLAudioElement>()
		const cues = new Set<HTMLAudioElement>()
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (const audio of [...channels.values(), ...cues]) stop(audio)
				channels.clear()
				cues.clear()
			}),
		)
		// The element comes from the document of the game, not the global one.
		const create = (src: string) => {
			const audio = document.createElement("audio")
			audio.src = src
			return audio
		}
		const url = (story: Story.Story, file: string) =>
			Option.getOrElse(Record.get(story.audio, file), () => file)
		const play = (audio: HTMLAudioElement) => {
			audio.play().catch((error: unknown) => {
				// play() fails before the first user input; unlock() tries again.
				// It also fails when stop() takes the source away. Both are expected.
				if (
					Predicate.hasProperty(error, "name") &&
					(error.name === "NotAllowedError" || error.name === "AbortError")
				)
					return
				run(Effect.logWarning("Could not play audio", audio.src, error))
			})
		}
		return {
			apply: (story, stage, playCues) =>
				Effect.sync(() => {
					for (const [channel, audio] of channels)
						if (!Record.has(stage.audio, channel)) {
							stop(audio)
							channels.delete(channel)
						}
					for (const [channel, track] of Record.toEntries(stage.audio)) {
						const current = channels.get(channel)
						if (current?.dataset["file"] === track.file) continue
						if (current !== undefined) stop(current)
						const audio = create(url(story, track.file))
						audio.dataset["file"] = track.file
						audio.loop = track.loop
						channels.set(channel, audio)
						play(audio)
					}
					if (playCues)
						for (const cue of stage.cues) {
							const audio = create(url(story, cue.file))
							cues.add(audio)
							audio.addEventListener("ended", () => cues.delete(audio))
							play(audio)
						}
				}),
			unlock: () => {
				for (const audio of channels.values()) if (audio.paused) play(audio)
			},
		}
	})
