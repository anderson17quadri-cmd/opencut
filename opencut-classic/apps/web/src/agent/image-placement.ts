// Code for place_image: shows a picture (b-roll, a logo, a product shot…)
// over the video with an entrance and exit animation. Runs in the same
// sandbox as Claude's motion graphics, with the picture as images.img.

export type ImageStyle = "card" | "plain" | "fullscreen";
export type ImageAnimation = "pop" | "fade" | "slide" | "zoom" | "none";

export interface ImagePlacement {
	style: ImageStyle;
	animation: ImageAnimation;
	anchor: string;
	/** Picture width as a fraction of the frame width (card/plain). */
	width: number;
	/** Optional centre, fractions of the frame (overrides anchor). */
	x: number | null;
	y: number | null;
	/** Degrees. */
	tilt: number;
	label: string | null;
	labelFont: string;
	/** Slow zoom while on screen (Ken Burns). */
	kenBurns: boolean;
}

export function imagePlacementCode(placement: ImagePlacement): string {
	return `
const P = ${JSON.stringify(placement)};
function render({ ctx, t, width, height, duration, images, tween, ease, clamp, roundRect }) {
	const img = images.img;
	if (!img) return;
	const IN = Math.min(0.45, duration / 3), OUT = Math.min(0.3, duration / 4);
	const enter = P.animation === "none" ? 1 : clamp(t / IN);
	const exit = P.animation === "none" ? 1 : 1 - clamp((t - (duration - OUT)) / OUT);
	const alpha = Math.min(ease.out(enter), ease.out(exit));
	if (alpha <= 0) return;
	const drift = P.kenBurns ? 1 + 0.06 * clamp(t / duration) : 1;
	const labelSize = Math.round(Math.min(width, height) * 0.045);

	if (P.style === "fullscreen") {
		const cover = Math.max(width / img.width, height / img.height) * drift;
		let dx = 0, s = 1;
		if (P.animation === "slide") dx = (1 - ease.out(enter)) * width - (1 - ease.out(exit)) * width;
		if (P.animation === "zoom" || P.animation === "pop") s = 1 + 0.08 * (1 - ease.out(enter));
		const w = img.width * cover * s, h = img.height * cover * s;
		ctx.globalAlpha = P.animation === "slide" ? 1 : alpha;
		ctx.drawImage(img, (width - w) / 2 + dx, (height - h) / 2, w, h);
		if (P.label) {
			ctx.font = "800 " + labelSize + "px \\"" + P.labelFont + "\\", sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			const tw = ctx.measureText(P.label).width;
			const pad = labelSize * 0.5;
			const by = height * 0.82;
			ctx.fillStyle = "rgba(0,0,0,0.65)";
			roundRect(ctx, width / 2 - tw / 2 - pad + dx, by - labelSize * 0.8, tw + pad * 2, labelSize * 1.6, labelSize * 0.4);
			ctx.fill();
			ctx.fillStyle = "#fff";
			ctx.fillText(P.label, width / 2 + dx, by);
		}
		return;
	}

	// Card / plain: fit the picture into the requested width, capped in height.
	let w = width * P.width;
	let h = w * img.height / img.width;
	const maxH = height * (P.style === "card" && P.label ? 0.42 : 0.5);
	if (h > maxH) { h = maxH; w = h * img.width / img.height; }
	const frame = P.style === "card" ? Math.round(Math.max(6, w * 0.03)) : 0;
	const labelH = P.style === "card" && P.label ? labelSize * 1.9 : 0;
	const boxW = w + frame * 2, boxH = h + frame * 2 + labelH;
	const margin = Math.min(width, height) * 0.06;
	const a = P.anchor;
	let cx = width / 2, cy = height / 2;
	if (a.includes("left")) cx = margin + boxW / 2;
	if (a.includes("right")) cx = width - margin - boxW / 2;
	if (a.includes("top")) cy = margin * 2 + boxH / 2;
	if (a.includes("bottom")) cy = height - margin * 2 - boxH / 2;
	if (P.x !== null) cx = width * P.x;
	if (P.y !== null) cy = height * P.y;

	let scale = 1, dx = 0, dy = 0;
	const e = ease.out(enter), x = ease.in(1 - exit);
	if (P.animation === "pop") scale = (0.55 + 0.45 * ease.back(clamp(t / IN))) * (1 - 0.35 * x);
	if (P.animation === "zoom") scale = (1.25 - 0.25 * e) * (1 + 0.1 * x);
	if (P.animation === "slide") {
		const fromRight = cx >= width / 2;
		dx = (fromRight ? 1 : -1) * ((1 - e) + x) * (boxW / 2 + margin + Math.abs(width / 2 - cx) + width * 0.1);
	}
	ctx.save();
	ctx.globalAlpha = P.animation === "slide" ? 1 : alpha;
	ctx.translate(cx + dx, cy + dy);
	ctx.rotate((P.tilt * Math.PI) / 180);
	ctx.scale(scale * drift, scale * drift);
	const left = -boxW / 2, top = -boxH / 2;
	const radius = Math.min(boxW, boxH) * 0.06;
	if (P.style === "card") {
		ctx.shadowColor = "rgba(0,0,0,0.45)";
		ctx.shadowBlur = boxW * 0.06;
		ctx.shadowOffsetY = boxW * 0.02;
		ctx.fillStyle = "#ffffff";
		roundRect(ctx, left, top, boxW, boxH, radius);
		ctx.fill();
		ctx.shadowColor = "transparent";
	}
	ctx.save();
	roundRect(ctx, left + frame, top + frame, w, h, P.style === "card" ? Math.max(2, radius - frame) : radius * 0.6);
	ctx.clip();
	ctx.drawImage(img, left + frame, top + frame, w, h);
	ctx.restore();
	if (P.label) {
		ctx.font = "800 " + labelSize + "px \\"" + P.labelFont + "\\", sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		if (P.style === "card") {
			ctx.fillStyle = "#111";
			ctx.fillText(P.label, 0, top + frame + h + labelH / 2, w);
		} else {
			const ly = top + h + labelSize * 0.9;
			ctx.lineJoin = "round";
			ctx.lineWidth = labelSize * 0.16;
			ctx.strokeStyle = "rgba(0,0,0,0.85)";
			ctx.strokeText(P.label, 0, ly, w * 1.2);
			ctx.fillStyle = "#fff";
			ctx.fillText(P.label, 0, ly, w * 1.2);
		}
	}
	ctx.restore();
}
`;
}
