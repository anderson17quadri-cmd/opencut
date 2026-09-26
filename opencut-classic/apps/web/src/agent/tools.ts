import { frameRateToFloat } from "@/fps/utils";
import { processMediaAssets } from "@/media/processing";
import type { ExportFormat, ExportQuality } from "@/export";
import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";
import type { MediaTime } from "@/wasm";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import { DEFAULTS } from "@/timeline/defaults";
import {
	buildElementFromMedia,
	buildTextElement,
} from "@/timeline/element-utils";
import {
	type Args,
	type Navigate,
	allTracks,
	describeElement,
	editor,
	findElement,
	fromSeconds,
	insertAndFind,
	num,
	optNum,
	requireOpenProject,
	str,
	toSeconds,
} from "./helpers";
import { describeFull, runProTool } from "./pro-tools";

// Every tool here runs inside the OpenCut window, against the same
// EditorCore the UI uses, so edits show up live and go through undo history.
// Times cross this boundary in seconds; the editor works in MediaTime ticks.

// Opening the editor page reloads the project from storage, replacing the
// in-memory timeline — editing before that load finishes gets wiped. So
// navigate, then wait for a load of this project newer than `loadsBefore`.
async function navigateAndWaitForLoad({
	projectId,
	navigate,
}: {
	projectId: string;
	navigate: Navigate;
}): Promise<void> {
	const stampBefore = editor().project.getLoadStamp();
	if (
		window.location.pathname === `/editor/${projectId}` &&
		stampBefore.projectId === projectId
	) {
		return;
	}
	const loadsBefore = stampBefore.count;
	navigate(`/editor/${projectId}`);

	for (let i = 0; i < 200; i++) {
		const stamp = editor().project.getLoadStamp();
		if (stamp.count > loadsBefore && stamp.projectId === projectId) return;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error("The project took too long to open.");
}

function getState() {
	const project = requireOpenProject();
	const e = editor();
	return {
		project: {
			id: project.metadata.id,
			name: project.metadata.name,
			fps: frameRateToFloat(project.settings.fps),
			width: project.settings.canvasSize.width,
			height: project.settings.canvasSize.height,
		},
		durationSeconds: toSeconds(e.timeline.getTotalDuration()),
		playheadSeconds: toSeconds(e.playback.getCurrentTime()),
		tracks: allTracks().map((track) => ({
			id: track.id,
			type: track.type,
			name: track.name,
			...("muted" in track ? { muted: track.muted } : {}),
			...("hidden" in track ? { hidden: track.hidden } : {}),
			clips: track.elements.map(describeFull),
		})),
		media: e.media.getAssets().map((asset) => ({
			id: asset.id,
			name: asset.name,
			type: asset.type,
			durationSeconds: asset.duration,
			width: asset.width,
			height: asset.height,
		})),
	};
}

async function listProjects() {
	await editor().project.loadAllProjects();
	return editor()
		.project.getSavedProjects()
		.map((p) => ({
			id: p.id,
			name: p.name,
			durationSeconds: toSeconds(p.duration),
			updatedAt: new Date(p.updatedAt).toISOString(),
		}));
}

async function createProject(args: Args, navigate: Navigate) {
	const name =
		typeof args.name === "string" && args.name ? args.name : "Projeto do Claude";
	const projectId = await editor().project.createNewProject({ name });
	await navigateAndWaitForLoad({ projectId, navigate });
	return { projectId, name };
}

async function openProject(args: Args, navigate: Navigate) {
	const projectId = str(args, "projectId");
	await navigateAndWaitForLoad({ projectId, navigate });
	return getState();
}

async function addMedia(args: Args) {
	const project = requireOpenProject();
	const path = str(args, "path");

	const response = await fetch(
		`/api/agent/file?path=${encodeURIComponent(path)}`,
	);
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(body?.error ?? `Could not read ${path}`);
	}
	const blob = await response.blob();
	const name = decodeURIComponent(
		response.headers.get("x-file-name") ?? "media",
	);
	const file = new File([blob], name, { type: blob.type });

	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) throw new Error(`Could not import ${name}`);

	const asset = await editor().media.addMediaAsset({
		projectId: project.metadata.id,
		asset: processed,
	});
	if (!asset) throw new Error(`Could not save ${name} (storage full?)`);

	return {
		mediaId: asset.id,
		name: asset.name,
		type: asset.type,
		durationSeconds: asset.duration,
		width: asset.width,
		height: asset.height,
	};
}

function addToTimeline(args: Args) {
	requireOpenProject();
	const e = editor();
	const mediaId = str(args, "mediaId");
	const asset = e.media.getAssets().find((a) => a.id === mediaId);
	if (!asset) throw new Error(`No media with id ${mediaId}. Use add_media first.`);

	const start = optNum(args, "start");
	const durationSeconds = optNum(args, "duration") ?? asset.duration;
	const element = buildElementFromMedia({
		mediaId: asset.id,
		mediaType: asset.type,
		name: asset.name,
		duration:
			durationSeconds !== undefined
				? fromSeconds(durationSeconds)
				: DEFAULT_NEW_ELEMENT_DURATION,
		startTime:
			start !== undefined ? fromSeconds(start) : e.timeline.getTotalDuration(),
	});

	const inserted = insertAndFind(() =>
		e.timeline.insertElement({ element, placement: { mode: "auto" } }),
	);
	return { trackId: inserted.track.id, clip: describeElement(inserted.element) };
}

