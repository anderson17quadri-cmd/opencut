import {
	AddClipEffectCommand,
	AddTrackCommand,
	DeleteElementsCommand,
	DuplicateElementsCommand,
	InsertElementCommand,
	RemoveClipEffectCommand,
	SplitElementsCommand,
	TracksSnapshotCommand,
	UpdateClipEffectParamsCommand,
	UpdateElementsCommand,
	UpsertKeyframeCommand,
} from "@/commands";
import { effectsRegistry, registerDefaultEffects } from "@/effects";
import { floatToFrameRate, frameRateToFloat } from "@/fps/utils";
import { loadFonts } from "@/fonts/google-fonts";
import { buildDefaultMaskInstance } from "@/masks";
import type { BuiltinMaskType } from "@/masks/types";
import { decodeAudioToFloat32 } from "@/media/audio";
import { extractTimelineAudio } from "@/media/mediabunny";
import type { AnimationPath } from "@/animation/types";
import type { ParamValue, ParamValues } from "@/params";
import { transcriptionService } from "@/services/transcription/service";
import { VideoCache } from "@/services/video-cache/service";
import { resolveStickerIntrinsicSize } from "@/stickers";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import type { SubtitleCue, SubtitleStyleOverrides } from "@/subtitles/types";
import type {
	CreateTimelineElement,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	VideoTrack,
} from "@/timeline";
import {
	buildGraphicElement,
	buildStickerElement,
} from "@/timeline/element-utils";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import { buildCaptionChunks } from "@/transcription/caption";
import { LANGUAGES } from "@/transcription/languages";
import type { TranscriptionSegment } from "@/transcription/types";
import { type MediaTime, mediaTimeToSeconds } from "@/wasm";
import {
	type Args,
	allTracks,
	asOneStep,
	describeElement,
	editor,
	findElement,
	fromSeconds,
	num,
	optNum,
	rememberChosenFormat,
	requireOpenProject,
	str,
	toSeconds,
	upsertKeyframes,
} from "./helpers";
import { renderMotionGraphicClip, runGraphicsTool } from "./graphics-tools";
import { HUMAN_TOOLS, runHumanTool } from "./human-tools";
import { type KaraokeStyle, groupWords, karaokeCode } from "./karaoke";
import { createHandLandmarker, videoFrames } from "./vision";
import {
	ANCHORS,
	type Anchor,
	baseBounds,
	describeLayout,
	getCanvasSize,
	positionElement,
	resizeElement,
} from "./layout";

// The "pro" half of the agent tools: layout, text styling, animation,
// captions, icons/shapes, effects, masks, project format, range cuts and
// silence removal, and rendering frames so Claude can look at the result.
// Multi-step edits run as one undo step (see asOneStep).

type ElementRef = { trackId: string; elementId: string };

// ---------------------------------------------------------------- utilities

const opt = <T>(args: Args, key: string, guard: (v: unknown) => v is T) =>
	guard(args[key]) ? (args[key] as T) : undefined;
const isString = (v: unknown): v is string => typeof v === "string" && v !== "";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function optAnchor(args: Args): Anchor | undefined {
	const value = args.anchor;
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string" && (ANCHORS as readonly string[]).includes(value)) {
		return value as Anchor;
	}
	throw new Error(`"anchor" must be one of: ${ANCHORS.join(", ")}`);
}

function hexColor(value: string): string {
	const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
	if (!match) throw new Error(`"${value}" is not a hex colour like #ffcc00`);
	const hex = match[1].length === 3
		? match[1].split("").map((c) => c + c).join("")
		: match[1];
	return `#${hex.toLowerCase()}`;
}

function tracks(): SceneTracks {
	return editor().scenes.getActiveScene().tracks;
}

function nextPaint(): Promise<void> {
	return new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);
}

/** Inserts an element and returns where it landed. */
function insertElement(
	element: CreateTimelineElement,
	placement: ConstructorParameters<typeof InsertElementCommand>[0]["placement"] = {
		mode: "auto",
	},
): ElementRef {
	const before = new Set(allTracks().flatMap((t) => t.elements.map((e) => e.id)));
	new InsertElementCommand({ element, placement }).execute();
	for (const track of allTracks()) {
		const inserted = track.elements.find((e) => !before.has(e.id));
		if (inserted) return { trackId: track.id, elementId: inserted.id };
	}
	throw new Error("The editor rejected the element (no room on the timeline).");
}

function replaceElement(ref: ElementRef, next: TimelineElement) {
	new UpdateElementsCommand({
		updates: [{ ...ref, patch: next as Partial<TimelineElement> }],
	}).execute();
}

function currentElement(ref: ElementRef): TimelineElement {
	return findElement(ref.elementId).element;
}

function describeFull(element: TimelineElement) {
	const layout =
		element.type === "audio" || element.type === "effect"
			? undefined
			: describeLayout(element);
	return {
		...describeElement(element),
		...(layout ? { layout } : {}),
		...("hidden" in element && element.hidden ? { hidden: true } : {}),
		...("effects" in element && element.effects?.length
			? {
					effects: element.effects.map((effect) => ({
						id: effect.id,
						type: effect.type,
						enabled: effect.enabled,
						params: effect.params,
					})),
				}
			: {}),
		...(element.type === "effect"
			? { effectType: element.effectType, params: element.params }
			: {}),
		...("masks" in element && element.masks?.length
			? { masks: element.masks.map((mask) => mask.type) }
			: {}),
		...(element.animations && Object.keys(element.animations).length
			? { animated: Object.keys(element.animations) }
			: {}),
	};
}

// ------------------------------------------------------------ view_frames

async function viewFrames(args: Args) {
	requireOpenProject();
	const e = editor();
	const requested = Array.isArray(args.times)
		? args.times.map((t) => Number(t)).filter((t) => Number.isFinite(t))
		: [optNum(args, "time") ?? toSeconds(e.playback.getCurrentTime())];
	if (requested.length === 0) throw new Error('"times" must list seconds');
	if (requested.length > 8) throw new Error("At most 8 frames per call.");
	const maxWidth = Math.min(Math.max(optNum(args, "width") ?? 768, 160), 1280);

	// Let the preview rebuild its render tree after any edit just made.
	await nextPaint();

	const frames = [];
	for (const seconds of requested) {
		// A fresh cache per frame: each frame is decoded by seeking straight
		// to its time instead of reusing whatever frame a cache holds.
		const videoCache = new VideoCache();
		try {
			const { canvas, time } = await e.renderer.renderFrameToCanvas({
				time: fromSeconds(Math.max(0, seconds)),
				videoCache,
			});
			const scale = Math.min(1, maxWidth / canvas.width);
			const out = document.createElement("canvas");
			out.width = Math.round(canvas.width * scale);
			out.height = Math.round(canvas.height * scale);
			out.getContext("2d")?.drawImage(canvas, 0, 0, out.width, out.height);
			frames.push({
				time: toSeconds(time),
				image: out.toDataURL("image/jpeg", 0.82).split(",")[1],
			});
		} finally {
			videoCache.clearAll();
		}
	}
	return { frames };
}

// ----------------------------------------------------- set_clip_properties

const TEXT_TYPES = new Set(["text"]);
const VISUAL_TYPES = new Set(["video", "image", "text", "sticker", "graphic"]);
const AUDIO_TYPES = new Set(["video", "audio"]);
const BLEND_MODES = new Set([
	"normal", "darken", "multiply", "color-burn", "lighten", "screen",
	"plus-lighter", "color-dodge", "overlay", "soft-light", "hard-light",
	"difference", "exclusion", "hue", "saturation", "color", "luminosity",
]);

