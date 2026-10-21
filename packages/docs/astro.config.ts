import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"

export default defineConfig({
	// Set DOCS_URL to the public address of the docs site when you deploy it.
	site: process.env["DOCS_URL"] ?? "http://localhost:4321",
	integrations: [
		starlight({
			title: "Wovel",
			description: "用 Markdown 写剧本、跑在浏览器里的视觉小说引擎。",
			defaultLocale: "root",
			locales: { root: { label: "简体中文", lang: "zh-CN" } },
			sidebar: [
				{ label: "介绍", link: "/docs/" },
				{ label: "快速开始", link: "/docs/quickstart/" },
				{
					label: "写剧本",
					items: ["docs/script"],
				},
				{
					label: "开发",
					items: ["docs/architecture", "docs/packages", "docs/contributing"],
				},
				{
					label: "设计",
					items: ["docs/design", "docs/progress"],
				},
			],
		}),
	],
})
