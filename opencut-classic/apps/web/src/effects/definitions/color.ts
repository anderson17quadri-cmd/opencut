import type { EffectDefinition, EffectUniformValue } from "@/effects/types";
import type { ParamDefinition, ParamValues } from "@/params";

// Colour effects rendered by the "color-grade" and "chroma-key" shaders
// (rust/crates/effects/src/shaders). Every colour look is the same shader
// with different uniforms, so each definition only picks which knobs it
// exposes; the rest stay neutral (0).

export const COLOR_GRADE_SHADER = "color-grade";
export const CHROMA_KEY_SHADER = "chroma-key";

function readNumber({
	params,
	key,
}: {
	params: ParamValues;
	key: string;
}): number {
	const raw = params[key];
	const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
	return Number.isFinite(value) ? value : 0;
}

const percent = ({ params, key }: { params: ParamValues; key: string }) =>
	readNumber({ params, key }) / 100;

function slider({
	key,
	label,
	min = -100,
	max = 100,
	defaultValue = 0,
}: {
	key: string;
	label: string;
	min?: number;
	max?: number;
	defaultValue?: number;
}): ParamDefinition {
	return { key, label, type: "number", default: defaultValue, min, max, step: 1 };
}

function colorGradeUniforms({
	params,
}: {
	params: ParamValues;
}): Record<string, EffectUniformValue> {
	return {
		u_brightness: percent({ params, key: "brightness" }),
		u_contrast: percent({ params, key: "contrast" }),
		u_saturation: percent({ params, key: "saturation" }),
		// ±100 maps to ±2 stops.
		u_exposure: percent({ params, key: "exposure" }) * 2,
		u_temperature: percent({ params, key: "temperature" }),
		u_tint: percent({ params, key: "tint" }),
		u_hue: (readNumber({ params, key: "hue" }) * Math.PI) / 180,
		u_vignette: percent({ params, key: "vignette" }),
		u_grayscale: percent({ params, key: "grayscale" }),
		u_sepia: percent({ params, key: "sepia" }),
		u_sharpen: percent({ params, key: "sharpen" }),
		u_fade: percent({ params, key: "fade" }),
	};
}

function colorGradeEffect({
	type,
	name,
	keywords,
	params,
}: {
	type: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
}): EffectDefinition {
	return {
		type,
		name,
		keywords,
		params,
		renderer: {
			passes: [
				{
					shader: COLOR_GRADE_SHADER,
					uniforms: ({ effectParams }) =>
						colorGradeUniforms({ params: effectParams }),
				},
			],
		},
	};
}

export const colorAdjustEffectDefinition = colorGradeEffect({
	type: "color-adjust",
	name: "Ajuste de cor",
	keywords: ["color", "cor", "brightness", "brilho", "contrast", "saturation", "grade"],
	params: [
		slider({ key: "brightness", label: "Brilho" }),
		slider({ key: "contrast", label: "Contraste" }),
		slider({ key: "saturation", label: "Saturação" }),
		slider({ key: "exposure", label: "Exposição" }),
		slider({ key: "temperature", label: "Temperatura" }),
		slider({ key: "tint", label: "Matiz verde/magenta" }),
		slider({ key: "hue", label: "Girar cores", min: -180, max: 180 }),
		slider({ key: "fade", label: "Desbotado", min: 0 }),
	],
});

export const blackWhiteEffectDefinition = colorGradeEffect({
	type: "black-white",
	name: "Preto e branco",
	keywords: ["black and white", "grayscale", "preto", "branco", "mono"],
	params: [
		slider({ key: "grayscale", label: "Intensidade", min: 0, defaultValue: 100 }),
		slider({ key: "contrast", label: "Contraste", defaultValue: 10 }),
	],
});

export const sepiaEffectDefinition = colorGradeEffect({
	type: "sepia",
	name: "Sépia",
	keywords: ["sepia", "vintage", "retro", "old"],
	params: [
		slider({ key: "sepia", label: "Intensidade", min: 0, defaultValue: 80 }),
		slider({ key: "fade", label: "Desbotado", min: 0, defaultValue: 20 }),
	],
});

export const vignetteEffectDefinition = colorGradeEffect({
	type: "vignette",
	name: "Vinheta",
	keywords: ["vignette", "vinheta", "dark edges", "cinematic"],
	params: [slider({ key: "vignette", label: "Intensidade", min: 0, defaultValue: 50 })],
});

export const sharpenEffectDefinition = colorGradeEffect({
	type: "sharpen",
	name: "Nitidez",
	keywords: ["sharpen", "nitidez", "detail"],
	params: [slider({ key: "sharpen", label: "Intensidade", min: 0, defaultValue: 40 })],
});

function hexToRgb({ hex }: { hex: string }): [number, number, number] {
	const match = /^#?([0-9a-f]{6})/i.exec(hex.trim());
	if (!match) return [0, 1, 0];
	const value = Number.parseInt(match[1], 16);
	return [(value >> 16) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

export const chromaKeyEffectDefinition: EffectDefinition = {
	type: "chroma-key",
	name: "Chroma key (tela verde)",
	keywords: ["chroma key", "green screen", "tela verde", "fundo verde", "remove background"],
	params: [
		{ key: "keyColor", label: "Cor do fundo", type: "color", default: "#00ff00" },
		slider({ key: "similarity", label: "Tolerância", min: 0, defaultValue: 40 }),
		slider({ key: "smoothness", label: "Suavidade da borda", min: 0, defaultValue: 20 }),
		slider({ key: "spill", label: "Remover reflexo", min: 0, defaultValue: 50 }),
	],
	renderer: {
		passes: [
			{
				shader: CHROMA_KEY_SHADER,
				uniforms: ({ effectParams }) => {
					const [r, g, b] = hexToRgb({ hex: String(effectParams.keyColor ?? "#00ff00") });
					return {
						u_key_r: r,
						u_key_g: g,
						u_key_b: b,
						u_similarity: percent({ params: effectParams, key: "similarity" }),
						u_smoothness: percent({ params: effectParams, key: "smoothness" }),
						u_spill: percent({ params: effectParams, key: "spill" }),
					};
				},
			},
		],
	},
};
