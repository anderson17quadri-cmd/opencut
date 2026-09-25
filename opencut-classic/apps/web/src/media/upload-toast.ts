import { toast } from "sonner";

export interface MediaUploadToastResult {
	uploadedCount: number;
	assetNames?: string[];
}

function getAssetLabel({ count }: { count: number }): string {
	return count === 1 ? "mídia" : "mídias";
}

function waitForNextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}

export async function showMediaUploadToast<T extends MediaUploadToastResult>({
	filesCount,
	promise,
}: {
	filesCount: number;
	promise: Promise<T> | (() => Promise<T>);
}) {
	const run = typeof promise === "function" ? promise : () => promise;
	const toastPromise = toast.promise(async () => {
		await waitForNextPaint();
		return run();
	}, {
		loading: `Importando ${getAssetLabel({ count: filesCount })}...`,
		success: ({ uploadedCount, assetNames }) => {
			if (uploadedCount === 1) {
				const assetName = assetNames?.[0];
				return assetName
					? `${assetName} foi importado`
					: "1 mídia importada";
			}

			if (uploadedCount > 1) {
				return `${uploadedCount} mídias importadas`;
			}

			return "Nenhuma mídia foi importada";
		},
		error: `Não foi possível importar ${getAssetLabel({ count: filesCount })}`,
	});

	return toastPromise.unwrap();
}
