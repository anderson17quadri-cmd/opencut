import { TracksSnapshotCommand } from "@/commands";
import { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import {
	type MediaTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
} from "@/wasm";

// Shared helpers for the agent tools. Times cross the bridge in seconds;
// the editor works in MediaTime ticks.

export type Navigate = (path: string) => void;
export type Args = Record<string, unknown>;

export const editor = () => EditorCore.getInstance();

export const toSeconds = (time: MediaTime) =>
	Math.round(mediaTimeToSeconds({ time }) * 1000) / 1000;
export const fromSeconds = (seconds: number) => mediaTimeFromSeconds({ seconds });

export function str(args: Args, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || !value) {
		throw new Error(`"${key}" is required`);
	}
	return value;
}

export function num(args: Args, key: string): number {
	const value = args[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`"${key}" must be a number`);
	}
	return value;
}

export function optNum(args: Args, key: string): number | undefined {
	return args[key] === undefined || args[key] === null
		? undefined
		: num(args, key);
}

export function allTracks(): TimelineTrack[] {
	const tracks = editor().scenes.getActiveScene().tracks;
	return [...tracks.overlay, tracks.main, ...tracks.audio];
}

export function findElement(elementId: string): {
	track: TimelineTrack;
	element: TimelineElement;
} {
	for (const track of allTracks()) {
		const element = track.elements.find((e) => e.id === elementId);
		if (element) return { track, element };
	}
	throw new Error(`No clip with id ${elementId}. Call get_state for current ids.`);
}

export function allElementIds(): Set<string> {
	return new Set(allTracks().flatMap((t) => t.elements.map((e) => e.id)));
}

export function describeElement(element: TimelineElement) {
	return {
		id: element.id,
		type: element.type,
		name: element.name,
		start: toSeconds(element.startTime),
		end: toSeconds((element.startTime + element.duration) as MediaTime),
		duration: toSeconds(element.duration),
		...("mediaId" in element ? { mediaId: element.mediaId } : {}),
		...(element.type === "text"
			? {
					text: element.params.content,
					style: {
						fontFamily: element.params.fontFamily,
						fontSize: element.params.fontSize,
						color: element.params.color,
						bold: element.params.fontWeight === "bold",
						background: element.params["background.enabled"]
							? element.params["background.color"]
							: "none",
					},
				}
			: {}),
		...(element.type === "sticker" ? { sticker: element.stickerId } : {}),
		...(element.type === "graphic"
			? { shape: element.definitionId, fill: element.params.fill }
			: {}),
		...("retime" in element && element.retime
			? { speed: element.retime.rate }
			: {}),
		...(element.type === "video" || element.type === "audio"
			? { volumeDb: element.params.volume, muted: element.params.muted }
			: {}),
	};
}

export function requireOpenProject() {
	const project = editor().project.getActiveOrNull();
	if (!project || !window.location.pathname.startsWith("/editor/")) {
		throw new Error(
			"No project is open. Use list_projects + open_project, or create_project.",
		);
	}
	return project;
}

/** Projects whose frame size Claude chose on purpose (set_project). */
const chosenFormat = new Set<string>();

export function rememberChosenFormat(projectId: string) {
	chosenFormat.add(projectId);
}

export function insertAndFind(
	insert: () => void,
): { track: TimelineTrack; element: TimelineElement } {
	const before = allElementIds();
	const project = editor().project.getActive();
	const canvasBefore = project?.settings.canvasSize;
	insert();
	// The editor resizes the frame to the first clip dropped into an empty
	// timeline. Keep a format chosen with set_project (e.g. 9:16 for Reels
	// with 16:9 footage).
	const after = editor().project.getActive();
	if (
		project &&
		canvasBefore &&
		after &&
		chosenFormat.has(project.metadata.id) &&
		(after.settings.canvasSize.width !== canvasBefore.width ||
			after.settings.canvasSize.height !== canvasBefore.height)
	) {
		void editor().project.updateSettings({
			settings: { canvasSize: canvasBefore },
			pushHistory: false,
		});
	}
	for (const track of allTracks()) {
		const element = track.elements.find((e) => !before.has(e.id));
		if (element) return { track, element };
	}
	throw new Error("The editor rejected the clip (overlap or unsupported track).");
}


/** Imports a file into the open project's media, like dropping it in. */
export async function importMediaFile(file: File) {
	const project = requireOpenProject();
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) throw new Error(`Could not import ${file.name}`);

	const asset = await editor().media.addMediaAsset({
		projectId: project.metadata.id,
		asset: processed,
	});
	if (!asset) throw new Error(`Could not save ${file.name} (storage full?)`);

	return {
		mediaId: asset.id,
		name: asset.name,
		type: asset.type,
		durationSeconds: asset.duration,
		width: asset.width,
		height: asset.height,
	};
}

/**
 * Runs `run`, which must apply its edits by calling commands' execute()
 * directly, then records the whole change as a single undoable step.
 */
export async function asOneStep<T>(run: () => T | Promise<T>): Promise<T> {
	const before = editor().scenes.getActiveScene().tracks;
	let result: T;
	try {
		result = await run();
	} catch (error) {
		editor().timeline.updateTracks(before);
		throw error;
	}
	const after = editor().scenes.getActiveScene().tracks;
	if (after !== before) {
		editor().command.execute({
			command: new TracksSnapshotCommand({ before, after }),
		});
	}
	return result;
}


/** Clips made by cutout_person carry this suffix in their name. */
export const CUTOUT_SUFFIX = "(pessoa)";

/**
 * Overlay index for a new graphics layer: the top, but under any person
 * cutout layers sitting there, so new graphics land behind the presenter.
 */
export function graphicsInsertIndex(): number {
	const overlay = editor().scenes.getActiveScene().tracks.overlay;
	let index = 0;
	while (
		index < overlay.length &&
		overlay[index].elements.some((element) => element.name.endsWith(CUTOUT_SUFFIX))
	) {
		index++;
	}
	return index;
}
