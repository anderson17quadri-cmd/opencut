import {
	DeleteElementsCommand,
	SplitElementsCommand,
} from "@/commands";
import { frameRateToFloat } from "@/fps/utils";
import { decodeAudioToFloat32 } from "@/media/audio";
import { extractTimelineAudio } from "@/media/mediabunny";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { type MediaTime, mediaTimeToSeconds } from "@/wasm";
import { addSoundEffect, renderMotionGraphicClip, resolveImages } from "./graphics-tools";
import {
	type Args,
	allTracks,
	asOneStep,
	CUTOUT_SUFFIX,
	editor,
	findElement,
	fromSeconds,
	optNum,
	requireOpenProject,
	str,
	toSeconds,
	upsertKeyframes,
} from "./helpers";
import { layersCode } from "./layers-3d";
import { LAYOUTS, type Layout, layoutCard, layoutCode, layoutZoom } from "./layout-card";
import { baseBounds } from "./layout";
import { getElementBounds } from "@/preview/element-bounds";
import { SOUND_EFFECTS, SOUND_LEAD, type SoundEffect } from "./sound-effects";
import { createFaceFinder, PersonMasker, videoFrames } from "./vision";

// Tools for the finishing touches a human editor adds: the "scene splits
// into 3D glass layers" shot, punch-in zooms that keep the face framed,
// sound effects, and music that dips under the voice.

const round2 = (value: number) => Math.round(value * 100) / 100;

function sceneTracks(): SceneTracks {
	return editor().scenes.getActiveScene().tracks;
}

function numberParam(element: TimelineElement, key: string, fallback: number) {
	const value = element.params[key];
	return typeof value === "number" ? value : fallback;
}

function mediaAsset(element: TimelineElement) {
	if (!("mediaId" in element)) return undefined;
	return editor()
		.media.getAssets()
		.find((asset) => asset.id === element.mediaId);
}

/** Source-media seconds for a timeline time inside a clip. */
export function sourceTime(element: TimelineElement, timelineSeconds: number) {
	const rate = ("retime" in element ? element.retime?.rate : undefined) ?? 1;
	return mediaTimeToSeconds({ time: element.trimStart }) + (timelineSeconds - toSeconds(element.startTime)) * rate;
}

/** Person-cutout copies of a clip (made by cutout_person). */
function cutoutsOf(element: TimelineElement) {
	return allTracks().flatMap((track) =>
		track.elements
			.filter(
				(candidate) =>
					candidate.id !== element.id &&
					candidate.name === `${element.name} ${CUTOUT_SUFFIX}` &&
					candidate.startTime === element.startTime,
			)
			.map((candidate) => ({ track, element: candidate })),
	);
}

/** Steps through decoded frames, keeping a private copy of the current one. */
export class FrameCursor {
	private iterator: AsyncIterator<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; width: number; height: number }>;
	private pending: IteratorResult<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; width: number; height: number }> | null = null;
	copy: OffscreenCanvas | null = null;
	timestamp = -1;

	constructor(file: File, start: number, end: number, maxWidth: number) {
		this.iterator = videoFrames({ file, start, end: end + 0.2, maxWidth })[Symbol.asyncIterator]();
	}

	/** Advances to the last frame at or before `time`; returns it. */
	async at(time: number): Promise<OffscreenCanvas | null> {
		this.pending ??= await this.iterator.next();
		while (!this.pending.done && (this.pending.value.timestamp <= time + 1e-3 || !this.copy)) {
			const frame = this.pending.value;
			if (!this.copy || this.copy.width !== frame.width || this.copy.height !== frame.height) {
				this.copy = new OffscreenCanvas(frame.width, frame.height);
			}
			const ctx = this.copy.getContext("2d");
			ctx?.drawImage(frame.canvas, 0, 0);
			this.timestamp = frame.timestamp;
			this.pending = await this.iterator.next();
		}
		return this.copy;
	}

	async close() {
		await this.iterator.return?.();
	}
}

// ------------------------------------------------------------ 3D layers

/** Fills transparent holes with the surrounding colours (pull-push). */
function pullPush(source: OffscreenCanvas): OffscreenCanvas {
	const levels = [source];
	while (levels[levels.length - 1].width > 4 && levels[levels.length - 1].height > 4) {
		const previous = levels[levels.length - 1];
		const next = new OffscreenCanvas(Math.max(1, previous.width >> 1), Math.max(1, previous.height >> 1));
		const ctx = next.getContext("2d");
		if (!ctx) break;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(previous, 0, 0, next.width, next.height);
		levels.push(next);
	}
	for (let i = levels.length - 2; i >= 0; i--) {
		const ctx = levels[i].getContext("2d");
		if (!ctx) continue;
		ctx.globalCompositeOperation = "destination-over";
		ctx.drawImage(levels[i + 1], 0, 0, levels[i].width, levels[i].height);
		ctx.globalCompositeOperation = "source-over";
	}
	return levels[0];
}

