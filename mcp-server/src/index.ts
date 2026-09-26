#!/usr/bin/env node
/**
 * Claude Desktop extension for OpenCut. Every tool is forwarded to the
 * running OpenCut app, which executes it in the editor window the user is
 * looking at (see opencut-classic/apps/web/src/agent).
 */
import { request } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OPENCUT_URL = process.env.OPENCUT_URL ?? "http://127.0.0.1:47821";

const INSTRUCTIONS = `You control OpenCut, a video editor running on the user's computer. Every change you make appears live in the OpenCut window, and the user can undo it there too (Ctrl+Z), so edit boldly but check your work. Work like a professional video editor.

Basics:
- Times are always in seconds. Keyframe times in animate are seconds from the clip's own start.
- Start with get_state: project format, tracks, clips (ids, timing, layout on screen, text style, effects, animations) and imported media. Re-read it after edits instead of guessing ids.
- If no project is open, use list_projects + open_project, or create_project.
- To bring in the user's files: list_media_files (Videos, Downloads, Desktop, Music, Pictures by default), add_media with the full path, then add_to_timeline. Clips that overlap in time go on separate layers; later layers are drawn on top.
- Look at the result with view_frames whenever layout or looks matter (titles, icons, captions, colour, masks). It returns images of the actual frames.

Editing:
- Remove a section of the whole video with cut_range (later clips move left, no gap). For one clip only, split_clip + delete_clips, or trim_clip.
- remove_silences cuts pauses from talking videos (find_silences previews them). transcribe gives what is said with timestamps, useful to cut by content or to write chapters, titles and descriptions.
- Social-media captions where the spoken word lights up: generate_captions with style "karaoke".
- Objects in the presenter's hand (logos floating in the palm, following it): create the object (add_icon / create_motion_graphic small, e.g. widthPercent 18), then follow_hand with the talking-head clip; combine with cutout_person to let it pass behind them.
- Captions: generate_captions transcribes the audio and adds styled captions on their own track (the first run downloads a speech model, which can take a few minutes). add_captions adds captions you write yourself (e.g. translations). Restyle them all later with set_clip_properties using the captions trackId. fontSize ≈ percent of video height × 0.9 (5 = normal captions, 8 = big social-media captions).
- Layout: set_clip_properties places any visual clip with anchor (top-left … bottom-right, center) plus margin, or x/y (centre, % of the frame), and sizes it with widthPercent/heightPercent. It also styles text (font, size, colour, bold, background box), opacity, rotation, blend mode.
- Titles: add_text, then set_clip_properties to style and place it, then animate for motion.
- Icons, emojis, logos and flags: search_icons (English keywords) then add_icon. Shapes (boxes, circles, bars behind text): add_shape.
- Layers: tracks listed first in get_state are drawn on top. move_layer brings a layer to the front/back or above/below another.
- Graphics behind the presenter (logos floating behind them, text behind the head, 3D screens in the background, "the scene splits into layers"): run cutout_person on the talking-head clip; motion graphics created before or after it land under the cutout, so they appear between the background and the person. Use move_layer for other clips (icons, text) that should go behind.
- Motion graphics (animated titles, VS cards, animated explainers/recipes/infographics, counters, 3D objects, floating screens, end cards, anything the built-in tools can't do): write code for create_motion_graphic; iterate with preview_motion_graphic first. Use search_icons ids as images for logos.
- Animation: animate with a preset (fade_in, fade_out, pop_in, slide_in_left, zoom_in for a Ken Burns effect, …) or custom keyframes. For audio, fade_in/fade_out ramp the volume.
- Looks: list_effects, then add_effect on one clip (clipId) or on every video/image clip in a time range (no clipId). Available: blur, colour adjustment (brightness, contrast, saturation, exposure, temperature…), black & white, sepia, vignette, sharpen, chroma key (green screen removal). add_mask cuts a clip to a shape (circle, heart, star, cinematic bars…).
- Format for Reels/TikTok/Shorts: set_project aspectRatio "9:16"; YouTube: "16:9"; Instagram feed: "4:5" or "1:1". Then check framing with view_frames and adjust clip scale/position.
- Music: add_media the audio file, add_to_timeline, set_volume (e.g. -18 dB under speech), animate fade_out at the end.
- Transitions between shots: add_transition (crossfade, fade_black, slides, zoom), or all=true for every cut.
- From the internet: when the user asks for music, sound effects, images or b-roll, search_free_media then download_media (it also imports the file). For a link the user gives, download_media directly. YouTube/Instagram/TikTok pages can't be downloaded. Mention the license/credit when it requires attribution.
- Pictures for what is being said (automatic b-roll — "put images when I mention something"): 1) transcribe with words=true; 2) pick the concrete references worth illustrating (products, brands, places, people, objects, foods, numbers/events) — usually one every 3-8 s, not every noun; 3) for each, search_free_media type "image" with English keywords: it returns preview pictures, look at them and choose the one that really shows the thing (skip it if none fits); 4) add_web_image with that url, start = the time the word is spoken (≈0.1 s before), duration 2-4 s, style "card" (pop-up photo, anchor "top" on vertical videos so the face stays clear), "fullscreen" (cutaway covering the frame) or "plain"; alternate positions/styles for variety; 5) view_frames at a few of those times to check. For a logo, prefer search_icons + add_icon. Tell the user which pictures you used and their licenses.

Slow operations (export, transcription, captions, silence removal, downloads) may answer \"still working\" with a taskId: call check_task with it until you get the result.

Finish with export_video: it renders and saves under the user's Videos\\OpenCut folder; tell the user the path it returns.
If a tool says OpenCut is not open, ask the user to open the OpenCut app and try again. Reply to the user in their language.`;