function buildParamPatch(args: Args, element: TimelineElement) {
	const patch: ParamValues = {};
	const ignored: string[] = [];
	const set = (applies: boolean, argKey: string, key: string, value: ParamValue) => {
		if (applies) patch[key] = value;
		else ignored.push(argKey);
	};
	const isText = TEXT_TYPES.has(element.type);
	const isVisual = VISUAL_TYPES.has(element.type);
	const isGraphic = element.type === "graphic";
	const hasAudio = AUDIO_TYPES.has(element.type);

	const text = opt(args, "text", isString);
	if (text !== undefined) set(isText, "text", "content", text);
	const fontFamily = opt(args, "fontFamily", isString);
	if (fontFamily !== undefined) set(isText, "fontFamily", "fontFamily", fontFamily);
	const fontSize = optNum(args, "fontSize");
	if (fontSize !== undefined) set(isText, "fontSize", "fontSize", fontSize);
	const color = opt(args, "color", isString);
	if (color !== undefined) set(isText, "color", "color", hexColor(color));
	const bold = opt(args, "bold", isBool);
	if (bold !== undefined) set(isText, "bold", "fontWeight", bold ? "bold" : "normal");
	const italic = opt(args, "italic", isBool);
	if (italic !== undefined) set(isText, "italic", "fontStyle", italic ? "italic" : "normal");
	const underline = opt(args, "underline", isBool);
	if (underline !== undefined)
		set(isText, "underline", "textDecoration", underline ? "underline" : "none");
	const align = opt(args, "align", isString);
	if (align !== undefined) {
		if (!["left", "center", "right"].includes(align))
			throw new Error('"align" must be left, center or right');
		set(isText, "align", "textAlign", align);
	}
	const letterSpacing = optNum(args, "letterSpacing");
	if (letterSpacing !== undefined) set(isText, "letterSpacing", "letterSpacing", letterSpacing);
	const lineHeight = optNum(args, "lineHeight");
	if (lineHeight !== undefined) set(isText, "lineHeight", "lineHeight", lineHeight);
	const background = opt(args, "background", isString);
	if (background !== undefined) {
		if (background === "none") set(isText, "background", "background.enabled", false);
		else {
			set(isText, "background", "background.enabled", true);
			set(isText, "background", "background.color", hexColor(background));
		}
	}
	const backgroundRadius = optNum(args, "backgroundRadius");
	if (backgroundRadius !== undefined)
		set(isText, "backgroundRadius", "background.cornerRadius", backgroundRadius);
	const backgroundPadding = optNum(args, "backgroundPadding");
	if (backgroundPadding !== undefined) {
		set(isText, "backgroundPadding", "background.paddingX", backgroundPadding);
		set(isText, "backgroundPadding", "background.paddingY", backgroundPadding);
	}

	const fill = opt(args, "fill", isString);
	if (fill !== undefined) set(isGraphic, "fill", "fill", hexColor(fill));
	const stroke = opt(args, "stroke", isString);
	if (stroke !== undefined) set(isGraphic, "stroke", "stroke", hexColor(stroke));
	const strokeWidth = optNum(args, "strokeWidth");
	if (strokeWidth !== undefined) set(isGraphic, "strokeWidth", "strokeWidth", strokeWidth);
	const cornerRadius = optNum(args, "cornerRadius");
	if (cornerRadius !== undefined) set(isGraphic, "cornerRadius", "cornerRadius", cornerRadius);

	const rotation = optNum(args, "rotation");
	if (rotation !== undefined) set(isVisual, "rotation", "transform.rotate", rotation);
	const opacity = optNum(args, "opacity");
	if (opacity !== undefined)
		set(isVisual, "opacity", "opacity", Math.min(Math.max(opacity, 0), 100) / 100);
	const blendMode = opt(args, "blendMode", isString);
	if (blendMode !== undefined) {
		if (!BLEND_MODES.has(blendMode)) throw new Error(`Unknown blendMode ${blendMode}`);
		set(isVisual, "blendMode", "blendMode", blendMode);
	}

	const volumeDb = optNum(args, "volumeDb");
	if (volumeDb !== undefined) set(hasAudio, "volumeDb", "volume", volumeDb);
	const muted = opt(args, "muted", isBool);
	if (muted !== undefined) set(hasAudio, "muted", "muted", muted);

	return { patch, ignored, fontFamily: isText ? fontFamily : undefined };
}

function targetRefs(args: Args): ElementRef[] {
	const ids = Array.isArray(args.clipIds) ? args.clipIds.map(String) : [];
	if (typeof args.clipId === "string") ids.push(args.clipId);
	const refs = ids.map((id) => {
		const { track, element } = findElement(id);
		return { trackId: track.id, elementId: element.id };
	});
	if (typeof args.trackId === "string" && args.trackId) {
		const track = allTracks().find((t) => t.id === args.trackId);
		if (!track) throw new Error(`No track with id ${args.trackId}`);
		refs.push(...track.elements.map((e) => ({ trackId: track.id, elementId: e.id })));
	}
	if (refs.length === 0) throw new Error('Give "clipIds" (or "clipId") and/or "trackId".');
	return refs;
}

async function setClipProperties(args: Args) {
	requireOpenProject();
	const refs = targetRefs(args);
	const anchor = optAnchor(args);
	const layoutArgs = {
		anchor,
		margin: optNum(args, "margin"),
		x: optNum(args, "x"),
		y: optNum(args, "y"),
		widthPercent: optNum(args, "widthPercent"),
		heightPercent: optNum(args, "heightPercent"),
		scale: optNum(args, "scale"),
	};
	const hidden = opt(args, "hidden", isBool);

	// Fonts must be loaded before text is measured for layout.
	const fontFamily = opt(args, "fontFamily", isString);
	if (fontFamily) await loadFonts({ families: [fontFamily] });

	const ignored = new Set<string>();
	const results = await asOneStep(() =>
		refs.map((ref) => {
			let element = currentElement(ref);
			const built = buildParamPatch(args, element);
			for (const key of built.ignored) ignored.add(`${key} (${element.type})`);
			element = {
				...element,
				params: { ...element.params, ...built.patch },
			} as TimelineElement;

			if (VISUAL_TYPES.has(element.type)) {
				element = resizeElement({ element, ...layoutArgs });
				element = positionElement({ element, ...layoutArgs });
			}
			if (hidden !== undefined) {
				if ("hidden" in element || VISUAL_TYPES.has(element.type)) {
					element = { ...element, hidden } as TimelineElement;
				} else ignored.add(`hidden (${element.type})`);
			}
			replaceElement(ref, element);
			return describeFull(currentElement(ref));
		}),
	);

	return {
		clips: results,
		...(ignored.size ? { ignored: [...ignored] } : {}),
	};
}

// ----------------------------------------------------------------- animate

type KeySpec = { path: string; time: number; value: number };

const ANIMATION_PRESETS = [
	"fade_in", "fade_out", "zoom_in", "zoom_out",
	"slide_in_left", "slide_in_right", "slide_in_top", "slide_in_bottom",
	"slide_out_left", "slide_out_right", "slide_out_top", "slide_out_bottom",
	"pop_in", "pop_out", "spin", "pulse", "shake",
] as const;

function numberParam(element: TimelineElement, key: string, fallback: number) {
	const value = element.params[key];
	return typeof value === "number" ? value : fallback;
}

function presetKeys({
	preset,
	element,
	seconds,
	intensity,
}: {
	preset: string;
	element: TimelineElement;
	seconds?: number;
	intensity?: number;
}): { keys: KeySpec[]; smooth: boolean } {
	const clip = toSeconds(element.duration);
	const d = Math.min(seconds ?? 0.5, clip / 2);
	const end = clip;
	const { width, height } = getCanvasSize();
	const sx = numberParam(element, "transform.scaleX", 1);
	const sy = numberParam(element, "transform.scaleY", 1);
	const px = numberParam(element, "transform.positionX", 0);
	const py = numberParam(element, "transform.positionY", 0);
	const rot = numberParam(element, "transform.rotate", 0);
	const opacity = numberParam(element, "opacity", 1);
	const volume = numberParam(element, "volume", 0);
	const visual = VISUAL_TYPES.has(element.type);
	const audible = AUDIO_TYPES.has(element.type);
	const scaleKeys = (time: number, factor: number): KeySpec[] => [
		{ path: "transform.scaleX", time, value: sx * factor },
		{ path: "transform.scaleY", time, value: sy * factor },
	];
	const zoom = intensity ?? 1.2;

	switch (preset) {
		case "fade_in":
			return {
				smooth: false,
				keys: [
					...(visual
						? [
								{ path: "opacity", time: 0, value: 0 },
								{ path: "opacity", time: d, value: opacity },
							]
						: []),
					...(audible
						? [
								{ path: "volume", time: 0, value: -60 },
								{ path: "volume", time: d, value: volume },
							]
						: []),
				],
			};
		case "fade_out":
			return {
				smooth: false,
				keys: [
					...(visual
						? [
								{ path: "opacity", time: end - d, value: opacity },
								{ path: "opacity", time: end, value: 0 },
							]
						: []),
					...(audible
						? [
								{ path: "volume", time: end - d, value: volume },
								{ path: "volume", time: end, value: -60 },
							]
						: []),
				],
			};
		case "zoom_in":
			return { smooth: false, keys: [...scaleKeys(0, 1), ...scaleKeys(end, zoom)] };
		case "zoom_out":
			return { smooth: false, keys: [...scaleKeys(0, zoom), ...scaleKeys(end, 1)] };
		case "slide_in_left":
		case "slide_in_right":
		case "slide_in_top":
		case "slide_in_bottom":
		case "slide_out_left":
		case "slide_out_right":
		case "slide_out_top":
		case "slide_out_bottom": {
			const incoming = preset.startsWith("slide_in");
			const side = preset.split("_").pop();
			const horizontal = side === "left" || side === "right";
			const path = horizontal ? "transform.positionX" : "transform.positionY";
			const base = horizontal ? px : py;
			const distance = (horizontal ? width : height) * (side === "left" || side === "top" ? -1 : 1);
			return {
				smooth: true,
				keys: incoming
					? [
							{ path, time: 0, value: base + distance },
							{ path, time: d, value: base },
						]
					: [
							{ path, time: end - d, value: base },
							{ path, time: end, value: base + distance },
						],
			};
		}
		case "pop_in":
			return {
				smooth: true,
				keys: [
					...scaleKeys(0, 0.05),
					...scaleKeys(d * 0.7, 1.12),
					...scaleKeys(d, 1),
					{ path: "opacity", time: 0, value: 0 },
					{ path: "opacity", time: d * 0.4, value: opacity },
				],
			};
		case "pop_out":
			return {
				smooth: true,
				keys: [
					...scaleKeys(end - d, 1),
					...scaleKeys(end - d * 0.7, 1.12),
					...scaleKeys(end, 0.05),
					{ path: "opacity", time: end - d * 0.4, value: opacity },
					{ path: "opacity", time: end, value: 0 },
				],
			};
		case "spin":
			return {
				smooth: false,
				keys: [
					{ path: "transform.rotate", time: 0, value: rot },
					{ path: "transform.rotate", time: end, value: rot + 360 * (intensity ?? 1) },
				],
			};
		case "pulse": {
			const period = seconds ?? 0.6;
			const keys: KeySpec[] = [];
			for (let t = 0, i = 0; t <= end && i < 80; t += period / 2, i++) {
				keys.push(...scaleKeys(Math.min(t, end), i % 2 === 0 ? 1 : (intensity ?? 1.08)));
			}
			return { smooth: true, keys };
		}
		case "shake": {
			const length = Math.min(seconds ?? 0.4, clip);
			const amplitude = (Math.min(width, height) * (intensity ?? 1.5)) / 100;
			const keys: KeySpec[] = [];
			const step = 0.05;
			for (let t = 0, i = 0; t < length; t += step, i++) {
				const offset = i % 2 === 0 ? amplitude : -amplitude;
				keys.push({ path: "transform.positionX", time: t, value: px + offset * (1 - t / length) });
			}
			keys.push({ path: "transform.positionX", time: length, value: px });
			return { smooth: false, keys };
		}
		default:
			throw new Error(`Unknown preset "${preset}". Use one of: ${ANIMATION_PRESETS.join(", ")}`);
	}
}

