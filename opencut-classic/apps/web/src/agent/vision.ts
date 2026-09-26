import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	CanvasSink,
	CanvasSource,
	Input,
	Output,
	QUALITY_HIGH,
	WebMOutputFormat,
	canEncodeVideo,
} from "mediabunny";

// On-device vision for the agent tools, via Google's MediaPipe Tasks
// (loaded on first use from jsDelivr; models come through
// /api/vision-models, which caches them on disk).

const TASKS_VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// Loaded at runtime, not bundled: keep the import out of the bundler's sight.
const importFromUrl = new Function("url", "return import(url)") as (
	url: string,
) => Promise<VisionModule>;

type MPMask = {
	width: number;
	height: number;
	getAsFloat32Array(): Float32Array;
	close(): void;
};
type SegmenterResult = { confidenceMasks?: MPMask[]; close(): void };
type ImageSegmenter = {
	segmentForVideo(image: TexImageSource, timestampMs: number): SegmenterResult;
	close(): void;
};
type Landmark = { x: number; y: number; z: number };
type HandResult = {
	landmarks: Landmark[][];
	handedness: Array<Array<{ categoryName: string; score: number }>>;
};
type HandLandmarker = {
	detectForVideo(image: TexImageSource, timestampMs: number): HandResult;
	close(): void;
};
type VisionModule = {
	FilesetResolver: { forVisionTasks(path: string): Promise<unknown> };
	ImageSegmenter: {
		createFromOptions(fileset: unknown, options: unknown): Promise<ImageSegmenter>;
	};
	HandLandmarker: {
		createFromOptions(fileset: unknown, options: unknown): Promise<HandLandmarker>;
	};
};

let visionPromise: Promise<{ module: VisionModule; fileset: unknown }> | null = null;

function loadVision() {
	visionPromise ??= (async () => {
		const module = await importFromUrl(`${TASKS_VISION}/vision_bundle.mjs`);
		const fileset = await module.FilesetResolver.forVisionTasks(`${TASKS_VISION}/wasm`);
		return { module, fileset };
	})().catch((error) => {
		visionPromise = null;
		throw new Error(
			`Could not load the AI vision engine (internet needed the first time): ${error instanceof Error ? error.message : error}`,
		);
	});
	return visionPromise;
}

/** Tries the GPU first, then the CPU (some machines have no WebGL2 GPU). */
async function withDelegate<T>(create: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
	try {
		return await create("GPU");
	} catch {
		return create("CPU");
	}
}

/**
 * The multiclass model (hair, face, body, clothes) gives the cleanest
 * edges but is heavy; on a GPU it's fast. Without a usable GPU the small
 * selfie model is used instead, which is several times faster on the CPU.
 * `personMask` says whether the first mask is the person or the background.
 */
async function createPersonSegmenter(
	quality: "auto" | "fast" | "best" = "auto",
): Promise<{ segmenter: ImageSegmenter; personMask: "invert-background" | "person" }> {
	const { module, fileset } = await loadVision();
	const create = (model: string, delegate: "GPU" | "CPU") =>
		module.ImageSegmenter.createFromOptions(fileset, {
			baseOptions: { modelAssetPath: `/api/vision-models/${model}`, delegate },
			runningMode: "VIDEO",
			outputCategoryMask: false,
			outputConfidenceMasks: true,
		});
	const best = "selfie_multiclass_256x256.tflite";
	const fast = "selfie_segmenter.tflite";

	if (quality !== "fast") {
		try {
			return { segmenter: await create(best, "GPU"), personMask: "invert-background" };
		} catch {
			if (quality === "best") {
				return { segmenter: await create(best, "CPU"), personMask: "invert-background" };
			}
		}
	}
	try {
		return { segmenter: await create(fast, "GPU"), personMask: "person" };
	} catch {
		return { segmenter: await create(fast, "CPU"), personMask: "person" };
	}
}

export async function createHandLandmarker(): Promise<HandLandmarker> {
	const { module, fileset } = await loadVision();
	return withDelegate((delegate) =>
		module.HandLandmarker.createFromOptions(fileset, {
			baseOptions: { modelAssetPath: "/api/vision-models/hand_landmarker.task", delegate },
			runningMode: "VIDEO",
			numHands: 2,
		}),
	);
}

