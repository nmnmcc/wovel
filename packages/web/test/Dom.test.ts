import { Dom } from "@wovel/web"
import { Option } from "effect"
import { expect, test } from "vitest"

test("an image name falls back to shorter names", () => {
	const s = { "eileen happy": "/happy.png", eileen: "/eileen.png" }
	expect(Dom.imageUrl(s, "eileen happy")).toStrictEqual(
		Option.some("/happy.png"),
	)
	expect(Dom.imageUrl(s, "eileen sad")).toStrictEqual(
		Option.some("/eileen.png"),
	)
	expect(Dom.imageUrl(s, "lucy")).toStrictEqual(Option.none())
})

test("named positions map to CSS lengths", () => {
	expect(Dom.positions["left"]).toBe("26%")
	expect(Dom.positions["center"]).toBe("50%")
})