const CUSTOM_PROPERTIES = ["opacity", "scale", "x", "y", "rotation", "volume"] as const;

function customKeys(element: TimelineElement, raw: unknown): KeySpec[] {
	if (!Array.isArray(raw) || raw.length === 0)
		throw new Error('"keyframes" must be a non-empty list');
	const bounds = baseBounds(element);
	const { width, height } = getCanvasSize();
	const sx = numberParam(element, "transform.scaleX", 1);
	const sy = numberParam(element, "transform.scaleY", 1);
	const px = numberParam(element, "transform.positionX", 0);
	const py = numberParam(element, "transform.positionY", 0);
	const clip = toSeconds(element.duration);

	return raw.flatMap((entry): KeySpec[] => {
		const k = entry as Args;
		const property = str(k, "property");
		const time = Math.min(Math.max(num(k, "time"), 0), clip);
		const value = num(k, "value");
		switch (property) {
			case "opacity":
				return [{ path: "opacity", time, value: Math.min(Math.max(value, 0), 100) / 100 }];
			case "scale":
				return [
					{ path: "transform.scaleX", time, value: sx * value },
					{ path: "transform.scaleY", time, value: sy * value },
				];
			case "x":
				return [{ path: "transform.positionX", time, value: px + ((value / 100) * width - (bounds?.cx ?? width / 2)) }];
			case "y":
				return [{ path: "transform.positionY", time, value: py + ((value / 100) * height - (bounds?.cy ?? height / 2)) }];
			case "rotation":
				return [{ path: "transform.rotate", time, value }];
			case "volume":
				return [{ path: "volume", time, value }];
			default:
				throw new Error(`Unknown property "${property}". Use: ${CUSTOM_PROPERTIES.join(", ")}`);
		}
	});
}

async function animate(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	const preset = opt(args, "preset", isString);
	const easing = opt(args, "easing", isString);

	const { keys, smooth } = preset
		? presetKeys({
				preset,
				element,
				seconds: optNum(args, "duration"),
				intensity: optNum(args, "intensity"),
			})
		: { keys: customKeys(element, args.keyframes), smooth: false };
	if (keys.length === 0) {
		throw new Error(`"${preset}" does nothing on a ${element.type} clip.`);
	}
	const interpolation =
		easing === "linear" ? "linear" : easing === "smooth" || smooth ? "bezier" : "linear";

	await asOneStep(() => {
		upsertKeyframes({
			trackId: track.id,
			elementId: element.id,
			keys: keys.map((key) => ({ path: key.path as AnimationPath, time: key.time, value: key.value, interpolation })),
		});
	});
	return describeFull(findElement(element.id).element);
}

const PROPERTY_PATHS: Record<string, string[]> = {
	opacity: ["opacity"],
	scale: ["transform.scaleX", "transform.scaleY"],
	x: ["transform.positionX"],
	y: ["transform.positionY"],
	position: ["transform.positionX", "transform.positionY"],
	rotation: ["transform.rotate"],
	volume: ["volume"],
};

async function removeAnimations(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	const property = opt(args, "property", isString);
	let animations = element.animations;
	if (property) {
		const paths = PROPERTY_PATHS[property];
		if (!paths) throw new Error(`Unknown property. Use: ${Object.keys(PROPERTY_PATHS).join(", ")}`);
		animations = { ...(animations ?? {}) };
		for (const path of paths) delete animations[path];
		if (Object.keys(animations).length === 0) animations = undefined;
	} else {
		animations = undefined;
	}
	editor().timeline.updateElements({
		updates: [{ trackId: track.id, elementId: element.id, patch: { animations } }],
	});
	return describeFull(findElement(element.id).element);
}

// ------------------------------------------------------ captions & speech

function languageArg(args: Args) {
	const language = opt(args, "language", isString);
	if (!language || language === "auto") return undefined;
	const known = LANGUAGES.find((l) => l.code === language);
	if (!known) {
		throw new Error(
			`Unsupported language "${language}". Use one of: ${LANGUAGES.map((l) => l.code).join(", ")}, or omit for auto.`,
		);
	}
	return known.code;
}

