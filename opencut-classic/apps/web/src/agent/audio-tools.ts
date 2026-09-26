import { InsertElementCommand } from "@/commands";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { DEEPFILTER_GLUE } from "./deepfilter-glue";
import { progressToast } from "./graphics-tools";
import { type Args, allTracks, asOneStep, editor, findElement, importMediaFile, requireOpenProject, str } from "./helpers";

// Audio tools built on open-source engines: voice cleanup with DeepFilterNet 3.

const SAMPLE_RATE = 48_000;

/** How much noise to take out: attenuation limit in dB. */
const STRENGTH_DB = { light: 12, medium: 24, strong: 100 } as const;

function sceneTracks(): SceneTracks {
	return editor().scenes.getActiveScene().tracks;
}

/** Decodes a media file's audio to mono 48 kHz. */
async function decodeMono(file: File): Promise<Float32Array> {
	const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
	let buffer: AudioBuffer;
	try {
		buffer = await context.decodeAudioData(await file.arrayBuffer());
	} catch {
		throw new Error("This clip's audio couldn't be decoded.");
	}
	const mono = new Float32Array(buffer.length);
	for (let c = 0; c < buffer.numberOfChannels; c++) {
		const data = buffer.getChannelData(c);
		for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
	}
	return mono;
}

const WORKER_SOURCE = `${DEEPFILTER_GLUE}
self.onmessage = (event) => {
	const { wasm, model, audio, attenuation } = event.data;
	try {
		initSync({ module: wasm });
		const state = df_create(new Uint8Array(model), attenuation);
		const hop = df_get_frame_length(state);
		const out = new Float32Array(audio.length + hop * 4);
		const frame = new Float32Array(hop);
		const total = Math.ceil((audio.length + hop * 4) / hop);
		for (let f = 0; f < total; f++) {
			frame.fill(0);
			const from = f * hop;
			if (from < audio.length) frame.set(audio.subarray(from, Math.min(audio.length, from + hop)));
			out.set(df_process_frame(state, frame), from);
			if (f % 200 === 0) self.postMessage({ progress: f / total });
		}
		self.postMessage({ done: true, out }, [out.buffer]);
	} catch (error) {
		self.postMessage({ error: String(error && error.message || error) });
	}
};`;

let assets: Promise<{ wasm: WebAssembly.Module; model: ArrayBuffer }> | null = null;

function loadAssets() {
	assets ??= (async () => {
		const get = async (name: string) => {
			const response = await fetch(`/api/vision-models/${name}`);
			if (!response.ok) throw new Error("Could not download the voice cleanup model (internet needed the first time).");
			return response.arrayBuffer();
		};
		const [wasmBytes, model] = await Promise.all([get("df_bg.wasm"), get("DeepFilterNet3_onnx.tar.gz")]);
		return { wasm: await WebAssembly.compile(wasmBytes), model };
	})().catch((error) => {
		assets = null;
		throw error;
	});
	return assets;
}

/** Runs DeepFilterNet over a whole recording in a worker. */
async function denoise(
	audio: Float32Array,
	attenuation: number,
	onProgress: (fraction: number) => void,
): Promise<Float32Array> {
	const { wasm, model } = await loadAssets();
	const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
	const worker = new Worker(url);
	try {
		return await new Promise<Float32Array>((resolve, reject) => {
			worker.onmessage = (event) => {
				const data = event.data as { progress?: number; done?: boolean; out?: Float32Array; error?: string };
				if (data.error) reject(new Error(`Voice cleanup failed: ${data.error}`));
				else if (data.done && data.out) resolve(data.out);
				else if (data.progress !== undefined) onProgress(data.progress);
			};
			worker.onerror = (event) => reject(new Error(`Voice cleanup failed: ${event.message}`));
			// The model bytes are copied (kept for the next run); the audio is moved.
			worker.postMessage({ wasm, model: model.slice(0), audio, attenuation }, [audio.buffer]);
		});
	} finally {
		worker.terminate();
		URL.revokeObjectURL(url);
	}
}

/**
 * The model's output lags its input by a fixed amount; find it by
 * correlating the loudest stretch of both, so the clean voice lines up
 * with the picture to the sample.
 */
