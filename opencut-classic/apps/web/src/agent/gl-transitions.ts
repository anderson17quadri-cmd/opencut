import { frameRateToFloat } from "@/fps/utils";
import { getElementBounds } from "@/preview/element-bounds";
import type { TimelineElement } from "@/timeline";
import { addSoundEffect, renderMotionGraphicClip } from "./graphics-tools";
import { type Args, allTracks, editor, findElement, fromSeconds, optNum, requireOpenProject, str, toSeconds } from "./helpers";
import { FrameCursor, sourceTime } from "./human-tools";

// Shader transitions from gl-transitions (MIT/BSD, vendored in
// /vendor/gl-transitions): glitch, zoom blur, page curl, cube, swirl…
// Both clips are fed frame by frame to the shader in the sandbox and the
// result is rendered as a clip over the cut.

type GlTransition = {
	name: string;
	glsl: string;
	defaultParams?: Record<string, unknown>;
	paramsTypes?: Record<string, string>;
	author?: string;
	license?: string;
};

/** Hand-picked transitions with what they look like, for choosing. */
export const FEATURED_TRANSITIONS: Record<string, string> = {
	fade: "plain crossfade",
	fadecolor: "dip through a colour (black by default)",
	CrossZoom: "punchy zoom blur into the next shot — energetic, very common in Reels",
	DreamyZoom: "soft rotating zoom, dreamy",
	SimpleZoom: "zoom into the next shot",
	directionalwarp: "warped slide, dynamic",
	Directional: "push slide",
	wipeLeft: "clean wipe to the left (also wipeRight, wipeUp, wipeDown)",
	GlitchMemories: "RGB-split digital glitch — tech/gaming vibe",
	GlitchDisplace: "blocky displacement glitch",
	StripDatamoshGlitch: "datamosh strips glitch",
	TVStatic: "TV static noise",
	old_tv_lost_signal: "old TV losing signal",
	Swirl: "swirl/whirlpool",
	ripple: "water ripple",
	WaterDrop: "water drop",
	cube: "3D cube rotation",
	InvertedPageCurl: "page curl like turning a page",
	BookFlip: "book page flip",
	doorway: "doors opening into the next shot",
	circleopen: "circle opening (iris)",
	StarWipe: "star-shaped wipe",
	heart: "heart-shaped reveal",
	pixelize: "pixelate out and in",
	Mosaic: "mosaic tiles",
	FilmBurn: "film burn / light leak — warm, cinematic",
	burn: "bright burn",
	Overexposure: "flash to white overexposure — hits well on a beat",
	LinearBlur: "motion blur crossfade",
	DefocusBlur: "defocus into the next shot",
	windowslice: "sliced blinds",
	kaleidoscope: "kaleidoscope",
	Radial: "radial clock wipe",
	squareswire: "squares wipe",
	colorphase: "colour phase shift",
};

let catalogue: Promise<GlTransition[]> | null = null;

export function loadTransitions(): Promise<GlTransition[]> {
	catalogue ??= fetch("/vendor/gl-transitions/transitions.json")
		.then((response) => {
			if (!response.ok) throw new Error("Transition catalogue missing.");
			return response.json() as Promise<GlTransition[]>;
		})
		.catch((error) => {
			catalogue = null;
			throw error;
		});
	return catalogue;
}