async function transcribeTimeline(
	args: Args,
	{ words = false }: { words?: boolean } = {},
): Promise<TranscriptionSegment[]> {
	requireOpenProject();
	const e = editor();
	const duration = e.timeline.getTotalDuration();
	if (duration === 0) throw new Error("The timeline is empty.");
	const audioBlob = await extractTimelineAudio({
		tracks: tracks(),
		mediaAssets: e.media.getAssets(),
		totalDuration: duration,
	});
	const { samples } = await decodeAudioToFloat32({
		audioBlob,
		sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
	});
	const result = await transcriptionService.transcribe({
		audioData: samples,
		language: languageArg(args),
		wordTimestamps: words,
	});
	return result.segments;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

async function transcribe(args: Args) {
	const words = args.words === true;
	const segments = await transcribeTimeline(args, { words });
	const items = segments
		.map((s) => ({ start: round2(s.start), end: round2(s.end), text: s.text.trim() }))
		.filter((s) => s.text);
	return words ? { words: items } : { segments: items };
}

function captionStyle(args: Args): SubtitleStyleOverrides {
	const style: SubtitleStyleOverrides = {};
	const fontFamily = opt(args, "fontFamily", isString);
	if (fontFamily) style.fontFamily = fontFamily;
	const fontSize = optNum(args, "fontSize");
	if (fontSize !== undefined) style.fontSize = fontSize;
	const color = opt(args, "color", isString);
	if (color) style.color = hexColor(color);
	if (opt(args, "bold", isBool)) style.fontWeight = "bold";
	const background = opt(args, "background", isString);
	if (background && background !== "none") {
		style.background = { enabled: true, color: hexColor(background) };
	} else if (background === "none") {
		style.background = { enabled: false, color: "#000000" };
	}
	const position = opt(args, "position", isString);
	if (position) {
		if (!["top", "middle", "bottom"].includes(position))
			throw new Error('"position" must be top, middle or bottom');
		style.placement = { verticalAlign: position as "top" | "middle" | "bottom" };
	}
	return style;
}

async function insertCaptions(args: Args, cues: SubtitleCue[]) {
	if (cues.length === 0) throw new Error("No speech was found to caption.");
	const fontFamily = opt(args, "fontFamily", isString);
	if (fontFamily) await loadFonts({ families: [fontFamily] });
	const uppercase = opt(args, "uppercase", isBool) ?? false;
	const style = captionStyle(args);
	const trackId = insertCaptionChunksAsTextTrack({
		editor: editor(),
		captions: cues.map((cue) => ({
			...cue,
			text: uppercase ? cue.text.toLocaleUpperCase() : cue.text,
			style,
		})),
	});
	if (!trackId) throw new Error("The captions could not be added.");
	const track = allTracks().find((t) => t.id === trackId);
	return {
		trackId,
		captions: (track?.elements ?? []).map((element) => ({
			id: element.id,
			start: toSeconds(element.startTime),
			end: toSeconds((element.startTime + element.duration) as MediaTime),
			text: element.type === "text" ? element.params.content : "",
		})),
	};
}

async function generateCaptions(args: Args) {
	if (args.style === "karaoke") return generateKaraokeCaptions(args);
	const segments = await transcribeTimeline(args);
	const wordsPerCaption = optNum(args, "wordsPerCaption");
	const chunks = buildCaptionChunks({
		segments,
		...(wordsPerCaption !== undefined ? { wordsPerChunk: Math.max(1, Math.round(wordsPerCaption)) } : {}),
	});
	return insertCaptions(args, chunks);
}

/**
 * Word-by-word animated captions: transcribe with word timing, then render
 * the phrases as one transparent motion-graphic clip where the spoken
 * word lights up.
 */
async function generateKaraokeCaptions(args: Args) {
	const project = requireOpenProject();
	const words = (await transcribeTimeline(args, { words: true }))
		.map((w) => ({ text: w.text.trim(), start: w.start, end: Math.max(w.end, w.start + 0.05) }))
		.filter((w) => w.text);
	if (words.length === 0) throw new Error("No speech was found to caption.");

	const { width, height } = project.settings.canvasSize;
	const groups = groupWords({
		words,
		wordsPerCaption: Math.max(1, Math.round(optNum(args, "wordsPerCaption") ?? 3)),
	});
	const position = opt(args, "position", isString) ?? "bottom";
	const background = opt(args, "background", isString);
	const fontFamily = opt(args, "fontFamily", isString) ?? "Montserrat";
	const start = Math.max(0, groups[0].start - 0.05);
	const end = groups[groups.length - 1].end;
	const style: KaraokeStyle = {
		fontFamily,
		fontWeight: opt(args, "bold", isBool) === false ? 600 : 900,
		fontSize: ((optNum(args, "fontSize") ?? 6) * height) / 90,
		color: hexColor(opt(args, "color", isString) ?? "#ffffff"),
		highlightColor: hexColor(opt(args, "highlightColor", isString) ?? "#ffd400"),
		upcomingOpacity: 0.55,
		boxColor: background && background !== "none" ? hexColor(background) : null,
		y: position === "top" ? 0.2 : position === "middle" ? 0.5 : 0.78,
		uppercase: opt(args, "uppercase", isBool) ?? true,
		maxWidth: 0.86,
	};
	const clip = await renderMotionGraphicClip({
		spec: {
			code: karaokeCode({ groups, style, offset: start }),
			mode: "2d",
			width,
			height,
			fps: Math.min(Math.round(frameRateToFloat(project.settings.fps)), 30),
			duration: Math.max(0.1, end - start),
			fonts: [fontFamily],
		},
		name: "Legendas karaokê",
		start,
	});
	return {
		...clip,
		style: "karaoke",
		captions: groups.map((g) => ({
			start: round2(g.start),
			end: round2(g.end),
			text: g.words.map((w) => w.text).join(" "),
		})),
		note: "The captions are one rendered clip. To fix a word, delete it and use add_captions or regenerate.",
	};
}

async function addCaptions(args: Args) {
	requireOpenProject();
	if (!Array.isArray(args.captions)) throw new Error('"captions" must be a list');
	const cues: SubtitleCue[] = args.captions.map((raw) => {
		const cue = raw as Args;
		const start = num(cue, "start");
		const end = num(cue, "end");
		if (end <= start) throw new Error(`Caption "${cue.text}" ends before it starts.`);
		return { text: str(cue, "text"), startTime: start, duration: end - start };
	});
	return insertCaptions(args, cues);
}

// ------------------------------------------------------------ icons/shapes

async function searchIcons(args: Args) {
	const query = str(args, "query");
	const limit = Math.min(Math.max(optNum(args, "limit") ?? 24, 1), 64);
	const style = opt(args, "style", isString) ?? "any";
	const response = await fetch(
		`/api/icons/search?q=${encodeURIComponent(query)}&limit=${limit}&style=${encodeURIComponent(style)}`,
	);
	if (!response.ok) {
		throw new Error("Icon search is unavailable (no internet connection?).");
	}
	return (await response.json()) as { icons: string[] };
}

function placementArgs(args: Args, defaults: { widthPercent?: number }) {
	return {
		anchor: optAnchor(args) ?? (optNum(args, "x") === undefined && optNum(args, "y") === undefined ? "center" : undefined),
		margin: optNum(args, "margin"),
		x: optNum(args, "x"),
		y: optNum(args, "y"),
		widthPercent: optNum(args, "widthPercent") ?? (optNum(args, "heightPercent") === undefined ? defaults.widthPercent : undefined),
		heightPercent: optNum(args, "heightPercent"),
	};
}

function timing(args: Args) {
	const start = optNum(args, "start") ?? toSeconds(editor().playback.getCurrentTime());
	const duration = optNum(args, "duration") ?? 3;
	if (duration <= 0) throw new Error('"duration" must be positive');
	return { startTime: fromSeconds(Math.max(0, start)), duration: fromSeconds(duration) };
}

async function placeNew(element: CreateTimelineElement, layout: ReturnType<typeof placementArgs>, patch?: ParamValues) {
	return asOneStep(() => {
		const ref = insertElement(element);
		let next = currentElement(ref);
		if (patch) next = { ...next, params: { ...next.params, ...patch } } as TimelineElement;
		next = resizeElement({ element: next, ...layout });
		next = positionElement({ element: next, ...layout });
		replaceElement(ref, next);
		return { trackId: ref.trackId, clip: describeFull(currentElement(ref)) };
	});
}

async function addIcon(args: Args) {
	requireOpenProject();
	const iconId = str(args, "iconId").trim().toLowerCase();
	if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(iconId)) {
		throw new Error('"iconId" must look like "mdi:heart" (from search_icons).');
	}
	const color = opt(args, "color", isString);
	const stickerId = `icons:${iconId}${color ? `~${hexColor(color).slice(1)}` : ""}`;
	const { width, height } = await resolveStickerIntrinsicSize({ stickerId });
	const { startTime, duration } = timing(args);
	const element = {
		...buildStickerElement({
			stickerId,
			name: iconId.split(":")[1].replaceAll("-", " "),
			startTime,
			intrinsicWidth: width,
			intrinsicHeight: height,
		}),
		duration,
	};
	return placeNew(element, placementArgs(args, { widthPercent: 15 }));
}

const SHAPES: Record<string, { definitionId: string; params?: ParamValues }> = {
	rectangle: { definitionId: "rectangle" },
	square: { definitionId: "rectangle" },
	circle: { definitionId: "ellipse" },
	ellipse: { definitionId: "ellipse" },
	triangle: { definitionId: "polygon", params: { sides: 3 } },
	diamond: { definitionId: "polygon", params: { sides: 4 } },
	pentagon: { definitionId: "polygon", params: { sides: 5 } },
	hexagon: { definitionId: "polygon", params: { sides: 6 } },
	star: { definitionId: "star" },
};

async function addShape(args: Args) {
	requireOpenProject();
	const shape = str(args, "shape");
	const spec = SHAPES[shape];
	if (!spec) throw new Error(`Unknown shape. Use: ${Object.keys(SHAPES).join(", ")}`);
	const params: ParamValues = { ...(spec.params ?? {}) };
	const fill = opt(args, "fill", isString);
	if (fill) params.fill = hexColor(fill);
	const stroke = opt(args, "stroke", isString);
	if (stroke) params.stroke = hexColor(stroke);
	const strokeWidth = optNum(args, "strokeWidth");
	if (strokeWidth !== undefined) params.strokeWidth = strokeWidth;
	const cornerRadius = optNum(args, "cornerRadius");
	if (cornerRadius !== undefined) params.cornerRadius = cornerRadius;
	const opacity = optNum(args, "opacity");
	if (opacity !== undefined) params.opacity = Math.min(Math.max(opacity, 0), 100) / 100;

	const { startTime, duration } = timing(args);
	const element = {
		...buildGraphicElement({ definitionId: spec.definitionId, name: shape, startTime, params }),
		duration,
	};
	return placeNew(element, placementArgs(args, { widthPercent: 20 }));
}

// ----------------------------------------------------------------- effects

function ensureEffects() {
	registerDefaultEffects();
}

function listEffects() {
	ensureEffects();
	return {
		effects: effectsRegistry.getAll().map((definition) => ({
			type: definition.type,
			name: definition.name,
			params: definition.params.map((param) => ({
				key: param.key,
				label: param.label,
				type: param.type,
				default: param.default,
				...(param.type === "number" ? { min: param.min, max: param.max } : {}),
			})),
		})),
	};
}

function effectParams(args: Args, effectType: string): ParamValues {
	const raw = args.params;
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) throw new Error('"params" must be an object');
	const definition = effectsRegistry.get(effectType);
	const params: ParamValues = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const param = definition.params.find((p) => p.key === key);
		if (!param) {
			throw new Error(`"${effectType}" has no param "${key}". Params: ${definition.params.map((p) => p.key).join(", ")}`);
		}
		if (param.type === "number") {
			const n = Number(value);
			if (!Number.isFinite(n)) throw new Error(`"${key}" must be a number`);
			params[key] = Math.min(Math.max(n, param.min), param.max ?? n);
		} else if (param.type === "color") {
			params[key] = hexColor(String(value));
		} else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			params[key] = value;
		}
	}
	return params;
}