function findDelay(input: Float32Array, output: Float32Array): number {
	const window = Math.min(input.length, SAMPLE_RATE * 2);
	let bestStart = 0;
	let bestEnergy = -1;
	for (let start = 0; start + window <= input.length; start += SAMPLE_RATE / 2) {
		let energy = 0;
		for (let i = start; i < start + window; i += 16) energy += input[i] * input[i];
		if (energy > bestEnergy) {
			bestEnergy = energy;
			bestStart = start;
		}
	}
	let bestLag = 0;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (let lag = 0; lag <= 4800; lag += 1) {
		let score = 0;
		for (let i = bestStart; i < bestStart + window; i += 4) score += input[i] * (output[i + lag] ?? 0);
		if (score > bestScore) {
			bestScore = score;
			bestLag = lag;
		}
	}
	return bestLag;
}

function toWav(samples: Float32Array): ArrayBuffer {
	const bytes = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(bytes);
	const text = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return bytes;
}

async function cleanVoice(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "video" && element.type !== "audio") throw new Error("clean_voice works on video or audio clips.");
	if (!("mediaId" in element)) throw new Error("That clip has no media.");
	const asset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === element.mediaId);
	if (!asset) throw new Error("The clip's media is missing.");
	const strength = (args.strength === "light" || args.strength === "strong" ? args.strength : "medium") as keyof typeof STRENGTH_DB;

	const progress = progressToast("Limpando a voz");
	let clean: Float32Array;
	let delay = 0;
	try {
		const original = await decodeMono(asset.file);
		const length = original.length;
		const reference = original.slice(0, Math.min(length, SAMPLE_RATE * 60));
		// (the worker takes ownership of `original`)
		const processed = await denoise(original, STRENGTH_DB[strength], (fraction) => progress.update(fraction));
		delay = findDelay(reference, processed);
		clean = processed.subarray(delay, delay + length);
		progress.done("Voz limpa");
	} catch (error) {
		progress.fail();
		throw error;
	}

	const file = new File([toWav(clean)], `${asset.name.replace(/\.[^.]+$/, "")} - voz limpa.wav`, { type: "audio/wav" });
	const media = await importMediaFile(file);
	const cleanAsset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === media.mediaId);
	if (!cleanAsset) throw new Error("The clean audio could not be imported.");

	// The clean audio replaces the clip's sound: same timing, trim, speed and
	// volume on an audio layer; the original clip is muted.
	const volume = typeof element.params.volume === "number" ? element.params.volume : 0;
	const result = await asOneStep(() => {
		const base = buildElementFromMedia({
			mediaId: cleanAsset.id,
			mediaType: cleanAsset.type,
			name: `${element.name} (voz limpa)`,
			duration: element.duration,
			startTime: element.startTime,
		});
		const copy = {
			...base,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			...("retime" in element && element.retime ? { retime: element.retime } : {}),
			params: { ...base.params, volume },
		} as typeof base;
		const before = new Set(allTracks().flatMap((t) => t.elements.map((e) => e.id)));
		new InsertElementCommand({ element: copy, placement: { mode: "auto", trackType: "audio" } }).execute();
		const mute = <T extends { elements: TimelineElement[] }>(t: T): T => ({
			...t,
			elements: t.elements.map((e) => (e.id === element.id ? ({ ...e, params: { ...e.params, muted: true } } as TimelineElement) : e)),
		});
		const now = sceneTracks();
		editor().timeline.updateTracks({ overlay: now.overlay.map(mute), main: mute(now.main), audio: now.audio.map(mute) });
		for (const t of allTracks()) {
			const inserted = t.elements.find((e) => !before.has(e.id));
			if (inserted) return { trackId: t.id, clipId: inserted.id };
		}
		throw new Error("The editor rejected the clean audio clip.");
	});

	return {
		...result,
		mediaId: media.mediaId,
		originalClipId: element.id,
		originalTrackId: track.id,
		strength,
		alignedBySamples: delay,
		note: "The original clip is muted and the clean voice plays in its place, in sync. If you later move or trim the original, do the same to this audio clip (or run clean_voice again).",
	};
}

export const AUDIO_TOOLS = new Set(["clean_voice"]);

export async function runAudioTool({ tool, args }: { tool: string; args: Args }): Promise<unknown> {
	switch (tool) {
		case "clean_voice":
			return cleanVoice(args);
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}