async function explodeLayers(args: Args) {
	const project = requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "video") throw new Error("explode_layers works on a video clip with a person.");
	const asset = mediaAsset(element);
	if (!asset) throw new Error("The clip's media is missing.");
	const bounds = baseBounds(element);
	if (!bounds) throw new Error("The clip isn't visible.");

	const clipStart = toSeconds(element.startTime);
	const clipEnd = clipStart + toSeconds(element.duration);
	const duration = Math.min(Math.max(optNum(args, "duration") ?? 5, 2.5), 20, clipEnd - clipStart);
	const start = Math.min(Math.max(optNum(args, "start") ?? clipStart, clipStart), clipEnd - duration);
	const { width, height } = project.settings.canvasSize;
	const fps = Math.min(Math.max(Math.round(frameRateToFloat(project.settings.fps)), 1), 60);
	const background =
		project.settings.background.type === "color" ? project.settings.background.color : "#000000";

	// Middle pane: pictures/icons given by Claude.
	const middleRefs = Array.isArray(args.middleImages) ? args.middleImages.map(String).slice(0, 4) : [];
	const images = await resolveImages(Object.fromEntries(middleRefs.map((ref, i) => [`m${i}`, ref])));
	const hasMiddle = middleRefs.length > 0;
	const defaults = hasMiddle ? ["Apresentador", "Gráficos", "Fundo"] : ["Apresentador", "Fundo"];
	// Labels go front to back; with no middle pane, a 3-label list keeps
	// its first and last (presenter, background).
	const pick = (raw: unknown): unknown[] | null => {
		if (!Array.isArray(raw)) return null;
		return !hasMiddle && raw.length >= 3 ? [raw[0], raw[raw.length - 1]] : raw;
	};
	const givenLabels = pick(args.labels);
	const givenSublabels = pick(args.sublabels);
	const labels = defaults.map((fallback, i) =>
		String(givenLabels?.[i] ?? fallback).slice(0, 28) || fallback,
	);
	const sublabels = defaults.map((_, i) => String(givenSublabels?.[i] ?? "").slice(0, 36));
	const font = typeof args.font === "string" && /^[\w\s-]{1,60}$/.test(args.font) ? args.font : "Montserrat";
	const accent = typeof args.accent === "string" && /^#[0-9a-f]{6}$/i.test(args.accent) ? args.accent : "#ff5a36";
	const openSeconds = Math.min(1.2, duration * 0.25);

	// Per-frame inputs: the frame as it appears on the canvas, the same
	// with the person removed (holes filled from around them), and just
	// the person.
	const cursor = new FrameCursor(asset.file, sourceTime(element, start), sourceTime(element, start + duration), 1280);
	const masker = await PersonMasker.create(
		args.quality === "best" || args.quality === "pro" || args.quality === "fast" ? args.quality : "auto",
	);
	const orig = new OffscreenCanvas(width, height);
	const person = new OffscreenCanvas(width, height);
	const fill = new OffscreenCanvas(width, height);
	const smallW = Math.max(8, Math.round(width / 4));
	const smallH = Math.max(8, Math.round(height / 4));
	let lastMs = -1;
	// Where the clip sits at a given moment, zooms and moves included, so
	// the shot matches the normal frame exactly where it cuts in and out.
	const boundsAt = (time: number) =>
		getElementBounds({
			element,
			canvasSize: { width, height },
			mediaAsset: asset,
			localTime: fromSeconds(start + time - clipStart),
		}) ?? bounds;
	const drawIn = (
		ctx: OffscreenCanvasRenderingContext2D,
		image: CanvasImageSource,
		b: { cx: number; cy: number; width: number; height: number; rotation: number },
		scale = 1,
	) => {
		ctx.save();
		ctx.translate(b.cx * scale, b.cy * scale);
		if (b.rotation) ctx.rotate((b.rotation * Math.PI) / 180);
		ctx.drawImage(image, (-b.width / 2) * scale, (-b.height / 2) * scale, b.width * scale, b.height * scale);
		ctx.restore();
	};

	const frames = async (_index: number, time: number) => {
		const b = boundsAt(time);
		const frame = await cursor.at(sourceTime(element, start + time));
		const o = orig.getContext("2d");
		const pctx = person.getContext("2d");
		const f = fill.getContext("2d");
		if (!o || !pctx || !f) throw new Error("Canvas unavailable.");
		o.fillStyle = background;
		o.fillRect(0, 0, width, height);
		if (frame) drawIn(o, frame, b);

		const ms = Math.max(lastMs + 1, Math.round(cursor.timestamp * 1000));
		lastMs = ms;
		const mask = frame ? await masker.mask(frame, ms) : null;

		// Person only.
		pctx.clearRect(0, 0, width, height);
		pctx.globalCompositeOperation = "source-over";
		pctx.drawImage(orig, 0, 0);
		pctx.globalCompositeOperation = "destination-in";
		if (mask) drawIn(pctx, mask, b);
		else pctx.clearRect(0, 0, width, height);
		pctx.globalCompositeOperation = "source-over";

		// Background with the person painted out.
		f.globalCompositeOperation = "source-over";
		f.drawImage(orig, 0, 0);
		if (mask) {
			const grown = new OffscreenCanvas(smallW, smallH);
			const g = grown.getContext("2d");
			const hole = new OffscreenCanvas(smallW, smallH);
			const h = hole.getContext("2d");
			if (g && h) {
				g.filter = "blur(3px)";
				for (let i = 0; i < 4; i++) drawIn(g, mask, b, smallW / width);
				g.filter = "none";
				h.drawImage(orig, 0, 0, smallW, smallH);
				h.globalCompositeOperation = "destination-out";
				h.drawImage(grown, 0, 0);
				h.globalCompositeOperation = "source-over";
				const filled = pullPush(hole);
				const patch = filled.getContext("2d");
				if (patch) {
					patch.globalCompositeOperation = "destination-in";
					patch.drawImage(grown, 0, 0);
				}
				f.imageSmoothingQuality = "high";
				f.drawImage(filled, 0, 0, width, height);
			}
		}

		const [origBitmap, fillBitmap, personBitmap] = await Promise.all([
			createImageBitmap(orig),
			createImageBitmap(fill),
			createImageBitmap(person),
		]);
		return { orig: origBitmap, fill: fillBitmap, person: personBitmap };
	};

	// The 3D shot goes right above the source clip, so captions and other
	// layers above stay flat on top.
	const current = sceneTracks();
	const overlayIndex = current.overlay.findIndex((t) => t.id === track.id);
	const trackIndex = overlayIndex >= 0 ? overlayIndex : current.overlay.length;

	let result: Awaited<ReturnType<typeof renderMotionGraphicClip>>;
	try {
		result = await renderMotionGraphicClip({
			spec: {
				code: layersCode({
					labels,
					sublabels,
					hasMiddle,
					middleImages: middleRefs.map((_, i) => `m${i}`),
					background,
					accent,
					openSeconds,
					closeSeconds: openSeconds,
					angle: Math.min(Math.max(optNum(args, "angle") ?? 32, 10), 60),
					font,
				}),
				mode: "three",
				width,
				height,
				fps,
				duration,
				fonts: [font],
				images,
			},
			name: "Camadas 3D",
			start,
			trackIndex,
			frames,
		});
	} finally {
		masker.close();
		await cursor.close();
	}

	// A person cutout of this clip would draw flat over the 3D shot: take
	// that stretch out of it.
	const cutouts = cutoutsOf(element);
	if (cutouts.length) {
		await asOneStep(() => {
			for (const time of [start, start + duration]) {
				const crossing = allTracks().flatMap((t) =>
					t.elements
						.filter(
							(e) =>
								e.name === `${element.name} ${CUTOUT_SUFFIX}` &&
								e.startTime < fromSeconds(time) &&
								e.startTime + e.duration > fromSeconds(time),
						)
						.map((e) => ({ trackId: t.id, elementId: e.id })),
				);
				if (crossing.length) {
					new SplitElementsCommand({ elements: crossing, splitTime: fromSeconds(time) as MediaTime }).execute();
				}
			}
			const inside = allTracks().flatMap((t) =>
				t.elements
					.filter(
						(e) =>
							e.name === `${element.name} ${CUTOUT_SUFFIX}` &&
							e.startTime >= fromSeconds(start) - 1 &&
							e.startTime + e.duration <= fromSeconds(start + duration) + 1,
					)
					.map((e) => ({ trackId: t.id, elementId: e.id })),
			);
			if (inside.length) new DeleteElementsCommand({ elements: inside }).execute();
		});
	}

	// The shot is built from the raw video: give it the clip's effects
	// (colour grade etc.) so it matches the clip where it cuts in and out.
	const effects = "effects" in element ? element.effects : undefined;
	if (effects?.length) {
		await asOneStep(() => {
			const withEffects = <T extends { elements: TimelineElement[] }>(t: T): T => ({
				...t,
				elements: t.elements.map((e) =>
					e.id === result.clipId ? ({ ...e, effects: structuredClone(effects) } as TimelineElement) : e,
				),
			});
			const now = sceneTracks();
			editor().timeline.updateTracks({
				overlay: now.overlay.map(withEffects),
				main: withEffects(now.main),
				audio: now.audio,
			});
		});
	}

	const sounds: string[] = [];
	if (args.sound !== false) {
		const open = await addSoundEffect({ effect: "whoosh", at: start + SOUND_LEAD.whoosh, volumeDb: -4 });
		const close = await addSoundEffect({ effect: "swoosh_down", at: start + duration - openSeconds + SOUND_LEAD.swoosh_down, volumeDb: -4 });
		for (const sound of [open, close]) if (sound) sounds.push(sound.clipId);
	}

	return {
		...result,
		start: round2(start),
		end: round2(start + duration),
		layers: labels,
		soundClipIds: sounds,
		note: "The shot starts and ends exactly on the normal frame, so it cuts in and out seamlessly. Check the middle with view_frames. Other layers above (captions, titles) stay flat on top; move or trim them if they clutter the shot.",
	};
}