async function addEffect(args: Args) {
	requireOpenProject();
	ensureEffects();
	const effectType = str(args, "effect");
	if (!effectsRegistry.has(effectType)) {
		throw new Error(`Unknown effect "${effectType}". Call list_effects.`);
	}
	const params = effectParams(args, effectType);
	const clipId = opt(args, "clipId", isString);

	if (clipId) {
		const { track, element } = findElement(clipId);
		if (!VISUAL_TYPES.has(element.type)) {
			throw new Error("Effects apply to video, image, text, icon and shape clips.");
		}
		const effectId = await asOneStep(() => {
			const command = new AddClipEffectCommand({ trackId: track.id, elementId: element.id, effectType });
			command.execute();
			const id = command.getEffectId();
			if (!id) throw new Error("The effect could not be added.");
			if (Object.keys(params).length) {
				new UpdateClipEffectParamsCommand({ trackId: track.id, elementId: element.id, effectId: id, params }).execute();
			}
			return id;
		});
		return { effectId, clip: describeFull(findElement(element.id).element) };
	}

	// No clip: grade every video/image clip in the time range. (A scene-wide
	// adjustment layer would be the natural fit, but stacking full-frame
	// passes that way is heavy on the renderer, so effects stay per clip.)
	const e = editor();
	const start = optNum(args, "start") ?? 0;
	const total = toSeconds(e.timeline.getTotalDuration());
	const end = start + (optNum(args, "duration") ?? Math.max(total - start, 0));
	const targets = allTracks().flatMap((track) =>
		track.elements
			.filter(
				(element) =>
					(element.type === "video" || element.type === "image") &&
					toSeconds(element.startTime) < end &&
					toSeconds((element.startTime + element.duration) as MediaTime) > start,
			)
			.map((element) => ({ trackId: track.id, elementId: element.id })),
	);
	if (targets.length === 0) throw new Error("No video or image clips in that time range.");
	const applied = await asOneStep(() =>
		targets.map((target) => {
			const command = new AddClipEffectCommand({ ...target, effectType });
			command.execute();
			const effectId = command.getEffectId();
			if (effectId && Object.keys(params).length) {
				new UpdateClipEffectParamsCommand({ ...target, effectId, params }).execute();
			}
			return { clipId: target.elementId, effectId };
		}),
	);
	return { applied };
}

async function updateEffect(args: Args) {
	requireOpenProject();
	ensureEffects();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type === "effect") {
		const params = effectParams(args, element.effectType);
		editor().timeline.updateElements({
			updates: [{ trackId: track.id, elementId: element.id, patch: { params } }],
		});
		return describeFull(findElement(element.id).element);
	}
	const effects = "effects" in element ? (element.effects ?? []) : [];
	const effectId = opt(args, "effectId", isString) ?? (effects.length === 1 ? effects[0].id : undefined);
	const effect = effects.find((candidate) => candidate.id === effectId);
	if (!effect) throw new Error('Give "effectId" (see the clip\'s effects in get_state).');
	editor().timeline.updateClipEffectParams({
		trackId: track.id,
		elementId: element.id,
		effectId: effect.id,
		params: effectParams(args, effect.type),
	});
	return describeFull(findElement(element.id).element);
}

async function removeEffect(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type === "effect") {
		editor().timeline.deleteElements({ elements: [{ trackId: track.id, elementId: element.id }] });
		return { removed: element.id };
	}
	const effects = "effects" in element ? (element.effects ?? []) : [];
	const effectId = opt(args, "effectId", isString);
	const targets = effectId ? effects.filter((effect) => effect.id === effectId) : effects;
	if (targets.length === 0) throw new Error("That clip has no such effect.");
	await asOneStep(() => {
		for (const effect of targets) {
			new RemoveClipEffectCommand({ trackId: track.id, elementId: element.id, effectId: effect.id }).execute();
		}
	});
	return describeFull(findElement(element.id).element);
}

// ------------------------------------------------------------------- masks

const MASK_SHAPES: BuiltinMaskType[] = [
	"rectangle", "ellipse", "heart", "diamond", "star", "split", "cinematic-bars", "text",
];

async function addMask(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (!["video", "image", "graphic"].includes(element.type)) {
		throw new Error("Masks apply to video, image and shape clips.");
	}
	const shape = str(args, "shape") as BuiltinMaskType;
	if (!MASK_SHAPES.includes(shape)) throw new Error(`Unknown mask. Use: ${MASK_SHAPES.join(", ")}`);
	const bounds = baseBounds(element);
	const mask = buildDefaultMaskInstance({
		maskType: shape,
		elementSize: bounds ? { width: bounds.width, height: bounds.height } : undefined,
	});
	const inverted = opt(args, "inverted", isBool);
	const feather = optNum(args, "feather");
	const params = {
		...mask.params,
		...(inverted !== undefined ? { inverted } : {}),
		...(feather !== undefined ? { feather } : {}),
	};
	editor().timeline.updateElements({
		updates: [
			{
				trackId: track.id,
				elementId: element.id,
				patch: { masks: [{ ...mask, params } as typeof mask] } as Partial<TimelineElement>,
			},
		],
	});
	return describeFull(findElement(element.id).element);
}

async function removeMask(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	editor().timeline.updateElements({
		updates: [
			{ trackId: track.id, elementId: element.id, patch: { masks: [] } as Partial<TimelineElement> },
		],
	});
	return describeFull(findElement(element.id).element);
}

// ----------------------------------------------------------------- project

const ASPECT_SIZES: Record<string, { width: number; height: number }> = {
	"16:9": { width: 1920, height: 1080 },
	"9:16": { width: 1080, height: 1920 },
	"1:1": { width: 1080, height: 1080 },
	"4:5": { width: 1080, height: 1350 },
	"4:3": { width: 1440, height: 1080 },
	"21:9": { width: 2560, height: 1080 },
};

async function setProject(args: Args) {
	const project = requireOpenProject();
	const settings: Parameters<ReturnType<typeof editor>["project"]["updateSettings"]>[0]["settings"] = {};
	const aspect = opt(args, "aspectRatio", isString);
	if (aspect) {
		const size = ASPECT_SIZES[aspect];
		if (!size) throw new Error(`Use one of: ${Object.keys(ASPECT_SIZES).join(", ")}`);
		settings.canvasSize = size;
		settings.canvasSizeMode = "preset";
	}
	const width = optNum(args, "width");
	const height = optNum(args, "height");
	if (width !== undefined || height !== undefined) {
		settings.canvasSize = {
			width: Math.round(width ?? project.settings.canvasSize.width),
			height: Math.round(height ?? project.settings.canvasSize.height),
		};
		settings.canvasSizeMode = "custom";
		settings.lastCustomCanvasSize = settings.canvasSize;
	}
	const fps = optNum(args, "fps");
	if (fps !== undefined) settings.fps = floatToFrameRate(fps);
	const backgroundColor = opt(args, "backgroundColor", isString);
	const backgroundBlur = optNum(args, "backgroundBlur");
	if (backgroundColor) settings.background = { type: "color", color: hexColor(backgroundColor) };
	if (backgroundBlur !== undefined) settings.background = { type: "blur", blurIntensity: backgroundBlur };
	if (Object.keys(settings).length === 0) throw new Error("Nothing to change.");

	await editor().project.updateSettings({ settings });
	if (settings.canvasSize) rememberChosenFormat(project.metadata.id);
	const next = editor().project.getActive().settings;
	return {
		width: next.canvasSize.width,
		height: next.canvasSize.height,
		fps: frameRateToFloat(next.fps),
		background: next.background,
	};
}

// ------------------------------------------------------ clips and tracks

async function duplicateClip(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	const start = optNum(args, "start");
	return asOneStep(() => {
		const command = new DuplicateElementsCommand({ elements: [{ trackId: track.id, elementId: element.id }] });
		command.execute();
		const [copy] = command.getDuplicatedElements();
		if (!copy) throw new Error("Could not duplicate the clip.");
		if (start !== undefined) {
			const copied = currentElement(copy);
			replaceElement(copy, { ...copied, startTime: fromSeconds(start) } as TimelineElement);
		}
		return describeFull(currentElement(copy));
	});
}

