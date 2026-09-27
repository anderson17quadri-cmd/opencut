import { hasWebGPU } from "./vision";

// Image AI models run in the editor window with transformers.js (the same
// engine as the captions and the pro cutout). Each downloads once from
// Hugging Face and is then cached by the browser.
//
// - CLIP (OpenAI, MIT): how well a picture matches a description, to pick
//   the b-roll picture that really shows what is being said.
// - Depth Anything V2 Small (Apache-2.0): depth of a photo, for the 3D
//   parallax ("2.5D") motion of still pictures.
// - Swin2SR lightweight x2 (Apache-2.0): doubles the resolution of small
//   pictures so they stay sharp full screen.

type Transformers = typeof import("@huggingface/transformers");

let library: Promise<Transformers> | null = null;
function transformers() {
	library ??= import("@huggingface/transformers").catch((error) => {
		library = null;
		throw error;
	});
	return library;
}

/** Runs `load` on the GPU when there is a real one, else on the CPU. */
async function onBestDevice<T>(load: (options: Record<string, unknown>) => Promise<T>, cpuDtype: string): Promise<T> {
	if (await hasWebGPU()) {
		try {
			return await load({ device: "webgpu", dtype: "fp32" });
		} catch {
			// Falls back to the CPU below.
		}
	}
	return load({ dtype: cpuDtype });
}

function cached<T>(create: () => Promise<T>) {
	let value: Promise<T> | null = null;
	return () => {
		value ??= create().catch((error) => {
			value = null;
			throw error;
		});
		return value;
	};
}

// ------------------------------------------------------------------ CLIP

const CLIP_MODEL = "Xenova/clip-vit-base-patch32";

const clip = cached(async () => {
	const t = await transformers();
	const [tokenizer, processor, text, vision] = await Promise.all([
		t.AutoTokenizer.from_pretrained(CLIP_MODEL),
		t.AutoProcessor.from_pretrained(CLIP_MODEL),
		t.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: "q8" }),
		t.CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: "q8" }),
	]);
	return { t, tokenizer, processor, text, vision };
});

function normalizedRows(tensor: { dims: number[]; data: ArrayLike<number> }) {
	const [rows, size] = tensor.dims;
	const out: Float32Array[] = [];
	for (let r = 0; r < rows; r++) {
		const row = Float32Array.from({ length: size }, (_, i) => Number(tensor.data[r * size + i]));
		const length = Math.hypot(...row) || 1;
		out.push(row.map((v) => v / length));
	}
	return out;
}

/**
 * Cosine similarity between a description and each picture (CLIP). On
 * this model a picture that shows the thing scores about 0.27-0.33,
 * unrelated ones about 0.15-0.22.
 */
export async function pictureSimilarity({ text, pictures }: { text: string; pictures: Blob[] }): Promise<Array<number | null>> {
	const { t, tokenizer, processor, text: textModel, vision } = await clip();
	const images = await Promise.all(pictures.map((blob) => t.RawImage.fromBlob(blob).catch(() => null)));
	const usable = images.flatMap((image, index) => (image ? [{ image, index }] : []));
	const scores: Array<number | null> = pictures.map(() => null);
	if (usable.length === 0) return scores;
	const { text_embeds } = await textModel(tokenizer([text], { padding: true, truncation: true }));
	const [query] = normalizedRows(text_embeds);
	// A few at a time, to keep memory low.
	for (let i = 0; i < usable.length; i += 8) {
		const batch = usable.slice(i, i + 8);
		const { image_embeds } = await vision(await processor(batch.map((b) => b.image)));
		normalizedRows(image_embeds).forEach((row, k) => {
			scores[batch[k].index] = row.reduce((sum, v, j) => sum + v * query[j], 0);
		});
	}
	return scores;
}

// ----------------------------------------------------------------- depth

const depthEstimator = cached(async () => {
	const t = await transformers();
	return onBestDevice(
		(options) => t.pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", options),
		"q8",
	);
});

/** Relative depth of a picture: 0 far … 1 near, as a greyscale canvas. */
export async function depthMap(picture: ImageBitmap): Promise<OffscreenCanvas> {
	const t = await transformers();
	const estimator = await depthEstimator();
	// The model works at ~518 px; a smaller copy is enough.
	const scale = Math.min(1, 768 / Math.max(picture.width, picture.height));
	const input = new OffscreenCanvas(Math.round(picture.width * scale), Math.round(picture.height * scale));
	input.getContext("2d")?.drawImage(picture, 0, 0, input.width, input.height);
	const result = (await estimator(t.RawImage.fromCanvas(input))) as unknown as {
		depth: { width: number; height: number; data: Uint8Array | Uint8ClampedArray; channels: number };
	};
	const { width, height, data, channels } = result.depth;
	let low = 255;
	let high = 0;
	for (let i = 0; i < width * height; i++) {
		const v = data[i * channels];
		if (v < low) low = v;
		if (v > high) high = v;
	}
	const range = Math.max(1, high - low);
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("No 2D canvas available.");
	const image = ctx.createImageData(width, height);
	for (let i = 0; i < width * height; i++) {
		const v = Math.round(((data[i * channels] - low) / range) * 255);
		image.data[i * 4] = v;
		image.data[i * 4 + 1] = v;
		image.data[i * 4 + 2] = v;
		image.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(image, 0, 0);
	// Soften the edges between near and far so the motion doesn't tear.
	const soft = new OffscreenCanvas(width, height);
	const softCtx = soft.getContext("2d");
	if (!softCtx) return canvas;
	softCtx.filter = `blur(${Math.max(1, Math.round(width / 180))}px)`;
	softCtx.drawImage(canvas, 0, 0);
	return soft;
}

const PARALLAX_VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
	uv = position * 0.5 + 0.5;
	uv.y = 1.0 - uv.y;
	gl_Position = vec4(position, 0.0, 1.0);
}`;

// Moves near things more than far ones, like a camera gliding past the
// scene: each pixel looks up where it came from along the camera offset,
// refined a few times so edges stay consistent.
const PARALLAX_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D picture;
uniform sampler2D depth;
uniform vec2 offset;
uniform float zoom;
uniform float focus;
void main() {
	vec2 base = (uv - 0.5) / zoom + 0.5;
	vec2 p = base;
	for (int i = 0; i < 12; i++) {
		float d = texture(depth, p).r;
		p = base + offset * (d - focus);
	}
	color = texture(picture, clamp(p, 0.001, 0.999));
}`;

