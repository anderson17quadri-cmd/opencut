import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// AI models used by the agent tools (MediaPipe cutout, face and hand
// tracking; DeepFilterNet voice cleanup). Their hosts serve them without
// CORS, so the editor window can't fetch them itself; this route downloads
// each one once and keeps it next to the app's data.
const MODELS: Record<string, string> = {
	"selfie_segmenter.tflite":
		"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
	"selfie_multiclass_256x256.tflite":
		"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
	"blaze_face_short_range.tflite":
		"https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
	// DeepFilterNet 3 (voice cleanup): the wasm engine matching the glue in
	// agent/deepfilter-glue.ts, and the official DeepFilterNet3 ONNX model.
	"df_bg.wasm": "https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v3/pkg/df_bg.wasm",
	"DeepFilterNet3_onnx.tar.gz":
		"https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v3/models/DeepFilterNet3_onnx.tar.gz",
	"hand_landmarker.task":
		"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
};

function cacheDir(): string {
	const database = process.env.DATABASE_URL;
	const base = database && !database.includes("://") ? dirname(database) : tmpdir();
	return join(base, "vision-models");
}

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;
	const source = MODELS[name];
	if (!source) {
		return NextResponse.json({ error: "Unknown model" }, { status: 404 });
	}

	const path = join(cacheDir(), name);
	let data: Buffer;
	try {
		data = await readFile(path);
	} catch {
		try {
			const response = await fetch(source, { signal: AbortSignal.timeout(5 * 60_000) });
			if (!response.ok) throw new Error(String(response.status));
			data = Buffer.from(await response.arrayBuffer());
			await mkdir(cacheDir(), { recursive: true });
			await writeFile(`${path}.part`, data);
			await rename(`${path}.part`, path);
		} catch {
			return NextResponse.json(
				{ error: "Could not download the AI model (no internet connection?)" },
				{ status: 502 },
			);
		}
	}

	return new NextResponse(new Uint8Array(data), {
		headers: {
			"content-type": "application/octet-stream",
			"cache-control": "public, max-age=31536000, immutable",
		},
	});
}
