// @effect-diagnostics strictEffectProvide:off -- each test is an entry point: it builds its own short-lived layers and runs once.
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { Plugin } from "@wovel/vite"
import { Effect } from "effect"

const roots: Array<string> = []
after(() =>
	Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
)

const project = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), "wovel-vite-"))
	roots.push(root)
	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(root, path, ".."), { recursive: true })
		await writeFile(join(root, path), content)
	}
	return root
}

const generate = (options: Plugin.Options & { readonly root: string }) =>
	Effect.provide(Plugin.generate(options), Plugin.layer)

test("asset names come from folders and file names", () => {
	assert.equal(Plugin.assetName("bg/room.webp"), "bg room")
	assert.equal(Plugin.assetName("xue/smile.png"), "xue smile")
	assert.equal(Plugin.assetName("rain.ogg"), "rain")
})

test("the story module imports each asset and starts with the index file", async () => {
	const root = await project({
		"story/b.mdw": "# later\n\nLater.\n",
		"story/index.mdw": "# first\n\n::bg[room]\n\nHello.\n\n[→](#later)\n",
		"story/notes.md": "# not a script\n",
		"images/bg/room.svg": "<svg/>",
		"audio/rain.ogg": "",
	})
	const built = await Effect.runPromise(generate({ root }))
	assert.match(built.code, /import asset0 from ".*images\/bg\/room\.svg\?url"/)
	assert.match(built.code, /"bg room": asset0/)
	assert.match(built.code, /"rain": asset1/)
	assert.match(built.code, /"start":"first"/)
	assert.equal(built.watch.length, 2)
	assert.deepEqual(
		built.warnings.map((w) => w.rule),
		[],
	)
})

test("a missing asset folder is empty", async () => {
	const root = await project({ "story/index.mdw": "# a\n\nHi.\n" })
	const built = await Effect.runPromise(generate({ root }))
	assert.match(built.code, /"start":"a"/)
})

test("a scripts path that is not a folder is a read error", async () => {
	const root = await project({ story: "not a folder" })
	const error = await Effect.runPromise(Effect.flip(generate({ root })))
	assert.equal(error._tag, "ReadError")
})