// ----------------------------------------------------------- punch zoom

type Zoom = { at: number; scale: number; hold: number; style: "cut" | "smooth" | "push" };

async function punchZoom(args: Args) {
	const project = requireOpenProject();
	const { element } = findElement(str(args, "clipId"));
	if (element.type !== "video") throw new Error("punch_zoom works on video clips.");
	const asset = mediaAsset(element);
	if (!asset) throw new Error("The clip's media is missing.");
	const bounds = baseBounds(element);
	if (!bounds) throw new Error("The clip isn't visible.");

	const clipStart = toSeconds(element.startTime);
	const clipEnd = clipStart + toSeconds(element.duration);
	const defaultScale = optNum(args, "scale") ?? 1.18;
	const defaultHold = optNum(args, "hold") ?? 2;
	const defaultStyle = (["cut", "smooth", "push"].includes(String(args.style)) ? args.style : "cut") as Zoom["style"];
	const raw: unknown[] = Array.isArray(args.zooms)
		? args.zooms
		: Array.isArray(args.times)
			? (args.times as unknown[]).map((at) => ({ at }))
			: [];
	const zooms: Zoom[] = raw
		.map((item) => {
			const z = (typeof item === "number" ? { at: item } : item) as Record<string, unknown>;
			const style = ["cut", "smooth", "push"].includes(String(z.style)) ? (z.style as Zoom["style"]) : defaultStyle;
			return {
				at: Number(z.at),
				scale: Math.min(Math.max(Number(z.scale ?? defaultScale), 1.02), 2.5),
				hold: Math.min(Math.max(Number(z.hold ?? defaultHold), 0.3), 30),
				style,
			};
		})
		.filter((z) => Number.isFinite(z.at) && z.at >= clipStart && z.at < clipEnd - 0.1)
		.sort((a, b) => a.at - b.at);
	if (zooms.length === 0) throw new Error("Give zooms (or times) inside the clip, in timeline seconds.");

	const { width, height } = project.settings.canvasSize;
	const sx = numberParam(element, "transform.scaleX", 1);
	const sy = numberParam(element, "transform.scaleY", 1);
	const px = numberParam(element, "transform.positionX", 0);
	const py = numberParam(element, "transform.positionY", 0);

	// Find the face at each zoom so it stays framed.
	const finder = await createFaceFinder();
	const faces: Array<{ x: number; y: number } | null> = [];
	try {
		for (const zoom of zooms) {
			const at = sourceTime(element, zoom.at + 0.05);
			let face: { x: number; y: number } | null = null;
			for await (const frame of videoFrames({ file: asset.file, start: at, end: at + 0.1, maxWidth: 720 })) {
				const hit = finder.find(frame.canvas);
				if (hit) {
					face = {
						x: bounds.cx + (hit.x - 0.5) * bounds.width,
						y: bounds.cy + (hit.y - 0.5) * bounds.height,
					};
				}
				break;
			}
			faces.push(face);
		}
	} finally {
		finder.close();
	}

	const covers = { x: bounds.width >= width - 1, y: bounds.height >= height - 1 };
	const target = (zoom: Zoom, face: { x: number; y: number } | null) => {
		// Scale around the face (or the upper middle if none was found),
		// keeping the frame covered when it was covered before.
		const focus = face ?? { x: bounds.cx, y: bounds.cy - bounds.height * 0.12 };
		let cx = focus.x + (bounds.cx - focus.x) * zoom.scale;
		let cy = focus.y + (bounds.cy - focus.y) * zoom.scale;
		// Nudge the face toward the centre line a little, like an editor would.
		cx += (width / 2 - focus.x) * 0.35;
		const w = bounds.width * zoom.scale;
		const h = bounds.height * zoom.scale;
		if (covers.x) cx = Math.min(Math.max(cx, width - w / 2), w / 2);
		if (covers.y) cy = Math.min(Math.max(cy, height - h / 2), h / 2);
		return { scaleX: sx * zoom.scale, scaleY: sy * zoom.scale, x: px + (cx - bounds.cx), y: py + (cy - bounds.cy) };
	};

	type Key = { time: number; values: { scaleX: number; scaleY: number; x: number; y: number }; interpolation: "hold" | "linear" | "bezier" };
	const base = { scaleX: sx, scaleY: sy, x: px, y: py };
	const keys: Key[] = [{ time: 0, values: base, interpolation: "hold" }];
	const frame = 1 / Math.max(1, frameRateToFloat(project.settings.fps));
	zooms.forEach((zoom, i) => {
		const t0 = zoom.at - clipStart;
		const next = zooms[i + 1] ? zooms[i + 1].at - clipStart : Number.POSITIVE_INFINITY;
		const t1 = Math.min(t0 + zoom.hold, next, clipEnd - clipStart);
		const z = target(zoom, faces[i]);
		const backToBase = t1 < next - 1e-3;
		if (zoom.style === "cut") {
			keys.push({ time: t0, values: z, interpolation: "hold" });
		} else if (zoom.style === "smooth") {
			const ramp = Math.min(0.4, (t1 - t0) / 3);
			keys.push({ time: t0, values: base, interpolation: "bezier" });
			keys.push({ time: t0 + ramp, values: z, interpolation: backToBase ? "hold" : "bezier" });
			if (backToBase) {
				keys.push({ time: t1 - ramp, values: z, interpolation: "bezier" });
				keys.push({ time: t1, values: base, interpolation: "hold" });
				return;
			}
		} else {
			keys.push({ time: t0, values: base, interpolation: "linear" });
			keys.push({ time: Math.max(t0 + frame, t1 - frame), values: z, interpolation: "hold" });
		}
		if (backToBase) keys.push({ time: t1, values: base, interpolation: "hold" });
	});

	const PATHS = ["transform.scaleX", "transform.scaleY", "transform.positionX", "transform.positionY"] as const;
	const targets = [findElement(element.id), ...cutoutsOf(element)];
	await asOneStep(() => {
		// Replace earlier zoom/position keys on the clip (and its cutout).
		const ids = new Set(targets.map((t) => t.element.id));
		const strip = <T extends { elements: TimelineElement[] }>(t: T): T => ({
			...t,
			elements: t.elements.map((e) => {
				if (!ids.has(e.id) || !e.animations) return e;
				const animations = { ...e.animations };
				for (const path of PATHS) delete animations[path];
				return { ...e, animations: Object.keys(animations).length ? animations : undefined };
			}),
		});
		const current = sceneTracks();
		editor().timeline.updateTracks({
			overlay: current.overlay.map(strip),
			main: strip(current.main),
			audio: current.audio,
		});
		for (const { track, element: target } of targets) {
			upsertKeyframes({
				trackId: track.id,
				elementId: target.id,
				keys: keys.flatMap((key) => {
					const values = [key.values.scaleX, key.values.scaleY, key.values.x, key.values.y];
					return PATHS.map((path, i) => ({
						path,
						time: key.time,
						value: values[i],
						interpolation: key.interpolation,
					}));
				}),
			});
		}
	});

	return {
		zooms: zooms.map((zoom, i) => ({
			at: round2(zoom.at),
			scale: zoom.scale,
			style: zoom.style,
			faceFound: Boolean(faces[i]),
		})),
		alsoOnCutout: targets.length > 1,
		note: "Replaces earlier zoom keys on this clip. Check with view_frames just after each zoom.",
	};
}

