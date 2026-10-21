import { Array as EffectArray, Order, Record, Schema } from "effect"

/** The content hash of a statement. A save keeps it to find the statement again. */
export const Hash = Schema.String.pipe(Schema.brand("@wovel/core/ContentHash"))
export type Hash = typeof Hash.Type

const byKey = Order.mapInput(
	Order.String,
	([key]: readonly [string, unknown]) => key,
)

/** Write a JSON value with sorted object keys, so equal values give equal text. */
export const canonical = (value: Schema.Json): string => {
	if (value === null || typeof value !== "object") return JSON.stringify(value)
	if (EffectArray.isArray(value))
		return `[${(value as Schema.JsonArray).map(canonical).join(",")}]`
	const entries = EffectArray.sort(
		Record.toEntries(value as Schema.JsonObject),
		byKey,
	)
	return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(",")}}`
}

/**
 * A short, fast, synchronous hash (cyrb53) of a JSON value. Statements use it
 * to find their place after a script change. It is not a security hash.
 */
export const contentHash = (value: Schema.Json): Hash => {
	const text = canonical(value)
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i)
		h1 = Math.imul(h1 ^ code, 2654435761)
		h2 = Math.imul(h2 ^ code, 1597334677)
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return Hash.make((4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36))
}