export type ParallaxMotion = "push" | "pan" | "orbit";

/**
 * Renders the 3D photo motion: frames of the picture seen from a camera
 * that glides and pushes in, with near things moving more than far ones.
 */
export async function parallaxFrames({
	picture,
	motion,
	strength,
}: {
	picture: ImageBitmap;
	motion: ParallaxMotion;
	/** 0.5 subtle … 1 default … 2 strong. */
	strength: number;
}) {
	const depth = await depthMap(picture);
	const canvas = new OffscreenCanvas(picture.width, picture.height);
	const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
	if (!gl) throw new Error("3D photos need WebGL 2.");
	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type);
		if (!shader) throw new Error("WebGL shader error");
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
		return shader;
	};
	const program = gl.createProgram();
	if (!program) throw new Error("WebGL program error");
	gl.attachShader(program, compile(gl.VERTEX_SHADER, PARALLAX_VERTEX));
	gl.attachShader(program, compile(gl.FRAGMENT_SHADER, PARALLAX_FRAGMENT));
	gl.linkProgram(program);
	gl.useProgram(program);
	const buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	const position = gl.getAttribLocation(program, "position");
	gl.enableVertexAttribArray(position);
	gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
	const texture = (unit: number, source: TexImageSource, name: string) => {
		const tex = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.uniform1i(gl.getUniformLocation(program, name), unit);
	};
	texture(0, picture, "picture");
	texture(1, depth, "depth");
	const offsetAt = gl.getUniformLocation(program, "offset");
	const zoomAt = gl.getUniformLocation(program, "zoom");
	gl.uniform1f(gl.getUniformLocation(program, "focus"), 0.55);
	gl.viewport(0, 0, canvas.width, canvas.height);

	const amount = 0.045 * Math.min(Math.max(strength, 0.3), 2.5);
	return {
		/** Frame at progress p (0 … 1). */
		async frame(p: number): Promise<ImageBitmap> {
			const e = p * p * (3 - 2 * p);
			let x = 0;
			let y = 0;
			let zoom = 1.06;
			if (motion === "push") {
				x = amount * 0.35 * (e - 0.5);
				y = -amount * 0.2 * (e - 0.5);
				zoom = 1.06 + 0.1 * e * Math.min(strength, 1.5);
			} else if (motion === "pan") {
				x = amount * (e - 0.5) * 2;
				zoom = 1.08;
			} else {
				x = amount * Math.sin(e * Math.PI * 2) * 0.9;
				y = amount * 0.5 * (Math.cos(e * Math.PI * 2) - 1) * 0.6;
				zoom = 1.09;
			}
			gl.uniform2f(offsetAt, x, y);
			gl.uniform1f(zoomAt, zoom);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			return createImageBitmap(canvas);
		},
		close() {
			gl.getExtension("WEBGL_lose_context")?.loseContext();
		},
	};
}

// --------------------------------------------------------------- upscale

const upscaler = cached(async () => {
	const t = await transformers();
	return onBestDevice(
		(options) => t.pipeline("image-to-image", "Xenova/swin2SR-lightweight-x2-64", options),
		"fp32",
	);
});

/** Doubles a picture's resolution with Swin2SR (keeps transparency out). */
export async function upscalePicture(picture: ImageBitmap): Promise<ImageBitmap> {
	const t = await transformers();
	const model = await upscaler();
	const input = new OffscreenCanvas(picture.width, picture.height);
	input.getContext("2d")?.drawImage(picture, 0, 0);
	const output = (await model(t.RawImage.fromCanvas(input))) as unknown as {
		width: number;
		height: number;
		channels: number;
		data: Uint8Array | Uint8ClampedArray;
	};
	const image = Array.isArray(output) ? output[0] : output;
	// The model pads its input to a multiple of 8: crop back to exactly 2×.
	const width = Math.min(image.width, picture.width * 2);
	const height = Math.min(image.height, picture.height * 2);
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("No 2D canvas available.");
	const data = ctx.createImageData(width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const from = (y * image.width + x) * image.channels;
			const to = (y * width + x) * 4;
			for (let c = 0; c < 3; c++) data.data[to + c] = image.data[from + c];
			data.data[to + 3] = 255;
		}
	}
	ctx.putImageData(data, 0, 0);
	return createImageBitmap(canvas);
}