const MOTION_GUIDE = `Write JavaScript that defines render(api) (and optionally setup(api)). It is called once per frame with api.t = time in seconds (0 … duration) and api.progress (0 … 1). Compute everything from t (frames may be rendered in any order); no imports, network or DOM.

mode "2d" (default): draw on api.ctx, a CanvasRenderingContext2D of api.width × api.height (the video size, e.g. 1080×1920 for 9:16). It starts transparent and cleared every frame, so only what you draw covers the video below.
mode "three": api.THREE (three.js r170), api.scene, api.camera (PerspectiveCamera, fov 35, at z=12 looking at the origin) and api.renderer are ready. Build meshes/lights in setup(api), store them on api.state, move them in render(api); the scene is rendered automatically after render. Transparent background.

Helpers: api.tween(t, t0, t1, from, to, easing) eases a value between two times (clamped); api.ease.{linear,in,out,inOut,back,elastic,bounce}; api.lerp, api.clamp; api.roundRect(ctx, x, y, w, h, radius) then ctx.fill(); api.images.name = ImageBitmaps from the images param; fonts: pass fonts: ["Montserrat"] and use ctx.font = "800 96px Montserrat".

Example (2d title that pops in and out):
function render({ ctx, t, width, height, tween, ease, duration }) {
  const s = tween(t, 0, 0.5, 0, 1, ease.back) * tween(t, duration - 0.4, duration, 1, 0);
  ctx.translate(width / 2, height * 0.2); ctx.scale(s, s);
  ctx.font = "900 110px Montserrat"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 30;
  ctx.fillText("QUEM EDITA MELHOR?", 0, 0);
}

Design tips: keep safe margins (~6% of the frame), large bold type for mobile, 2-4 colours, ease in/out every motion (0.3-0.6 s), stagger elements, leave the presenter's face clear unless the graphic is fullscreen.`;

type ToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

/**
 * POST without a client-side time limit. fetch() would give up after
 * undici's 5-minute headers timeout, but exports and the first
 * transcription (model download) can legitimately take longer.
 */
function postJson(url: string, body: unknown): Promise<unknown> {
	const payload = JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(payload),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
					} catch (error) {
						reject(error);
					}
				});
				res.on("error", reject);
			},
		);
		req.on("error", reject);
		req.end(payload);
	});
}

type ToolResult = { content: ToolContent[]; isError?: boolean };

async function runOnOpenCut(
	tool: string,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	let reply: { ok: boolean; result?: unknown; error?: string };
	try {
		reply = (await postJson(`${OPENCUT_URL}/api/agent/commands`, { tool, args })) as typeof reply;
	} catch {
		return {
			content: [
				{
					type: "text",
					text: "Could not reach OpenCut. Ask the user to open the OpenCut app, then try again.",
				},
			],
			isError: true,
		};
	}

	if (!reply.ok) {
		return {
			content: [{ type: "text", text: reply.error ?? "OpenCut reported an error." }],
			isError: true,
		};
	}
	return {
		content: [{ type: "text", text: JSON.stringify(reply.result ?? null, null, 2) }],
	};
}

// MCP clients time out tool calls (often after about a minute), but an
// export or the first transcription can take much longer. If a call isn't
// done within WAIT_MS it keeps running here and Claude gets a task id to
// poll with check_task.
const WAIT_MS = 40_000;
const pendingTasks = new Map<string, { tool: string; startedAt: number; promise: Promise<ToolResult> }>();
let nextTaskId = 1;

function stillRunning(taskId: string, tool: string, startedAt: number): ToolResult {
	const seconds = Math.round((Date.now() - startedAt) / 1000);
	return {
		content: [
			{
				type: "text",
				text: `OpenCut is still working on ${tool} (${seconds}s so far). Call check_task with taskId "${taskId}" to wait for the result. Tell the user it is in progress if it takes long.`,
			},
		],
	};
}

async function waitFor(taskId: string, tool: string, startedAt: number, promise: Promise<ToolResult>) {
	const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS));
	const result = await Promise.race([promise, timer]);
	if (result) {
		pendingTasks.delete(taskId);
		return result;
	}
	pendingTasks.set(taskId, { tool, startedAt, promise });
	return stillRunning(taskId, tool, startedAt);
}

async function callOpenCut(
	tool: string,
	args: Record<string, unknown> = {},
): Promise<ToolResult> {
	const taskId = String(nextTaskId++);
	return waitFor(taskId, tool, Date.now(), runOnOpenCut(tool, args));
}

async function checkTask(taskId: string): Promise<ToolResult> {
	const task = pendingTasks.get(taskId);
	if (!task) {
		return {
			content: [{ type: "text", text: `No running task "${taskId}" (it may have finished and been reported already).` }],
			isError: true,
		};
	}
	return waitFor(taskId, task.tool, task.startedAt, task.promise);
}