// -------------------------------------------------------- sound effects

async function addSoundEffectTool(args: Args) {
	requireOpenProject();
	const effect = str(args, "effect");
	if (!SOUND_EFFECTS.includes(effect as SoundEffect)) {
		throw new Error(`effect must be one of: ${SOUND_EFFECTS.join(", ")}`);
	}
	const at = optNum(args, "at") ?? toSeconds(editor().playback.getCurrentTime());
	const added = await addSoundEffect({ effect, at, volumeDb: optNum(args, "volumeDb") });
	if (!added) throw new Error("Could not add the sound.");
	return {
		clipId: added.clipId,
		effect,
		hitsAt: round2(at),
		note: effect === "riser" ? "The riser builds up and ends at 'at'." : undefined,
	};
}

// ----------------------------------------------------------- music ducking

async function duckMusic(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "audio" && element.type !== "video") throw new Error("Give the music clip.");
	const musicDb = optNum(args, "musicDb") ?? -12;
	const underVoiceDb = optNum(args, "underVoiceDb") ?? -24;
	const e = editor();

	// Voice = every other audible clip.
	const withoutMusic = <T extends { elements: TimelineElement[] }>(t: T): T => ({
		...t,
		elements: t.elements.filter((candidate) => candidate.id !== element.id),
	});
	const current = sceneTracks();
	const voiceTracks = {
		overlay: current.overlay.map(withoutMusic),
		main: withoutMusic(current.main),
		audio: current.audio.map(withoutMusic),
	};
	const total = e.timeline.getTotalDuration();
	const audioBlob = await extractTimelineAudio({
		tracks: voiceTracks as SceneTracks,
		mediaAssets: e.media.getAssets(),
		totalDuration: total,
	});
	const sampleRate = 16000;
	const { samples } = await decodeAudioToFloat32({ audioBlob, sampleRate });
	const windowSize = Math.round(sampleRate * 0.05);
	const levels: number[] = [];
	for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
		let sum = 0;
		for (let j = i; j < i + windowSize; j++) sum += samples[j] * samples[j];
		levels.push(10 * Math.log10(sum / windowSize + 1e-12));
	}
	const peak = Math.max(...levels, -120);
	const threshold = Math.min(Math.max(peak - 30, -50), -30);
	const step = windowSize / sampleRate;

	// Speech spans, with short pauses merged so the music doesn't pump.
	const spans: Array<{ start: number; end: number }> = [];
	levels.forEach((level, i) => {
		if (level < threshold) return;
		const t = i * step;
		const last = spans[spans.length - 1];
		if (last && t - last.end < 0.7) last.end = t + step;
		else spans.push({ start: t, end: t + step });
	});
	const speech = spans.filter((s) => s.end - s.start > 0.25);

	const clipStart = toSeconds(element.startTime);
	const clipEnd = clipStart + toSeconds(element.duration);
	const attack = 0.15;
	const release = 0.45;
	const keys: Array<{ time: number; value: number }> = [{ time: 0, value: musicDb }];
	for (const span of speech) {
		const a = Math.max(clipStart, span.start - attack);
		const b = Math.min(clipEnd, span.end + release);
		if (b <= clipStart || a >= clipEnd) continue;
		keys.push({ time: a - clipStart, value: musicDb });
		keys.push({ time: Math.min(b, a + attack) - clipStart, value: underVoiceDb });
		keys.push({ time: Math.max(a + attack, b - release) - clipStart, value: underVoiceDb });
		keys.push({ time: b - clipStart, value: musicDb });
	}
	const cleaned = keys
		.sort((x, y) => x.time - y.time)
		.filter((key, i, all) => i === 0 || key.time - all[i - 1].time > 0.01);

	await asOneStep(() => {
		const strip = <T extends { elements: TimelineElement[] }>(t: T): T => ({
			...t,
			elements: t.elements.map((candidate) => {
				if (candidate.id !== element.id || !candidate.animations) return candidate;
				const animations = { ...candidate.animations };
				delete animations.volume;
				return { ...candidate, animations: Object.keys(animations).length ? animations : undefined };
			}),
		});
		const now = sceneTracks();
		editor().timeline.updateTracks({ overlay: now.overlay.map(strip), main: strip(now.main), audio: now.audio.map(strip) });
		upsertKeyframes({
			trackId: track.id,
			elementId: element.id,
			keys: cleaned.map((key) => ({ path: "volume", time: key.time, value: key.value, interpolation: "linear" })),
		});
	});
	return {
		speechSpans: speech.length,
		musicDb,
		underVoiceDb,
		keyframes: cleaned.length,
		note: "The music plays at musicDb in pauses and dips to underVoiceDb while someone speaks.",
	};
}

