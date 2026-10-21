import { Crypto, Effect, Layer, PlatformError } from "effect"

/** The Web Crypto API that browsers and Node share, as the Effect `Crypto` service. */
export const make = Crypto.make({
	randomBytes: (size) => {
		// getRandomValues throws for more than 65536 bytes, so fill in parts.
		const bytes = new Uint8Array(size)
		for (let at = 0; at < size; at += 65536)
			globalThis.crypto.getRandomValues(bytes.subarray(at, at + 65536))
		return bytes
	},
	digest: (algorithm, data) =>
		Effect.tryPromise({
			// The copy is backed by a plain ArrayBuffer, which `subtle` requires.
			try: () =>
				globalThis.crypto.subtle.digest(algorithm, new Uint8Array(data)),
			catch: (cause) =>
				PlatformError.systemError({
					_tag: "Unknown",
					module: "WebCrypto",
					method: "digest",
					cause,
				}),
		}).pipe(Effect.map((buffer) => new Uint8Array(buffer))),
})

export const layer: Layer.Layer<Crypto.Crypto> = Layer.succeed(
	Crypto.Crypto,
	make,
)
