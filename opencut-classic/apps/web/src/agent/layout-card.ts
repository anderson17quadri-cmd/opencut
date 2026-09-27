// Code for set_layout: the presenter moves from full frame into a rounded
// card (beside, below or in a corner), over a blurred, darkened copy of
// the shot, leaving room for a graphic — then back to full frame. Runs in
// the motion-graphics sandbox; each frame arrives as api.frames.orig (the
// shot exactly as it appears on the canvas), so the clip cuts in and out
// seamlessly.

export const LAYOUTS = ["frame_right", "frame_left", "split", "pip"] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface LayoutSpec {
	/** Card rectangle in canvas pixels. */
	card: { x: number; y: number; w: number; h: number };
	/** Face centre in the shot, fractions of the canvas (keeps it framed in the card). */
	face: { x: number; y: number };
	/** Extra zoom of the shot inside the card (frames crop into the face). */
	zoom: number;
	/** Seconds of the move in and out. */
	move: number;
	/** "blur" (the shot, blurred and darkened) or a hex colour. */
	background: string;
	label: string | null;
	accent: string;
	font: string;
}

/** How far the card crops into the shot: side frames and corners show the face, not the room. */
export function layoutZoom(layout: Layout, width: number, height: number) {
	const portrait = height > width;
	if (layout === "split") return portrait ? 1.08 : 1.2;
	if (layout === "pip") return 1.5;
	return portrait ? 1.45 : 1.3;
}

/** Card rectangle for a layout on a canvas. */
export function layoutCard(layout: Layout, width: number, height: number) {
	const portrait = height > width;
	if (portrait) {
		switch (layout) {
			case "split":
				return { x: width * 0.04, y: height * 0.5, w: width * 0.92, h: height * 0.44 };
			case "pip":
				return { x: width * 0.6, y: height * 0.54, w: width * 0.34, h: height * 0.24 };
			case "frame_left":
				return { x: width * 0.05, y: height * 0.4, w: width * 0.5, h: height * 0.42 };
			default:
				return { x: width * 0.45, y: height * 0.4, w: width * 0.5, h: height * 0.42 };
		}
	}
	switch (layout) {
		case "split":
			return { x: width * 0.5, y: height * 0.06, w: width * 0.46, h: height * 0.88 };
		case "pip":
			return { x: width * 0.72, y: height * 0.62, w: width * 0.24, h: height * 0.32 };
		case "frame_left":
			return { x: width * 0.04, y: height * 0.12, w: width * 0.44, h: height * 0.76 };
		default:
			return { x: width * 0.52, y: height * 0.12, w: width * 0.44, h: height * 0.76 };
	}
}

export function layoutCode(spec: LayoutSpec): string {
	return `
const P = ${JSON.stringify(spec)};
function render({ ctx, t, width, height, duration, frames, ease, clamp, roundRect }) {
	const img = frames && frames.orig;
	if (!img) return;
	// 0 = full frame, 1 = in the card.
	const k = ease.inOut(clamp(t / P.move)) * (1 - ease.inOut(clamp((t - (duration - P.move)) / P.move)));
	const lerp = (a, b) => a + (b - a) * k;
	const C = P.card;
	// Image scale/offset that keeps the face framed inside the card.
	const s = Math.max(C.w / width, C.h / height) * P.zoom;
	const fx = P.face.x * width * s, fy = P.face.y * height * s;
	let ox = C.x + C.w / 2 - fx;
	let oy = C.y + C.h * 0.42 - fy;
	ox = Math.min(C.x, Math.max(C.x + C.w - width * s, ox));
	oy = Math.min(C.y, Math.max(C.y + C.h - height * s, oy));

	// Background: the shot, blurred and darker, or a colour.
	if (k > 0) {
		ctx.save();
		ctx.globalAlpha = 1;
		if (P.background === "blur") {
			ctx.filter = "blur(" + Math.round(Math.min(width, height) * 0.03) + "px) brightness(0.42) saturate(1.1)";
			const b = 1.12;
			ctx.drawImage(img, (width - width * b) / 2, (height - height * b) / 2, width * b, height * b);
			ctx.filter = "none";
		} else {
			ctx.fillStyle = P.background;
			ctx.fillRect(0, 0, width, height);
		}
		ctx.restore();
	}
	// The card (full frame at k = 0).
	const x = lerp(0, C.x), y = lerp(0, C.y), w = lerp(width, C.w), h = lerp(height, C.h);
	const r = lerp(0, Math.min(width, height) * 0.035);
	const is = lerp(1, s), ix = lerp(0, ox), iy = lerp(0, oy);
	ctx.save();
	if (k > 0) {
		ctx.shadowColor = "rgba(0,0,0," + (0.55 * k) + ")";
		ctx.shadowBlur = Math.min(width, height) * 0.05 * k;
		ctx.shadowOffsetY = Math.min(width, height) * 0.015 * k;
		ctx.fillStyle = "#000";
		roundRect(ctx, x, y, w, h, r);
		ctx.fill();
		ctx.shadowColor = "transparent";
	}
	roundRect(ctx, x, y, w, h, r);
	ctx.clip();
	ctx.drawImage(img, ix, iy, width * is, height * is);
	ctx.restore();
	if (k > 0) {
		ctx.save();
		ctx.globalAlpha = k;
		ctx.lineWidth = Math.max(1.5, Math.min(width, height) * 0.002);
		ctx.strokeStyle = "rgba(255,255,255,0.22)";
		roundRect(ctx, x, y, w, h, r);
		ctx.stroke();
		if (P.label) {
			const size = Math.round(Math.min(width, height) * 0.024);
			ctx.font = "700 " + size + "px \\"" + P.font + "\\", sans-serif";
			ctx.textBaseline = "middle";
			const pad = size * 0.6;
			const tw = ctx.measureText(P.label).width;
			const lx = x + pad, ly = y + h - pad - size * 0.9;
			ctx.fillStyle = "rgba(10,10,14,0.72)";
			roundRect(ctx, lx, ly - size * 0.8, tw + pad * 2 + size * 0.7, size * 1.6, size * 0.4);
			ctx.fill();
			ctx.fillStyle = P.accent;
			ctx.beginPath(); ctx.arc(lx + pad + size * 0.2, ly, size * 0.2, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = "#fff";
			ctx.fillText(P.label, lx + pad + size * 0.6, ly);
		}
		ctx.restore();
	}
}
`;
}
