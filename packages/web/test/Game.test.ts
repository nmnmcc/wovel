import type { Story } from "@wovel/core"
import { Compiler } from "@wovel/parser"
import { start } from "@wovel/web"
import { Effect } from "effect"
import { userEvent } from "vitest/browser"
import { expect, onTestFinished, test, vi } from "vitest"

const compile = (source: string): Promise<Story.Story> =>
	Effect.runPromise(
		Effect.map(
			Compiler.compile([{ path: "test.mdw", source }]),
			(compiled) => compiled.story,
		),
	)

/** Start a game in a fresh element. It stops after the test. */
const play = async (
	source: string,
	options: { readonly charactersPerSecond?: number } = {},
) => {
	const story = await compile(source)
	const root = document.createElement("div")
	// The game fills its root, so the root needs a size, as on a real page.
	root.style.cssText = "width: 100vw; height: 100vh"
	document.body.append(root)
	const game = start({
		story,
		root,
		saves: false,
		charactersPerSecond: options.charactersPerSecond ?? 0,
	})
	onTestFinished(async () => {
		await game.stop()
		root.remove()
	})
	const find = (selector: string) => {
		const node = root.querySelector<HTMLElement>(selector)
		if (node === null) throw new Error(`There is no ${selector}`)
		return node
	}
	const text = () => root.querySelector(".wovel-text")?.textContent ?? ""
	/** Wait until the screen shows a line. */
	const shows = (line: string) => expect.poll(text).toBe(line)
	const button = (label: string) => {
		const found = Array.from(root.querySelectorAll("button")).find(
			(node) => node.textContent === label,
		)
		if (found === undefined) throw new Error(`There is no "${label}" button`)
		return found
	}
	return { root, game, find, text, shows, button }
}

const people = `---
characters:
  xue:
    name: 小雪
    color: "#c8a2c8"
---
`

test("the first line shows with the name and color of the speaker", async () => {
	const { find, shows } = await play(`${people}# a\n\n**xue**：你好。\n`)
	await shows("你好。")
	expect(find(".wovel-name").textContent).toBe("小雪")
	expect(find(".wovel-say").style.getPropertyValue("--wovel-name-color")).toBe(
		"#c8a2c8",
	)
})

test("a click and the Enter key advance; a click on a button does not", async () => {
	const { find, shows, button } = await play("# a\n\n一。\n\n二。\n\n三。\n")
	await shows("一。")
	await userEvent.click(find(".wovel-say"))
	await shows("二。")
	await userEvent.click(button("History"))
	await expect.poll(() => find(".wovel-panel").textContent).toContain("二。")
	await userEvent.keyboard("{Escape}")
	await expect.poll(() => find(".wovel-say").textContent).toContain("二。")
	find(".wovel").focus()
	await userEvent.keyboard("{Enter}")
	await shows("三。")
})

test("a menu shows its question and goes where the player chooses", async () => {
	const { root, shows } = await play(
		"# a\n\n去哪里？\n\n- [海边](#sea)\n- [山上](#hill)\n\n# sea\n\n海风很大。\n\n::end\n\n# hill\n\n山上很冷。\n",
	)
	await shows("去哪里？")
	const choices = () =>
		Array.from(
			root.querySelectorAll(".wovel-menu button"),
			(b) => b.textContent,
		)
	await expect.poll(choices).toEqual(["海边", "山上"])
	const hill = root.querySelectorAll<HTMLElement>(".wovel-menu button")[1]
	expect(hill).toBeDefined()
	await userEvent.click(hill!)
	await shows("山上很冷。")
	expect(choices()).toEqual([])
})

test("rollback goes back, and the back button is off at the first step", async () => {
	const { find, shows, button } = await play("# a\n\n一。\n\n二。\n")
	await shows("一。")
	expect(button("Back").disabled).toBe(true)
	await userEvent.click(find(".wovel-say"))
	await shows("二。")
	await expect.poll(() => button("Back").disabled).toBe(false)
	await userEvent.click(button("Back"))
	await shows("一。")
	find(".wovel").focus()
	await userEvent.keyboard("{PageDown}")
	await shows("二。")
})