function addText(args: Args) {
	requireOpenProject();
	const e = editor();
	const text = str(args, "text");
	const start = num(args, "start");
	const duration = optNum(args, "duration") ?? 3;
	const fontSize = optNum(args, "fontSize");
	const color = typeof args.color === "string" ? args.color : undefined;

	const element = buildTextElement({
		raw: {
			...DEFAULTS.text.element,
			name: text.slice(0, 40),
			duration: fromSeconds(duration),
			params: {
				...DEFAULTS.text.element.params,
				content: text,
				...(fontSize !== undefined ? { fontSize } : {}),
				...(color ? { color } : {}),
			},
		},
		startTime: fromSeconds(start),
	});

	const inserted = insertAndFind(() =>
		e.timeline.insertElement({ element, placement: { mode: "auto" } }),
	);
	return { trackId: inserted.track.id, clip: describeElement(inserted.element) };
}

function splitClip(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	const time = num(args, "time");
	const start = toSeconds(element.startTime);
	const end = toSeconds((element.startTime + element.duration) as MediaTime);
	if (time <= start || time >= end) {
		throw new Error(`Time ${time}s is outside the clip (${start}s–${end}s).`);
	}

	const [right] = editor().timeline.splitElements({
		elements: [{ trackId: track.id, elementId: element.id }],
		splitTime: fromSeconds(time),
	});
	return { leftClipId: element.id, rightClipId: right?.elementId ?? null };
}

function deleteClips(args: Args) {
	requireOpenProject();
	const ids = args.clipIds;
	if (!Array.isArray(ids) || ids.length === 0) {
		throw new Error('"clipIds" must be a non-empty list');
	}
	const refs = ids.map((id) => {
		const { track, element } = findElement(String(id));
		return { trackId: track.id, elementId: element.id };
	});
	editor().timeline.deleteElements({ elements: refs });
	return { deleted: refs.length, durationSeconds: toSeconds(editor().timeline.getTotalDuration()) };
}

function moveClip(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	const targetTrackId =
		typeof args.trackId === "string" && args.trackId ? args.trackId : track.id;
	editor().timeline.moveElements({
		moves: [
			{
				sourceTrackId: track.id,
				targetTrackId,
				elementId: element.id,
				newStartTime: fromSeconds(num(args, "start")),
			},
		],
	});
	return describeElement(findElement(element.id).element);
}

function setSpeed(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "video" && element.type !== "audio") {
		throw new Error("Speed only applies to video and audio clips.");
	}
	const speed = num(args, "speed");
	if (speed < 0.1 || speed > 10) throw new Error("Speed must be between 0.1 and 10.");

	editor().timeline.updateElementRetime({
		trackId: track.id,
		elementId: element.id,
		retime: speed === 1 ? undefined : { rate: speed, maintainPitch: true },
	});
	return describeElement(findElement(element.id).element);
}

function setVolume(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "video" && element.type !== "audio") {
		throw new Error("Volume only applies to video and audio clips.");
	}
	const volumeDb = optNum(args, "volumeDb");
	const muted = typeof args.muted === "boolean" ? args.muted : undefined;
	editor().timeline.updateElements({
		updates: [
			{
				trackId: track.id,
				elementId: element.id,
				patch: {
					params: {
						...(volumeDb !== undefined ? { volume: volumeDb } : {}),
						...(muted !== undefined ? { muted } : {}),
					},
				},
			},
		],
	});
	return describeElement(findElement(element.id).element);
}

function seek(args: Args) {
	requireOpenProject();
	editor().playback.seek({ time: fromSeconds(num(args, "time")) });
	return { time: num(args, "time") };
}

async function exportVideo(args: Args) {
	const project = requireOpenProject();
	const format: ExportFormat = args.format === "webm" ? "webm" : "mp4";
	const quality: ExportQuality =
		args.quality === "low" ||
		args.quality === "medium" ||
		args.quality === "very_high"
			? args.quality
			: "high";

	const render = (format: ExportFormat) =>
		editor().project.export({
			options: { ...DEFAULT_EXPORT_OPTIONS, format, quality },
		});

	let usedFormat = format;
	let result = await render(format);
	// Some WebView/Chromium builds ship without an H.264 encoder; WebM
	// (VP9) is always available, so don't fail the whole export over it.
	if (!result.success && format === "mp4" && /not supported|encoder/i.test(result.error ?? "")) {
		usedFormat = "webm";
		result = await render("webm");
	}
	if (!result.success || !result.buffer) {
		throw new Error(result.error ?? "Export was cancelled.");
	}

	const name =
		typeof args.name === "string" && args.name ? args.name : project.metadata.name;
	const response = await fetch(
		`/api/agent/export?name=${encodeURIComponent(name)}&format=${usedFormat}`,
		{ method: "POST", body: result.buffer },
	);
	if (!response.ok) throw new Error("Rendered, but could not save the file.");
	const { path } = (await response.json()) as { path: string };
	return usedFormat === format
		? { path }
		: { path, note: "MP4 encoding isn't available here, so it was saved as WebM." };
}

export type { Navigate };

export async function runAgentTool({
	tool,
	args,
	navigate,
}: {
	tool: string;
	args: Args;
	navigate: Navigate;
}): Promise<unknown> {
	switch (tool) {
		case "get_state":
			return getState();
		case "list_projects":
			return listProjects();
		case "create_project":
			return createProject(args, navigate);
		case "open_project":
			return openProject(args, navigate);
		case "add_media":
			return addMedia(args);
		case "add_to_timeline":
			return addToTimeline(args);
		case "add_text":
			return addText(args);
		case "split_clip":
			return splitClip(args);
		case "delete_clips":
			return deleteClips(args);
		case "move_clip":
			return moveClip(args);
		case "set_speed":
			return setSpeed(args);
		case "set_volume":
			return setVolume(args);
		case "seek":
			return seek(args);
		case "undo":
			editor().command.undo();
			return getState();
		case "redo":
			editor().command.redo();
			return getState();
		case "export_video":
			return exportVideo(args);
		default:
			return runProTool({ tool, args });
	}
}
