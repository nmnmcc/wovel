/** Add `"types": ["@wovel/vite/client"]` to a game's tsconfig to type the story module. */
declare module "virtual:wovel/story" {
	/** The compiled story. Pass it to `start` from `@wovel/web`. */
	const story: unknown
	export default story
}
