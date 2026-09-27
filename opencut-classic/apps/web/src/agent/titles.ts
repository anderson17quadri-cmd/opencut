// Code for add_title: kinetic typography presets rendered in the motion
// graphics sandbox (the same engine as Claude's motion graphics), so a
// polished animated title is one call instead of hand-written code.

export const TITLE_PRESETS = ["pop", "typewriter", "slide_up", "highlight", "glitch", "stamp", "editorial"] as const;
export type TitlePreset = (typeof TITLE_PRESETS)[number];

/** The sound that fits each preset's entrance. */
export const TITLE_SOUNDS: Record<TitlePreset, string> = {
	pop: "pop",
	typewriter: "none",
	slide_up: "whoosh",
	highlight: "swoosh_down",
	glitch: "glitch",
	stamp: "punch",
	editorial: "none",
};

export interface TitleSpec {
	preset: TitlePreset;
	text: string;
	subtitle: string | null;
	/** Words (case-insensitive) drawn in the accent colour / marked. */
	accentWords: string[];
	font: string;
	/** Pixels. */
	size: number;
	color: string;
	accentColor: string;
	/** Rounded box behind each line, or null. */
	box: string | null;
	outline: boolean;
	uppercase: boolean;
	/** Vertical centre, fraction of the frame height. */
	y: number;
}