async function trimClip(args: Args) {
	requireOpenProject();
	const { element } = findElement(str(args, "clipId"));
	const clipStart = toSeconds(element.startTime);
	const clipEnd = toSeconds((element.startTime + element.duration) as MediaTime);
	const newStart = optNum(args, "start");
	const newEnd = optNum(args, "end");
	if (newStart === undefined && newEnd === undefined) throw new Error('Give "start" and/or "end".');
	if ((newStart ?? clipStart) < clipStart - 0.001 || (newEnd ?? clipEnd) > clipEnd + 0.001) {
		throw new Error(`trim_clip only shortens: the clip spans ${clipStart}s–${clipEnd}s.`);
	}
	if ((newEnd ?? clipEnd) - (newStart ?? clipStart) <= 0.01) throw new Error("Nothing would be left.");

	return asOneStep(() => {
		let keepId = element.id;
		if (newStart !== undefined && newStart > clipStart + 0.001) {
			const trackId = findElement(keepId).track.id;
			const split = new SplitElementsCommand({ elements: [{ trackId, elementId: keepId }], splitTime: fromSeconds(newStart) });
			split.execute();
			const [right] = split.getRightSideElements();
			new DeleteElementsCommand({ elements: [{ trackId, elementId: keepId }] }).execute();
			if (!right) throw new Error("Could not trim the clip start.");
			keepId = right.elementId;
		}
		if (newEnd !== undefined && newEnd < clipEnd - 0.001) {
			const trackId = findElement(keepId).track.id;
			const split = new SplitElementsCommand({ elements: [{ trackId, elementId: keepId }], splitTime: fromSeconds(newEnd) });
			split.execute();
			const [right] = split.getRightSideElements();
			if (right) new DeleteElementsCommand({ elements: [right] }).execute();
		}
		return describeFull(findElement(keepId).element);
	});
}

async function setTrack(args: Args) {
	requireOpenProject();
	const trackId = str(args, "trackId");
	const track = allTracks().find((t) => t.id === trackId);
	if (!track) throw new Error(`No track with id ${trackId}`);
	const muted = opt(args, "muted", isBool);
	const hidden = opt(args, "hidden", isBool);
	if (muted !== undefined) {
		if (!("muted" in track)) throw new Error("That track has no sound.");
		if (track.muted !== muted) editor().timeline.toggleTrackMute({ trackId });
	}
	if (hidden !== undefined) {
		if (!("hidden" in track)) throw new Error("That track isn't visual.");
		if (track.hidden !== hidden) editor().timeline.toggleTrackVisibility({ trackId });
	}
	const next = allTracks().find((t) => t.id === trackId);
	return {
		id: trackId,
		...(next && "muted" in next ? { muted: next.muted } : {}),
		...(next && "hidden" in next ? { hidden: next.hidden } : {}),
	};
}

// ------------------------------------------------- range cuts & silences

function elementEnd(element: TimelineElement) {
	return element.startTime + element.duration;
}

/** Removes [start, end) from every track and pulls later clips left. */
function cutRangeInPlace(startSeconds: number, endSeconds: number) {
	const start = fromSeconds(startSeconds);
	const end = fromSeconds(endSeconds);
	const gap = end - start;

	for (const time of [start, end]) {
		const crossing = allTracks().flatMap((track) =>
			track.elements
				.filter((element) => element.startTime < time && elementEnd(element) > time)
				.map((element) => ({ trackId: track.id, elementId: element.id })),
		);
		if (crossing.length) {
			new SplitElementsCommand({ elements: crossing, splitTime: time as MediaTime }).execute();
		}
	}

	const inside = allTracks().flatMap((track) =>
		track.elements
			.filter((element) => element.startTime >= start && elementEnd(element) <= end)
			.map((element) => ({ trackId: track.id, elementId: element.id })),
	);
	if (inside.length) new DeleteElementsCommand({ elements: inside }).execute();

	const shift = <T extends TimelineTrack>(track: T): T => ({
		...track,
		elements: track.elements.map((element) =>
			element.startTime >= end
				? { ...element, startTime: (element.startTime - gap) as MediaTime }
				: element,
		),
	});
	const current = tracks();
	editor().timeline.updateTracks({
		overlay: current.overlay.map(shift),
		main: shift(current.main),
		audio: current.audio.map(shift),
	});
}

async function cutRange(args: Args) {
	requireOpenProject();
	const start = num(args, "start");
	const end = num(args, "end");
	if (end <= start) throw new Error('"end" must be after "start"');
	await asOneStep(() => cutRangeInPlace(start, end));
	return {
		removedSeconds: round2(end - start),
		durationSeconds: toSeconds(editor().timeline.getTotalDuration()),
	};
}

async function findSilenceRanges(args: Args) {
	requireOpenProject();
	const e = editor();
	const duration = e.timeline.getTotalDuration();
	if (duration === 0) throw new Error("The timeline is empty.");
	const minDuration = optNum(args, "minDuration") ?? 0.6;
	const padding = optNum(args, "padding") ?? 0.12;

	const audioBlob = await extractTimelineAudio({
		tracks: tracks(),
		mediaAssets: e.media.getAssets(),
		totalDuration: duration,
	});
	const sampleRate = 16000;
	const { samples } = await decodeAudioToFloat32({ audioBlob, sampleRate });

	const windowSize = Math.round(sampleRate * 0.02);
	const levels: number[] = [];
	for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
		let sum = 0;
		for (let j = i; j < i + windowSize; j++) sum += samples[j] * samples[j];
		levels.push(10 * Math.log10(sum / windowSize + 1e-12));
	}
	const peak = Math.max(...levels, -120);
	const thresholdDb = optNum(args, "thresholdDb") ?? Math.min(Math.max(peak - 32, -55), -28);

	const ranges: Array<{ start: number; end: number }> = [];
	let runStart = -1;
	const windowSeconds = windowSize / sampleRate;
	for (let i = 0; i <= levels.length; i++) {
		const silent = i < levels.length && levels[i] < thresholdDb;
		if (silent && runStart < 0) runStart = i;
		if (!silent && runStart >= 0) {
			const startSec = runStart * windowSeconds;
			const endSec = i * windowSeconds;
			if (endSec - startSec >= minDuration) {
				// Keep a little air around the speech on both sides.
				const cutStart = startSec === 0 ? 0 : startSec + padding;
				const cutEnd = i === levels.length ? endSec : endSec - padding;
				if (cutEnd - cutStart > 0.05) ranges.push({ start: round2(cutStart), end: round2(cutEnd) });
			}
			runStart = -1;
		}
	}
	return { thresholdDb: round2(thresholdDb), ranges };
}

async function removeSilences(args: Args) {
	const { ranges, thresholdDb } = await findSilenceRanges(args);
	if (ranges.length === 0) return { removed: 0, thresholdDb };
	await asOneStep(() => {
		for (const range of [...ranges].reverse()) cutRangeInPlace(range.start, range.end);
	});
	return {
		removed: ranges.length,
		removedSeconds: round2(ranges.reduce((total, r) => total + (r.end - r.start), 0)),
		thresholdDb,
		durationSeconds: toSeconds(editor().timeline.getTotalDuration()),
	};
}


// ------------------------------------------------------------- transitions

const TRANSITIONS = [
	"crossfade", "fade_black", "slide_left", "slide_right", "slide_up", "slide_down", "zoom",
] as const;
type TransitionType = (typeof TRANSITIONS)[number];

/** Higher = drawn on top. Main is the bottom; overlay[0] is the top. */
function trackRank(trackId: string): number {
	const current = tracks();
	if (current.main.id === trackId) return 0;
	const index = current.overlay.findIndex((track) => track.id === trackId);
	return index < 0 ? -1 : current.overlay.length - index;
}

function isVisualTrack(track: TimelineTrack): track is VideoTrack {
	return track.type === "video";
}

const FRAME_EPSILON = 0.05;

function nextClipAfter(ref: ElementRef): ElementRef | null {
	const { track, element } = findElement(ref.elementId);
	const end = toSeconds(elementEnd(element) as MediaTime);
	const candidates = track.elements
		.filter((other) => other.id !== element.id && Math.abs(toSeconds(other.startTime) - end) < FRAME_EPSILON)
		.sort((a, b) => a.startTime - b.startTime);
	return candidates[0] ? { trackId: track.id, elementId: candidates[0].id } : null;
}

/** A video track directly above `trackId` with nothing in [start, end), or a new one. */
function freeTrackAbove(trackId: string, start: MediaTime, end: MediaTime): string {
	const current = tracks();
	const overlayIndex = current.overlay.findIndex((track) => track.id === trackId);
	const aboveIndex = overlayIndex < 0 ? current.overlay.length - 1 : overlayIndex - 1;
	const above = aboveIndex >= 0 ? current.overlay[aboveIndex] : undefined;
	if (
		above &&
		isVisualTrack(above) &&
		above.elements.every((element) => elementEnd(element) <= start || element.startTime >= end)
	) {
		return above.id;
	}
	const command = new AddTrackCommand({
		type: "video",
		index: overlayIndex < 0 ? current.overlay.length : overlayIndex,
	});
	command.execute();
	return command.getTrackId();
}

function moveToTrack(ref: ElementRef, targetTrackId: string, patch: Partial<TimelineElement> = {}): ElementRef {
	const current = tracks();
	const { element } = findElement(ref.elementId);
	const moved = { ...element, ...patch } as TimelineElement;
	const edit = <T extends TimelineTrack>(track: T): T => {
		if (track.id === ref.trackId) {
			return { ...track, elements: track.elements.filter((e) => e.id !== element.id) };
		}
		if (track.id === targetTrackId) {
			return {
				...track,
				elements: [...track.elements, moved].sort((a, b) => a.startTime - b.startTime),
			} as T;
		}
		return track;
	};
	editor().timeline.updateTracks({
		overlay: current.overlay.map(edit),
		main: edit(current.main),
		audio: current.audio.map(edit),
	});
	return { trackId: targetTrackId, elementId: element.id };
}