/** view_frames returns JPEGs; hand them to Claude as images. */
async function callViewFrames(args: Record<string, unknown>, tool = "view_frames") {
	const result = await callOpenCut(tool, args);
	if (result.isError) return result;
	const first = result.content[0];
	if (first.type === "text" && first.text.startsWith("OpenCut is still working")) return result;
	const parsed = JSON.parse(first.type === "text" ? first.text : "{}") as {
		frames?: Array<{ time: number; image: string }>;
	};
	const content: ToolContent[] = [];
	for (const frame of parsed.frames ?? []) {
		content.push({ type: "text", text: `Frame at ${frame.time}s:` });
		content.push({ type: "image", data: frame.image, mimeType: "image/jpeg" });
	}
	return { content };
}

/** Image search results carry base64 previews; show them as pictures. */
async function callSearchWithPreviews(args: Record<string, unknown>): Promise<ToolResult> {
	const result = await callOpenCut("search_free_media", args);
	const first = result.content[0];
	if (result.isError || first?.type !== "text" || first.text.startsWith("OpenCut is still working")) {
		return result;
	}
	let parsed: { results?: Array<Record<string, unknown>> } & Record<string, unknown>;
	try {
		parsed = JSON.parse(first.text);
	} catch {
		return result;
	}
	const images: ToolContent[] = [];
	const results = (parsed.results ?? []).map((item, index) => {
		const { preview, ...rest } = item as { preview?: { data: string; mimeType: string }; title?: unknown };
		if (preview) {
			images.push({ type: "text", text: `#${index + 1}: ${String(rest.title ?? "")}` });
			images.push({ type: "image", data: preview.data, mimeType: preview.mimeType });
		}
		return { "#": index + 1, ...rest };
	});
	return {
		content: [{ type: "text", text: JSON.stringify({ ...parsed, results }, null, 2) }, ...images],
	};
}

const server = new McpServer(
	{ name: "opencut", version: "0.6.0" },
	{ instructions: INSTRUCTIONS },
);

const clipId = z.string().describe("Clip id from get_state");

server.registerTool(
	"get_state",
	{
		title: "Get project state",
		description:
			"Open project (size, fps), playhead, tracks and clips (ids, start/end in seconds, on-screen layout in % of the frame, text and style, speed, volume, effects, masks, animated properties) and imported media.",
	},
	() => callOpenCut("get_state"),
);

server.registerTool(
	"list_media_files",
	{
		title: "List media files",
		description:
			"List video, audio and image files in a folder. Without a folder, lists the user's Videos, Downloads, Desktop, Music and Pictures folders.",
		inputSchema: {
			folder: z.string().optional().describe("Absolute folder path"),
		},
	},
	(args) => callOpenCut("list_media_files", args),
);

server.registerTool(
	"list_projects",
	{ title: "List projects", description: "List the user's OpenCut projects." },
	() => callOpenCut("list_projects"),
);

server.registerTool(
	"create_project",
	{
		title: "Create project",
		description: "Create a new empty project and open it in OpenCut.",
		inputSchema: { name: z.string().optional() },
	},
	(args) => callOpenCut("create_project", args),
);

server.registerTool(
	"open_project",
	{
		title: "Open project",
		description: "Open an existing project (id from list_projects). Returns its state.",
		inputSchema: { projectId: z.string() },
	},
	(args) => callOpenCut("open_project", args),
);

server.registerTool(
	"add_media",
	{
		title: "Import media",
		description:
			"Import a video, audio or image file from disk into the open project's media library. Returns a mediaId for add_to_timeline.",
		inputSchema: { path: z.string().describe("Absolute path to the file") },
	},
	(args) => callOpenCut("add_media", args),
);

server.registerTool(
	"add_to_timeline",
	{
		title: "Add media to timeline",
		description:
			"Place imported media on the timeline. Without start, it is appended at the end. Without duration, the full media length is used (images default to a few seconds).",
		inputSchema: {
			mediaId: z.string(),
			start: z.number().min(0).optional().describe("Seconds"),
			duration: z.number().positive().optional().describe("Seconds"),
		},
	},
	(args) => callOpenCut("add_to_timeline", args),
);

server.registerTool(
	"add_text",
	{
		title: "Add text",
		description:
			"Add a text overlay (title, label, call to action), centred on the frame. fontSize ≈ % of video height × 0.9 (default 15 is large; 8-10 for titles on busy footage). Style, place and animate it afterwards with set_clip_properties and animate.",
		inputSchema: {
			text: z.string(),
			start: z.number().min(0).describe("Seconds"),
			duration: z.number().positive().optional().describe("Seconds, default 3"),
			fontSize: z.number().positive().optional(),
			color: z.string().optional().describe('Hex color, e.g. "#ffffff"'),
		},
	},
	(args) => callOpenCut("add_text", args),
);

server.registerTool(
	"split_clip",
	{
		title: "Split clip",
		description:
			"Split a clip in two at a timeline time. Returns the ids of the left and right pieces.",
		inputSchema: { clipId, time: z.number().describe("Timeline seconds") },
	},
	(args) => callOpenCut("split_clip", args),
);

server.registerTool(
	"delete_clips",
	{
		title: "Delete clips",
		description: "Delete clips from the timeline. This leaves a gap where they were.",
		inputSchema: { clipIds: z.array(z.string()).min(1) },
	},
	(args) => callOpenCut("delete_clips", args),
);

