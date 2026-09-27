// Code for the built-in "karaoke" caption style: runs in the same sandbox
// as Claude's motion graphics. Shows one short phrase at a time; the word
// being spoken is highlighted and pops slightly, words already spoken stay
// bright, upcoming ones are dimmed.

export interface KaraokeWord {
	text: string;
	start: number;
	end: number;
}

export interface KaraokeStyle {
	fontFamily: string;
	fontWeight: number;
	/** Pixels. */
	fontSize: number;
	color: string;
	highlightColor: string;
	upcomingOpacity: number;
	/** Box behind each phrase, or null. */
	boxColor: string | null;
	/** Vertical centre of the text block, fraction of the frame height. */
	y: number;
	uppercase: boolean;
	/** Max text width, fraction of the frame width. */
	maxWidth: number;
	/** How the spoken word stands out: its colour, or a coloured box behind it. */
	highlightMode: "color" | "box";
	/** How much the spoken word grows when it starts (0 = none). */
	pop: number;
	/** Black outline around the letters (when there's no box). */
	outline: boolean;
	/** Glow in the highlight colour (neon look). */
	glow: boolean;
	/** Highlight colours used in turn, one per phrase (overrides highlightColor). */
	alternateColors: string[] | null;
}

export const CAPTION_PRESETS = ["karaoke", "hormozi", "box", "one_word", "minimal", "neon", "cinematic"] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

/** Social-media caption looks; the user's explicit options override them. */
export const CAPTION_PRESET_STYLES: Record<
	CaptionPreset,
	Partial<KaraokeStyle> & { wordsPerCaption: number; fontSizePercent: number; font: string }
> = {
	// The default: spoken word lights up in yellow and pops.
	karaoke: { wordsPerCaption: 3, fontSizePercent: 6, font: "Montserrat" },
	// Big, two words at a time, spoken word in yellow then green, bouncy.
	hormozi: {
		wordsPerCaption: 2,
		fontSizePercent: 7.5,
		font: "Montserrat",
		pop: 0.25,
		upcomingOpacity: 1,
		alternateColors: ["#ffd400", "#3ddc84"],
	},
	// CapCut style: a coloured box slides behind the spoken word.
	box: { wordsPerCaption: 3, fontSizePercent: 6, font: "Montserrat", highlightMode: "box", highlightColor: "#7c3aed", upcomingOpacity: 1 },
	// One huge word at a time.
	one_word: { wordsPerCaption: 1, fontSizePercent: 9, font: "Anton", pop: 0.3, uppercase: true },
	// Clean sentence-case subtitles, no effects.
	minimal: {
		wordsPerCaption: 6,
		fontSizePercent: 4.2,
		font: "Inter",
		fontWeight: 700,
		pop: 0,
		upcomingOpacity: 1,
		uppercase: false,
		outline: false,
		boxColor: "rgba(0,0,0,0.55)",
	},
	// Elegant, like pro tech reels: small sentence-case line low in the
	// frame, soft shadow, the spoken word in a warm accent.
	cinematic: {
		wordsPerCaption: 5,
		fontSizePercent: 3.6,
		font: "Montserrat",
		fontWeight: 600,
		pop: 0,
		upcomingOpacity: 1,
		uppercase: false,
		outline: false,
		highlightColor: "#ff7a45",
		y: 0.86,
	},
	// Glowing neon highlight.
	neon: { wordsPerCaption: 3, fontSizePercent: 6.5, font: "Bebas Neue", highlightColor: "#00f0ff", glow: true, fontWeight: 400 },
};

export function groupWords({
	words,
	wordsPerCaption,
	maxGap = 0.8,
}: {
	words: KaraokeWord[];
	wordsPerCaption: number;
	maxGap?: number;
}): Array<{ start: number; end: number; words: KaraokeWord[] }> {
	const groups: Array<{ start: number; end: number; words: KaraokeWord[] }> = [];
	let current: KaraokeWord[] = [];
	const flush = () => {
		if (current.length === 0) return;
		groups.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
		current = [];
	};
	for (const word of words) {
		const previous = current[current.length - 1];
		const sentenceEnd = previous && /[.!?…]$/.test(previous.text);
		if (current.length >= wordsPerCaption || (previous && word.start - previous.end > maxGap) || sentenceEnd) {
			flush();
		}
		current.push(word);
	}
	flush();
	// Keep each phrase on screen until the next one starts (no flicker).
	for (let i = 0; i + 1 < groups.length; i++) {
		if (groups[i + 1].start - groups[i].end < 0.6) groups[i].end = groups[i + 1].start;
		else groups[i].end += 0.3;
	}
	if (groups.length) groups[groups.length - 1].end += 0.4;
	return groups;
}