/** Iterates decoded frames of `file` between two source times (seconds). */
export async function* videoFrames({
	file,
	start,
	end,
	maxWidth,
}: {
	file: File;
	start: number;
	end: number;
	maxWidth?: number;
}): AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number; width: number; height: number }> {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("That clip has no video.");
		if (!(await track.canDecode())) {
			throw new Error("This video's codec can't be decoded here.");
		}
		const scale = maxWidth ? Math.min(1, maxWidth / track.displayWidth) : 1;
		const width = Math.max(2, Math.round((track.displayWidth * scale) / 2) * 2);
		const height = Math.max(2, Math.round((track.displayHeight * scale) / 2) * 2);
		const sink = new CanvasSink(track, { width, height, poolSize: 2, fit: "fill" });
		for await (const wrapped of sink.canvases(start, end)) {
			yield {
				canvas: wrapped.canvas,
				timestamp: wrapped.timestamp,
				duration: wrapped.duration,
				width,
				height,
			};
		}
	} finally {
		input.dispose();
	}
}

/**
 * Makes a transparent video of just the person in `file` between two
 * source times: every frame is segmented and everything but the person
 * (hair, face, body, clothes) is made transparent.
 */
export async function cutoutPerson({
	file,
	start,
	end,
	quality,
	onProgress,
}: {
	file: File;
	start: number;
	end: number;
	quality?: "auto" | "fast" | "best";
	onProgress?: (fraction: number) => void;
}): Promise<File> {
	const { segmenter, personMask } = await createPersonSegmenter(quality);
	let output: Output | null = null;
	let source: CanvasSource | null = null;
	let outCanvas: OffscreenCanvas | null = null;
	let outCtx: OffscreenCanvasRenderingContext2D | null = null;
	let maskCanvas: OffscreenCanvas | null = null;
	let maskCtx: OffscreenCanvasRenderingContext2D | null = null;
	let maskData: ImageData | null = null;
	let lastTimestampMs = -1;

	try {
		for await (const frame of videoFrames({ file, start, end })) {
			if (!output) {
				outCanvas = new OffscreenCanvas(frame.width, frame.height);
				outCtx = outCanvas.getContext("2d", { alpha: true });
				const codec = (await canEncodeVideo("vp9", { width: frame.width, height: frame.height }))
					? "vp9"
					: "vp8";
				output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
				source = new CanvasSource(outCanvas, {
					codec,
					bitrate: QUALITY_HIGH,
					alpha: "keep",
					keyFrameInterval: 2,
				});
				output.addVideoTrack(source);
				await output.start();
			}
			if (!outCtx || !outCanvas || !source) break;

			const timestampMs = Math.max(lastTimestampMs + 1, Math.round(frame.timestamp * 1000));
			lastTimestampMs = timestampMs;
			const result = segmenter.segmentForVideo(frame.canvas as TexImageSource, timestampMs);
			const mask = result.confidenceMasks?.[0];

			outCtx.globalCompositeOperation = "copy";
			outCtx.drawImage(frame.canvas, 0, 0, frame.width, frame.height);
			if (mask) {
				if (!maskCanvas || maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
					maskCanvas = new OffscreenCanvas(mask.width, mask.height);
					maskCtx = maskCanvas.getContext("2d");
					maskData = maskCtx?.createImageData(mask.width, mask.height) ?? null;
				}
				if (maskCtx && maskData) {
					const values = mask.getAsFloat32Array();
					const pixels = maskData.data;
					const invert = personMask === "invert-background";
					for (let i = 0; i < values.length; i++) {
						// Person probability; tighten the soft edge a little.
						const p = invert ? 1 - values[i] : values[i];
						const a = Math.min(1, Math.max(0, (p - 0.3) / 0.4));
						pixels[i * 4 + 3] = a * a * (3 - 2 * a) * 255;
					}
					maskCtx.putImageData(maskData, 0, 0);
					outCtx.globalCompositeOperation = "destination-in";
					outCtx.imageSmoothingQuality = "high";
					outCtx.drawImage(maskCanvas, 0, 0, frame.width, frame.height);
				}
			}
			result.close();
			outCtx.globalCompositeOperation = "source-over";

			await source.add(frame.timestamp - start, frame.duration);
			onProgress?.(Math.min(1, (frame.timestamp - start) / Math.max(0.001, end - start)));
		}
		if (!output) throw new Error("No video frames in that range.");
		await output.finalize();
		const buffer = (output.target as BufferTarget).buffer;
		if (!buffer) throw new Error("Encoding produced no data.");
		return new File([buffer], `${file.name.replace(/\.[^.]+$/, "")} - recorte.webm`, {
			type: "video/webm",
		});
	} finally {
		segmenter.close();
	}
}
