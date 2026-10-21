import type { State } from "@wovel/core"
import { Option, Record } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import * as Dom from "../Dom.ts"
import { Action, Message, type Model } from "./Model.ts"
import {
	FadeOutSprite,
	FadeOverlay,
	ReadInput,
	ShowBackground,
	ShowSprite,
} from "./Mount.ts"
import { text } from "./Text.ts"

type H = HtmlBuilder<Message>

const button = (
	label: string | ReadonlyArray<Html>,
	action: Action,
	h: H,
	attributes: ReadonlyArray<Attribute<Message>> = [],
) =>
	h.button(
		[
			h.Type("button"),
			// The click is for the button. It does not also advance.
			h.OnClick(Message.Asked({ action }), { propagation: "Stop" }),
			...attributes,
		],
		typeof label === "string" ? [label] : label,
	)

/** An image, or a labeled box when the story has no image for the name. */
const picture = (
	model: Model,
	key: string,
	imageName: string,
	className: string,
	attributes: ReadonlyArray<Attribute<Message>>,
	h: H,
) =>
	Option.match(Dom.imageUrl(model.images, imageName), {
		onNone: () =>
			h.keyed("div")(
				key,
				[
					h.Class(`${className} wovel-placeholder`),
					h.DataAttribute("name", imageName),
					...attributes,
				],
				[imageName],
			),
		onSome: (src) =>
			h.keyed("img")(key, [
				h.Class(className),
				h.Src(src),
				h.Alt(imageName),
				h.Draggable(false),
				h.DataAttribute("name", imageName),
				...attributes,
			]),
	})

const backgroundLayer = (model: Model, h: H) =>
	h.div(
		[h.Class("wovel-layer"), h.DataAttribute("layer", "background")],
		[
			...Option.match(model.previousBackground, {
				onNone: () => [],
				onSome: (name) => [
					picture(model, `bg:${name}`, name, "wovel-background", [], h),
				],
			}),
			...Option.match(model.stage.background, {
				onNone: () => [],
				onSome: (name) => [
					picture(
						model,
						`bg:${name}`,
						name,
						"wovel-background",
						[h.OnMount(ShowBackground({ name, duration: model.dissolve }))],
						h,
					),
				],
			}),
		],
	)

const sprite = (
	model: Model,
	key: string,
	value: State.Sprite,
	mount: Attribute<Message>,
	h: H,
) =>
	picture(
		model,
		key,
		[value.tag, ...value.attributes].join(" "),
		"wovel-sprite",
		[
			h.DataAttribute("tag", value.tag),
			h.DataAttribute("position", value.position),
			h.Style({
				"--x": Option.getOrElse(
					Record.get(Dom.positions, value.position),
					() => value.position,
				),
			}),
			mount,
		],
		h,
	)

const masterLayer = (model: Model, h: H) =>
	h.div(
		[h.Class("wovel-layer"), h.DataAttribute("layer", "master")],
		[
			...model.stage.sprites.map((value) =>
				sprite(
					model,
					`sprite:${value.tag}`,
					value,
					h.OnMount(ShowSprite({ duration: model.dissolve })),
					h,
				),
			),
			...model.leaving.map(({ key, sprite: value }) =>
				sprite(
					model,
					`leaving:${key}`,
					value,
					h.OnMount(FadeOutSprite({ key, duration: model.dissolve })),
					h,
				),
			),
		],
	)

/**
 * The dialogue box. It stays in the DOM when no line shows, so screen readers
 * keep the live region and read each new line.
 */
const say = (
	line: Option.Option<State.Line>,
	shown: Option.Option<number>,
	h: H,
) =>
	h.div(
		[
			h.Class("wovel-say"),
			h.Hidden(Option.isNone(line)),
			...Option.match(
				Option.flatMap(line, (line) => line.color),
				{
					onNone: () => [],
					onSome: (color) => [h.Style({ "--wovel-name-color": color })],
				},
			),
		],
		[
			h.div(
				[h.Class("wovel-name")],
				[
					Option.getOrElse(
						Option.flatMap(line, (line) => line.name),
						() => "",
					),
				],
			),
			h.p(
				[h.Class("wovel-text"), h.AriaLive("polite")],
				Option.match(line, {
					onNone: () => [],
					onSome: (line) => text(line.text, shown, h),
				}),
			),
		],
	)

