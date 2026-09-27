import type { EffectDefinition } from "@/effects/types";
import { LOOKS, lutFor } from "@/effects/looks";

// "Filtro de cinema": a film look (or any .cube LUT) applied by the GPU
// "lut" pass, blended with the original by the strength slider.

export const LUT_SHADER = "lut";

export const filmLookEffectDefinition: EffectDefinition = {
	type: "film-look",
	name: "Filtro de cinema (LUT)",
	keywords: ["lut", "look", "filtro", "cinema", "cinematic", "film", "grade", "color grading", "cube"],
	params: [
		{
			key: "look",
			label: "Filtro",
			type: "select",
			default: "cinema",
			options: [
				...Object.entries(LOOKS).map(([value, { label }]) => ({ value, label })),
				{ value: "custom", label: "LUT personalizado (.cube)" },
			],
		},
		{ key: "strength", label: "Intensidade", type: "number", default: 100, min: 0, max: 100, step: 1 },
		{
			key: "lutData",
			label: "Dados do LUT",
			type: "text",
			default: "",
			dependencies: [{ param: "look", equals: "custom" }],
		},
	],
	renderer: {
		passes: [
			{
				shader: LUT_SHADER,
				uniforms: ({ effectParams }) => {
					const lut = lutFor({
						look: String(effectParams.look ?? "cinema"),
						custom: typeof effectParams.lutData === "string" ? effectParams.lutData : "",
					});
					const strength = Number(effectParams.strength ?? 100);
					return {
						// Id 0 is never registered: the engine then leaves the colours as they are.
						u_lut_id: lut?.id ?? 0,
						u_strength: Number.isFinite(strength) ? Math.min(Math.max(strength, 0), 100) / 100 : 1,
						u_lut_size: lut?.size ?? 2,
					};
				},
			},
		],
	},
};
