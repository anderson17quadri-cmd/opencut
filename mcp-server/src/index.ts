#!/usr/bin/env node
/**
 * Claude Desktop extension for OpenCut. Every tool is forwarded to the
 * running OpenCut app, which executes it in the editor window the user is
 * looking at (see opencut-classic/apps/web/src/agent).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OPENCUT_URL = process.env.OPENCUT_URL ?? "http://127.0.0.1:47821";

const INSTRUCTIONS = `You control OpenCut, a video editor running on the user's computer. Every change you make appears live in the OpenCut window, and the user can undo it there too.

How to work:
- Times are always in seconds.
- Start with get_state to see the open project, its tracks and clips (with ids), and imported media. Re-read it after edits instead of guessing ids.
- If no project is open, use list_projects + open_project, or create_project.
- To edit a video file: list_media_files to find it (checks Videos, Downloads, Desktop, Music, Pictures by default), add_media with its full path, then add_to_timeline.
- To cut out a section: split_clip at its start and end, then delete_clips on the middle piece. Deleting leaves a gap; use move_clip to close it.
- export_video renders the timeline and saves it under the user's Videos\\OpenCut folder; tell the user the path it returns.
- If a tool says OpenCut is not open, ask the user to open the OpenCut app and try again.`;

async function callOpenCut(
	tool: string,
	args: Record<string, unknown> = {},
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
	let reply: { ok: boolean; result?: unknown; error?: string };
	try {
		const response = await fetch(`${OPENCUT_URL}/api/agent/commands`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ tool, args }),
		});
		reply = (await response.json()) as typeof reply;
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

const server = new McpServer(
	{ name: "opencut", version: "0.2.0" },
	{ instructions: INSTRUCTIONS },
);

const clipId = z.string().describe("Clip id from get_state");

server.registerTool(
	"get_state",
	{
		title: "Get project state",
		description:
			"Open project, its tracks and clips (ids, start/end in seconds, text, speed, volume) and imported media.",
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
			"Add a text overlay (title, caption, label). fontSize defaults to 15; keep it modest (about 10–30), larger values get big fast.",
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

await server.connect(new StdioServerTransport());