/** The line that the dialogue box shows. */
const line = (waiting: State.Waiting): Option.Option<State.Line> => {
	switch (waiting._tag) {
		case "Say":
			return Option.some(waiting.line)
		case "Menu":
			return waiting.prompt
		case "Pause":
		case "End":
			return Option.none()
	}
}

const waiting = (model: Model, h: H): ReadonlyArray<Html> => {
	switch (model.waiting._tag) {
		case "Say":
		case "Pause":
			return []
		case "Menu":
			return [
				h.div(
					[h.Class("wovel-menu"), h.Role("menu")],
					model.waiting.choices.map((choice) =>
						h.keyed("button")(
							`choice:${choice.index}`,
							[
								h.Type("button"),
								h.Role("menuitem"),
								h.OnClick(
									Message.Asked({
										action: Action.cases.Choose.make({ index: choice.index }),
									}),
									{ propagation: "Stop" },
								),
							],
							text(choice.text, Option.none(), h),
						),
					),
				),
			]
		case "End":
			return [
				h.div(
					[h.Class("wovel-end")],
					[
						h.div([], [model.labels.end]),
						button(model.labels.restart, Action.cases.Restart.make({}), h),
					],
				),
			]
	}
}

const history = (model: Model, lines: ReadonlyArray<State.Line>, h: H) =>
	h.section(
		[
			h.Class("wovel-panel"),
			h.Role("dialog"),
			// A click in the panel stays in the panel.
			h.OnClick(Message.ClickedPanel(), { propagation: "Stop" }),
		],
		[
			h.h2([], [model.labels.history]),
			...lines.map((line) =>
				h.p(
					[],
					[
						...Option.match(line.name, {
							onNone: () => [],
							onSome: (who) => [h.span([h.Class("wovel-who")], [who])],
						}),
						...text(line.text, Option.none(), h),
					],
				),
			),
			button(model.labels.close, Action.cases.Close.make({}), h),
		],
	)

const screens = (model: Model, h: H) =>
	h.div(
		[h.Class("wovel-layer"), h.DataAttribute("layer", "screens")],
		[
			// Only a Say line types. A menu shows its question at once.
			say(
				line(model.waiting),
				model.waiting._tag === "Say" ? model.typing : Option.none(),
				h,
			),
			...waiting(model, h),
			h.nav(
				[h.Class("wovel-quick")],
				[
					h.button(
						[
							h.Type("button"),
							h.Disabled(!model.canRollback),
							h.OnClick(
								Message.Asked({ action: Action.cases.Rollback.make({}) }),
								{ propagation: "Stop" },
							),
						],
						[model.labels.back],
					),
					button(model.labels.history, Action.cases.History.make({}), h),
					button(model.labels.save, Action.cases.Save.make({}), h),
					button(model.labels.load, Action.cases.Load.make({}), h),
				],
			),
			h.div(
				[
					h.Class("wovel-error"),
					h.Role("alert"),
					h.Hidden(Option.isNone(model.error)),
				],
				[Option.getOrElse(model.error, () => "")],
			),
			...Option.match(model.history, {
				onNone: () => [],
				onSome: (lines) => [history(model, lines, h)],
			}),
			...model.notices.map((notice) =>
				h.keyed("div")(
					`notice:${notice.id}`,
					[h.Class("wovel-notice"), h.Role("status")],
					[notice.text],
				),
			),
		],
	)

const overlay = (model: Model, h: H) =>
	Option.match(model.fade, {
		onNone: () => h.keyed("div")("overlay", [h.Class("wovel-overlay")]),
		// A new element for each phase, so its Mount runs the next animation.
		onSome: (fade) =>
			h.keyed("div")(`overlay:${fade.phase}`, [
				h.Class("wovel-overlay"),
				h.OnMount(FadeOverlay({ phase: fade.phase, duration: fade.duration })),
			]),
	})

/** The whole screen. Every part of it comes from the Model. */
// Foldkit calls the view with the Model and the builder. It has no pipeable form.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const view = (model: Model, h: H): Html =>
	h.div(
		[
			h.Id(model.id),
			h.Class("wovel"),
			h.Tabindex(0),
			...(model.hideInterface ? [h.DataAttribute("hide-ui", "")] : []),
			h.OnClick(Message.Asked({ action: Action.cases.Advance.make({}) })),
			h.OnMount(ReadInput()),
		],
		[
			h.div(
				[h.Class("wovel-stage")],
				[
					backgroundLayer(model, h),
					masterLayer(model, h),
					screens(model, h),
					overlay(model, h),
				],
			),
		],
	)
