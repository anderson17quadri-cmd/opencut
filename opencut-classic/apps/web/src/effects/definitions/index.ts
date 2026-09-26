import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";
import {
	blackWhiteEffectDefinition,
	chromaKeyEffectDefinition,
	colorAdjustEffectDefinition,
	sepiaEffectDefinition,
	sharpenEffectDefinition,
	vignetteEffectDefinition,
} from "./color";

const defaultEffects = [
	blurEffectDefinition,
	colorAdjustEffectDefinition,
	blackWhiteEffectDefinition,
	sepiaEffectDefinition,
	vignetteEffectDefinition,
	sharpenEffectDefinition,
	chromaKeyEffectDefinition,
];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			continue;
		}
		effectsRegistry.register({
			key: definition.type,
			definition,
		});
	}
}