export function titleCode(spec: TitleSpec): string {
	return `
const P = ${JSON.stringify(spec)};
const clean = (w) => w.toLocaleLowerCase().replace(/[^\\p{L}\\p{N}]/gu, "");
const ACCENT = new Set(P.accentWords.map(clean));
function words(ctx, maxWidth) {
	const text = P.uppercase ? P.text.toLocaleUpperCase() : P.text;
	const space = ctx.measureText(" ").width;
	const lines = [{ words: [], width: 0 }];
	for (const raw of text.split(/\\s+/).filter(Boolean)) {
		const w = { text: raw, width: ctx.measureText(raw).width, accent: ACCENT.has(clean(raw)) };
		const line = lines[lines.length - 1];
		const add = (line.words.length ? space : 0) + w.width;
		if (line.words.length && line.width + add > maxWidth) lines.push({ words: [w], width: w.width });
		else { line.words.push(w); line.width += add; }
	}
	return { lines, space };
}
function rand(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }
function render({ ctx, t, width, height, duration, ease, clamp, roundRect }) {
	const S = P.size;
	ctx.font = "900 " + S + "px \\"" + P.font + "\\", sans-serif";
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";
	const { lines, space } = words(ctx, width * 0.86);
	const lh = S * 1.14;
	const blockH = lines.length * lh + (P.subtitle ? S * 0.9 : 0);
	const top = height * P.y - blockH / 2;
	const OUT = Math.min(0.3, duration / 4);
	const exit = ease.in(clamp((t - (duration - OUT)) / OUT));
	ctx.globalAlpha = 1 - exit;
	ctx.save();
	const cx = width / 2, cy = height * P.y;
	ctx.translate(cx, cy); ctx.scale(1 - 0.08 * exit, 1 - 0.08 * exit); ctx.translate(-cx, -cy);

	// Stamp: the whole title slams in from big, with a short shake.
	if (P.preset === "stamp") {
		const hit = clamp(t / 0.16);
		const s = 2.4 - 1.4 * ease.in(hit);
		const shake = t > 0.16 ? Math.sin(t * 95) * S * 0.05 * Math.max(0, 1 - (t - 0.16) / 0.3) : 0;
		ctx.translate(cx + shake, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
		ctx.globalAlpha = (1 - exit) * clamp(t / 0.06);
	}
	const totalChars = P.text.length;
	const typeSeconds = Math.min(1.4, duration * 0.45);
	const glitching = P.preset === "glitch" && (t < 0.45 || t > duration - 0.25);

	let index = 0;
	let charsBefore = 0;
	lines.forEach((line, li) => {
		const y = top + li * lh + lh / 2;
		let x = (width - line.width) / 2;
		if (P.box) {
			const pad = S * 0.3;
			ctx.save();
			const grow = P.preset === "highlight" || P.preset === "stamp" || P.preset === "glitch" ? 1 : ease.out(clamp(t / 0.35));
			ctx.fillStyle = P.box;
			roundRect(ctx, x - pad, y - lh / 2 - pad * 0.15, (line.width + pad * 2) * grow, lh + pad * 0.3, S * 0.22);
			ctx.fill();
			ctx.restore();
		}
		for (const w of line.words) {
			const i = index++;
			let alpha = 1, scale = 1, dy = 0, text = w.text;
			const local = t - i * 0.07;
			if (P.preset === "pop") {
				scale = local <= 0 ? 0 : 0.3 + 0.7 * ease.back(clamp(local / 0.35));
				alpha = clamp(local / 0.08);
			} else if (P.preset === "slide_up") {
				dy = (1 - ease.out(clamp(local / 0.45))) * lh * 1.1;
			} else if (P.preset === "typewriter") {
				const shown = Math.floor((t / typeSeconds) * totalChars) - charsBefore;
				text = w.text.slice(0, Math.max(0, shown));
			} else if (P.preset === "highlight") {
				alpha = clamp(t / 0.2);
			}
			charsBefore += w.text.length + 1;
			if (!text || scale <= 0 || alpha <= 0) { x += w.width + space; continue; }
			// Marker sweeping behind accent words (or the whole title if none).
			const marked = P.preset === "highlight" && (ACCENT.size === 0 || w.accent);
			if (marked) {
				const m = ease.inOut(clamp((t - 0.25 - i * 0.12) / 0.35));
				ctx.save();
				ctx.globalAlpha *= 0.92;
				ctx.fillStyle = P.accentColor;
				roundRect(ctx, x - S * 0.12, y - S * 0.5, (w.width + S * 0.24) * m, S * 1.0, S * 0.12);
				ctx.fill();
				ctx.restore();
			}
			ctx.save();
			if (P.preset === "slide_up") {
				ctx.beginPath(); ctx.rect(0, y - lh / 2, width, lh); ctx.clip();
			}
			ctx.globalAlpha *= alpha;
			ctx.translate(x + w.width / 2, y + dy);
			ctx.scale(scale, scale);
			const fill = marked ? "#111111" : w.accent ? P.accentColor : P.color;
			const draw = (color, ox, oy) => {
				if (P.outline && !P.box && !marked) {
					ctx.lineWidth = S * 0.13; ctx.strokeStyle = "rgba(0,0,0,0.85)";
					ctx.strokeText(text, -w.width / 2 + ox, oy);
				}
				ctx.fillStyle = color;
				ctx.fillText(text, -w.width / 2 + ox, oy);
			};
			if (glitching) {
				const k = rand(Math.floor(t * 30) + i) * S * 0.12;
				const jitter = (rand(Math.floor(t * 30) * 7 + i) - 0.5) * S * 0.2;
				if (rand(Math.floor(t * 24) + i * 3) > 0.25) {
					ctx.globalCompositeOperation = "lighter";
					draw("rgba(255,0,60,0.9)", k + jitter, 0);
					draw("rgba(0,230,255,0.9)", -k + jitter, 0);
					ctx.globalCompositeOperation = "source-over";
				}
			} else {
				if (!P.box) { ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = S * 0.25; ctx.shadowOffsetY = S * 0.06; }
				draw(fill, 0, 0);
			}
			ctx.restore();
			x += w.width + space;
		}
	});
	// Blinking cursor while typing.
	if (P.preset === "typewriter" && t < typeSeconds + 0.6 && Math.floor(t * 3) % 2 === 0) {
		const last = lines[lines.length - 1];
		const shownAll = t >= typeSeconds;
		if (shownAll) {
			ctx.fillStyle = P.accentColor;
			ctx.fillRect((width + last.width) / 2 + S * 0.08, top + (lines.length - 0.5) * lh - S * 0.45, S * 0.08, S * 0.9);
		}
	}
	if (P.subtitle) {
		const s2 = S * 0.42;
		ctx.font = "700 " + s2 + "px \\"" + P.font + "\\", sans-serif";
		ctx.textAlign = "center";
		ctx.globalAlpha = (1 - exit) * clamp((t - 0.35) / 0.3);
		const sy = top + lines.length * lh + S * 0.5 + (1 - ease.out(clamp((t - 0.35) / 0.4))) * S * 0.3;
		if (P.outline && !P.box) { ctx.lineWidth = s2 * 0.14; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(P.subtitle, width / 2, sy); }
		ctx.fillStyle = P.color;
		ctx.fillText(P.subtitle, width / 2, sy);
	}
	ctx.restore();
}
`;
}