/**
 * Pulls everything that starts at or after `from` left by `gap`, then trims
 * any clip that now runs into the next one on the same track (captions and
 * titles butting up against each other).
 */
function rippleLeft(from: MediaTime, gap: number, except: Set<string>) {
	const current = tracks();
	const shift = <T extends TimelineTrack>(track: T): T => ({
		...track,
		elements: track.elements.map((element) =>
			element.startTime >= from && !except.has(element.id)
				? { ...element, startTime: (element.startTime - gap) as MediaTime }
				: element,
		),
	});
	editor().timeline.updateTracks({
		overlay: current.overlay.map(shift),
		main: shift(current.main),
		audio: current.audio.map(shift),
	});

	for (const track of allTracks()) {
		const sorted = [...track.elements].sort((a, b) => a.startTime - b.startTime);
		for (let i = 0; i + 1 < sorted.length; i++) {
			const earlier = sorted[i];
			const later = sorted[i + 1];
			if (elementEnd(earlier) > later.startTime && earlier.startTime < later.startTime) {
				const split = new SplitElementsCommand({
					elements: [{ trackId: track.id, elementId: earlier.id }],
					splitTime: later.startTime,
				});
				split.execute();
				const [right] = split.getRightSideElements();
				if (right) new DeleteElementsCommand({ elements: [right] }).execute();
			}
		}
	}
}

function keyframe(ref: ElementRef, path: string, time: number, value: number, interpolation: "linear" | "bezier") {
	new UpsertKeyframeCommand({
		trackId: ref.trackId,
		elementId: ref.elementId,
		propertyPath: path,
		time: fromSeconds(Math.max(0, time)),
		value,
		interpolation,
	}).execute();
}

function applyTransition(fromRef: ElementRef, toRef: ElementRef, type: TransitionType, seconds: number) {
	let from = findElement(fromRef.elementId);
	let to = findElement(toRef.elementId);
	const fromDuration = toSeconds(from.element.duration);
	const toDuration = toSeconds(to.element.duration);
	const d = Math.min(seconds, fromDuration / 2, toDuration / 2);
	if (d < 0.05) throw new Error("Those clips are too short for a transition.");

	if (type === "fade_black") {
		const half = d / 2;
		const fromRefNow = { trackId: from.track.id, elementId: from.element.id };
		const toRefNow = { trackId: to.track.id, elementId: to.element.id };
		const fromOpacity = numberParam(from.element, "opacity", 1);
		const toOpacity = numberParam(to.element, "opacity", 1);
		keyframe(fromRefNow, "opacity", fromDuration - half, fromOpacity, "linear");
		keyframe(fromRefNow, "opacity", fromDuration, 0, "linear");
		keyframe(toRefNow, "opacity", 0, 0, "linear");
		keyframe(toRefNow, "opacity", half, toOpacity, "linear");
		return;
	}

	// Overlap the two clips by d. Prefer the incoming clip's unused head
	// (source media before its in-point) so nothing else has to move;
	// otherwise pull everything after the cut left by d.
	const gap = fromSeconds(d);
	const cut = to.element.startTime;
	const rate = "retime" in to.element && to.element.retime ? to.element.retime.rate : 1;
	const headroom = (to.element.trimStart ?? 0) / rate;
	const sameTrack = from.track.id === to.track.id;

	if (headroom >= gap && (to.element.type === "video" || to.element.type === "image")) {
		const extended: Partial<TimelineElement> = {
			startTime: (cut - gap) as MediaTime,
			duration: (to.element.duration + gap) as MediaTime,
			trimStart: (to.element.trimStart - gap * rate) as MediaTime,
		};
		if (sameTrack) {
			const target = freeTrackAbove(from.track.id, (cut - gap) as MediaTime, elementEnd(to.element) as MediaTime);
			moveToTrack({ trackId: to.track.id, elementId: to.element.id }, target, extended);
		} else {
			replaceElement({ trackId: to.track.id, elementId: to.element.id }, { ...to.element, ...extended } as TimelineElement);
		}
	} else {
		// Lift the incoming clip off the shared track first, so pulling it
		// left doesn't collide with (and trim) the outgoing clip.
		if (sameTrack) {
			const target = freeTrackAbove(
				from.track.id,
				(cut - gap) as MediaTime,
				(elementEnd(to.element) - gap) as MediaTime,
			);
			moveToTrack({ trackId: to.track.id, elementId: to.element.id }, target);
		}
		rippleLeft(cut, gap, new Set());
	}

	from = findElement(fromRef.elementId);
	to = findElement(toRef.elementId);
	const fromNow = { trackId: from.track.id, elementId: from.element.id };
	const toNow = { trackId: to.track.id, elementId: to.element.id };
	const incomingOnTop = trackRank(to.track.id) > trackRank(from.track.id);
	const overlapStartInFrom = toSeconds(from.element.duration) - d;
	const { width, height } = getCanvasSize();

	// Audio always crossfades.
	if (AUDIO_TYPES.has(from.element.type)) {
		const volume = numberParam(from.element, "volume", 0);
		keyframe(fromNow, "volume", overlapStartInFrom, volume, "linear");
		keyframe(fromNow, "volume", overlapStartInFrom + d, -60, "linear");
	}
	if (AUDIO_TYPES.has(to.element.type)) {
		const volume = numberParam(to.element, "volume", 0);
		keyframe(toNow, "volume", 0, -60, "linear");
		keyframe(toNow, "volume", d, volume, "linear");
	}

	// Picture: animate whichever clip is on top — bring the incoming one in,
	// or take the outgoing one away.
	const top = incomingOnTop ? { ref: toNow, element: to.element, start: 0 } : { ref: fromNow, element: from.element, start: overlapStartInFrom };
	const [a, b] = incomingOnTop ? [0, 1] : [1, 0];
	const at = (fraction: number) => top.start + d * fraction;
	const opacity = numberParam(top.element, "opacity", 1);
	switch (type) {
		case "crossfade":
			keyframe(top.ref, "opacity", at(0), opacity * a, "linear");
			keyframe(top.ref, "opacity", at(1), opacity * b, "linear");
			break;
		case "zoom": {
			const sx = numberParam(top.element, "transform.scaleX", 1);
			const sy = numberParam(top.element, "transform.scaleY", 1);
			const big = 1.35;
			keyframe(top.ref, "opacity", at(0), opacity * a, "bezier");
			keyframe(top.ref, "opacity", at(1), opacity * b, "bezier");
			keyframe(top.ref, "transform.scaleX", at(0), sx * (incomingOnTop ? big : 1), "bezier");
			keyframe(top.ref, "transform.scaleX", at(1), sx * (incomingOnTop ? 1 : big), "bezier");
			keyframe(top.ref, "transform.scaleY", at(0), sy * (incomingOnTop ? big : 1), "bezier");
			keyframe(top.ref, "transform.scaleY", at(1), sy * (incomingOnTop ? 1 : big), "bezier");
			break;
		}
		default: {
			const horizontal = type === "slide_left" || type === "slide_right";
			const path = horizontal ? "transform.positionX" : "transform.positionY";
			const base = numberParam(top.element, path, 0);
			// slide_left: the new shot enters from the right moving left.
			const sign = type === "slide_left" || type === "slide_up" ? 1 : -1;
			const distance = (horizontal ? width : height) * sign;
			if (incomingOnTop) {
				keyframe(top.ref, path, at(0), base + distance, "bezier");
				keyframe(top.ref, path, at(1), base, "bezier");
			} else {
				keyframe(top.ref, path, at(0), base, "bezier");
				keyframe(top.ref, path, at(1), base - distance, "bezier");
			}
		}
	}
}

async function addTransition(args: Args) {
	requireOpenProject();
	const type = str(args, "type") as TransitionType;
	if (!TRANSITIONS.includes(type)) throw new Error(`Unknown transition. Use: ${TRANSITIONS.join(", ")}`);
	const seconds = optNum(args, "duration") ?? 0.6;

	let pairs: Array<[ElementRef, ElementRef]>;
	if (args.all === true) {
		const main = tracks().main;
		const sorted = [...main.elements].sort((a, b) => a.startTime - b.startTime);
		pairs = [];
		for (let i = 0; i + 1 < sorted.length; i++) {
			const gap = toSeconds(sorted[i + 1].startTime) - toSeconds(elementEnd(sorted[i]) as MediaTime);
			if (Math.abs(gap) < FRAME_EPSILON) {
				pairs.push([
					{ trackId: main.id, elementId: sorted[i].id },
					{ trackId: main.id, elementId: sorted[i + 1].id },
				]);
			}
		}
		if (pairs.length === 0) throw new Error("There are no back-to-back clips on the main track to join.");
	} else {
		const from = findElement(str(args, "fromClipId"));
		const fromRef = { trackId: from.track.id, elementId: from.element.id };
		const toId = opt(args, "toClipId", isString);
		const toRef = toId
			? (() => {
					const found = findElement(toId);
					return { trackId: found.track.id, elementId: found.element.id };
				})()
			: nextClipAfter(fromRef);
		if (!toRef) throw new Error("No clip starts right where that one ends. Give toClipId.");
		pairs = [[fromRef, toRef]];
	}

	await asOneStep(() => {
		for (const [fromRef, toRef] of pairs) applyTransition(fromRef, toRef, type, seconds);
	});
	return {
		transitions: pairs.length,
		durationSeconds: toSeconds(editor().timeline.getTotalDuration()),
	};
}


