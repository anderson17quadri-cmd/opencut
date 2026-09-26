import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import type { FreeMediaItem } from "./downloads";
import { downloadsFolder } from "./local-files";

// Credits for media Claude downloads (author, licence, source). Nothing is
// drawn on the video: when it's exported, a "<video> - créditos.txt" file
// is written next to it listing what appears in it, ready to paste into
// the post caption if the user wants.

type Credit = {
	title?: string;
	creator?: string;
	license?: string;
	sourcePage?: string;
	url: string;
};

type Registry = {
	/** Downloaded file name → credit. */
	files: Record<string, Credit>;
	/** Media id of a rendered picture clip (place_image) → source file name. */
	aliases: Record<string, string>;
};

/** Search results seen recently, so a download can be matched to its credit. */
const seen = new Map<string, FreeMediaItem>();
const MAX_SEEN = 2000;

export function rememberSearchResults(items: FreeMediaItem[]) {
	for (const item of items) {
		seen.delete(item.url);
		seen.set(item.url, item);
	}
	while (seen.size > MAX_SEEN) {
		const oldest = seen.keys().next().value;
		if (oldest === undefined) break;
		seen.delete(oldest);
	}
}

function registryPath() {
	return join(downloadsFolder(), ".creditos.json");
}

async function loadRegistry(): Promise<Registry> {
	try {
		const parsed = JSON.parse(await readFile(registryPath(), "utf8")) as Partial<Registry>;
		return { files: parsed.files ?? {}, aliases: parsed.aliases ?? {} };
	} catch {
		return { files: {}, aliases: {} };
	}
}

async function saveRegistry(registry: Registry) {
	await writeFile(registryPath(), JSON.stringify(registry, null, 1), "utf8").catch(() => {});
}

/** Notes the credit of a file just downloaded from `url` to `path`. */
export async function recordDownloadCredit({ url, path }: { url: string; path: string }) {
	const item = seen.get(url);
	const registry = await loadRegistry();
	registry.files[basename(path)] = item
		? {
				title: item.title,
				creator: item.creator,
				license: item.license,
				sourcePage: item.sourcePage,
				url,
			}
		: { url };
	await saveRegistry(registry);
}

/** Credits a clip rendered from something that isn't a downloaded file. */
export async function recordRenderedCredit({
	mediaId,
	key,
	credit,
}: {
	mediaId: string;
	key: string;
	credit: Credit;
}) {
	const registry = await loadRegistry();
	registry.files[key] = credit;
	registry.aliases[mediaId] = key;
	await saveRegistry(registry);
}

/** Links a rendered picture clip to the downloaded picture it shows. */
export async function recordAlias({ mediaId, sourceName }: { mediaId: string; sourceName: string }) {
	const registry = await loadRegistry();
	if (!registry.files[sourceName]) return;
	registry.aliases[mediaId] = sourceName;
	await saveRegistry(registry);
}

function creditLine(credit: Credit): string {
	const parts = [
		credit.title ? `"${credit.title}"` : null,
		credit.creator ? `por ${credit.creator}` : null,
		credit.license ? `(${credit.license})` : null,
	].filter(Boolean);
	const source = credit.sourcePage ?? credit.url;
	return `${parts.length ? parts.join(" ") : "Arquivo da internet"}\n  ${source}`;
}

/**
 * Writes "<video> - créditos.txt" next to an exported video for the
 * downloaded media it uses. Returns the file path, or null if none.
 */
export async function writeCreditsFile({
	videoPath,
	usedMedia,
}: {
	videoPath: string;
	usedMedia: Array<{ id: string; name: string }>;
}): Promise<{ path: string; count: number } | null> {
	const registry = await loadRegistry();
	const sources = new Set<string>();
	for (const { id, name } of usedMedia) {
		if (registry.files[name]) sources.add(name);
		const alias = registry.aliases[id];
		if (alias && registry.files[alias]) sources.add(alias);
	}
	if (sources.size === 0) return null;

	const credits = [...sources].map((name) => registry.files[name]);
	// Only licences that require attribution go in the caption line.
	const required = credits.filter((credit) => /\bBY\b/i.test(credit.license ?? "") || !credit.license);
	const short = required.map((credit) =>
		[credit.creator ?? credit.title, (credit.license ?? "").replace(/\s*\(.*\)\s*$/, "")].filter(Boolean).join(", "),
	);
	const text = [
		`Créditos de "${parse(videoPath).base}"`,
		"",
		"Imagens, sons e animações da internet usados neste vídeo:",
		"",
		...credits.map((credit, i) => `${i + 1}. ${creditLine(credit)}`),
		"",
		"Para colar na legenda do post:",
		short.length
			? `Créditos: ${short.join(" · ")}`
			: "(nenhum crédito é obrigatório: todas as mídias usadas são livres de crédito)",
		"",
		"Licenças CC BY / CC BY-SA pedem o crédito ao autor; CC0, domínio público e Lottie Simple License não pedem.",
		"",
	].join("\r\n");
	const path = join(dirname(videoPath), `${parse(videoPath).name} - créditos.txt`);
	await writeFile(path, text, "utf8");
	return { path, count: credits.length };
}