function shaderCode(transition: GlTransition): string {
	return `
const T = ${JSON.stringify({ glsl: transition.glsl, params: transition.defaultParams ?? {} })};
let S = null;
function setup(api) {
	const { THREE, scene, width, height } = api;
	const layer = () => {
		const canvas = document.createElement("canvas");
		canvas.width = width; canvas.height = height;
		const tex = new THREE.CanvasTexture(canvas);
		// Sample the sRGB pixels as-is; the output is written as-is too.
		tex.colorSpace = THREE.NoColorSpace;
		tex.minFilter = THREE.LinearFilter;
		tex.generateMipmaps = false;
		return { canvas, ctx: canvas.getContext("2d"), tex };
	};
	const from = layer(), to = layer();
	const uniforms = {
		uFrom: { value: from.tex },
		uTo: { value: to.tex },
		progress: { value: 0 },
		ratio: { value: width / height },
	};
	for (const [key, value] of Object.entries(T.params)) uniforms[key] = { value };
	const material = new THREE.ShaderMaterial({
		uniforms,
		vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
		fragmentShader:
			"uniform sampler2D uFrom; uniform sampler2D uTo; uniform float progress; uniform float ratio; varying vec2 vUv;\\n" +
			"vec4 getFromColor(vec2 uv) { return texture2D(uFrom, uv); }\\n" +
			"vec4 getToColor(vec2 uv) { return texture2D(uTo, uv); }\\n" +
			T.glsl +
			"\\nvoid main() { gl_FragColor = transition(vUv); }",
		depthTest: false,
		depthWrite: false,
	});
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
	quad.frustumCulled = false;
	scene.add(quad);
	S = { from, to, uniforms };
}
function paint(layer, bitmap) {
	if (!bitmap) return;
	layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
	layer.ctx.drawImage(bitmap, 0, 0);
	layer.tex.needsUpdate = true;
	if (bitmap.close) bitmap.close();
}
function render({ t, duration, frames, ease, clamp }) {
	paint(S.from, frames.from);
	paint(S.to, frames.to);
	S.uniforms.progress.value = ease.inOut(clamp(t / duration));
}
`;
}

/** Draws a clip as it appears on the canvas at a timeline time, reaching past its edges for handles. */
class ClipPainter {
	private cursor: FrameCursor | null = null;
	private image: ImageBitmap | null = null;
	private canvas: OffscreenCanvas;

	constructor(
		private element: TimelineElement,
		private file: File,
		private width: number,
		private height: number,
		private background: string,
		private mediaDuration: number,
		windowStart: number,
		windowEnd: number,
	) {
		this.canvas = new OffscreenCanvas(width, height);
		if (element.type === "video") {
			const clampSource = (time: number) => Math.min(Math.max(sourceTime(element, time), 0), Math.max(0, mediaDuration - 0.05));
			this.cursor = new FrameCursor(file, clampSource(windowStart), clampSource(windowEnd), 1920);
		}
	}

	async bitmapAt(timeline: number): Promise<ImageBitmap> {
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas unavailable.");
		ctx.fillStyle = this.background;
		ctx.fillRect(0, 0, this.width, this.height);
		const start = toSeconds(this.element.startTime);
		const local = Math.min(Math.max(timeline - start, 0), toSeconds(this.element.duration) - 1e-3);
		const bounds = getElementBounds({
			element: this.element,
			canvasSize: { width: this.width, height: this.height },
			mediaAsset: editor()
				.media.getAssets()
				.find((asset) => "mediaId" in this.element && asset.id === this.element.mediaId),
			localTime: fromSeconds(local),
		});
		let source: CanvasImageSource | null = null;
		if (this.cursor) {
			const time = Math.min(Math.max(sourceTime(this.element, timeline), 0), Math.max(0, this.mediaDuration - 0.05));
			source = await this.cursor.at(time);
		} else {
			this.image ??= await createImageBitmap(this.file);
			source = this.image;
		}
		if (source && bounds) {
			ctx.save();
			ctx.translate(bounds.cx, bounds.cy);
			if (bounds.rotation) ctx.rotate((bounds.rotation * Math.PI) / 180);
			ctx.drawImage(source, -bounds.width / 2, -bounds.height / 2, bounds.width, bounds.height);
			ctx.restore();
		}
		return createImageBitmap(this.canvas);
	}

	async close() {
		await this.cursor?.close();
		this.image?.close();
	}
}

function trackIndexOf(trackId: string): number {
	const tracks = editor().scenes.getActiveScene().tracks;
	const index = tracks.overlay.findIndex((track) => track.id === trackId);
	return index >= 0 ? index : tracks.overlay.length;
}