// ------------------------------------------------------------------ layers

async function moveLayer(args: Args) {
	requireOpenProject();
	const trackId = str(args, "trackId");
	const to = str(args, "to");
	const current = tracks();
	const index = current.overlay.findIndex((track) => track.id === trackId);
	if (index < 0) {
		throw new Error(
			current.main.id === trackId
				? "The main track always stays at the bottom."
				: `No overlay layer with id ${trackId}.`,
		);
	}
	const overlay = [...current.overlay];
	const [track] = overlay.splice(index, 1);
	let target: number;
	switch (to) {
		case "top":
			target = 0;
			break;
		case "bottom":
			target = overlay.length;
			break;
		case "up":
			target = Math.max(0, index - 1);
			break;
		case "down":
			target = Math.min(overlay.length, index + 1);
			break;
		default: {
			const match = /^(above|below):(.+)$/.exec(to);
			const other = match ? overlay.findIndex((t) => t.id === match[2]) : -1;
			if (!match || other < 0) {
				throw new Error('"to" must be top, bottom, up, down, above:<trackId> or below:<trackId>');
			}
			target = match[1] === "above" ? other : other + 1;
		}
	}
	overlay.splice(target, 0, track);
	await asOneStep(() => editor().timeline.updateTracks({ ...current, overlay }));
	return {
		layers: [...overlay.map((t) => ({ id: t.id, type: t.type, clips: t.elements.map((e) => e.name) })), { id: current.main.id, type: "main", clips: current.main.elements.map((e) => e.name) }],
	};
}


// ------------------------------------------------------------ hand tracking

const HAND_POINTS: Record<string, number> = { palm: 9, wrist: 0, index_tip: 8, thumb_tip: 4 };

async function followHand(args: Args) {
	requireOpenProject();
	const target = findElement(str(args, "clipId"));
	const source = findElement(str(args, "videoClipId"));
	if (source.element.type !== "video") throw new Error("videoClipId must be a video clip.");
	if (!VISUAL_TYPES.has(target.element.type)) throw new Error("clipId must be a visual clip.");
	const asset = editor()
		.media.getAssets()
		.find((candidate) => "mediaId" in source.element && candidate.id === source.element.mediaId);
	if (!asset) throw new Error("The video clip's media is missing.");

	const side = opt(args, "hand", isString) ?? "any";
	const point = HAND_POINTS[opt(args, "point", isString) ?? "palm"] ?? 9;
	const offsetX = optNum(args, "offsetX") ?? 0;
	const offsetY = optNum(args, "offsetY") ?? -8;
	const every = Math.min(Math.max(optNum(args, "sampleEvery") ?? 0.1, 0.04), 1);

	// The part of the timeline where both clips are showing.
	const from = Math.max(toSeconds(target.element.startTime), toSeconds(source.element.startTime));
	const to = Math.min(
		toSeconds(elementEnd(target.element) as MediaTime),
		toSeconds(elementEnd(source.element) as MediaTime),
	);
	if (to - from < every) throw new Error("The two clips don't overlap in time.");
	const rate = source.element.retime?.rate ?? 1;
	const trimStart = mediaTimeToSeconds({ time: source.element.trimStart });
	const sourceStart = trimStart + (from - toSeconds(source.element.startTime)) * rate;
	const sourceEnd = trimStart + (to - toSeconds(source.element.startTime)) * rate;

	const bounds = baseBounds(source.element);
	if (!bounds) throw new Error("The video clip isn't visible.");
	const { width, height } = getCanvasSize();
	const landmarker = await createHandLandmarker();
	const samples: Array<{ time: number; x: number; y: number }> = [];
	let nextSample = sourceStart;
	let lastMs = -1;
	try {
		for await (const frame of videoFrames({ file: asset.file, start: sourceStart, end: sourceEnd, maxWidth: 480 })) {
			if (frame.timestamp + 1e-6 < nextSample) continue;
			nextSample = frame.timestamp + every * rate;
			const ms = Math.max(lastMs + 1, Math.round(frame.timestamp * 1000));
			lastMs = ms;
			const result = landmarker.detectForVideo(frame.canvas as TexImageSource, ms);
			// Map each hand into the frame and ignore ones cropped out of view
			// (zoomed footage, split screens).
			const hands = result.landmarks
				.map((landmarks) => landmarks[point])
				.filter(Boolean)
				.map((landmark) => ({
					x: ((bounds.cx + (landmark.x - 0.5) * bounds.width) / width) * 100,
					y: ((bounds.cy + (landmark.y - 0.5) * bounds.height) / height) * 100,
				}))
				.filter((hand) => hand.x > -2 && hand.x < 102 && hand.y > -2 && hand.y < 102)
				.sort((a, b) => a.x - b.x);
			const hand = side === "right" ? hands[hands.length - 1] : hands[0];
			if (!hand) continue;
			const timelineTime = toSeconds(source.element.startTime) + (frame.timestamp - trimStart) / rate;
			samples.push({ time: timelineTime, x: hand.x + offsetX, y: hand.y + offsetY });
		}
	} finally {
		landmarker.close();
	}
	if (samples.length < 2) throw new Error("No visible hand was found in that part of the video.");

	// Light smoothing so the object doesn't jitter with the landmarks.
	const smooth = samples.map((sample, i) => {
		const window = samples.slice(Math.max(0, i - 1), i + 2);
		return {
			time: sample.time,
			x: window.reduce((sum, s) => sum + s.x, 0) / window.length,
			y: window.reduce((sum, s) => sum + s.y, 0) / window.length,
		};
	});

	const targetStart = toSeconds(target.element.startTime);
	const keyframes = smooth.flatMap((s) => [
		{ property: "x", time: s.time - targetStart, value: Math.round(s.x * 100) / 100 },
		{ property: "y", time: s.time - targetStart, value: Math.round(s.y * 100) / 100 },
	]);
	// Replace any earlier position animation, then key the new path.
	await removeAnimations({ clipId: target.element.id, property: "position" });
	const animated = await animate({ clipId: target.element.id, keyframes, easing: "linear" });
	const visible = smooth.filter((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100).length;
	return {
		trackedFrames: samples.length,
		from: round2(from),
		to: round2(to),
		// A few points of the path (centre in % of the frame) to sanity-check.
		path: smooth
			.filter((_, i) => i % Math.max(1, Math.round(0.5 / every)) === 0)
			.map((p) => ({ time: round2(p.time), x: Math.round(p.x), y: Math.round(p.y) })),
		...(visible < smooth.length / 2
			? { warning: "Most tracked points are outside the visible frame — the hand found may be one that is cropped out. Try the other hand or check with view_frames." }
			: {}),
		clip: animated,
		note: "Undo twice to remove (animation + cleanup).",
	};
}

// ---------------------------------------------------------------- dispatch

export async function runProTool({
	tool,
	args,
}: {
	tool: string;
	args: Args;
}): Promise<unknown> {
	switch (tool) {
		case "view_frames":
			return viewFrames(args);
		case "set_clip_properties":
			return setClipProperties(args);
		case "animate":
			return animate(args);
		case "remove_animations":
			return removeAnimations(args);
		case "transcribe":
			return transcribe(args);
		case "generate_captions":
			return generateCaptions(args);
		case "add_captions":
			return addCaptions(args);
		case "search_icons":
			return searchIcons(args);
		case "add_icon":
			return addIcon(args);
		case "add_shape":
			return addShape(args);
		case "list_effects":
			return listEffects();
		case "add_effect":
			return addEffect(args);
		case "update_effect":
			return updateEffect(args);
		case "remove_effect":
			return removeEffect(args);
		case "add_mask":
			return addMask(args);
		case "remove_mask":
			return removeMask(args);
		case "set_project":
			return setProject(args);
		case "duplicate_clip":
			return duplicateClip(args);
		case "trim_clip":
			return trimClip(args);
		case "set_track":
			return setTrack(args);
		case "cut_range":
			return cutRange(args);
		case "find_silences":
			return findSilenceRanges(args);
		case "remove_silences":
			return removeSilences(args);
		case "add_transition":
			return addTransition(args);
		case "move_layer":
			return moveLayer(args);
		case "follow_hand":
			return followHand(args);
		default:
			if (HUMAN_TOOLS.has(tool)) return runHumanTool({ tool, args });
			return runGraphicsTool({ tool, args });
	}
}

export { describeFull };
