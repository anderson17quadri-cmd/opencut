import { registerLut } from "opencut-wasm";

// Film looks as 3D colour lookup tables (LUTs) — the way colourists grade
// in DaVinci Resolve or Premiere. The built-in looks are made here from
// colour-science formulas (no third-party LUT files), and any .cube LUT can
// be loaded too. Tables are registered with the GPU effects engine once
// and the "lut" shader pass refers to them by id.

type Look = {
	/** Linear gain before the curve (<1 darker). */
	exposure: number;
	/** Filmic S-curve steepness and pivot. */
	k?: number;
	pivot?: number;
	/** Colour added to the shadows and to the highlights (split toning). */
	shadows?: [number, number, number];
	highlights?: [number, number, number];
	/** Saturation, and the saturation kept on skin tones. */
	sat?: number;
	skinSat?: number;
	/** Darkens bright, colourless areas (white walls) by up to this much. */
	tameWalls?: number;
	/** Lifted blacks (matte film). */
	fade?: number;
	bw?: boolean;
};

export const LOOKS: Record<string, { label: string; description: string; look: Look }> = {
	cinema: {
		label: "Cinema",
		description: "teal & orange: sombras frias, pele quente, contraste de filme",
		look: { exposure: 0.95, k: 5.5, pivot: 0.42, shadows: [-0.04, 0.02, 0.06], highlights: [0.05, 0.015, -0.035], sat: 0.85, skinSat: 1, tameWalls: 0.18 },
	},
	noturno: {
		label: "Noturno",
		description: "escuro e elegante, fundo claro vira cinza, destaque no rosto",
		look: { exposure: 0.72, k: 6.5, pivot: 0.4, shadows: [0.01, -0.01, 0.07], highlights: [0.03, 0, -0.02], sat: 0.8, skinSat: 0.95, tameWalls: 0.35 },
	},
	filme: {
		label: "Filme",
		description: "quente e suave, pretos levantados, cara de película",
		look: { exposure: 0.98, k: 4.2, pivot: 0.45, shadows: [0, 0.03, 0.02], highlights: [0.05, 0.02, -0.04], sat: 0.9, skinSat: 1.05, fade: 0.05, tameWalls: 0.12 },
	},
	limpo: {
		label: "Limpo",
		description: "claro e vivo, brancos neutros (estilo YouTube/Apple)",
		look: { exposure: 1.03, k: 4.5, pivot: 0.5, shadows: [0, 0, 0.01], highlights: [0.01, 0.005, -0.005], sat: 1.12, skinSat: 1.02 },
	},
	neon: {
		label: "Neon",
		description: "sombras roxas e realces ciano, clima tech/noite",
		look: { exposure: 0.8, k: 6, pivot: 0.42, shadows: [0.06, -0.03, 0.09], highlights: [-0.03, 0.02, 0.05], sat: 1.05, skinSat: 0.95, tameWalls: 0.3 },
	},
	pb: {
		label: "Preto e branco",
		description: "P&B de filme, contraste forte",
		look: { exposure: 0.97, k: 6.5, pivot: 0.45, fade: 0.03, bw: true },
	},
};

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
	const t = clamp((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
};
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function curve(x: number, k: number, pivot: number) {
	const s = (v: number) => 1 / (1 + Math.exp(-k * (v - pivot)));
	return (s(x) - s(0)) / (s(1) - s(0));
}

function hueSat(r: number, g: number, b: number) {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 1e-6) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return { h: h * 60, s: max > 0 ? d / max : 0 };
}

/** 0 … 1: how much a colour looks like skin (orange hues, moderate saturation). */
function skin(r: number, g: number, b: number) {
	const { h, s } = hueSat(r, g, b);
	const hue = h > 5 && h < 50 ? 1 - Math.abs(h - 25) / 25 : 0;
	return clamp(hue * smooth(0.12, 0.3, s) * (1 - smooth(0.75, 0.95, s)));
}

