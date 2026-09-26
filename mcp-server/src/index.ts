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
- Captions: generate_captions transcribes the audio and adds styled captions on their own track (the first run downloads a speech model, which can take a few minutes). add_captions adds captions you write yourself (e.g. translations). Restyle them all later with set_clip_properties using the captions trackId. fontSize ≈ percent of video height × 0.9 (5 = normal captions, 8 = big social-media captions).
- Layout: set_clip_properties places any visual clip with anchor (top-left … bottom-right, center) plus margin, or x/y (centre, % of the frame), and sizes it with widthPercent/heightPercent. It also styles text (font, size, colour, bold, background box), opacity, rotation, blend mode.
- Titles: add_text, then set_clip_properties to style and place it, then animate for motion.
- Icons, emojis, logos and flags: search_icons (English keywords) then add_icon. Shapes (boxes, circles, bars behind text): add_shape.
- Animation: animate with a preset (fade_in, fade_out, pop_in, slide_in_left, zoom_in for a Ken Burns effect, …) or custom keyframes. For audio, fade_in/fade_out ramp the volume.
- Looks: list_effects, then add_effect on one clip (clipId) or on every video/image clip in a time range (no clipId). Available: blur, colour adjustment (brightness, contrast, saturation, exposure, temperature…), black & white, sepia, vignette, sharpen, chroma key (green screen removal). add_mask cuts a clip to a shape (circle, heart, star, cinematic bars…).
- Format for Reels/TikTok/Shorts: set_project aspectRatio "9:16"; YouTube: "16:9"; Instagram feed: "4:5" or "1:1". Then check framing with view_frames and adjust clip scale/position.
- Music: add_media the audio file, add_to_timeline, set_volume (e.g. -18 dB under speech), animate fade_out at the end.

Slow operations (export, transcription, captions, silence removal) may answer \"still working\" with a taskId: call check_task with it until you get the result.

Finish with export_video: it renders and saves under the user's Videos\\OpenCut folder; tell the user the path it returns.
If a tool says OpenCut is not open, ask the user to open the OpenCut app and try again. Reply to the user in their language.`;

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
async function callViewFrames(args: Record<string, unknown>) {
	const result = await callOpenCut("view_frames", args);
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

const server = new McpServer(
	{ name: "opencut", version: "0.3.0" },
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
			"Transcribe the timeline's audio on this computer and return what is said with start/end times (seconds). Nothing is changed. The first run downloads a speech model and can take a few minutes.",
		inputSchema: { language: languageSchema },
	},
	(args) => callOpenCut("transcribe", args),
);

server.registerTool(
	"generate_captions",
	{
		title: "Generate captions",
		description:
			"Transcribe the timeline's audio and add captions as text clips on a new track, styled as requested. Returns the trackId and each caption (id, time, text) so you can fix words with set_clip_properties.",
		inputSchema: {
			language: languageSchema,
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
	"check_task",
	{
		title: "Wait for a running task",
		description: "Wait for a slow operation (export, transcription, captions, silence removal) that answered \"still working\" with a taskId, and get its result.",
		inputSchema: { taskId: z.string() },
	},
	({ taskId }) => checkTask(taskId),
);

await server.connect(new StdioServerTransport());