// ---------------------------------------------------------------- dispatch

// --------------------------------------------------------------- layouts

/**
 * The presenter moves from full frame into a rounded card (beside, below or
 * in a corner) over a blurred copy of the shot, for [start, start+duration],
 * then back — leaving room for a graphic, like pro explainer reels. Renders a
 * clip right above the source clip (its sound keeps playing underneath).
 */
async function setLayout(args: Args) {
	const project = requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "video") throw new Error("set_layout works on a video clip.");
	const asset = mediaAsset(element);
	if (!asset) throw new Error("The clip's media is missing.");
	const bounds = baseBounds(element);
	if (!bounds) throw new Error("The clip isn't visible.");
	const layout = ((LAYOUTS as readonly string[]).includes(args.layout as string) ? args.layout : "frame_right") as Layout;
	const clipStart = toSeconds(element.startTime);
	const clipEnd = clipStart + toSeconds(element.duration);
	const duration = Math.min(Math.max(optNum(args, "duration") ?? 4, 1.5), 30, clipEnd - clipStart);
	const start = Math.min(Math.max(optNum(args, "start") ?? clipStart, clipStart), clipEnd - duration);
	const { width, height } = project.settings.canvasSize;
	const fps = Math.min(Math.max(Math.round(frameRateToFloat(project.settings.fps)), 1), 60);
	const background =
		project.settings.background.type === "color" ? project.settings.background.color : "#000000";
	const card = layoutCard(layout, width, height);

	const boundsAt = (time: number) =>
		getElementBounds({
			element,
			canvasSize: { width, height },
			mediaAsset: asset,
			localTime: fromSeconds(start + time - clipStart),
		}) ?? bounds;
	const orig = new OffscreenCanvas(width, height);
	const cursor = new FrameCursor(asset.file, sourceTime(element, start), sourceTime(element, start + duration), 1280);
	const drawShot = async (time: number) => {
		const o = orig.getContext("2d");
		if (!o) throw new Error("Canvas unavailable.");
		const b = boundsAt(time);
		const frame = await cursor.at(sourceTime(element, start + time));
		o.fillStyle = background;
		o.fillRect(0, 0, width, height);
		if (frame) {
			o.save();
			o.translate(b.cx, b.cy);
			if (b.rotation) o.rotate((b.rotation * Math.PI) / 180);
			o.drawImage(frame, -b.width / 2, -b.height / 2, b.width, b.height);
			o.restore();
		}
	};

	// Where the face is (a moment in), so the card keeps it framed.
	let face = { x: 0.5, y: 0.38 };
	try {
		const finder = await createFaceFinder();
		try {
			await drawShot(Math.min(0.6, duration / 2));
			const found = finder.find(orig);
			if (found) face = { x: found.x, y: found.y };
		} finally {
			finder.close();
		}
	} catch {
		// No face finder: the card centres on the upper middle.
	}

	const current = sceneTracks();
	const overlayIndex = current.overlay.findIndex((t) => t.id === track.id);
	const trackIndex = overlayIndex >= 0 ? overlayIndex : current.overlay.length;
	const move = Math.min(0.5, duration / 4);
	const accent = typeof args.accent === "string" && /^#[0-9a-f]{6}$/i.test(args.accent) ? args.accent : "#ff7a45";
	const bg = typeof args.background === "string" && /^#[0-9a-f]{6}$/i.test(args.background) ? args.background : "blur";
	let result: Awaited<ReturnType<typeof renderMotionGraphicClip>>;
	try {
		result = await renderMotionGraphicClip({
			spec: {
				code: layoutCode({
					card,
					face,
					zoom: layoutZoom(layout, width, height),
					move,
					background: bg,
					label: typeof args.label === "string" && args.label.trim() ? args.label.trim().slice(0, 40) : null,
					accent,
					font: "Montserrat",
				}),
				mode: "2d",
				width,
				height,
				fps,
				duration,
				fonts: ["Montserrat"],
			},
			name: `Layout ${layout}`,
			start,
			trackIndex,
			frames: async (_index, time) => {
				await drawShot(time);
				return { orig: await createImageBitmap(orig) };
			},
		});
	} finally {
		await cursor.close();
	}
	if (args.sound !== false) {
		await addSoundEffect({ effect: "whoosh", at: start + move * 0.6, volumeDb: -12 });
		await addSoundEffect({ effect: "swoosh_down", at: start + duration - move * 0.4, volumeDb: -14 });
	}
	const pct = (v: number, of: number) => Math.round((v / of) * 1000) / 10;
	const portrait = height > width;
	// The free part of the frame, for the graphic that goes with the layout.
	const free =
		layout === "split"
			? portrait
				? { x: 4, y: 6, w: 92, h: 42 }
				: { x: 4, y: 6, w: 44, h: 88 }
			: portrait
				? { x: 4, y: 6, w: 92, h: pct(card.y, height) - 9 }
				: layout === "frame_left"
				? { x: pct(card.x + card.w, width) + 2, y: 8, w: 100 - pct(card.x + card.w, width) - 6, h: 84 }
				: layout === "pip"
					? { x: 4, y: 6, w: 92, h: portrait ? 46 : 54 }
					: { x: 4, y: 8, w: pct(card.x, width) - 6, h: 84 };
	return {
		...result,
		layout,
		card: { x: pct(card.x, width), y: pct(card.y, height), w: pct(card.w, width), h: pct(card.h, height) },
		freeArea: free,
		note: `Percent of the frame. Put the explainer graphic (create_motion_graphic, add_title editorial, add_3d_logo, a picture) inside freeArea for [${round2(start)}, ${round2(start + duration)}] and above this layer; captions stay on top. The shot is full frame again at both ends.`,
	};
}