async function addTransitionFx(args: Args) {
	const project = requireOpenProject();
	const from = findElement(str(args, "fromClipId"));
	if (from.element.type !== "video" && from.element.type !== "image") throw new Error("fromClipId must be a video or image clip.");
	const cut = toSeconds(from.element.startTime) + toSeconds(from.element.duration);
	const toId = typeof args.toClipId === "string" ? args.toClipId : null;
	const to = toId
		? findElement(toId)
		: (() => {
				const frame = 1 / Math.max(1, frameRateToFloat(project.settings.fps));
				for (const track of allTracks()) {
					const next = track.elements.find(
						(e) => e.id !== from.element.id && (e.type === "video" || e.type === "image") && Math.abs(toSeconds(e.startTime) - cut) < frame,
					);
					if (next) return { track, element: next };
				}
				throw new Error("No clip starts where that one ends; give toClipId.");
			})();
	if (to.element.type !== "video" && to.element.type !== "image") throw new Error("toClipId must be a video or image clip.");

	const all = await loadTransitions();
	const wanted = typeof args.type === "string" ? args.type : "CrossZoom";
	const transition = all.find((t) => t.name.toLowerCase() === wanted.toLowerCase());
	if (!transition) throw new Error(`Unknown transition "${wanted}". Use list_transition_effects.`);

	const duration = Math.min(Math.max(optNum(args, "duration") ?? 0.7, 0.2), 3);
	const start = Math.max(0, cut - duration / 2);
	const end = start + duration;
	const { width, height } = project.settings.canvasSize;
	const background = project.settings.background.type === "color" ? project.settings.background.color : "#000000";
	const assetOf = (element: TimelineElement) =>
		editor()
			.media.getAssets()
			.find((asset) => "mediaId" in element && asset.id === element.mediaId);
	const fromAsset = assetOf(from.element);
	const toAsset = assetOf(to.element);
	if (!fromAsset || !toAsset) throw new Error("A clip's media is missing.");
	const fromPainter = new ClipPainter(from.element, fromAsset.file, width, height, background, fromAsset.duration ?? 1e9, start, end);
	const toPainter = new ClipPainter(to.element, toAsset.file, width, height, background, toAsset.duration ?? 1e9, start, end);

	let result: Awaited<ReturnType<typeof renderMotionGraphicClip>>;
	try {
		result = await renderMotionGraphicClip({
			spec: {
				code: shaderCode(transition),
				mode: "three",
				width,
				height,
				fps: Math.min(Math.max(Math.round(frameRateToFloat(project.settings.fps)), 1), 60),
				duration,
			},
			name: `Transição ${transition.name}`,
			start,
			trackIndex: Math.min(trackIndexOf(from.track.id), trackIndexOf(to.track.id)),
			frames: async (_index, time) => {
				const [fromBitmap, toBitmap] = await Promise.all([
					fromPainter.bitmapAt(start + time),
					toPainter.bitmapAt(start + time),
				]);
				return { from: fromBitmap, to: toBitmap };
			},
		});
	} finally {
		await fromPainter.close();
		await toPainter.close();
	}

	// A whoosh (by default) peaking on the cut.
	const sound =
		args.sound === "none"
			? null
			: await addSoundEffect({ effect: typeof args.sound === "string" ? args.sound : "whoosh", at: cut, volumeDb: -6 });
	return {
		...result,
		transition: transition.name,
		cutAt: Math.round(cut * 100) / 100,
		...(sound ? { soundClipId: sound.clipId } : {}),
		note: "Rendered over the cut from the two clips (their spare footage is used when there is some, otherwise the edge frames hold). If you change either clip later, delete this clip and add the transition again.",
	};
}

async function listTransitionEffects() {
	const all = await loadTransitions();
	return {
		featured: FEATURED_TRANSITIONS,
		all: all.map((t) => t.name),
		note: "Pass the name as type to add_transition_effect. Keep 0.4-0.9 s; use them at scene changes, not between every sentence.",
	};
}

export const TRANSITION_TOOLS = new Set(["add_transition_effect", "list_transition_effects"]);

export async function runTransitionTool({ tool, args }: { tool: string; args: Args }): Promise<unknown> {
	switch (tool) {
		case "add_transition_effect":
			return addTransitionFx(args);
		case "list_transition_effects":
			return listTransitionEffects();
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}
