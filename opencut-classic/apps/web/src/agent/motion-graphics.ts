// Motion graphics written by Claude as code. The code runs in a sandboxed
// iframe with an opaque origin: it can draw, but it cannot reach the
// editor, the local API or the user's files. The editor asks it for one
// frame at a time (time is passed in explicitly, so rendering is
// deterministic), receives each frame as an ImageBitmap, and encodes the
// frames into a transparent WebM that goes on the timeline like any clip.

export type MotionMode = "2d" | "three";

export interface MotionGraphicSpec {
	code: string;
	mode: MotionMode;
	width: number;
	height: number;
	fps: number;
	duration: number;
	fonts?: string[];
	/** Named images handed to the code as ImageBitmaps (api.images[name]). */
	images?: Record<string, ImageBitmap>;
}

const RUNTIME_HELPERS = String.raw`
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = {
	linear: (t) => t,
	in: (t) => t * t * t,
	out: (t) => 1 - Math.pow(1 - t, 3),
	inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
	back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
	elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
	bounce: (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
};
/** Maps time t from [t0, t1] to [from, to] with an easing, clamped. */
const tween = (t, t0, t1, from = 0, to = 1, easing = ease.inOut) =>
	lerp(from, to, easing(clamp((t - t0) / Math.max(1e-6, t1 - t0))));
const roundRect = (ctx, x, y, w, h, r) => {
	ctx.beginPath();
	ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
};
`;

function buildDocument({
	spec,
	origin,
}: {
	spec: MotionGraphicSpec;
	origin: string;
}): string {
	const fontLinks = (spec.fonts ?? [])
		.map(
			(family) =>
				`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@300;400;600;700;800;900&display=block">`,
		)
		.join("");
	const csp = [
		"default-src 'none'",
		`script-src 'unsafe-inline' 'unsafe-eval' ${origin}/vendor/`,
		"style-src 'unsafe-inline' https://fonts.googleapis.com",
		"font-src https://fonts.gstatic.com data:",
		"img-src data: blob:",
		"connect-src 'none'",
	].join("; ");
	const config = JSON.stringify({
		width: spec.width,
		height: spec.height,
		fps: spec.fps,
		duration: spec.duration,
		mode: spec.mode,
		fonts: spec.fonts ?? [],
	});

	// The user code is inlined inside a function so its top-level
	// declarations (setup/render) stay local to it.
	return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
${fontLinks}
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>
</head><body><canvas id="c"></canvas>
<script>
// Classic script so even a syntax error in the module below is reported.
window.addEventListener("error", (event) => parent.postMessage({ type: "error", message: String(event.message || event.error), stack: String(event.error && event.error.stack || "") }, "*"));
</script>
<script type="module">
import * as THREE from "${origin}/vendor/three/three.module.min.js";
const CONFIG = ${config};
const send = (message, transfer) => parent.postMessage(message, "*", transfer ?? []);
const fail = (error) => send({ type: "error", message: String(error && error.message || error), stack: String(error && error.stack || "") });
window.addEventListener("unhandledrejection", (event) => fail(event.reason));
${RUNTIME_HELPERS}
const canvas = document.getElementById("c");
canvas.width = CONFIG.width;
canvas.height = CONFIG.height;
const W = CONFIG.width, H = CONFIG.height;
let ctx = null, renderer = null, scene = null, camera = null;
if (CONFIG.mode === "three") {
	renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
	renderer.setPixelRatio(1);
	renderer.setSize(W, H, false);
	renderer.setClearColor(0x000000, 0);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 2000);
	camera.position.set(0, 0, 12);
} else {
	ctx = canvas.getContext("2d", { alpha: true });
}
const api = { THREE, canvas, ctx, renderer, scene, camera, width: W, height: H, fps: CONFIG.fps, duration: CONFIG.duration, images: {}, state: {}, clamp, lerp, ease, tween, roundRect };
const user = (() => {
${spec.code}
;return {
	setup: typeof setup === "function" ? setup : null,
	render: typeof render === "function" ? render : null,
};
})();
if (!user.render) throw new Error("The code must define a function render(api).");

