import { defineConfig } from "tsdown"
import config from "../../tsdown.config.ts"

export default defineConfig({
	...config,
	platform: "node",
	entry: {
		index: "src/index.ts",
	},
	// The build rewrites `exports`, so the hand-written client types go in here.
	exports: {
		...config.exports,
		customExports: { "./client": { types: "./client.d.ts" } },
	},
})