test("load before a save shows a notice; save then load goes back", async () => {
	const { root, find, shows, button } = await play("# a\n\n一。\n\n二。\n")
	/** The newest notice. An older one can still be on the screen. */
	const notice = () =>
		Array.from(root.querySelectorAll(".wovel-notice")).at(-1)?.textContent
	await shows("一。")
	await userEvent.click(button("Load"))
	await expect.poll(notice).toBe("There is no save yet")
	await userEvent.click(button("Save"))
	await expect.poll(notice).toBe("Saved")
	await userEvent.click(find(".wovel-say"))
	await shows("二。")
	await userEvent.click(button("Load"))
	await shows("一。")
})

test("the end screen restarts the game", async () => {
	const { root, shows, button } = await play("# a\n\n只有一句。\n\n::end\n")
	await shows("只有一句。")
	await userEvent.click(root.querySelector<HTMLElement>(".wovel-say")!)
	await expect.poll(() => root.querySelector(".wovel-end") !== null).toBe(true)
	await userEvent.click(button("Restart"))
	await shows("只有一句。")
	await expect.poll(() => root.querySelector(".wovel-end")).toBeNull()
})

test("h hides the interface and a click shows it again", async () => {
	const { find, shows } = await play("# a\n\n一。\n\n二。\n")
	await shows("一。")
	find(".wovel").focus()
	await userEvent.keyboard("h")
	await expect
		.poll(() => find(".wovel").hasAttribute("data-hide-ui"))
		.toBe(true)
	await userEvent.click(find(".wovel-stage"))
	await expect
		.poll(() => find(".wovel").hasAttribute("data-hide-ui"))
		.toBe(false)
	// That click only showed the interface. It did not advance.
	expect(find(".wovel-text").textContent).toBe("一。")
})

test("the first click shows the whole line, the second goes on", async () => {
	const { root, find, shows } = await play(
		"# a\n\n这一句很长很长。\n\n下一句。\n",
		{
			charactersPerSecond: 1,
		},
	)
	const hidden = () => root.querySelectorAll(".wovel-g[data-hidden]").length
	// The first line of a new game types too.
	await expect.poll(hidden).toBeGreaterThan(0)
	await userEvent.click(find(".wovel-say"))
	await expect.poll(hidden).toBe(0)
	expect(find(".wovel-text").textContent).toBe("这一句很长很长。")
	await userEvent.click(find(".wovel-say"))
	await shows("下一句。")
})

test("a restart types the first line; a rollback to it does not", async () => {
	const { root, find, shows, button } = await play(
		"# a\n\n第一句。\n\n第二句。\n\n::end\n",
		{ charactersPerSecond: 1 },
	)
	const hidden = () => root.querySelectorAll(".wovel-g[data-hidden]").length
	const say = find(".wovel-say")
	/** Click until the line shows, finishing any typing on the way. */
	const reach = async (line: string) => {
		await expect
			.poll(async () => {
				if (find(".wovel-text").textContent !== line || hidden() > 0)
					await userEvent.click(say)
				return find(".wovel-text").textContent === line && hidden() === 0
			})
			.toBe(true)
	}
	await expect.poll(hidden).toBeGreaterThan(0)
	await reach("第二句。")
	await userEvent.click(button("Back"))
	await shows("第一句。")
	// A rollback jumps to the line. It does not type it again.
	expect(hidden()).toBe(0)
	await userEvent.click(say)
	await shows("第二句。")
	await expect.poll(hidden).toBeGreaterThan(0)
	await userEvent.click(say)
	await expect.poll(hidden).toBe(0)
	await userEvent.click(say)
	await expect.poll(() => root.querySelector(".wovel-end") !== null).toBe(true)
	await userEvent.click(button("Restart"))
	await shows("第一句。")
	await expect.poll(hidden).toBeGreaterThan(0)
})

