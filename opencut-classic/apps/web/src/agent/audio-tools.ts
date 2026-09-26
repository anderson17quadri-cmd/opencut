import { analyze, guess } from "web-audio-beat-detector";
import { InsertElementCommand } from "@/commands";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { DEEPFILTER_GLUE } from "./deepfilter-glue";
import { progressToast } from "./graphics-tools";
import { mediaTimeToSeconds } from "@/wasm";
import {
	type Args,
	allTracks,
	asOneStep,
	editor,
	findElement,
	importMediaFile,
	requireOpenProject,
	fromSeconds,
	str,
	toSeconds,
} from "./helpers";

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

/**
 * Finds the music's tempo and beat grid (web-audio-beat-detector) and
 * returns the beat times on the timeline, for cutting and animating on
 * the beat.
 */
async function findBeats(args: Args) {
	requireOpenProject();
	const { element } = findElement(str(args, "clipId"));
	if (element.type !== "audio" && element.type !== "video") throw new Error("find_beats works on music (audio or video clips).");
	if (!("mediaId" in element)) throw new Error("That clip has no media.");
	const asset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === element.mediaId);
	if (!asset) throw new Error("The clip's media is missing.");

	let buffer: AudioBuffer;
	try {
		buffer = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await asset.file.arrayBuffer());
	} catch {
		throw new Error("This clip's audio couldn't be decoded.");
	}
	const rate = ("retime" in element ? element.retime?.rate : undefined) ?? 1;
	const clipStart = toSeconds(element.startTime);
	const clipSeconds = toSeconds(element.duration);
	const sourceStart = mediaTimeToSeconds({ time: element.trimStart });
	// Tempo from up to 60 s of what the clip plays.
	const analyzed = Math.max(3, Math.min(60, clipSeconds * rate, buffer.duration - sourceStart));
	let result: { bpm: number; offset: number; tempo: number };
	try {
		// guess() gives the grid's phase (offset) with a rounded BPM;
		// analyze() gives the precise tempo for a grid that doesn't drift.
		const [grid, tempo] = await Promise.all([guess(buffer, sourceStart, analyzed), analyze(buffer, sourceStart, analyzed)]);
		result = { ...grid, tempo: Math.abs(tempo - grid.bpm) < 2 ? tempo : grid.bpm };
	} catch {
		throw new Error("No steady beat was found in that part of the clip.");
	}
	const period = 60 / result.tempo;
	// Beat grid in source time, anchored at the first detected beat.
	let beat = sourceStart + result.offset;
	while (beat - period >= sourceStart) beat -= period;
	const beats: number[] = [];
	for (; beat < sourceStart + clipSeconds * rate && beats.length < 1000; beat += period) {
		const timeline = clipStart + (beat - sourceStart) / rate;
		if (timeline >= clipStart && timeline <= clipStart + clipSeconds) beats.push(Math.round(timeline * 1000) / 1000);
	}
	return {
		bpm: Math.round(result.tempo * 10) / 10,
		beatSeconds: Math.round((period / rate) * 1000) / 1000,
		beats,
		// Every 4th beat, assuming the first detected beat starts a bar.
		bars: beats.filter((_, i) => i % 4 === 0),
		note: "Timeline seconds. Cut, punch_zoom, show pictures/animations and add sounds on beats (strongest on bars); a cut every 1-2 bars feels musical.",
	};
}

const VITS_WEB = "https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm";
type VitsModule = {
	predict(
		config: { text: string; voiceId: string },
		callback?: (progress: { loaded: number; total: number }) => void,
	): Promise<Blob>;
};
// Kept out of the bundler's sight: loaded at run time.
const importFromUrl = new Function("url", "return import(url)") as (url: string) => Promise<VitsModule>;

/** Brazilian Portuguese voices of Piper (rhasspy), run on this computer. */
const VOICES = {
	faber: { id: "pt_BR-faber-medium", note: "male, clear (medium quality)" },
	edresson: { id: "pt_BR-edresson-low", note: "male, lighter model (low quality)" },
} as const;

export const VOICE_LICENSE =
	"Piper (MIT) · voz pt_BR: dataset CC0/CC BY 4.0; modelo base de pesquisa (lessac/ryan) — confira antes de uso comercial";

/**
 * Narration from text with a Piper neural voice (via vits-web, MIT),
 * generated on this computer and placed on an audio layer.
 */
async function generateVoiceover(args: Args) {
	requireOpenProject();
	const text = str(args, "text").trim();
	if (!text) throw new Error('"text" is required');
	if (text.length > 3000) throw new Error("Keep each narration under 3000 characters (split it into parts).");
	const voiceKey = (args.voice === "edresson" ? "edresson" : "faber") as keyof typeof VOICES;
	const start = Math.max(0, typeof args.start === "number" ? args.start : toSeconds(editor().playback.getCurrentTime()));

	const progress = progressToast("Gerando a narração");
	let wav: Blob;
	try {
		// Loaded on first use from jsDelivr (its phonemizer is a large
		// emscripten module), like the MediaPipe vision tools.
		const tts = await importFromUrl(VITS_WEB);
		wav = await tts.predict({ text, voiceId: VOICES[voiceKey].id }, (p: { loaded: number; total: number }) => {
			if (p.total > 0) progress.update(Math.min(0.99, p.loaded / p.total));
		});
		progress.done("Narração pronta");
	} catch (error) {
		progress.fail();
		throw new Error(
			`Could not generate the narration (internet needed the first time to download the voice): ${error instanceof Error ? error.message : error}`,
		);
	}

	const name = `narração - ${text.slice(0, 40).replace(/[^\p{L}\p{N} ]/gu, "").trim() || "voz"}.wav`;
	const media = await importMediaFile(new File([wav], name, { type: "audio/wav" }));
	const asset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === media.mediaId);
	if (!asset) throw new Error("The narration could not be imported.");
	const volumeDb = typeof args.volumeDb === "number" ? args.volumeDb : 0;
	const placed = await asOneStep(() => {
		const base = buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: `Narração (${voiceKey})`,
			duration: fromSeconds(asset.duration ?? 1),
			startTime: fromSeconds(start),
		});
		const element = { ...base, params: { ...base.params, volume: volumeDb } } as typeof base;
		const before = new Set(allTracks().flatMap((t) => t.elements.map((e) => e.id)));
		new InsertElementCommand({ element, placement: { mode: "auto", trackType: "audio" } }).execute();
		for (const t of allTracks()) {
			const inserted = t.elements.find((e) => !before.has(e.id));
			if (inserted) return { trackId: t.id, clipId: inserted.id };
		}
		throw new Error("The editor rejected the narration clip.");
	});
	return {
		...placed,
		mediaId: media.mediaId,
		voice: voiceKey,
		start: Math.round(start * 100) / 100,
		durationSeconds: Math.round((asset.duration ?? 0) * 100) / 100,
		license: VOICE_LICENSE,
		note: "Transcribe it (transcribe words=true) to time captions and pictures to the narration.",
	};
}

export const AUDIO_TOOLS = new Set(["clean_voice", "find_beats", "generate_voiceover"]);

export async function runAudioTool({ tool, args }: { tool: string; args: Args }): Promise<unknown> {
	switch (tool) {
		case "clean_voice":
			return cleanVoice(args);
		case "find_beats":
			return findBeats(args);
		case "generate_voiceover":
			return generateVoiceover(args);
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}
