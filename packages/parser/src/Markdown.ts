import type { Root } from "mdast"
import remarkDirective from "remark-directive"
import remarkFrontmatter from "remark-frontmatter"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"

// These plugins only add syntax, so parse() is enough and no transform runs.
const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkFrontmatter, ["yaml"])
	.use(remarkDirective)

/** Parse MDW source into an mdast tree: CommonMark, GFM, YAML frontmatter, and directives. */
export const parse = (source: string): Root => processor.parse(source)
