import { Schema } from "effect"

/** A problem in a script, with its place. Editors and the CLI show these. */
export const Diagnostic = Schema.Struct({
	file: Schema.String,
	line: Schema.Finite,
	column: Schema.Finite,
	severity: Schema.Literals(["error", "warning"]),
	/** A short name for the kind of problem, such as `unknown-scene`. */
	rule: Schema.String,
	message: Schema.String,
})
export type Diagnostic = typeof Diagnostic.Type

/** The scripts have errors, so there is no story. */
export class CompileError extends Schema.TaggedError<CompileError>()(
	"CompileError",
	{ diagnostics: Schema.Array(Diagnostic) },
) {
	override get message() {
		return this.diagnostics.map(format).join("\n")
	}
}

export const format = (diagnostic: Diagnostic): string =>
	`${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.message} (${diagnostic.rule})`