window.addEventListener("message", async (event) => {
	const data = event.data || {};
	try {
		if (data.type === "init") {
			Object.assign(api.images, data.images || {});
			await Promise.all(CONFIG.fonts.flatMap((family) => [400, 700, 900].map((weight) => document.fonts.load(weight + " 32px \\"" + family + "\\"").catch(() => null))));
			if (user.setup) await user.setup(api);
			send({ type: "ready" });
		} else if (data.type === "frame") {
			const t = data.time;
			api.t = t;
			api.progress = CONFIG.duration > 0 ? t / CONFIG.duration : 0;
			if (ctx) {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.clearRect(0, 0, W, H);
				ctx.save();
				await user.render({ ...api, t, progress: api.progress });
				ctx.restore();
			} else {
				await user.render({ ...api, t, progress: api.progress });
				renderer.render(scene, camera);
			}
			const bitmap = await createImageBitmap(canvas, { premultiplyAlpha: "none" });
			send({ type: "frame", index: data.index, bitmap }, [bitmap]);
		}
	} catch (error) {
		fail(error);
	}
});
send({ type: "loaded" });
</script></body></html>`;
}

/** A running sandbox that renders frames of one motion graphic on demand. */
export class MotionGraphicSandbox {
	private iframe: HTMLIFrameElement;
	private pending = new Map<number, (bitmap: ImageBitmap) => void>();
	private failure: ((error: Error) => void) | null = null;
	private listener: (event: MessageEvent) => void;
	private error: Error | null = null;

	private constructor(private spec: MotionGraphicSpec) {
		this.iframe = document.createElement("iframe");
		this.iframe.setAttribute("sandbox", "allow-scripts");
		this.iframe.setAttribute("aria-hidden", "true");
		Object.assign(this.iframe.style, {
			position: "fixed",
			left: "-20000px",
			top: "0",
			width: `${Math.min(spec.width, 4096)}px`,
			height: `${Math.min(spec.height, 4096)}px`,
			border: "0",
			pointerEvents: "none",
		});
		this.listener = (event) => this.onMessage(event);
	}

	static async start(spec: MotionGraphicSpec): Promise<MotionGraphicSandbox> {
		const sandbox = new MotionGraphicSandbox(spec);
		await sandbox.boot();
		return sandbox;
	}

	private onMessage(event: MessageEvent) {
		if (event.source !== this.iframe.contentWindow) return;
		const data = event.data as {
			type: string;
			index?: number;
			bitmap?: ImageBitmap;
			message?: string;
			stack?: string;
		};
		if (data.type === "frame" && data.index !== undefined && data.bitmap) {
			this.pending.get(data.index)?.(data.bitmap);
			this.pending.delete(data.index);
		} else if (data.type === "error") {
			const firstStackLine = (data.stack ?? "").split("\n").find((line) => /:\d+:\d+/.test(line));
			this.error = new Error(
				`Motion graphic code error: ${data.message}${firstStackLine ? ` (${firstStackLine.trim()})` : ""}`,
			);
			this.failure?.(this.error);
		}
	}

	private waitFor(type: string, timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(this.error ?? new Error(`The motion graphic did not respond (${type}).`)),
				timeoutMs,
			);
			const onMessage = (event: MessageEvent) => {
				if (event.source !== this.iframe.contentWindow) return;
				if ((event.data as { type?: string })?.type === type) {
					clearTimeout(timer);
					window.removeEventListener("message", onMessage);
					resolve();
				}
			};
			window.addEventListener("message", onMessage);
			this.failure = (error) => {
				clearTimeout(timer);
				window.removeEventListener("message", onMessage);
				reject(error);
			};
		});
	}

	private async boot() {
		window.addEventListener("message", this.listener);
		const loaded = this.waitFor("loaded", 20_000);
		this.iframe.srcdoc = buildDocument({ spec: this.spec, origin: window.location.origin });
		document.body.appendChild(this.iframe);
		try {
			await loaded;
			const ready = this.waitFor("ready", 30_000);
			this.iframe.contentWindow?.postMessage(
				{ type: "init", images: this.spec.images ?? {} },
				"*",
			);
			await ready;
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	renderFrame(index: number, time: number): Promise<ImageBitmap> {
		if (this.error) return Promise.reject(this.error);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`Frame at ${time.toFixed(2)}s took too long to draw.`)),
				30_000,
			);
			this.failure = (error) => {
				clearTimeout(timer);
				reject(error);
			};
			this.pending.set(index, (bitmap) => {
				clearTimeout(timer);
				resolve(bitmap);
			});
			this.iframe.contentWindow?.postMessage({ type: "frame", index, time }, "*");
		});
	}

	dispose() {
		window.removeEventListener("message", this.listener);
		this.iframe.remove();
	}
}
