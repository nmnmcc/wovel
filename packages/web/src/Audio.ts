import type { State, Story } from "@wovel/core"
import {
	Context,
	Effect,
	FiberSet,
	Layer,
	Option,
	Predicate,
	Record,
} from "effect"

export class Player extends Context.Service<
	Player,
	{
		/** Make the channels match the stage. Cues play only when `cues` is true. */
		readonly apply: (
			audio: Story.Story["audio"],
			stage: State.Stage,
			cues: boolean,
		) => Effect.Effect<void>
	}
>()("@wovel/web/Audio/Player") {}

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
 *
 * Browsers block sound until the player acts, and some of them allow `play()`
 * only inside the handler of that input. So the player listens for input on
 * `root` itself and tries the blocked channels again there.
 */
export const layer = (root: HTMLElement): Layer.Layer<Player> =>
	Layer.effect(
		Player,
		Effect.gen(function* () {
			// play() reports its errors in a Promise, outside any fiber. This runs the log there.
			const run = yield* FiberSet.makeRuntime<never>()
			// The element comes from the document of the game, not the global one.
			const document = root.ownerDocument
			const channels = new Map<string, HTMLAudioElement>()
			const cues = new Set<HTMLAudioElement>()
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					for (const audio of [...channels.values(), ...cues]) stop(audio)
					channels.clear()
					cues.clear()
				}),
			)
			const create = (src: string) => {
				const audio = document.createElement("audio")
				audio.src = src
				return audio
			}
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
			const unlock = () => {
				for (const audio of channels.values()) if (audio.paused) play(audio)
			}
			// Capture, so the player sees the input before a handler stops it.
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					root.addEventListener("pointerdown", unlock, true)
					root.addEventListener("keydown", unlock, true)
				}),
				() =>
					Effect.sync(() => {
						root.removeEventListener("pointerdown", unlock, true)
						root.removeEventListener("keydown", unlock, true)
					}),
			)
			return Player.of({
				apply: (files, stage, playCues) =>
					Effect.sync(() => {
						const url = (file: string) =>
							Option.getOrElse(Record.get(files, file), () => file)
						for (const [channel, audio] of channels)
							if (!Record.has(stage.audio, channel)) {
								stop(audio)
								channels.delete(channel)
							}
						for (const [channel, track] of Record.toEntries(stage.audio)) {
							const current = channels.get(channel)
							if (current?.dataset["file"] === track.file) continue
							if (current !== undefined) stop(current)
							const audio = create(url(track.file))
							audio.dataset["file"] = track.file
							audio.loop = track.loop
							channels.set(channel, audio)
							play(audio)
						}
						if (playCues)
							for (const cue of stage.cues) {
								const audio = create(url(cue.file))
								cues.add(audio)
								audio.addEventListener("ended", () => cues.delete(audio))
								play(audio)
							}
					}),
			})
		}),
	)
