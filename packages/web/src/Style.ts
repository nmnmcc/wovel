/**
 * The default look. Every color, size, and font is a CSS variable, so a game
 * can change the theme with a few lines of its own CSS.
 */
export const css = `
.wovel {
	--wovel-width: 1920;
	--wovel-height: 1080;
	--wovel-font: system-ui, "PingFang SC", "Noto Sans CJK SC", sans-serif;
	--wovel-text: #f4f1ec;
	--wovel-muted: #b8b2a8;
	--wovel-accent: #e0a96d;
	--wovel-box: rgb(16 14 20 / 0.82);
	--wovel-box-border: rgb(255 255 255 / 0.12);
	--wovel-button: rgb(30 27 36 / 0.9);
	--wovel-button-hover: rgb(60 52 70 / 0.95);
	--wovel-text-size: clamp(16px, 2.2vmin, 28px);
	--wovel-line-height: 1.75;
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	background: #000;
	color: var(--wovel-text);
	font-family: var(--wovel-font);
	user-select: none;
	-webkit-user-select: none;
	container-type: size;
}
.wovel-stage {
	position: absolute;
	inset: 0;
	margin: auto;
	aspect-ratio: var(--wovel-width) / var(--wovel-height);
	max-width: 100%;
	max-height: 100%;
	overflow: hidden;
	background: #111;
}
.wovel-layer { position: absolute; inset: 0; pointer-events: none; }
.wovel-layer[data-layer="screens"] { pointer-events: auto; }
.wovel-background {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.wovel-sprite {
	position: absolute;
	bottom: 0;
	left: var(--x, 50%);
	height: 92%;
	transform: translateX(-50%);
}
.wovel-placeholder {
	display: grid;
	place-items: center;
	color: var(--wovel-muted);
	font-size: 1.2em;
	background: repeating-linear-gradient(45deg, #222 0 12px, #2a2a2a 12px 24px);
	border: 1px dashed #555;
}
.wovel-sprite.wovel-placeholder { width: 24%; height: 70%; }
.wovel-say {
	position: absolute;
	left: 50%;
	bottom: 3%;
	transform: translateX(-50%);
	width: min(92%, 1400px);
	min-height: 22%;
	box-sizing: border-box;
	padding: 1.2em 1.6em 1.4em;
	border: 1px solid var(--wovel-box-border);
	border-radius: 12px;
	background: var(--wovel-box);
	backdrop-filter: blur(6px);
	font-size: var(--wovel-text-size);
	line-height: var(--wovel-line-height);
}
.wovel-name {
	min-height: 1.4em;
	margin-bottom: 0.3em;
	font-weight: 700;
	color: var(--wovel-name-color, var(--wovel-accent));
}
.wovel-text { margin: 0; white-space: pre-wrap; }
.wovel-text a { color: var(--wovel-accent); }
.wovel-text code { font-family: ui-monospace, monospace; }
.wovel-g[data-hidden] { visibility: hidden; }
.wovel-menu {
	position: absolute;
	inset: 0 0 30% 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.9em;
	font-size: var(--wovel-text-size);
}
.wovel-menu button,
.wovel-quick button,
.wovel-panel button,
.wovel-end button {
	font: inherit;
	color: var(--wovel-text);
	background: var(--wovel-button);
	border: 1px solid var(--wovel-box-border);
	border-radius: 10px;
	cursor: pointer;
}
.wovel-menu button { min-width: min(60%, 720px); padding: 0.7em 1.4em; }
.wovel-menu button:hover, .wovel-menu button:focus-visible,
.wovel-quick button:hover, .wovel-quick button:focus-visible,
.wovel-panel button:hover, .wovel-panel button:focus-visible,
.wovel-end button:hover, .wovel-end button:focus-visible {
	background: var(--wovel-button-hover);
	outline: 2px solid var(--wovel-accent);
	outline-offset: 2px;
}
.wovel-quick {
	position: absolute;
	right: 1.5%;
	top: 1.5%;
	display: flex;
	gap: 0.4em;
	font-size: clamp(12px, 1.5vmin, 18px);
	z-index: 2;
}
.wovel-quick button { padding: 0.3em 0.9em; }
.wovel-quick button:disabled { opacity: 0.4; cursor: default; }
.wovel-panel {
	position: absolute;
	inset: 6% 8%;
	overflow: auto;
	padding: 1.5em 2em;
	border-radius: 12px;
	background: rgb(10 9 12 / 0.94);
	font-size: var(--wovel-text-size);
	line-height: var(--wovel-line-height);
}
.wovel-panel h2 { margin-top: 0; }
.wovel-panel p { margin: 0 0 0.6em; }
.wovel-panel .wovel-who { color: var(--wovel-accent); margin-right: 0.6em; }
.wovel-end {
	position: absolute;
	inset: 0;
	display: grid;
	place-content: center;
	gap: 1em;
	text-align: center;
	font-size: calc(var(--wovel-text-size) * 1.6);
	background: rgb(0 0 0 / 0.6);
}
.wovel-end button { font-size: var(--wovel-text-size); padding: 0.5em 1.4em; }
.wovel-error {
	position: absolute;
	inset: auto 2% 2% 2%;
	padding: 1em 1.4em;
	border-radius: 10px;
	background: #5c1a1a;
	color: #fff;
	font: 14px/1.5 ui-monospace, monospace;
	white-space: pre-wrap;
	z-index: 10;
}
.wovel-notice {
	position: absolute;
	top: 8%;
	right: 1.5%;
	padding: 0.4em 1em;
	border-radius: 8px;
	background: var(--wovel-box);
	font-size: clamp(12px, 1.5vmin, 18px);
}
.wovel-overlay { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
.wovel[data-hide-ui] .wovel-layer[data-layer="screens"] > :not(.wovel-error) { visibility: hidden; }
@media (prefers-reduced-motion: reduce) {
	.wovel * { animation: none !important; transition: none !important; }
}
`