server.registerTool(
	"move_clip",
	{
		title: "Move clip",
		description: "Move a clip to a new start time, optionally onto another track.",
		inputSchema: {
			clipId,
			start: z.number().min(0).describe("New start, seconds"),
			trackId: z.string().optional(),
		},
	},
	(args) => callOpenCut("move_clip", args),
);

server.registerTool(
	"set_speed",
	{
		title: "Set clip speed",
		description:
			"Change playback speed of a video or audio clip (0.1–10; 2 = twice as fast, 0.5 = slow motion, 1 = normal). Changes the clip's length.",
		inputSchema: { clipId, speed: z.number().min(0.1).max(10) },
	},
	(args) => callOpenCut("set_speed", args),
);

server.registerTool(
	"set_volume",
	{
		title: "Set clip volume",
		description:
			"Change a video or audio clip's volume in decibels (0 = original, -6 = about half as loud, positive = louder) and/or mute it.",
		inputSchema: {
			clipId,
			volumeDb: z.number().optional(),
			muted: z.boolean().optional(),
		},
	},
	(args) => callOpenCut("set_volume", args),
);

server.registerTool(
	"seek",
	{
		title: "Move playhead",
		description: "Move the playhead so the user sees that moment in the preview.",
		inputSchema: { time: z.number().min(0).describe("Seconds") },
	},
	(args) => callOpenCut("seek", args),
);

server.registerTool(
	"undo",
	{ title: "Undo", description: "Undo the last edit." },
	() => callOpenCut("undo"),
);

server.registerTool(
	"redo",
	{ title: "Redo", description: "Redo the last undone edit." },
	() => callOpenCut("redo"),
);

server.registerTool(
	"export_video",
	{
		title: "Export video",
		description:
			"Render the timeline to a video file in the user's Videos\\OpenCut folder and return its path. Can take a while for long videos.",
		inputSchema: {
			name: z.string().optional().describe("File name without extension; defaults to the project name"),
			format: z.enum(["mp4", "webm"]).optional().describe("Default mp4"),
			quality: z.enum(["low", "medium", "high", "very_high"]).optional().describe("Default high"),
		},
	},
	(args) => callOpenCut("export_video", args),
);

const anchor = z
	.enum(["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"])
	.optional()
	.describe("Snap the clip's box to this spot of the frame");
const placement = {
	anchor,
	margin: z.number().min(0).max(40).optional().describe("Padding from the frame edge for anchor, % of the shorter side (default 5)"),
	x: z.number().optional().describe("Horizontal centre, % of frame width (0 = left edge, 50 = middle)"),
	y: z.number().optional().describe("Vertical centre, % of frame height (0 = top, 50 = middle)"),
	widthPercent: z.number().positive().max(400).optional().describe("Width as % of the frame width (keeps aspect ratio unless heightPercent is also given)"),
	heightPercent: z.number().positive().max(400).optional().describe("Height as % of the frame height"),
};
const hex = z.string().describe('Hex colour, e.g. "#ffcc00"');
const timing = {
	start: z.number().min(0).optional().describe("Timeline seconds; default the playhead"),
	duration: z.number().positive().optional().describe("Seconds, default 3"),
};

server.registerTool(
	"view_frames",
	{
		title: "Look at frames",
		description:
			"Render frames of the edited video (with all layers, text, effects) and return them as images so you can see the result. Use it to check framing, titles, captions and colour.",
		inputSchema: {
			times: z.array(z.number().min(0)).min(1).max(8).optional().describe("Timeline seconds to render; default the playhead"),
			width: z.number().min(160).max(1280).optional().describe("Image width in pixels, default 768"),
		},
	},
	(args) => callViewFrames(args),
);

server.registerTool(
	"set_clip_properties",
	{
		title: "Style and place clips",
		description:
			"Change clips' position, size, rotation, opacity, blend mode and visibility; text content and style; shape colours; volume. Target clips by id and/or a whole track (e.g. all captions). Options that don't apply to a clip type are ignored and reported.",
		inputSchema: {
			clipIds: z.array(z.string()).optional(),
			trackId: z.string().optional().describe("Apply to every clip on this track"),
			...placement,
			scale: z.number().positive().optional().describe("Absolute scale, 1 = fitted to the frame"),
			rotation: z.number().min(-360).max(360).optional().describe("Degrees"),
			opacity: z.number().min(0).max(100).optional().describe("Percent"),
			blendMode: z.enum(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "plus-lighter"]).optional(),
			hidden: z.boolean().optional(),
			text: z.string().optional().describe("New text content"),
			fontFamily: z.string().optional().describe('Any Google Font name (e.g. "Montserrat", "Bebas Neue", "Poppins") or Arial'),
			fontSize: z.number().positive().optional().describe("≈ % of video height × 0.9; 5 = captions, 10 = title, 15 = default"),
			color: hex.optional(),
			bold: z.boolean().optional(),
			italic: z.boolean().optional(),
			underline: z.boolean().optional(),
			align: z.enum(["left", "center", "right"]).optional(),
			letterSpacing: z.number().optional(),
			lineHeight: z.number().positive().optional(),
			background: z.string().optional().describe('Text box colour (hex) or "none"'),
			backgroundRadius: z.number().min(0).optional(),
			backgroundPadding: z.number().min(0).optional(),
			fill: hex.optional().describe("Shape fill colour"),
			stroke: hex.optional().describe("Shape outline colour"),
			strokeWidth: z.number().min(0).optional(),
			cornerRadius: z.number().min(0).optional().describe("Rounded corners for rectangles"),
			volumeDb: z.number().min(-60).max(20).optional(),
			muted: z.boolean().optional(),
		},
	},
	(args) => callOpenCut("set_clip_properties", args),
);

