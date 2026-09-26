import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extname, posix } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadsFolder, mediaMimeType, nextFreePath } from "./local-files";

// Server-side helpers for Claude's download_media and search_free_media
// tools. Downloads land in ~/Downloads/OpenCut and are then imported into
// the open project like any local file.

const USER_AGENT =
	"OpenCut-desktop/0.3 (video editor; https://github.com/anderson17quadri-cmd/opencut)";
const MAX_DOWNLOAD_BYTES = 4 * 1024 ** 3;
const MAX_REDIRECTS = 5;

const EXTENSION_BY_MIME: Record<string, string> = {
	"video/mp4": "mp4",
	"video/webm": "webm",
	"video/quicktime": "mov",
	"video/x-matroska": "mkv",
	"video/x-msvideo": "avi",
	"video/ogg": "ogv",
	"audio/mpeg": "mp3",
	"audio/mp3": "mp3",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/wave": "wav",
	"audio/ogg": "ogg",
	"audio/opus": "opus",
	"audio/mp4": "m4a",
	"audio/x-m4a": "m4a",
	"audio/aac": "aac",
	"audio/flac": "flac",
	"audio/x-flac": "flac",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

// ------------------------------------------------------------ SSRF guard

function ipv4ToNumber(ip: string): number {
	return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function inRange(ip: string, cidr: string): boolean {
	const [base, bits] = cidr.split("/");
	const mask = bits === "0" ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
	return ((ipv4ToNumber(ip) & mask) >>> 0) === ((ipv4ToNumber(base) & mask) >>> 0);
}

const PRIVATE_V4 = [
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
	"172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15",
	"224.0.0.0/4", "240.0.0.0/4",
];

export function isPublicAddress(ip: string): boolean {
	const version = isIP(ip);
	if (version === 4) return !PRIVATE_V4.some((cidr) => inRange(ip, cidr));
	if (version === 6) {
		const lower = ip.toLowerCase();
		const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
		if (mapped) return isPublicAddress(mapped[1]);
		return !(
			lower === "::" ||
			lower === "::1" ||
			lower.startsWith("fc") ||
			lower.startsWith("fd") ||
			lower.startsWith("fe8") ||
			lower.startsWith("fe9") ||
			lower.startsWith("fea") ||
			lower.startsWith("feb") ||
			lower.startsWith("ff")
		);
	}
	return false;
}

/**
 * Only public http(s) hosts: a link Claude was handed must not be able to
 * reach this app's own API or other devices on the user's network.
 */
async function assertPublicUrl(url: URL) {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only http and https links can be downloaded.");
	}
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const addresses = isIP(host)
		? [{ address: host }]
		: await lookup(host, { all: true }).catch(() => {
				throw new Error(`Could not find ${host} (no internet connection?).`);
			});
	if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
		throw new Error("That link points to a local or private address and can't be downloaded.");
	}
}

async function fetchPublic(rawUrl: string, init: RequestInit = {}): Promise<Response> {
	let url = new URL(rawUrl);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		await assertPublicUrl(url);
		const response = await fetch(url, {
			...init,
			redirect: "manual",
			headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) },
		});
		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			url = new URL(location, url);
			continue;
		}
		return response;
	}
	throw new Error("Too many redirects.");
}

const MAX_PREVIEW_BYTES = 400_000;

/** Small preview picture as base64, or null when it can't be fetched. */
export async function fetchPreview(url: string): Promise<{ data: string; mimeType: string } | null> {
	try {
		const response = await fetchPublic(url, { signal: AbortSignal.timeout(12_000) });
		const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
		if (!response.ok || !/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) return null;
		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.byteLength > MAX_PREVIEW_BYTES) return null;
		return { data: buffer.toString("base64"), mimeType };
	} catch {
		return null;
	}
}

/** Adds preview pictures to image results (for Claude to look at). */
export async function withPreviews(items: FreeMediaItem[], max = 8) {
	return Promise.all(
		items.map(async (item, index) => {
			if (index >= max || !item.thumbnail) return item;
			const preview = await fetchPreview(item.thumbnail);
			return preview ? { ...item, preview } : item;
		}),
	);
}

// -------------------------------------------------------------- download

