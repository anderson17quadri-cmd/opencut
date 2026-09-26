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
- Designer animations (animated emojis/icons, arrows pointing, confetti, checkmarks, like/subscribe/follow buttons, lower thirds, transitions): search_animations then add_animation — prefer these over coding the same thing. Icons, emojis, logos and flags (static): search_icons (English keywords) then add_icon. Shapes (boxes, circles, bars behind text): add_shape.
- Layers: tracks listed first in get_state are drawn on top. move_layer brings a layer to the front/back or above/below another.
- Graphics behind the presenter (logos floating behind them, text behind the head, 3D screens in the background, "the scene splits into layers"): run cutout_person on the talking-head clip; motion graphics created before or after it land under the cutout, so they appear between the background and the person. Use move_layer for other clips (icons, text) that should go behind.
- Motion graphics (animated titles, VS cards, animated explainers/recipes/infographics, counters, 3D objects, floating screens, end cards, anything the built-in tools can't do): write code for create_motion_graphic; iterate with preview_motion_graphic first. Use search_icons ids as images for logos.
- Animation: animate with a preset (fade_in, fade_out, pop_in, slide_in_left, zoom_in for a Ken Burns effect, …) or custom keyframes. For audio, fade_in/fade_out ramp the volume.
- Looks: list_effects, then add_effect on one clip (clipId) or on every video/image clip in a time range (no clipId). Available: blur, colour adjustment (brightness, contrast, saturation, exposure, temperature…), black & white, sepia, vignette, sharpen, chroma key (green screen removal). add_mask cuts a clip to a shape (circle, heart, star, cinematic bars…).
- Format for Reels/TikTok/Shorts: set_project aspectRatio "9:16"; YouTube: "16:9"; Instagram feed: "4:5" or "1:1" (a format chosen this way is kept when footage of another shape is added). Then check framing with view_frames and adjust clip scale/position.
- Music: add_media the audio file, add_to_timeline, set_volume (e.g. -18 dB under speech), animate fade_out at the end.
- Transitions between shots: add_transition (crossfade, fade_black, slides, zoom), or all=true for every cut.
- From the internet: when the user asks for music, sound effects, images or b-roll, search_free_media then download_media (it also imports the file). For a link the user gives, download_media directly. YouTube/Instagram/TikTok pages can't be downloaded. Credits are collected automatically into a text file next to the exported video.
- Pictures for what is being said (automatic b-roll — "put images when I mention something"): 1) transcribe with words=true; 2) pick the concrete references worth illustrating (products, brands, places, people, objects, foods, numbers/events) — usually one every 3-8 s, not every noun; 3) for each, search_free_media type "image" with English keywords: it returns preview pictures, look at them and choose the one that really shows the thing (skip it if none fits); 4) add_web_image with that url, start = the time the word is spoken (≈0.1 s before), duration 2-4 s, style "card" (pop-up photo, anchor "top" on vertical videos so the face stays clear), "fullscreen" (cutaway covering the frame) or "plain"; alternate positions/styles for variety; sound "pop" (cards) or "whoosh" (fullscreen) gives the pro feel; 5) view_frames at a few of those times to check (keep faces and burned-in captions clear). For a logo, prefer search_icons + add_icon. Never write credits on the video: author and licence of everything downloaded are recorded automatically, and export_video writes a "<video> - créditos.txt" file next to the video (creditsFile) that the user can paste into the post caption if they want — tell them where it is.