server.registerTool(
	"animate",
	{
		title: "Animate a clip",
		description:
			"Add motion to a clip with a preset or custom keyframes. Presets: fade_in, fade_out (also fade audio), zoom_in / zoom_out (slow Ken Burns zoom over the whole clip), slide_in_left|right|top|bottom, slide_out_left|right|top|bottom, pop_in, pop_out, spin, pulse, shake. Custom keyframes: property opacity (0-100), scale (multiplier of current size), x / y (centre, % of frame), rotation (degrees) or volume (dB), at times in seconds from the clip start.",
		inputSchema: {
			clipId,
			preset: z.enum(["fade_in", "fade_out", "zoom_in", "zoom_out", "slide_in_left", "slide_in_right", "slide_in_top", "slide_in_bottom", "slide_out_left", "slide_out_right", "slide_out_top", "slide_out_bottom", "pop_in", "pop_out", "spin", "pulse", "shake"]).optional(),
			duration: z.number().positive().optional().describe("Length of in/out presets in seconds (default 0.5); pulse period; shake length"),
			intensity: z.number().positive().optional().describe("zoom factor (default 1.2), spin turns, pulse size (1.08), shake strength"),
			keyframes: z
				.array(
					z.object({
						property: z.enum(["opacity", "scale", "x", "y", "rotation", "volume"]),
						time: z.number().min(0).describe("Seconds from the clip start"),
						value: z.number(),
					}),
				)
				.optional(),
			easing: z.enum(["linear", "smooth"]).optional(),
		},
	},
	(args) => callOpenCut("animate", args),
);

server.registerTool(
	"remove_animations",
	{
		title: "Remove animations",
		description: "Remove a clip's keyframes, for one property or all of them.",
		inputSchema: {
			clipId,
			property: z.enum(["opacity", "scale", "x", "y", "position", "rotation", "volume"]).optional(),
		},
	},
	(args) => callOpenCut("remove_animations", args),
);

const languageSchema = z
	.enum(["pt", "en", "es", "fr", "it", "de", "ru", "ja", "zh"])
	.optional()
	.describe("Spoken language; omit to auto-detect");
const captionStyle = {
	fontFamily: z.string().optional(),
	fontSize: z.number().positive().optional().describe("Default 5; 7-9 for bold social-media captions"),
	color: hex.optional(),
	bold: z.boolean().optional(),
	background: z.string().optional().describe('Box behind the text (hex) or "none"'),
	position: z.enum(["bottom", "middle", "top"]).optional(),
	uppercase: z.boolean().optional(),
};

server.registerTool(
	"transcribe",
	{
		title: "Transcribe speech",
		description:
			"Transcribe the timeline's audio on this computer and return what is said with start/end times (seconds). words=true returns every word with its own timing (for precise cuts or custom animated text). Nothing is changed. The first run downloads a speech model and can take a few minutes.",
		inputSchema: { language: languageSchema, words: z.boolean().optional() },
	},
	(args) => callOpenCut("transcribe", args),
);

server.registerTool(
	"generate_captions",
	{
		title: "Generate captions",
		description:
			"Transcribe the timeline's audio and add captions. style \"classic\" (default): text clips on a new track, editable word by word with set_clip_properties (returns each caption's id). style \"karaoke\": social-media captions where the word being spoken lights up (highlightColor) and pops, short phrases, bold uppercase with outline — rendered as one animated clip (regenerate to change).",
		inputSchema: {
			language: languageSchema,
			style: z.enum(["classic", "karaoke"]).optional(),
			highlightColor: hex.optional().describe("karaoke: colour of the spoken word (default yellow)"),
			wordsPerCaption: z.number().int().min(1).max(20).optional().describe("Words per caption (default 3); 1-3 for fast social captions"),
			...captionStyle,
		},
	},
	(args) => callOpenCut("generate_captions", args),
);

server.registerTool(
	"add_captions",
	{
		title: "Add captions",
		description: "Add captions you provide (e.g. translated or corrected) as text clips on a new track.",
		inputSchema: {
			captions: z
				.array(z.object({ start: z.number().min(0), end: z.number().positive(), text: z.string().min(1) }))
				.min(1),
			...captionStyle,
		},
	},
	(args) => callOpenCut("add_captions", args),
);

server.registerTool(
	"search_icons",
	{
		title: "Search icons and emojis",
		description:
			'Search 200,000+ open-source icons, emojis, logos and flags (Iconify). Use English keywords. Returns ids like "mdi:heart" or "fluent-emoji-flat:fire" for add_icon.',
		inputSchema: {
			query: z.string().min(1),
			style: z.enum(["any", "emoji", "color", "outline", "solid", "logos", "flags"]).optional(),
			limit: z.number().int().min(1).max(64).optional(),
		},
	},
	(args) => callOpenCut("search_icons", args),
);

server.registerTool(
	"add_icon",
	{
		title: "Add icon or emoji",
		description: "Put an icon/emoji/logo/flag from search_icons on the video, sized and placed on the frame (default: centre, 15% of the width).",
		inputSchema: {
			iconId: z.string().describe('From search_icons, e.g. "mdi:heart"'),
			color: hex.optional().describe("Recolour single-colour icons"),
			...timing,
			...placement,
		},
	},
	(args) => callOpenCut("add_icon", args),
);