function grade([r0, g0, b0]: [number, number, number], o: Look): [number, number, number] {
	let r = r0 * o.exposure;
	let g = g0 * o.exposure;
	let b = b0 * o.exposure;
	const sk = skin(r, g, b);
	if (o.k) {
		r = curve(clamp(r), o.k, o.pivot ?? 0.45);
		g = curve(clamp(g), o.k, o.pivot ?? 0.45);
		b = curve(clamp(b), o.k, o.pivot ?? 0.45);
	}
	const y = luma(r, g, b);
	const sh = (1 - y) ** 2;
	const hi = y ** 2;
	const st = o.shadows ?? [0, 0, 0];
	const ht = o.highlights ?? [0, 0, 0];
	r += st[0] * sh + ht[0] * hi;
	g += st[1] * sh + ht[1] * hi;
	b += st[2] * sh + ht[2] * hi;
	const sat = mix(o.sat ?? 1, o.skinSat ?? 1, sk);
	const y2 = luma(r, g, b);
	r = y2 + (r - y2) * sat;
	g = y2 + (g - y2) * sat;
	b = y2 + (b - y2) * sat;
	if (o.tameWalls) {
		const { s } = hueSat(clamp(r), clamp(g), clamp(b));
		const k = 1 - o.tameWalls * smooth(0.55, 0.95, luma(r, g, b)) * (1 - smooth(0.05, 0.25, s));
		r *= k;
		g *= k;
		b *= k;
	}
	// Soft highlight roll-off instead of hard clipping.
	const roll = (v: number) => (v > 0.85 ? 0.85 + ((1 - Math.exp(-(v - 0.85) * 4)) * 0.15) / (1 - Math.exp(-0.6)) : v);
	r = roll(r);
	g = roll(g);
	b = roll(b);
	if (o.fade) {
		r = o.fade + r * (1 - o.fade);
		g = o.fade + g * (1 - o.fade);
		b = o.fade + b * (1 - o.fade);
	}
	if (o.bw) {
		const v = clamp(0.35 * r + 0.5 * g + 0.15 * b);
		return [v, v, v];
	}
	return [clamp(r), clamp(g), clamp(b)];
}

export type LutTable = { size: number; rgb: Uint8Array };

/** Bakes a built-in look into a size³ table (red fastest, as in .cube). */
export function lookTable(name: string, size = 33): LutTable {
	const look = LOOKS[name]?.look;
	if (!look) throw new Error(`Unknown look "${name}"`);
	const rgb = new Uint8Array(size * size * size * 3);
	let i = 0;
	for (let bi = 0; bi < size; bi++) {
		for (let gi = 0; gi < size; gi++) {
			for (let ri = 0; ri < size; ri++) {
				const out = grade([ri / (size - 1), gi / (size - 1), bi / (size - 1)], look);
				rgb[i++] = Math.round(out[0] * 255);
				rgb[i++] = Math.round(out[1] * 255);
				rgb[i++] = Math.round(out[2] * 255);
			}
		}
	}
	return { size, rgb };
}