Editing like a human editor (when the user asks for a professional/viral/"like that video" edit of a talking-head video, do all of this; for smaller asks, pick what fits):
1. Understand it first: get_state, view_frames at 4-6 times, transcribe words=true. Read the whole script: find the hook, key points, lists, numbers, brand/product/place mentions, reveals, jokes and the call to action.
2. Clean cut first (it shifts every time after it): remove_silences with tight pacing (minDuration 0.35-0.5, padding 0.08-0.12) and cut_range for false starts or repeated takes you spot in the transcript. Transcribe again afterwards.
3. Format and framing: set_project 9:16 for Reels/TikTok/Shorts, fill the frame with the talking head, check with view_frames.
4. Hook in the first 2 s: a bold animated title (create_motion_graphic) with an impact or whoosh, plus a punch-in on the first sentence.
5. Keep it moving: something should change every 2-4 s. punch_zoom on emphasis words (style "cut", alternate ~1.12 and ~1.25, return to wide in between; "push" for slow build-ups), pictures at mentions (add_web_image), graphics for lists/numbers/comparisons, icons. Never more than two new things at once, and keep the face clear.
6. Captions: generate_captions style "karaoke", 2-3 words per caption, in the lower third, clear of the face and graphics.
7. One or two signature moments where the script allows (talking about layers, how something is made, a reveal): explode_layers (the scene turns into 3D glass layers with numbered labels), cutout_person + graphics behind the presenter, follow_hand for objects in the hand, 3D motion graphics (floating screens, objects that explode into parts), picture-in-picture next to an animated explainer.
8. Sound design: every graphic entrance gets a sound (add_sound_effect or the sound option): pop for small pop-ups, whoosh for movement and transitions, impact for big titles/reveals, click for UI and list items, ding for checkmarks/prices/success, riser to build up to a reveal. Sounds around -8 dB. Music: search_free_media type "music" matching the mood, under the whole video, then duck_music so it dips while the person talks.
9. Look: a light grade on the talking head (add_effect colour adjustment: a bit more contrast and saturation, slight vignette).
10. End with a call-to-action graphic in the last 2-3 s (follow/save/comment) with a ding.
11. Review like an editor: view_frames at every element you added and at a few random times; fix overlaps (captions vs graphics vs face), bad timing and anything cut off; then export_video. Tell the user, briefly, the edit decisions you made and where the file and credits are.

Order matters: timing edits (cuts, speed) → punch_zoom → colour grade → cutout_person → graphics, pictures, hand-tracked objects → explode_layers (it bakes the frame as it looks then, so do it after the zooms under it) → captions → sounds and music (duck_music last, once the timing is final) → review → export.

