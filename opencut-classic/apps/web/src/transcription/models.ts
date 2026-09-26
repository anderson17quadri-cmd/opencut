import type {
	TranscriptionModel,
	TranscriptionModelId,
} from "./types";

/** Same as Small, exported with cross-attentions so it can time each word. */
export const WORD_TIMESTAMP_MODEL: TranscriptionModel = {
	id: "whisper-small-timestamped",
	name: "Small (palavras)",
	huggingFaceId: "onnx-community/whisper-small_timestamped",
	description: "Tempo de cada palavra (legendas estilo karaokê)",
};

export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
	{
		id: "whisper-tiny",
		name: "Tiny",
		huggingFaceId: "onnx-community/whisper-tiny",
		description: "Mais rápido, menos preciso",
	},
	{
		id: "whisper-small",
		name: "Small",
		huggingFaceId: "onnx-community/whisper-small",
		description: "Bom equilíbrio entre velocidade e precisão",
	},
	{
		id: "whisper-medium",
		name: "Medium",
		huggingFaceId: "onnx-community/whisper-medium",
		description: "Mais preciso, mais lento",
	},
	{
		id: "whisper-large-v3-turbo",
		name: "Large v3 Turbo",
		huggingFaceId: "onnx-community/whisper-large-v3-turbo",
		description: "Máxima precisão, precisa de WebGPU para bom desempenho",
	},
];

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId =
	"whisper-small";
