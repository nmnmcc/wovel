import type * as State from "./State.ts"

const rotate = (x: number, k: number) => (x << k) | (x >>> (32 - k))

/**
 * One step of xoshiro128**. It returns a number in [0, 1) and the next seed.
 * The seed is in the state, so a rollback gives the same numbers again.
 */
export const next = (
	seed: State.Seed,
): readonly [value: number, seed: State.Seed] => {
	let [a, b, c, d] = seed
	const result = Math.imul(rotate(Math.imul(b, 5), 7), 9) >>> 0
	const t = b << 9
	c ^= a
	d ^= b
	b ^= c
	a ^= d
	c ^= t
	d = rotate(d, 11)
	return [result / 4294967296, [a >>> 0, b >>> 0, c >>> 0, d >>> 0]]
}

/** Make a seed from one number with splitmix32. */
export const seed = (value: number): State.Seed => {
	let state = value >>> 0
	const step = () => {
		state = (state + 0x9e3779b9) >>> 0
		let z = state
		z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
		z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
		return (z ^ (z >>> 16)) >>> 0
	}
	return [step(), step(), step(), step()]
}