export function karaokeCode({
	groups,
	style,
	offset,
}: {
	groups: ReturnType<typeof groupWords>;
	style: KaraokeStyle;
	/** Timeline time of the graphic's frame 0. */
	offset: number;
}): string {
	const data = JSON.stringify({ groups, style, offset });
	return `
const DATA = ${data};
function render({ ctx, t, width, height, clamp, roundRect }) {
	const T = t + DATA.offset;
	const S = DATA.style;
	const groupIndex = DATA.groups.findIndex((g) => T >= g.start && T < g.end);
	if (groupIndex < 0) return;
	const group = DATA.groups[groupIndex];
	const highlight = S.alternateColors ? S.alternateColors[groupIndex % S.alternateColors.length] : S.highlightColor;
	ctx.font = S.fontWeight + " " + S.fontSize + "px \\"" + S.fontFamily + "\\", sans-serif";
	ctx.textBaseline = "middle";
	const space = ctx.measureText(" ").width;
	const words = group.words.map((w) => {
		const text = S.uppercase ? w.text.trim().toLocaleUpperCase() : w.text.trim();
		return { ...w, text, width: ctx.measureText(text).width };
	});
	// Wrap into lines.
	const maxWidth = width * S.maxWidth;
	const lines = [[]];
	let lineWidth = 0;
	for (const w of words) {
		const add = (lines[lines.length - 1].length ? space : 0) + w.width;
		if (lineWidth + add > maxWidth && lines[lines.length - 1].length) { lines.push([]); lineWidth = 0; }
		lines[lines.length - 1].push(w);
		lineWidth += (lines[lines.length - 1].length > 1 ? space : 0) + w.width;
	}
	const lineHeight = S.fontSize * 1.18;
	const blockHeight = lines.length * lineHeight;
	const appear = clamp((T - group.start) / 0.12);
	const top = height * S.y - blockHeight / 2 + (1 - appear) * S.fontSize * 0.25;
	ctx.globalAlpha = appear;
	lines.forEach((line, index) => {
		const total = line.reduce((sum, w, i) => sum + w.width + (i ? space : 0), 0);
		let x = (width - total) / 2;
		const y = top + index * lineHeight + lineHeight / 2;
		if (S.boxColor) {
			const pad = S.fontSize * 0.28;
			ctx.fillStyle = S.boxColor;
			roundRect(ctx, x - pad, y - lineHeight / 2 - pad * 0.2, total + pad * 2, lineHeight + pad * 0.4, S.fontSize * 0.22);
			ctx.fill();
		}
		for (const w of line) {
			const active = T >= w.start && T < w.end;
			const spoken = T >= w.end;
			const pop = active ? 1 + S.pop * (1 - clamp((T - w.start) / 0.15)) : 1;
			ctx.save();
			ctx.translate(x + w.width / 2, y);
			ctx.scale(pop, pop);
			ctx.globalAlpha = appear * (active || spoken ? 1 : S.upcomingOpacity);
			if (active && S.highlightMode === "box") {
				const pad = S.fontSize * 0.16;
				ctx.fillStyle = highlight;
				roundRect(ctx, -w.width / 2 - pad, -lineHeight / 2 + pad * 0.4, w.width + pad * 2, lineHeight - pad * 0.8, S.fontSize * 0.18);
				ctx.fill();
			}
			ctx.lineJoin = "round";
			ctx.lineWidth = S.fontSize * 0.14;
			ctx.strokeStyle = "rgba(0,0,0,0.85)";
			if (S.outline && !S.boxColor && !(active && S.highlightMode === "box")) ctx.strokeText(w.text, -w.width / 2, 0);
			if (!S.outline && !S.boxColor) {
				ctx.shadowColor = "rgba(0,0,0,0.7)";
				ctx.shadowBlur = S.fontSize * 0.2;
			}
			if (S.glow && active) {
				ctx.shadowColor = highlight;
				ctx.shadowBlur = S.fontSize * 0.5;
			}
			ctx.fillStyle = active && S.highlightMode === "color" ? highlight : S.color;
			ctx.fillText(w.text, -w.width / 2, 0);
			ctx.restore();
			x += w.width + space;
		}
	});
}
`;
}