server.registerTool(
	"add_shape",
	{
		title: "Add shape",
		description: "Add a shape (box behind text, highlight, circle, arrow-like triangle, star…). Give both widthPercent and heightPercent to stretch it (e.g. a lower-third bar).",
		inputSchema: {
			shape: z.enum(["rectangle", "square", "circle", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star"]),
			fill: hex.optional(),
			stroke: hex.optional(),
			strokeWidth: z.number().min(0).optional(),
			cornerRadius: z.number().min(0).optional(),
			opacity: z.number().min(0).max(100).optional(),
			...timing,
			...placement,
		},
	},
	(args) => callOpenCut("add_shape", args),
);

server.registerTool(
	"list_effects",
	{ title: "List effects", description: "Effects available for add_effect, with their params and ranges." },
	() => callOpenCut("list_effects"),
);

server.registerTool(
	"add_effect",
	{
		title: "Add effect",
		description:
			"Apply an effect (see list_effects: blur, color-adjust, black-white, sepia, vignette, sharpen, chroma-key) to one clip with clipId, or without clipId to every video and image clip in a time range (default: the whole video) — e.g. a colour grade for the whole edit.",
		inputSchema: {
			effect: z.string().describe("Effect type from list_effects"),
			clipId: z.string().optional(),
			params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional().describe('e.g. {"brightness": 10, "saturation": 20}'),
			start: z.number().min(0).optional().describe("Without clipId: range start (seconds)"),
			duration: z.number().positive().optional().describe("Without clipId: range length (seconds)"),
		},
	},
	(args) => callOpenCut("add_effect", args),
);

server.registerTool(
	"update_effect",
	{
		title: "Change effect settings",
		description: "Change params of an effect on a clip (effectId from get_state).",
		inputSchema: {
			clipId,
			effectId: z.string().optional().describe("Needed when the clip has more than one effect"),
			params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
		},
	},
	(args) => callOpenCut("update_effect", args),
);

server.registerTool(
	"remove_effect",
	{
		title: "Remove effect",
		description: "Remove one effect (effectId) or all effects from a clip, or delete an adjustment-layer clip.",
		inputSchema: { clipId, effectId: z.string().optional() },
	},
	(args) => callOpenCut("remove_effect", args),
);

server.registerTool(
	"add_mask",
	{
		title: "Add mask",
		description: "Show only part of a video/image/shape clip: rectangle, ellipse (circle), heart, diamond, star, split, cinematic-bars (letterbox) or text. inverted hides that part instead.",
		inputSchema: {
			clipId,
			shape: z.enum(["rectangle", "ellipse", "heart", "diamond", "star", "split", "cinematic-bars", "text"]),
			inverted: z.boolean().optional(),
			feather: z.number().min(0).max(100).optional().describe("Soft edge"),
		},
	},
	(args) => callOpenCut("add_mask", args),
);

server.registerTool(
	"remove_mask",
	{ title: "Remove mask", description: "Remove a clip's mask.", inputSchema: { clipId } },
	(args) => callOpenCut("remove_mask", args),
);

server.registerTool(
	"set_project",
	{
		title: "Project format",
		description: 'Change the video format (aspectRatio "9:16" for Reels/TikTok/Shorts, "16:9" YouTube, "1:1", "4:5", "4:3", "21:9", or exact width/height), frame rate, and the background shown behind clips (colour or blurred video).',
		inputSchema: {
			aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"]).optional(),
			width: z.number().int().min(16).max(7680).optional(),
			height: z.number().int().min(16).max(7680).optional(),
			fps: z.number().min(1).max(240).optional(),
			backgroundColor: hex.optional(),
			backgroundBlur: z.number().min(0).max(100).optional().describe("Blurred copy of the video as background (good for vertical from horizontal)"),
		},
	},
	(args) => callOpenCut("set_project", args),
);

server.registerTool(
	"duplicate_clip",
	{
		title: "Duplicate clip",
		description: "Copy a clip (with its style, effects and animations), optionally to a new start time.",
		inputSchema: { clipId, start: z.number().min(0).optional() },
	},
	(args) => callOpenCut("duplicate_clip", args),
);

server.registerTool(
	"trim_clip",
	{
		title: "Trim clip",
		description: "Shorten one clip so it starts and/or ends at the given timeline times (seconds). Leaves a gap; use cut_range to remove time from the whole video instead.",
		inputSchema: { clipId, start: z.number().min(0).optional(), end: z.number().positive().optional() },
	},
	(args) => callOpenCut("trim_clip", args),
);

server.registerTool(
	"set_track",
	{
		title: "Mute or hide a track",
		description: "Mute/unmute or hide/show a whole track (layer).",
		inputSchema: { trackId: z.string(), muted: z.boolean().optional(), hidden: z.boolean().optional() },
	},
	(args) => callOpenCut("set_track", args),
);

server.registerTool(
	"cut_range",
	{
		title: "Cut a time range",
		description: "Remove everything between start and end (seconds) on all tracks and close the gap, like a ripple delete. One undo step.",
		inputSchema: { start: z.number().min(0), end: z.number().positive() },
	},
	(args) => callOpenCut("cut_range", args),
);

const silenceOptions = {
	minDuration: z.number().min(0.1).max(10).optional().describe("Shortest pause to cut, seconds (default 0.6)"),
	thresholdDb: z.number().min(-90).max(-10).optional().describe("Level counted as silence; default adapts to the recording"),
	padding: z.number().min(0).max(1).optional().describe("Seconds of pause kept around speech (default 0.12)"),
};

server.registerTool(
	"find_silences",
	{
		title: "Find silences",
		description: "List the pauses in the timeline audio (start/end seconds) without changing anything.",
		inputSchema: silenceOptions,
	},
	(args) => callOpenCut("find_silences", args),
);

server.registerTool(
	"remove_silences",
	{
		title: "Remove silences",
		description: "Cut all pauses out of the video (jump cuts) in one undoable step. Great for talking-head videos.",
		inputSchema: silenceOptions,
	},
	(args) => callOpenCut("remove_silences", args),
);

server.registerTool(
	"add_transition",
	{
		title: "Add transition",
		description:
			"Transition between two back-to-back clips (fromClipId, and toClipId or the clip that starts where it ends), or between every cut on the main track with all=true. Types: crossfade (dissolve), fade_black (dip to black), slide_left/right/up/down (new shot pushes in), zoom. Clips are overlapped by the duration (using spare footage when available, otherwise later clips move earlier); audio crossfades too. One undo step.",
		inputSchema: {
			type: z.enum(["crossfade", "fade_black", "slide_left", "slide_right", "slide_up", "slide_down", "zoom"]),
			fromClipId: z.string().optional(),
			toClipId: z.string().optional(),
			all: z.boolean().optional().describe("Every cut on the main track"),
			duration: z.number().min(0.1).max(5).optional().describe("Seconds, default 0.6"),
		},
	},
	(args) => callOpenCut("add_transition", args),
);

server.registerTool(
	"search_free_media",
	{
		title: "Search free media online",
		description:
			"Search openly licensed media to use in the video: music and sound effects (Openverse/Jamendo/Freesound), images (Wikimedia Commons + Openverse/Flickr) and video clips (Wikimedia Commons). Returns direct file URLs with license and attribution; then use download_media (or add_web_image for pictures). Image results come with numbered preview pictures so you can check what each one really shows before using it. Use English keywords. By default only licenses that allow commercial use.",
		inputSchema: {
			query: z.string().min(1),
			type: z.enum(["music", "sound", "audio", "image", "video"]),
			limit: z.number().int().min(1).max(30).optional(),
			commercialUse: z.boolean().optional().describe("false to include non-commercial licenses too"),
			previews: z.boolean().optional().describe("Images only; default true: include preview pictures"),
		},
	},
	(args) => callSearchWithPreviews(args),
);

server.registerTool(
	"download_media",
	{
		title: "Download media from the internet",
		description:
			"Download a video, audio or image file from a direct link into the user's Downloads\\OpenCut folder and import it into the open project (returns the path and the new mediaId for add_to_timeline). Works with direct file links (e.g. from search_free_media, or links the user gives you). Web pages such as YouTube, Instagram or TikTok are not files and can't be downloaded; tell the user so. Only download what the user asked for or approved, and respect licenses.",
		inputSchema: {
			url: z.string().url(),
			fileName: z.string().optional().describe("Name to save as (extension added automatically)"),
			addToProject: z.boolean().optional().describe("Default true: import into the open project"),
		},
	},
	(args) => callOpenCut("download_media", args),
);

const placementInputs = {
	start: z.number().min(0).optional().describe("Timeline seconds when it appears (e.g. when the word is spoken); default the playhead"),
	duration: z.number().min(0.5).max(30).optional().describe("Seconds on screen, default 3"),
	style: z
		.enum(["card", "plain", "fullscreen"])
		.optional()
		.describe('"card" (default): photo with a white frame and shadow; "plain": just the picture with rounded corners; "fullscreen": covers the whole frame (cutaway)'),
	animation: z.enum(["pop", "fade", "slide", "zoom", "none"]).optional().describe("Entrance/exit; default pop (fade for fullscreen)"),
	anchor: z
		.enum(["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"])
		.optional()
		.describe("Where on screen (card/plain); default center"),
	widthPercent: z.number().min(5).max(100).optional().describe("Card/plain width, % of the frame width (default 70 vertical, 40 horizontal)"),
	x: z.number().min(0).max(100).optional().describe("Centre x, % of frame (overrides anchor)"),
	y: z.number().min(0).max(100).optional().describe("Centre y, % of frame (overrides anchor)"),
	tilt: z.number().min(-30).max(30).optional().describe("Rotation in degrees, e.g. -4 for a playful card"),
	label: z.string().max(80).optional().describe("Short caption under the picture"),
	font: z.string().optional().describe("Google Font for the label, default Montserrat"),
	kenBurns: z.boolean().optional().describe("Slow zoom while on screen, default true"),
	behindPerson: z.boolean().optional().describe("Put it under a cutout_person layer (behind the presenter)"),
};

server.registerTool(
	"add_web_image",
	{
		title: "Show a picture from the internet",
		description:
			"Download a picture from a direct image link (e.g. a search_free_media image url), import it and show it over the video at a given time with an animation — b-roll for something being mentioned. One call does download + import + placement.",
		inputSchema: {
			url: z.string().url(),
			fileName: z.string().optional(),
			...placementInputs,
		},
	},
	(args) => callOpenCut("add_web_image", args),
);

server.registerTool(
	"place_image",
	{
		title: "Show an imported picture",
		description:
			"Show an image already in the project (mediaId from get_state/add_media/download_media) over the video at a given time, as a pop-up photo card, a plain picture or a fullscreen cutaway, animated in and out. It becomes a clip on its own top layer.",
		inputSchema: {
			mediaId: z.string(),
			...placementInputs,
		},
	},
	(args) => callOpenCut("place_image", args),
);

const motionInputs = {
	code: z.string().min(1).describe("JavaScript defining render(api) and optionally setup(api); see the tool description"),
	mode: z.enum(["2d", "three"]).optional().describe('"2d" canvas drawing (default) or "three" for 3D with three.js'),
	duration: z.number().min(0.1).max(120).optional().describe("Seconds, default 5"),
	width: z.number().int().min(16).max(3840).optional().describe("Default: project width"),
	height: z.number().int().min(16).max(3840).optional().describe("Default: project height"),
	fps: z.number().int().min(1).max(60).optional().describe("Default: project frame rate"),
	fonts: z.array(z.string()).max(6).optional().describe("Google Fonts families to load"),
	images: z
		.record(z.string(), z.string())
		.optional()
		.describe('Images for the code as api.images[name]: "icon:<iconId from search_icons>[~hexcolour]" or "media:<mediaId of an imported image>"'),
};

server.registerTool(
	"preview_motion_graphic",
	{
		title: "Preview a motion graphic",
		description: `Render a few frames of motion-graphic code and return them as images (transparent areas shown as a checkerboard) without adding anything to the project. Use it to iterate on the design before create_motion_graphic.\n\n${MOTION_GUIDE}`,
		inputSchema: {
			...motionInputs,
			times: z.array(z.number().min(0)).max(8).optional().describe("Seconds to render; default start, middle, end"),
		},
	},
	(args) => callViewFrames(args, "preview_motion_graphic"),
);

server.registerTool(
	"create_motion_graphic",
	{
		title: "Create a motion graphic",
		description: `Create an animated graphic from code — titles, lower thirds, "VS" cards, logos flying in, animated lists/recipes/infographics, counters, charts, callouts, 3D objects (e.g. a house that opens up), floating screens, end cards — rendered to a transparent video clip and placed on a new top layer at start (default: the playhead). Everything under transparent pixels stays visible.\n\n${MOTION_GUIDE}`,
		inputSchema: {
			...motionInputs,
			name: z.string().optional().describe("Clip name"),
			start: z.number().min(0).optional().describe("Timeline seconds; default the playhead"),
		},
	},
	(args) => callOpenCut("create_motion_graphic", args),
);

server.registerTool(
	"cutout_person",
	{
		title: "Cut out the person (AI)",
		description:
			"Separate the person from the background of a video clip with on-device AI (MediaPipe). Creates a copy of the clip that shows only the person (transparent background) on the top layer, exactly aligned with the original (same timing, speed, position, animations, effects). With it you can put graphics BEHIND the presenter: create the graphic (create_motion_graphic, add_icon, add_text, floating screens…) and it lands on a layer under the cutout, so it appears between the background and the person — like logos passing behind them or text behind the head. Do the cut after timing edits (split/trim/speed) of that clip; takes roughly real time. First run downloads the AI model (internet needed).",
		inputSchema: {
			clipId: z.string().describe("A video clip showing a person"),
			quality: z.enum(["auto", "fast", "best"]).optional().describe("auto (default): best edges with a GPU, fast model otherwise"),
		},
	},
	(args) => callOpenCut("cutout_person", args),
);

server.registerTool(
	"move_layer",
	{
		title: "Reorder layers",
		description: "Bring a layer (overlay track) to the front or send it back: to = top, bottom, up, down, above:<trackId> or below:<trackId>. The main video track always stays at the bottom.",
		inputSchema: { trackId: z.string(), to: z.string() },
	},
	(args) => callOpenCut("move_layer", args),
);

server.registerTool(
	"follow_hand",
	{
		title: "Make a clip follow a hand",
		description:
			"Track the presenter's hand in a video clip (on-device AI) and animate another clip (icon, logo, 3D object graphic, text) so it floats at the hand — e.g. a logo sitting in the open palm and moving with it. Keys the clip's position over the time both clips overlap.",
		inputSchema: {
			clipId: z.string().describe("The clip to move (icon, graphic, text…)"),
			videoClipId: z.string().describe("The video clip where the hand is"),
			hand: z.enum(["left", "right", "any"]).optional().describe("Hand on the left or right side of the frame"),
			point: z.enum(["palm", "wrist", "index_tip", "thumb_tip"]).optional(),
			offsetX: z.number().optional().describe("Shift, % of frame width"),
			offsetY: z.number().optional().describe("Shift, % of frame height (default -8: just above the palm)"),
			sampleEvery: z.number().min(0.04).max(1).optional().describe("Seconds between tracked points (default 0.1)"),
		},
	},
	(args) => callOpenCut("follow_hand", args),
);

server.registerTool(
	"check_task",
	{
		title: "Wait for a running task",
		description: "Wait for a slow operation (export, transcription, captions, silence removal, download) that answered \"still working\" with a taskId, and get its result.",
		inputSchema: { taskId: z.string() },
	},
	({ taskId }) => checkTask(taskId),
);

await server.connect(new StdioServerTransport());