function fileNameFromResponse(response: Response, url: URL): string {
	const disposition = response.headers.get("content-disposition") ?? "";
	const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
	const plain = /filename="?([^";]+)"?/i.exec(disposition);
	const fromHeader = star ? decodeURIComponent(star[1].trim()) : plain?.[1];
	if (fromHeader) return fromHeader;
	const base = posix.basename(decodeURIComponent(url.pathname));
	return base && base !== "/" ? base : "download";
}

export async function downloadMedia({
	url,
	fileName,
}: {
	url: string;
	fileName?: string;
}): Promise<{ path: string; sizeMb: number; contentType: string }> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("That is not a valid link.");
	}

	const response = await fetchPublic(parsed.toString(), {
		signal: AbortSignal.timeout(60 * 60_000),
	});
	if (!response.ok || !response.body) {
		throw new Error(`The site answered ${response.status} ${response.statusText}.`);
	}

	const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
	const suggested = fileName || fileNameFromResponse(response, parsed);
	const extension =
		EXTENSION_BY_MIME[contentType] ??
		(mediaMimeType(suggested) ? extname(suggested).slice(1).toLowerCase() : undefined);
	if (!extension) {
		await response.body.cancel();
		throw new Error(
			contentType.startsWith("text/html")
				? "That link is a web page, not a video/audio/image file. Pages like YouTube or Instagram can't be downloaded directly; use a direct file link (or search_free_media)."
				: `That link isn't a supported video, audio or image file (${contentType || "unknown type"}).`,
		);
	}

	const declared = Number(response.headers.get("content-length") ?? 0);
	if (declared > MAX_DOWNLOAD_BYTES) {
		await response.body.cancel();
		throw new Error("That file is larger than 4 GB.");
	}

	const path = await nextFreePath({
		folder: downloadsFolder(),
		name: suggested,
		extension,
		fallbackName: "download",
	});

	let received = 0;
	const limit = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			received += chunk.length;
			if (received > MAX_DOWNLOAD_BYTES) {
				callback(new Error("That file is larger than 4 GB."));
				return;
			}
			callback(null, chunk);
		},
	});
	try {
		await pipeline(
			Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
			limit,
			createWriteStream(path),
		);
	} catch (error) {
		await unlink(path).catch(() => {});
		throw error;
	}

	return {
		path,
		sizeMb: Math.round((received / 1024 / 1024) * 10) / 10,
		contentType: contentType || "unknown",
	};
}

// ----------------------------------------------------- free media search

export interface FreeMediaItem {
	title: string;
	url: string;
	/** Small preview image, when the source has one. */
	thumbnail?: string;
	type: "audio" | "image" | "video";
	license: string;
	creator?: string;
	attribution?: string;
	sourcePage?: string;
	durationSeconds?: number;
	width?: number;
	height?: number;
}

async function getJson(url: string): Promise<unknown> {
	const response = await fetchPublic(url, { signal: AbortSignal.timeout(20_000) });
	if (!response.ok) throw new Error(`Search failed (${response.status}).`);
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		// e.g. a rate-limit notice in plain text.
		throw new Error(`Search service answered: ${text.slice(0, 120)}`);
	}
}

type OpenverseResult = {
	title?: string;
	url: string;
	thumbnail?: string;
	license: string;
	license_version?: string;
	creator?: string;
	attribution?: string;
	foreign_landing_url?: string;
	duration?: number;
	width?: number;
	height?: number;
};

async function searchOpenverse({
	query,
	kind,
	category,
	limit,
	commercial,
}: {
	query: string;
	kind: "audio" | "images";
	category?: string;
	limit: number;
	commercial: boolean;
}): Promise<FreeMediaItem[]> {
	const params = new URLSearchParams({ q: query, page_size: String(limit) });
	if (commercial) params.set("license_type", "commercial");
	if (category) params.set("category", category);
	const data = (await getJson(`https://api.openverse.org/v1/${kind}/?${params}`)) as {
		results?: OpenverseResult[];
	};
	return (data.results ?? []).map((result) => ({
		title: result.title ?? "untitled",
		url: result.url,
		...(result.thumbnail && kind === "images" ? { thumbnail: result.thumbnail } : {}),
		type: kind === "audio" ? "audio" : "image",
		license: `CC ${result.license.toUpperCase()} ${result.license_version ?? ""}`.trim(),
		creator: result.creator,
		attribution: result.attribution,
		sourcePage: result.foreign_landing_url,
		...(result.duration ? { durationSeconds: Math.round(result.duration / 100) / 10 } : {}),
		...(result.width ? { width: result.width, height: result.height } : {}),
	}));
}

