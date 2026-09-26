// Code for place_animation: plays a Lottie animation (After Effects
// animations exported as JSON, e.g. from LottieFiles) frame by frame with
// lottie-web's canvas renderer, inside the motion-graphics sandbox.
// The animation JSON arrives as api.data.animation.

export interface LottiePlacement {
	anchor: string;
	/** Width as a fraction of the frame width. */
	width: number;
	x: number | null;
	y: number | null;
	/** Cover the whole frame (cropping), e.g. transitions and backgrounds. */
	fullscreen: boolean;
	loop: boolean;
	speed: number;
	/** Seconds of fade in/out (0 = none). */
	fade: number;
}

export function lottieCode(placement: LottiePlacement): string {
	return `
const P = ${JSON.stringify(placement)};
let anim = null, surface = null, box = null;

async function setup(api) {
	const data = api.data && api.data.animation;
	if (!data || !data.w || !data.h) throw new Error("Not a Lottie animation (missing w/h).");
	const W = api.width, H = api.height;
	const aspect = data.w / data.h;
	let w, h;
	if (P.fullscreen) {
		const s = Math.max(W / data.w, H / data.h);
		w = data.w * s; h = data.h * s;
	} else {
		w = W * P.width; h = w / aspect;
		if (h > H * 0.9) { h = H * 0.9; w = h * aspect; }
	}
	const margin = Math.min(W, H) * 0.06;
	let cx = W / 2, cy = H / 2;
	if (!P.fullscreen) {
		if (P.anchor.includes("left")) cx = margin + w / 2;
		if (P.anchor.includes("right")) cx = W - margin - w / 2;
		if (P.anchor.includes("top")) cy = margin * 2 + h / 2;
		if (P.anchor.includes("bottom")) cy = H - margin * 2 - h / 2;
		if (P.x !== null) cx = W * P.x;
		if (P.y !== null) cy = H * P.y;
	}
	box = { x: cx - w / 2, y: cy - h / 2, w, h };
	surface = document.createElement("canvas");
	surface.width = Math.max(2, Math.round(w));
	surface.height = Math.max(2, Math.round(h));
	anim = lottie.loadAnimation({
		renderer: "canvas",
		loop: false,
		autoplay: false,
		animationData: data,
		rendererSettings: {
			context: surface.getContext("2d"),
			clearCanvas: true,
			preserveAspectRatio: "xMidYMid meet",
		},
	});
	await new Promise((resolve) => {
		if (anim.isLoaded) return resolve();
		anim.addEventListener("DOMLoaded", resolve);
		setTimeout(resolve, 5000);
	});
	anim.resize();
}

function render({ ctx, t, duration, clamp }) {
	const total = Math.max(1, anim.totalFrames);
	let frame = t * anim.frameRate * P.speed;
	frame = P.loop ? frame % total : Math.min(frame, total - 1);
	anim.goToAndStop(frame, true);
	let alpha = 1;
	if (P.fade > 0) alpha = Math.min(clamp(t / P.fade), clamp((duration - t) / P.fade));
	if (alpha <= 0) return;
	ctx.globalAlpha = alpha;
	ctx.drawImage(surface, box.x, box.y, box.w, box.h);
}
`;
}

/** Length of one play-through in seconds. */
export function lottieSeconds(animation: { fr?: number; ip?: number; op?: number }): number {
	const fr = animation.fr && animation.fr > 0 ? animation.fr : 30;
	const frames = Math.max(1, (animation.op ?? 60) - (animation.ip ?? 0));
	return frames / fr;
}
