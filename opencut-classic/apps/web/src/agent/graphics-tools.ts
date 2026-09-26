import { AddTrackCommand, InsertElementCommand } from "@/commands";
import { frameRateToFloat } from "@/fps/utils";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { encodeAlphaVideo } from "./alpha-video";
import {
	type Args,
	allTracks,
	asOneStep,
	editor,
	fromSeconds,
	importMediaFile,
	optNum,
	requireOpenProject,
	str,
	toSeconds,
} from "./helpers";
import { ICON_ID_PATTERN, iconSvgUrl } from "./icons";
import {
	type MotionGraphicSpec,
	type MotionMode,
	MotionGraphicSandbox,
} from "./motion-graphics";

// Tools that generate new footage in the editor window: motion graphics
// from code (and, later, AI cutouts). Results are transparent WebM clips
// imported into the project and placed on their own layer.

const MAX_DURATION_SECONDS = 120;

async function loadImage(url: string): Promise<ImageBitmap> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Could not load image ${url}`);
	const blob = await response.blob();
	if (blob.type.includes("svg")) {
		// createImageBitmap can't decode SVG blobs directly.
		const objectUrl = URL.createObjectURL(blob);
		try {
			const image = new Image();
			image.src = objectUrl;
			await image.decode();
			return await createImageBitmap(image);
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	}
	return createImageBitmap(blob);
}

/** Resolves {name: "icon:mdi:heart~ff0000" | "media:<mediaId>"} to bitmaps. */
async function resolveImages(raw: unknown): Promise<Record<string, ImageBitmap>> {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error('"images" must map names to "icon:<iconId>" or "media:<mediaId>"');
	}
	const images: Record<string, ImageBitmap> = {};
	for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
		const ref = String(value);
		if (ref.startsWith("icon:")) {
			const [iconId] = ref.slice(5).toLowerCase().split("~");
			if (!ICON_ID_PATTERN.test(iconId)) throw new Error(`Bad icon id in images.${name}`);
			images[name] = await loadImage(iconSvgUrl({ value: ref.slice(5).toLowerCase() }));
		} else if (ref.startsWith("media:")) {
			const asset = editor()
				.media.getAssets()
				.find((candidate) => candidate.id === ref.slice(6));
			if (!asset) throw new Error(`No media ${ref.slice(6)} for images.${name}`);
			if (asset.type !== "image") throw new Error(`images.${name} must be an image`);
			images[name] = await createImageBitmap(asset.file);
		} else {
			throw new Error(`images.${name} must be "icon:<iconId>" or "media:<mediaId>"`);
		}
	}
	return images;
}

async function buildSpec(args: Args): Promise<MotionGraphicSpec> {
	const project = requireOpenProject();
	const mode = (args.mode === "three" ? "three" : "2d") as MotionMode;
	const duration = Math.min(Math.max(optNum(args, "duration") ?? 5, 0.1), MAX_DURATION_SECONDS);
	const canvas = project.settings.canvasSize;
	const fps = Math.min(Math.max(Math.round(optNum(args, "fps") ?? frameRateToFloat(project.settings.fps)), 1), 60);
	const fonts = Array.isArray(args.fonts)
		? args.fonts.map(String).filter((font) => /^[\w\s-]{1,60}$/.test(font))
		: [];
	return {
		code: str(args, "code"),
		mode,
		width: Math.round(optNum(args, "width") ?? canvas.width),
		height: Math.round(optNum(args, "height") ?? canvas.height),
		fps,
		duration,
		fonts,
		images: await resolveImages(args.images),
	};
}

async function previewMotionGraphic(args: Args) {
	const spec = await buildSpec(args);
	const times = Array.isArray(args.times)
		? args.times.map(Number).filter((t) => Number.isFinite(t)).slice(0, 8)
		: [0, spec.duration / 2, Math.max(0, spec.duration - 1 / spec.fps)];
	const maxWidth = 768;
	const sandbox = await MotionGraphicSandbox.start(spec);
	try {
		const frames = [];
		for (const [i, time] of times.entries()) {
			const bitmap = await sandbox.renderFrame(i, Math.min(Math.max(time, 0), spec.duration));
			const scale = Math.min(1, maxWidth / bitmap.width);
			const out = document.createElement("canvas");
			out.width = Math.round(bitmap.width * scale);
			out.height = Math.round(bitmap.height * scale);
			const ctx = out.getContext("2d");
			if (ctx) {
				// Checkerboard so transparency is visible.
				const size = 16;
				for (let y = 0; y < out.height; y += size) {
					for (let x = 0; x < out.width; x += size) {
						ctx.fillStyle = (x / size + y / size) % 2 === 0 ? "#3a3a3a" : "#2a2a2a";
						ctx.fillRect(x, y, size, size);
					}
				}
				ctx.drawImage(bitmap, 0, 0, out.width, out.height);
			}
			bitmap.close();
			frames.push({ time, image: out.toDataURL("image/jpeg", 0.85).split(",")[1] });
		}
		return { frames };
	} finally {
		sandbox.dispose();
	}
}

async function createMotionGraphic(args: Args) {
	const spec = await buildSpec(args);
	const name = (typeof args.name === "string" && args.name.trim()) || "Motion graphic";
	const frameCount = Math.max(1, Math.round(spec.duration * spec.fps));

	const sandbox = await MotionGraphicSandbox.start(spec);
	let file: File;
	try {
		file = await encodeAlphaVideo({
			width: spec.width,
			height: spec.height,
			fps: spec.fps,
			frameCount,
			name: name.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "motion",
			drawFrame: async ({ ctx, index, time }) => {
				const bitmap = await sandbox.renderFrame(index, time);
				ctx.drawImage(bitmap, 0, 0, ctx.canvas.width, ctx.canvas.height);
				bitmap.close();
			},
		});
	} finally {
		sandbox.dispose();
	}

	const media = await importMediaFile(file);
	const asset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === media.mediaId);
	if (!asset) throw new Error("The rendered graphic could not be imported.");
	const start = Math.max(0, optNum(args, "start") ?? toSeconds(editor().playback.getCurrentTime()));

	const clip = await asOneStep(() => {
		// Its own layer on top of everything (a cutout of the presenter can
		// later go above it to put the graphic "behind" them).
		const addTrack = new AddTrackCommand({ type: "video", index: 0 });
		addTrack.execute();
		const trackId = addTrack.getTrackId();
		const before = new Set(allTracks().flatMap((t) => t.elements.map((e) => e.id)));
		new InsertElementCommand({
			element: buildElementFromMedia({
				mediaId: asset.id,
				mediaType: asset.type,
				name,
				duration: fromSeconds(spec.duration),
				startTime: fromSeconds(start),
			}),
			placement: { mode: "explicit", trackId },
		}).execute();
		const track = allTracks().find((t) => t.id === trackId);
		const inserted = track?.elements.find((e) => !before.has(e.id));
		if (!inserted) throw new Error("The editor rejected the graphic clip.");
		return { trackId, clipId: inserted.id };
	});

	return {
		...clip,
		mediaId: media.mediaId,
		start,
		end: start + spec.duration,
		frames: frameCount,
		size: `${spec.width}x${spec.height}`,
		note: "Check it with view_frames. To change it, delete_clips this clip and create it again with new code.",
	};
}

export async function runGraphicsTool({
	tool,
	args,
}: {
	tool: string;
	args: Args;
}): Promise<unknown> {
	switch (tool) {
		case "preview_motion_graphic":
			return previewMotionGraphic(args);
		case "create_motion_graphic":
			return createMotionGraphic(args);
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}