Slow operations (export, transcription, captions, silence removal, downloads, motion graphics, cutouts, 3D layers, frame previews) may answer \"still working\" with a taskId: call check_task with it until you get the result.

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
	transform?: (result: ToolResult) => ToolResult,
): Promise<ToolResult> {
	const taskId = String(nextTaskId++);
	// The transform runs even when the result arrives later via check_task.
	const promise = runOnOpenCut(tool, args).then((result) => (transform ? transform(result) : result));
	return waitFor(taskId, tool, Date.now(), promise);
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
function framesToImages(result: ToolResult): ToolResult {
	if (result.isError) return result;
	const first = result.content[0];
	if (first?.type !== "text") return result;
	let parsed: { frames?: Array<{ time: number; image: string }> };
	try {
		parsed = JSON.parse(first.text);
	} catch {
		return result;
	}
	const content: ToolContent[] = [];
	for (const frame of parsed.frames ?? []) {
		content.push({ type: "text", text: `Frame at ${frame.time}s:` });
		content.push({ type: "image", data: frame.image, mimeType: "image/jpeg" });
	}
	return { content };
}

function callViewFrames(args: Record<string, unknown>, tool = "view_frames") {
	return callOpenCut(tool, args, framesToImages);
}

/** Image search results carry base64 previews; show them as pictures. */
function callSearchWithPreviews(args: Record<string, unknown>): Promise<ToolResult> {
	return callOpenCut("search_free_media", args, previewsToImages);
}

function previewsToImages(result: ToolResult): ToolResult {
	const first = result.content[0];
	if (result.isError || first?.type !== "text") return result;
	let parsed: { results?: Array<Record<string, unknown>> } & Record<string, unknown>;
	try {
		parsed = JSON.parse(first.text);
	} catch {
		return result;
	}
	const images: ToolContent[] = [];
	const results = (parsed.results ?? []).map((item, index) => {
		const { preview, ...rest } = item as { preview?: { data: string; mimeType: string }; title?: unknown; name?: unknown };
		if (preview) {
			images.push({ type: "text", text: `#${index + 1}: ${String(rest.title ?? rest.name ?? "")}` });
			images.push({ type: "image", data: preview.data, mimeType: preview.mimeType });
		}
		return { "#": index + 1, ...rest };
	});
	return {
		content: [{ type: "text", text: JSON.stringify({ ...parsed, results }, null, 2) }, ...images],
	};
}

const VERSION = "0.8.0";

const server = new McpServer(
	{ name: "opencut", version: VERSION },
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
			"Render the timeline to a video file in the user's Videos\\OpenCut folder and return its path. If it uses pictures or sounds downloaded from the internet, a \"<video> - créditos.txt\" file with their authors and licences is saved next to it (creditsFile). Can take a while for long videos.",
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
			"Search openly licensed media to use in the video: music and sound effects (Openverse/Jamendo/Freesound), images (Wikimedia Commons + Openverse/Flickr) and video clips (Wikimedia Commons). Returns direct file URLs with license and attribution; then use download_media (or add_web_image for pictures). Image results come with numbered preview pictures so you can check what each one really shows before using it. Use English keywords. Only licences that allow editing (no ND); by default also commercial use.",
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
	sound: z.enum(["pop", "whoosh", "swoosh_down", "click", "impact", "riser", "ding", "none"]).optional().describe("Sound effect when it appears (made on the spot, no licence needed); default none"),
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
			quality: z
				.enum(["auto", "fast", "best", "pro"])
				.optional()
				.describe('auto (default): professional hair-level matting (MODNet) when the PC has a GPU, the fast model otherwise; "pro": always MODNet (slow without a GPU, ~1-3 s per frame); "fast": quickest, rough edges'),
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
	"search_animations",
	{
		title: "Search designer animations (Lottie)",
		description:
			"Search LottieFiles' free catalogue of animations made by designers — animated icons and emojis, arrows, confetti, checkmarks, likes/subscribe buttons, loaders, lower thirds, transitions, stickers. Returns numbered preview pictures (first frame) so you can pick; then add_animation with its url. Use English keywords. These look far more polished than drawing the same thing with code.",
		inputSchema: {
			query: z.string().min(1),
			limit: z.number().int().min(1).max(20).optional().describe("Default 8"),
			previews: z.boolean().optional().describe("Default true"),
		},
	},
	(args) => callOpenCut("search_animations", args, previewsToImages),
);

server.registerTool(
	"add_animation",
	{
		title: "Add a designer animation (Lottie)",
		description:
			"Play a Lottie animation (url from search_animations) over the video at a time and place, rendered to a transparent clip on its own top layer. One play-through by default; loop or set duration/speed. Its author and licence go into the credits file automatically.",
		inputSchema: {
			url: z.string().url(),
			start: z.number().min(0).optional().describe("Timeline seconds; default the playhead"),
			duration: z.number().min(0.3).max(60).optional().describe("Default one play-through"),
			loop: z.boolean().optional(),
			speed: z.number().min(0.25).max(4).optional(),
			anchor: z
				.enum(["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"])
				.optional(),
			widthPercent: z.number().min(3).max(100).optional().describe("Default 40"),
			x: z.number().min(0).max(100).optional().describe("Centre x, % of frame"),
			y: z.number().min(0).max(100).optional().describe("Centre y, % of frame"),
			fullscreen: z
				.boolean()
				.optional()
				.describe("Cover the whole frame, cropping the edges — only for animations made full-frame (transitions, backgrounds). For confetti, emojis, icons use widthPercent (100 = full width, nothing cropped)"),
			fade: z.number().min(0).max(2).optional().describe("Fade in/out seconds (default 0)"),
			behindPerson: z.boolean().optional().describe("Under a cutout_person layer"),
			sound: z.enum(["pop", "whoosh", "swoosh_down", "click", "impact", "riser", "ding", "none"]).optional(),
			name: z.string().optional(),
		},
	},
	(args) => callOpenCut("add_animation", args),
);

server.registerTool(
	"explode_layers",
	{
		title: "3D glass layers shot",
		description:
			"The signature shot: the talking-head frame turns sideways in 3D and splits into glass panes spread in depth — the presenter in front, optional graphics/logos in the middle, the background (person painted out) at the back — each with a numbered label (01 Apresentador, 02 …, 03 Fundo), then folds back into the flat frame, so it cuts in and out seamlessly. Renders a new clip right above the video clip for [start, start+duration] (the person is separated with on-device AI), with whoosh sounds on open/close. Layers above (captions) stay flat on top. Best at a moment where the script talks about layers, parts or how something is made.",
		inputSchema: {
			clipId: z.string().describe("The talking-head video clip"),
			start: z.number().min(0).optional().describe("Timeline seconds (default: the clip start)"),
			duration: z.number().min(2.5).max(20).optional().describe("Seconds, default 5"),
			labels: z.array(z.string().max(28)).max(3).optional().describe('Pane labels front to back, e.g. ["Apresentador","Logos 3D","Fundo"] (default Portuguese)'),
			sublabels: z.array(z.string().max(36)).max(3).optional().describe("Small grey text under each label"),
			middleImages: z
				.array(z.string())
				.max(4)
				.optional()
				.describe('Pictures for the middle pane: "icon:<iconId>" (search_icons; prefer colour logos such as logos:*, or add ~ffffff for a white icon — the glass is dark) or "media:<mediaId>" of an imported image; omit for two panes only'),
			accent: z.string().optional().describe("Label number colour, hex (default #ff5a36)"),
			angle: z.number().min(10).max(60).optional().describe("Turn angle in degrees (default 32)"),
			font: z.string().optional().describe("Google Font for labels (default Montserrat)"),
			sound: z.boolean().optional().describe("Whoosh on open/close (default true)"),
			quality: z.enum(["auto", "fast", "best", "pro"]).optional().describe('Person separation (default auto: hair-level MODNet with a GPU, fast otherwise; "pro" forces MODNet)'),
		},
	},
	(args) => callOpenCut("explode_layers", args),
);

server.registerTool(
	"punch_zoom",
	{
		title: "Punch-in zooms on the face",
		description:
			"Editor-style zooms on a talking-head clip that keep the face framed (on-device face detection): style \"cut\" jumps in on an emphasis word and back out after hold seconds, \"smooth\" eases in/out, \"push\" slowly pushes in over the hold. Give all zooms for the clip in one call (it replaces earlier zooms on that clip); a person cutout of the clip gets the same zooms.",
		inputSchema: {
			clipId: z.string(),
			zooms: z
				.array(
					z.object({
						at: z.number().describe("Timeline seconds"),
						scale: z.number().min(1.02).max(2.5).optional(),
						hold: z.number().min(0.3).max(30).optional().describe("Seconds before going back to wide (or until the next zoom)"),
						style: z.enum(["cut", "smooth", "push"]).optional(),
					}),
				)
				.optional(),
			times: z.array(z.number()).optional().describe("Shortcut: zoom times with the shared settings below"),
			scale: z.number().min(1.02).max(2.5).optional().describe("Default 1.18"),
			hold: z.number().min(0.3).max(30).optional().describe("Default 2 s"),
			style: z.enum(["cut", "smooth", "push"]).optional().describe("Default cut"),
		},
	},
	(args) => callOpenCut("punch_zoom", args),
);

server.registerTool(
	"add_sound_effect",
	{
		title: "Add a sound effect",
		description:
			"Put a sound effect on the audio layer, timed so it lands at 'at' (made on the spot, no download or licence): pop (small pop-ups), whoosh (movement, transitions), swoosh_down (things leaving), click (UI, list items), impact (big title, reveal), riser (builds up and ends at 'at'), ding (check, price, success).",
		inputSchema: {
			effect: z.enum(["pop", "whoosh", "swoosh_down", "click", "impact", "riser", "ding"]),
			at: z.number().min(0).optional().describe("Timeline seconds of the visual moment; default the playhead"),
			volumeDb: z.number().min(-40).max(6).optional().describe("Default 0; around -8 sits well under a voice"),
		},
	},
	(args) => callOpenCut("add_sound_effect", args),
);

server.registerTool(
	"duck_music",
	{
		title: "Duck music under the voice",
		description:
			"Make a music clip dip automatically while someone talks and come back up in the pauses (keys its volume from the other audio). Run it after the cuts are final.",
		inputSchema: {
			clipId: z.string().describe("The music clip"),
			musicDb: z.number().min(-40).max(6).optional().describe("Level in pauses (default -12)"),
			underVoiceDb: z.number().min(-60).max(0).optional().describe("Level under speech (default -24)"),
		},
	},
	(args) => callOpenCut("duck_music", args),
);

server.registerTool(
	"list_transition_effects",
	{
		title: "List shader transitions",
		description:
			"List the 123 shader transitions from gl-transitions (glitch, zoom blur, page curl, 3D cube, swirl, film burn, light leaks, pixelate, wipes…), with a featured set described by look, for add_transition_effect.",
	},
	() => callOpenCut("list_transition_effects"),
);

server.registerTool(
	"add_transition_effect",
	{
		title: "Add a shader transition",
		description:
			"Put a designed transition over the cut between two back-to-back clips, e.g. CrossZoom (energetic zoom blur, the Reels classic), GlitchMemories (tech glitch), FilmBurn (warm light leak), cube (3D), InvertedPageCurl (page turn), Overexposure (white flash on a beat). It is rendered from both clips (using their spare footage when there is some) as a clip over the cut, with a whoosh on the cut. Unlike add_transition it doesn't move or overlap the clips. Use at scene/topic changes; 0.4-0.9 s.",
		inputSchema: {
			fromClipId: z.string().describe("The clip before the cut"),
			toClipId: z.string().optional().describe("The clip after the cut (default: the one starting where fromClip ends)"),
			type: z.string().optional().describe("Transition name from list_transition_effects (default CrossZoom)"),
			duration: z.number().min(0.2).max(3).optional().describe("Seconds, default 0.7"),
			sound: z.enum(["whoosh", "swoosh_down", "impact", "click", "pop", "none"]).optional().describe("Default whoosh"),
		},
	},
	(args) => callOpenCut("add_transition_effect", args),
);

server.registerTool(
	"find_beats",
	{
		title: "Find the music's beats",
		description:
			"Detect the tempo (BPM) and beat grid of a music clip (web-audio-beat-detector) and return every beat and bar (every 4th beat) as timeline seconds. Use them to edit on the beat like a Reels editor: cuts and transitions on bars, punch_zoom and pictures/animations/text popping on beats, sounds landing on beats.",
		inputSchema: { clipId: z.string().describe("The music clip") },
	},
	(args) => callOpenCut("find_beats", args),
);

server.registerTool(
	"clean_voice",
	{
		title: "Clean up the voice (remove noise)",
		description:
			"Remove background noise from speech on this computer with DeepFilterNet 3 (AI noise suppression): fans, air conditioning, traffic, hum, room echo, phone-mic hiss. Makes a cleaned copy of the clip's whole audio, puts it on an audio layer in exact sync (same timing, trim and speed) and mutes the original clip's sound. Use it on talking-head recordings before ducking music; not on music. strength: light (keeps some room tone), medium (default), strong (removes everything but the voice). First run downloads the model (~24 MB).",
		inputSchema: {
			clipId: z.string().describe("Video or audio clip with the speech"),
			strength: z.enum(["light", "medium", "strong"]).optional(),
		},
	},
	(args) => callOpenCut("clean_voice", args),
);

server.registerTool(
	"check_task",
	{
		title: "Wait for a running task",
		description: "Wait for a slow operation (export, transcription, captions, silence removal, download, motion graphic, cutout, 3D layers, frames) that answered \"still working\" with a taskId, and get its result.",
		inputSchema: { taskId: z.string() },
	},
	({ taskId }) => checkTask(taskId),
);

// ------------------------------------------------------------ serving
//
// The tool list above is also exported to JSON at build time and shipped
// inside the OpenCut app (served at /agent-tools.json). At run time the
// extension prefers the app's list, so tools added in an app update reach
// Claude without reinstalling this extension. Every tool is a plain call
// to the app; a few results are post-processed (pictures), named here.

type ToolsFile = {
	version: string;
	instructions: string;
	tools: Array<{ name: string } & Record<string, unknown>>;
	transforms: Record<string, "frames" | "previews">;
};

const TRANSFORMS = { frames: framesToImages, previews: previewsToImages } as const;
const TRANSFORM_BY_TOOL: ToolsFile["transforms"] = {
	view_frames: "frames",
	preview_motion_graphic: "frames",
	search_free_media: "previews",
	search_animations: "previews",
};

async function exportTools(path: string) {
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	const client = new Client({ name: "export", version: "1" });
	await client.connect(clientSide);
	const { tools } = await client.listTools();
	const file: ToolsFile = { version: VERSION, instructions: INSTRUCTIONS, tools, transforms: TRANSFORM_BY_TOOL };
	const { writeFileSync, mkdirSync } = await import("node:fs");
	const { dirname } = await import("node:path");
	for (const target of path.split(",")) {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${JSON.stringify(file, null, 1)}\n`);
	}
	await client.close();
}

/** The app's tool list, or null when the app isn't running (or is older). */
function fetchAppTools(): Promise<ToolsFile | null> {
	return new Promise((resolve) => {
		const req = request(`${OPENCUT_URL}/agent-tools.json`, { method: "GET", timeout: 2000 }, (res) => {
			if (res.statusCode !== 200) {
				res.resume();
				return resolve(null);
			}
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				try {
					const file = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ToolsFile;
					resolve(Array.isArray(file.tools) && file.tools.length > 0 ? file : null);
				} catch {
					resolve(null);
				}
			});
		});
		req.on("timeout", () => req.destroy());
		req.on("error", () => resolve(null));
		req.end();
	});
}

async function serve() {
	const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
	const { CallToolRequestSchema, ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
	const bundled = (await import("./generated/tools.json", { with: { type: "json" } })).default as unknown as ToolsFile;
	// The app's definitions win (they match the app that will run them);
	// tools only this extension knows are kept, so an older app never hides
	// them (it answers "unknown tool" if it really can't run one).
	const merge = (app: ToolsFile | null): ToolsFile => {
		const base = bundled.tools?.length ? bundled : { ...bundled, tools: [] };
		if (!app) return base;
		const names = new Set(app.tools.map((tool) => tool.name));
		return {
			...app,
			tools: [...app.tools, ...base.tools.filter((tool) => !names.has(tool.name))],
			transforms: { ...base.transforms, ...app.transforms },
		};
	};
	const fromApp = await fetchAppTools();
	let current: ToolsFile = merge(fromApp);

	const runtime = new Server(
		{ name: "opencut", version: current.version || VERSION },
		{ capabilities: { tools: { listChanged: true } }, instructions: current.instructions || INSTRUCTIONS },
	);
	runtime.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: current.tools as never }));
	runtime.setRequestHandler(CallToolRequestSchema, async (request) => {
		const name = request.params.name;
		const args = (request.params.arguments ?? {}) as Record<string, unknown>;
		if (name === "check_task") return (await checkTask(String(args.taskId ?? ""))) as never;
		if (!current.tools.some((tool) => tool.name === name)) {
			return { content: [{ type: "text", text: `Unknown tool ${name}.` }], isError: true } as never;
		}
		const kind = current.transforms?.[name] ?? TRANSFORM_BY_TOOL[name];
		return (await callOpenCut(name, args, kind ? TRANSFORMS[kind] : undefined)) as never;
	});
	await runtime.connect(new StdioServerTransport());

	// Started before the app: pick up the app's (possibly newer) list once
	// it is running, and tell Claude the list changed.
	if (!fromApp) {
		const timer = setInterval(async () => {
			const found = await fetchAppTools();
			if (!found) return;
			clearInterval(timer);
			const merged = merge(found);
			if (JSON.stringify(merged.tools) !== JSON.stringify(current.tools)) {
				current = merged;
				await runtime.sendToolListChanged().catch(() => {});
			}
		}, 15_000);
		timer.unref();
	}
}

if (process.argv[2] === "--export-tools") {
	await exportTools(process.argv[3] ?? "tools.json");
	process.exit(0);
} else {
	await serve();
}