// ------------------------------------------------------ scene detection

/** Mean HSV of a small frame, per pixel (PySceneDetect's content measure). */
function hsvPixels(canvas: OffscreenCanvas): Float32Array {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	const out = new Float32Array(canvas.width * canvas.height * 3);
	if (!ctx) return out;
	const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
	for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
		const r = data[i] / 255;
		const g = data[i + 1] / 255;
		const b = data[i + 2] / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		let h = 0;
		if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		// OpenCV's 8-bit ranges, as in PySceneDetect: H 0-180, S and V 0-255.
		out[p] = ((h * 60 + 360) % 360) / 2;
		out[p + 1] = max === 0 ? 0 : (d / max) * 255;
		out[p + 2] = max * 255;
	}
	return out;
}

/**
 * Finds the cuts inside a clip (a video that already has several shots):
 * the content detector of PySceneDetect (BSD) — the average change of hue,
 * saturation and brightness from one frame to the next. Optionally splits
 * the clip at each cut, so each shot can be trimmed, moved or transitioned.
 */
async function detectScenes(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "video") throw new Error("detect_scenes works on video clips.");
	const asset = mediaAsset(element);
	if (!asset) throw new Error("The clip's media is missing.");
	const threshold = Math.min(Math.max(optNum(args, "threshold") ?? 27, 5), 100);
	const minScene = Math.max(optNum(args, "minSceneSeconds") ?? 0.6, 0.2);
	const rate = ("retime" in element ? element.retime?.rate : undefined) ?? 1;
	const clipStart = toSeconds(element.startTime);
	const clipEnd = clipStart + toSeconds(element.duration);
	const sourceStart = sourceTime(element, clipStart);

	const small = new OffscreenCanvas(96, 54);
	const smallCtx = small.getContext("2d", { willReadFrequently: true });
	let previous: Float32Array | null = null;
	const cuts: Array<{ time: number; score: number }> = [];
	let lastCut = clipStart;
	for await (const frame of videoFrames({
		file: asset.file,
		start: sourceStart,
		end: sourceTime(element, clipEnd),
		maxWidth: 320,
	})) {
		smallCtx?.drawImage(frame.canvas, 0, 0, small.width, small.height);
		const current = hsvPixels(small);
		const timeline = clipStart + (frame.timestamp - sourceStart) / rate;
		if (previous) {
			let hue = 0;
			let sat = 0;
			let val = 0;
			for (let p = 0; p < current.length; p += 3) {
				const dh = Math.abs(current[p] - previous[p]);
				hue += Math.min(dh, 180 - dh);
				sat += Math.abs(current[p + 1] - previous[p + 1]);
				val += Math.abs(current[p + 2] - previous[p + 2]);
			}
			const pixels = current.length / 3;
			const score = (hue / pixels + sat / pixels + val / pixels) / 3;
			if (score >= threshold && timeline - lastCut >= minScene && clipEnd - timeline >= 0.2) {
				cuts.push({ time: round2(timeline), score: round2(score) });
				lastCut = timeline;
			}
		}
		previous = current;
	}

	const scenes = [clipStart, ...cuts.map((c) => c.time), clipEnd].slice(0, -1).map((start, i, all) => ({
		start: round2(start),
		end: round2(i + 1 < all.length ? all[i + 1] : clipEnd),
	}));
	let clipIds: string[] | undefined;
	if (args.split === true && cuts.length) {
		await asOneStep(() => {
			for (const cut of [...cuts].reverse()) {
				const current = allTracks()
					.find((t) => t.id === track.id)
					?.elements.find((e) => e.startTime < fromSeconds(cut.time) && e.startTime + e.duration > fromSeconds(cut.time) && ("mediaId" in e ? e.mediaId === asset.id : false));
				if (!current) continue;
				new SplitElementsCommand({ elements: [{ trackId: track.id, elementId: current.id }], splitTime: fromSeconds(cut.time) }).execute();
			}
		});
		clipIds = (allTracks().find((t) => t.id === track.id)?.elements ?? [])
			.filter((e) => "mediaId" in e && e.mediaId === asset.id && toSeconds(e.startTime) >= clipStart - 0.01 && toSeconds(e.startTime) < clipEnd - 0.01)
			.sort((a, b) => a.startTime - b.startTime)
			.map((e) => e.id);
	}
	return {
		cuts,
		scenes,
		...(clipIds ? { clipIds, note: "The clip was split at every cut; each shot is now its own clip (ids in order)." } : { note: "Pass split=true to split the clip at these cuts." }),
	};
}