/** Parses a .cube file (3D LUTs), resampled to at most `maxSize`³. */
export function parseCube(text: string, maxSize = 25): LutTable {
	let size = 0;
	let domainMin = [0, 0, 0];
	let domainMax = [1, 1, 1];
	const values: number[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const parts = line.split(/\s+/);
		const keyword = parts[0].toUpperCase();
		if (keyword === "LUT_3D_SIZE") size = Number.parseInt(parts[1], 10);
		else if (keyword === "LUT_1D_SIZE") throw new Error("Only 3D LUTs (.cube with LUT_3D_SIZE) are supported.");
		else if (keyword === "DOMAIN_MIN") domainMin = parts.slice(1, 4).map(Number);
		else if (keyword === "DOMAIN_MAX") domainMax = parts.slice(1, 4).map(Number);
		else if (/^[-+.\d]/.test(parts[0]) && parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
	}
	if (!size || size < 2 || size > 129) throw new Error("That .cube file has no valid LUT_3D_SIZE.");
	if (values.length !== size ** 3 * 3) throw new Error(`That .cube file should have ${size ** 3} colours, it has ${values.length / 3}.`);
	const at = (ri: number, gi: number, bi: number, c: number) => values[((bi * size + gi) * size + ri) * 3 + c];
	const sample = (x: number, y: number, z: number): [number, number, number] => {
		// Trilinear lookup in the source table (coordinates 0 … 1).
		const f = (v: number) => clamp(v) * (size - 1);
		const [fx, fy, fz] = [f(x), f(y), f(z)];
		const [x0, y0, z0] = [Math.floor(fx), Math.floor(fy), Math.floor(fz)];
		const [x1, y1, z1] = [Math.min(x0 + 1, size - 1), Math.min(y0 + 1, size - 1), Math.min(z0 + 1, size - 1)];
		const [tx, ty, tz] = [fx - x0, fy - y0, fz - z0];
		const out: [number, number, number] = [0, 0, 0];
		for (let c = 0; c < 3; c++) {
			const c00 = mix(at(x0, y0, z0, c), at(x1, y0, z0, c), tx);
			const c10 = mix(at(x0, y1, z0, c), at(x1, y1, z0, c), tx);
			const c01 = mix(at(x0, y0, z1, c), at(x1, y0, z1, c), tx);
			const c11 = mix(at(x0, y1, z1, c), at(x1, y1, z1, c), tx);
			out[c] = mix(mix(c00, c10, ty), mix(c01, c11, ty), tz);
		}
		return out;
	};
	const outSize = Math.min(size, maxSize);
	const rgb = new Uint8Array(outSize ** 3 * 3);
	let i = 0;
	for (let bi = 0; bi < outSize; bi++) {
		for (let gi = 0; gi < outSize; gi++) {
			for (let ri = 0; ri < outSize; ri++) {
				const [r, g, b] = sample(ri / (outSize - 1), gi / (outSize - 1), bi / (outSize - 1));
				rgb[i++] = Math.round(clamp((r - domainMin[0]) / (domainMax[0] - domainMin[0] || 1)) * 255);
				rgb[i++] = Math.round(clamp((g - domainMin[1]) / (domainMax[1] - domainMin[1] || 1)) * 255);
				rgb[i++] = Math.round(clamp((b - domainMin[2]) / (domainMax[2] - domainMin[2] || 1)) * 255);
			}
		}
	}
	return { size: outSize, rgb };
}

/** Compact text form of a table, stored in the effect's params: "size:base64". */
export function encodeTable({ size, rgb }: LutTable): string {
	let binary = "";
	for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
	return `${size}:${btoa(binary)}`;
}

function decodeTable(text: string): LutTable | null {
	const match = /^(\d+):([A-Za-z0-9+/=]+)$/.exec(text.trim());
	if (!match) return null;
	const size = Number(match[1]);
	const binary = atob(match[2]);
	if (binary.length !== size ** 3 * 3) return null;
	return { size, rgb: Uint8Array.from(binary, (c) => c.charCodeAt(0)) };
}

const registered = new Map<string, { id: number; size: number }>();
let nextId = 1;

/**
 * The GPU id and size of a look ("cinema", …) or of an encoded custom
 * table, registering it on first use. Null if it can't be used.
 */
export function lutFor({ look, custom }: { look: string; custom?: string }): { id: number; size: number } | null {
	const key = look === "custom" ? `custom:${custom ?? ""}` : look;
	const known = registered.get(key);
	if (known) return known;
	let table: LutTable | null = null;
	try {
		table = look === "custom" ? decodeTable(custom ?? "") : LOOKS[look] ? lookTable(look) : null;
	} catch {
		table = null;
	}
	if (!table) return null;
	const rgba = new Uint8Array(table.size ** 3 * 4);
	for (let i = 0, j = 0; i < table.rgb.length; i += 3, j += 4) {
		rgba[j] = table.rgb[i];
		rgba[j + 1] = table.rgb[i + 1];
		rgba[j + 2] = table.rgb[i + 2];
		rgba[j + 3] = 255;
	}
	const entry = { id: nextId++, size: table.size };
	try {
		registerLut(entry.id, table.size, rgba);
	} catch {
		return null;
	}
	registered.set(key, entry);
	return entry;
}