test("the stage shows the background, sprites, and placeholders", async () => {
	const { root, find, shows } = await play(
		"---\nimages:\n  bg room: /room.png\n---\n# a\n\n::bg[room]\n\n::show[xue smile]{at=left}\n\n你好。\n",
	)
	await shows("你好。")
	const background = find("[data-layer=background] img")
	expect(background.getAttribute("src")).toBe("/room.png")
	const sprite = find(".wovel-sprite")
	// There is no image for xue, so a placeholder stands in.
	expect(sprite.classList.contains("wovel-placeholder")).toBe(true)
	expect(sprite.style.getPropertyValue("--x")).toBe("26%")
	expect(root.querySelectorAll(".wovel-sprite")).toHaveLength(1)
})

test("a step forward plays its transition; a rollback does not", async () => {
	const animate = vi.spyOn(Element.prototype, "animate")
	onTestFinished(() => animate.mockRestore())
	const { find, shows, button } = await play(
		"# a\n\n一。\n\n::show[xue]{transition=dissolve}\n\n二。\n",
	)
	await shows("一。")
	expect(animate).not.toHaveBeenCalled()
	await userEvent.click(find(".wovel-say"))
	await shows("二。")
	await expect.poll(() => animate.mock.calls.length).toBeGreaterThan(0)
	const calls = animate.mock.calls.length
	await userEvent.click(button("Back"))
	await shows("一。")
	expect(animate.mock.calls.length).toBe(calls)
})

test("music plays on its channel and stops when the game stops", async () => {
	const playing = vi.spyOn(HTMLMediaElement.prototype, "play")
	const pausing = vi.spyOn(HTMLMediaElement.prototype, "pause")
	onTestFinished(() => {
		playing.mockRestore()
		pausing.mockRestore()
	})
	const { game, shows } = await play("# a\n\n::music[rain]\n\n下雨了。\n")
	await shows("下雨了。")
	await expect.poll(() => playing.mock.calls.length).toBeGreaterThan(0)
	const audio = playing.mock.contexts[0] as HTMLAudioElement
	expect(audio.loop).toBe(true)
	expect(audio.src).toContain("rain")
	await game.stop()
	expect(pausing.mock.contexts).toContain(audio)
})

test("a script error shows its place, and the game keeps going", async () => {
	const { root, find, shows } = await play("# a\n\n一。\n\n{nope.x}\n")
	await shows("一。")
	await userEvent.click(find(".wovel-say"))
	await expect
		.poll(() => root.querySelector(".wovel-error:not([hidden])")?.textContent)
		.toMatch(/^test\.mdw:5\n/)
	// The game is still on its last good step.
	expect(find(".wovel-text").textContent).toBe("一。")
})

test("stop removes the game and shows no error", async () => {
	const { root, game, shows } = await play("# a\n\n一。\n")
	await shows("一。")
	await game.stop()
	expect(root.innerHTML).toBe("")
})

test("a story that is not valid shows its error, and replace rejects", async () => {
	const root = document.createElement("div")
	document.body.append(root)
	const game = start({ story: { not: "a story" }, root, saves: false })
	onTestFinished(async () => {
		await game.stop()
		root.remove()
	})
	await expect.poll(() => root.textContent).toContain("The story is not valid")
	await expect(game.replace(await compile("# a\n\n一。\n"))).rejects.toThrow()
})

test("replace uses the new story and keeps the place", async () => {
	const { find, game, shows } = await play("# a\n\n一。\n\n二。\n\n三。\n")
	await shows("一。")
	await userEvent.click(find(".wovel-say"))
	await shows("二。")
	await game.replace(await compile("# a\n\n一。\n\n二。\n\n改过的三。\n"))
	await userEvent.click(find(".wovel-say"))
	await shows("改过的三。")
})