// --------------------------------------------------------- auto reframe

/**
 * Fits a (usually horizontal) clip to the frame height and pans it to keep
 * the speaker's face in view — a 16:9 video turned into a 9:16 Reel with a
 * virtual camera operator. Face positions are sampled, smoothed and only
 * followed when the face drifts away from the centre, so the frame doesn't
 * wobble.
 */
async function autoReframe(args: Args) {
	const project = requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "video") throw new Error("auto_reframe works on video clips.");
	const asset = mediaAsset(element);
	if (!asset?.width || !asset.height) throw new Error("The clip's media is missing.");
	const { width, height } = project.settings.canvasSize;

	// Cover the frame: scale so the video is exactly as tall as the frame
	// (or as wide, for a video narrower than the frame).
	const cover = Math.max(width / asset.width, height / asset.height);
	const shownWidth = asset.width * cover;
	if (shownWidth <= width + 1) {
		throw new Error("This clip already fits the frame width; there is nothing to pan.");
	}
	const fit = (() => {
		// Scale 1 = the editor's default "contain" fit.
		const contain = Math.min(width / asset.width, height / asset.height);
		return cover / contain;
	})();

	const clipStart = toSeconds(element.startTime);
	const clipSeconds = toSeconds(element.duration);
	const every = Math.min(Math.max(optNum(args, "sampleEvery") ?? 0.33, 0.1), 2);
	const finder = await createFaceFinder();
	const samples: Array<{ time: number; x: number | null }> = [];
	try {
		for await (const frame of videoFrames({
			file: asset.file,
			start: sourceTime(element, clipStart),
			end: sourceTime(element, clipStart + clipSeconds),
			maxWidth: 640,
		})) {
			const timeline = clipStart + (frame.timestamp - sourceTime(element, clipStart)) / (("retime" in element ? element.retime?.rate : undefined) ?? 1);
			if (samples.length && timeline - samples[samples.length - 1].time < every) continue;
			samples.push({ time: timeline, x: finder.find(frame.canvas)?.x ?? null });
		}
	} finally {
		finder.close();
	}
	const found = samples.filter((s) => s.x !== null).length;
	if (found === 0) throw new Error("No face was found in this clip to follow.");

	// Fill gaps with the last seen face, smooth over ~1 s, and only move the
	// "camera" when the face leaves the middle 30% (like an operator would).
	let last = samples.find((s) => s.x !== null)?.x ?? 0.5;
	const filled = samples.map((s) => ({ time: s.time, x: (last = s.x ?? last) }));
	const radius = Math.max(1, Math.round(1 / every / 2));
	const smooth = filled.map((s, i) => {
		const window = filled.slice(Math.max(0, i - radius), i + radius + 1);
		return { time: s.time, x: window.reduce((sum, w) => sum + w.x, 0) / window.length };
	});
	const maxOffset = (shownWidth - width) / 2;
	const deadZone = (width * 0.15) / shownWidth;
	let aim = smooth[0].x;
	const keys: Array<{ time: number; x: number }> = [];
	for (const s of smooth) {
		if (Math.abs(s.x - aim) > deadZone) aim = s.x + Math.sign(aim - s.x) * deadZone * 0.5;
		// positionX that puts `aim` at the frame's centre, kept covering.
		const x = Math.min(Math.max((0.5 - aim) * shownWidth, -maxOffset), maxOffset);
		if (!keys.length || Math.abs(keys[keys.length - 1].x - x) > 2) keys.push({ time: s.time - clipStart, x });
	}

	await asOneStep(() => {
		const update = <T extends { elements: TimelineElement[] }>(t: T): T => ({
			...t,
			elements: t.elements.map((e) => {
				if (e.id !== element.id) return e;
				const animations = { ...(e.animations ?? {}) };
				for (const path of ["transform.positionX", "transform.positionY", "transform.scaleX", "transform.scaleY"]) {
					delete animations[path as keyof typeof animations];
				}
				return {
					...e,
					animations: Object.keys(animations).length ? animations : undefined,
					params: {
						...e.params,
						"transform.scaleX": fit,
						"transform.scaleY": fit,
						"transform.positionX": keys[0]?.x ?? 0,
						"transform.positionY": 0,
					},
				} as TimelineElement;
			}),
		});
		const now = sceneTracks();
		editor().timeline.updateTracks({ overlay: now.overlay.map(update), main: update(now.main), audio: now.audio });
		if (keys.length > 1) {
			upsertKeyframes({
				trackId: track.id,
				elementId: element.id,
				keys: keys.map((k) => ({ path: "transform.positionX", time: k.time, value: k.x, interpolation: "bezier" as const })),
			});
		}
	});

	return {
		facesFoundIn: `${found}/${samples.length} samples`,
		moves: Math.max(0, keys.length - 1),
		scale: Math.round(fit * 1000) / 1000,
		note: "The clip now fills the frame and pans to keep the face in view. Run it after cuts (it keys the whole clip); punch_zoom afterwards replaces these keys, so reframe first and zoom only where needed — or use punch_zoom alone.",
	};
}

export const HUMAN_TOOLS = new Set(["explode_layers", "punch_zoom", "add_sound_effect", "duck_music", "auto_reframe", "detect_scenes", "set_layout"]);

export async function runHumanTool({ tool, args }: { tool: string; args: Args }): Promise<unknown> {
	switch (tool) {
		case "explode_layers":
			return explodeLayers(args);
		case "punch_zoom":
			return punchZoom(args);
		case "add_sound_effect":
			return addSoundEffectTool(args);
		case "duck_music":
			return duckMusic(args);
		case "auto_reframe":
			return autoReframe(args);
		case "detect_scenes":
			return detectScenes(args);
		case "set_layout":
			return setLayout(args);
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}
