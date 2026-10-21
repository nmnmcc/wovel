import story from "virtual:wovel/story"
import { start } from "@wovel/web"

const root = document.getElementById("game")
if (root === null) throw new Error("The page has no #game element")

const game = start({
	story,
	root,
	saves: "starter",
	labels: {
		back: "回退",
		forward: "前进",
		save: "存档",
		load: "读档",
		history: "历史",
		restart: "重新开始",
		close: "关闭",
		end: "— 终 —",
		saved: "已存档",
		noSave: "还没有存档",
	},
})

// A script change replaces the story and keeps the player's place.
import.meta.hot?.accept("virtual:wovel/story", (module) => {
	if (module !== undefined)
		game.replace(module["default"]).catch((error: unknown) => {
			// A broken script keeps the old story running. Vite shows the compile error.
			console.error("Could not use the new story", error)
		})
})