type CommonsPage = {
	title: string;
	index?: number;
	imageinfo?: Array<{
		url: string;
		thumburl?: string;
		mime: string;
		width?: number;
		height?: number;
		duration?: number;
		descriptionurl?: string;
		extmetadata?: Record<string, { value?: string }>;
	}>;
};

const stripHtml = (value?: string) => value?.replace(/<[^>]*>/g, "").trim();

async function searchCommons({
	query,
	limit,
	kind,
}: {
	query: string;
	limit: number;
	kind: "video" | "image";
}): Promise<FreeMediaItem[]> {
	const params = new URLSearchParams({
		action: "query",
		format: "json",
		generator: "search",
		gsrsearch: `filetype:${kind === "video" ? "video" : "bitmap"} ${query}`,
		gsrnamespace: "6",
		gsrlimit: String(limit),
		prop: "imageinfo",
		iiprop: "url|size|mime|extmetadata",
		iiurlwidth: "360",
	});
	const data = (await getJson(`https://commons.wikimedia.org/w/api.php?${params}`)) as {
		query?: { pages?: Record<string, CommonsPage> };
	};
	return Object.values(data.query?.pages ?? {})
		.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
		.flatMap((page): FreeMediaItem[] => {
			const info = page.imageinfo?.[0];
			if (!info) return [];
			// Only formats the editor can open (no TIFF, PDF, SVG…).
			if (kind === "image" && !/^image\/(jpeg|png|webp|gif)$/.test(info.mime)) return [];
			const meta = info.extmetadata ?? {};
			return [
				{
					title: page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
					url: info.url.split("?")[0],
					...(info.thumburl ? { thumbnail: info.thumburl } : {}),
					type: kind,
					license: stripHtml(meta.LicenseShortName?.value) ?? "see source page",
					creator: stripHtml(meta.Artist?.value),
					sourcePage: info.descriptionurl,
					...(info.duration ? { durationSeconds: Math.round(info.duration) } : {}),
					...(info.width ? { width: info.width, height: info.height } : {}),
				},
			];
		});
}

/** Interleaves results from several sources; a failing source is skipped. */
async function fromSources(
	sources: Array<Promise<FreeMediaItem[]>>,
	limit: number,
): Promise<FreeMediaItem[]> {
	const settled = await Promise.allSettled(sources);
	const lists = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
	if (lists.length === 0) {
		const reason = settled.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
		throw reason?.reason instanceof Error ? reason.reason : new Error("Search failed.");
	}
	const merged: FreeMediaItem[] = [];
	for (let i = 0; merged.length < limit && lists.some((list) => i < list.length); i++) {
		for (const list of lists) if (list[i] && merged.length < limit) merged.push(list[i]);
	}
	return merged;
}

export async function searchFreeMedia({
	query,
	type,
	limit = 10,
	commercial = true,
}: {
	query: string;
	type: string;
	limit?: number;
	commercial?: boolean;
}): Promise<{ results: FreeMediaItem[]; note: string }> {
	const size = Math.min(Math.max(Math.round(limit), 1), 30);
	const note =
		"Free, openly licensed media. Check each license: CC BY needs credit (use `attribution`), NC means no commercial use, ND means no modifications. Download with download_media(url).";
	switch (type) {
		case "music":
			return { results: await searchOpenverse({ query, kind: "audio", category: "music", limit: size, commercial }), note };
		case "sound":
			return { results: await searchOpenverse({ query, kind: "audio", category: "sound_effect", limit: size, commercial }), note };
		case "audio":
			return { results: await searchOpenverse({ query, kind: "audio", limit: size, commercial }), note };
		case "image":
			return {
				results: await fromSources(
					[
						searchCommons({ query, limit: size, kind: "image" }),
						searchOpenverse({ query, kind: "images", limit: size, commercial }),
					],
					size,
				),
				note,
			};
		case "video":
			return { results: await searchCommons({ query, limit: size, kind: "video" }), note };
		default:
			throw new Error('"type" must be music, sound, audio, image or video');
	}
}
