import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

// The tests run in headless Chromium, so they use the real DOM, Web
// Animations, media elements, and IndexedDB. devenv.nix gives the browser.
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			// A game screen is wide. The default viewport is a phone, too narrow to click in.
			viewport: { width: 1280, height: 720 },
			instances: [{ browser: "chromium" }],
		},
	},
})