export interface EditorialSpec {
	/** Small uppercase line above ("DESAFIO DE EDIÇÃO"), or null. */
	kicker: string | null;
	/** Headline; "\n" breaks lines. */
	text: string;
	accentWords: string[];
	/** Headline font (condensed display face) and the kicker/meta font. */
	font: string;
	bodyFont: string;
	/** Headline letter height, pixels. */
	size: number;
	color: string;
	accentColor: string;
	/** Left edge and top, fractions of the frame. */
	x: number;
	y: number;
	align: "left" | "center";
	/** Small line under the headline, or null. */
	meta: string | null;
}

/**
 * Magazine-style title of pro explainer reels: a tiny letter-spaced kicker
 * with an accent dot, then a condensed uppercase headline whose lines rise
 * from behind a mask one after another, an accent colour on key words,
 * and an optional meta line.
 */
export function editorialCode(spec: EditorialSpec): string {
	return `
const P = ${JSON.stringify(spec)};
const clean = (w) => w.toLocaleLowerCase().replace(/[^\\p{L}\\p{N}]/gu, "");
const ACCENT = new Set(P.accentWords.map(clean));
function render({ ctx, t, width, height, duration, ease, clamp }) {
	const S = P.size;
	const OUT = Math.min(0.35, duration / 4);
	const exit = ease.in(clamp((t - (duration - OUT)) / OUT));
	const left = width * P.x;
	let y = height * P.y;
	ctx.textBaseline = "alphabetic";
	ctx.globalAlpha = 1 - exit;
	const shiftUp = exit * S * 0.4;
	// Kicker.
	if (P.kicker) {
		const k = Math.round(S * 0.3);
		ctx.font = "700 " + k + "px \\"" + P.bodyFont + "\\", sans-serif";
		const text = P.kicker.toLocaleUpperCase().split("").join(String.fromCharCode(8202));
		const a = ease.out(clamp(t / 0.3));
		const w = ctx.measureText(text).width + k * 1.2;
		const kx = P.align === "center" ? (width - w) / 2 : left;
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = P.accentColor;
		ctx.beginPath(); ctx.arc(kx + k * 0.3, y - k * 0.35 - shiftUp, k * 0.22, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,0.78)";
		ctx.fillText(text, kx + k * 1.0 + (1 - a) * k, y - shiftUp);
		ctx.restore();
		y += k * 0.8;
	}
	// Headline lines rise from a mask, staggered.
	ctx.font = "700 " + S + "px \\"" + P.font + "\\", sans-serif";
	const lines = P.text.toLocaleUpperCase().split("\\n");
	const lh = S * 1.02;
	lines.forEach((line, i) => {
		const p = ease.out(clamp((t - 0.12 - i * 0.09) / 0.45));
		const top = y + i * lh;
		const words = line.split(/\\s+/).filter(Boolean);
		const space = ctx.measureText(" ").width;
		const widths = words.map((w) => ctx.measureText(w).width);
		const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, words.length - 1);
		let x = P.align === "center" ? (width - total) / 2 : left;
		ctx.save();
		ctx.beginPath(); ctx.rect(0, top - shiftUp, width, lh + S * 0.12); ctx.clip();
		const dy = (1 - p) * lh;
		words.forEach((w, j) => {
			ctx.fillStyle = ACCENT.has(clean(w)) ? P.accentColor : P.color;
			ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = S * 0.15;
			ctx.fillText(w, x, top + S * 0.92 + dy - shiftUp);
			x += widths[j] + space;
		});
		ctx.restore();
	});
	if (P.meta) {
		const m = Math.round(S * 0.2);
		ctx.font = "500 " + m + "px \\"" + P.bodyFont + "\\", sans-serif";
		const a = ease.out(clamp((t - 0.45) / 0.35));
		ctx.globalAlpha = (1 - exit) * a * 0.75;
		ctx.fillStyle = P.color;
		const my = y + lines.length * lh + m * 1.6 - shiftUp;
		const mw = ctx.measureText(P.meta).width;
		ctx.fillText(P.meta, P.align === "center" ? (width - mw) / 2 : left, my);
	}
}
`;
}
