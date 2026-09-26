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
function sourceTime(element: TimelineElement, timelineSeconds: number) {
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
class FrameCursor {
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
	const masker = await PersonMasker.create(args.quality === "best" ? "best" : "fast");
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
		const mask = frame ? masker.mask(frame, ms) : null;

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

export const HUMAN_TOOLS = new Set(["explode_layers", "punch_zoom", "add_sound_effect", "duck_music"]);

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
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}
