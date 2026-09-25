import type { TrackType } from "@/timeline";

export const DEFAULT_TRACK_NAMES: Record<TrackType, string> = {
	video: "Faixa de vídeo",
	text: "Faixa de texto",
	audio: "Faixa de áudio",
	graphic: "Faixa de gráfico",
	effect: "Faixa de efeito",
} as const;
