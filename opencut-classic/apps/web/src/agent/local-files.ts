import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, parse } from "node:path";

const MIME_BY_EXTENSION: Record<string, string> = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".ogv": "video/ogg",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".opus": "audio/ogg",
	".flac": "audio/flac",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

export function mediaMimeType(path: string): string | null {
	return MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? null;
}

export function defaultMediaFolders(): string[] {
	const home = homedir();
	return ["Videos", "Downloads", "Desktop", "Music", "Pictures"].map((name) =>
		join(home, name),
	);
}

export interface MediaFolderListing {
	folder: string;
	exists: boolean;
	subfolders: string[];
	files: Array<{ path: string; name: string; sizeMb: number }>;
}

export async function listMediaFolder(folder: string): Promise<MediaFolderListing> {
	if (!isAbsolute(folder)) {
		throw new Error(`Folder must be an absolute path: ${folder}`);
	}

	let entries;
	try {
		entries = await readdir(folder, { withFileTypes: true });
	} catch {
		return { folder, exists: false, subfolders: [], files: [] };
	}

	const subfolders: string[] = [];
	const files: MediaFolderListing["files"] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const path = join(folder, entry.name);
		if (entry.isDirectory()) {
			subfolders.push(path);
		} else if (entry.isFile() && mediaMimeType(path)) {
			const { size } = await stat(path);
			files.push({
				path,
				name: entry.name,
				sizeMb: Math.round((size / 1024 / 1024) * 10) / 10,
			});
		}
	}
	return { folder, exists: true, subfolders, files };
}

/** Picks a path under ~/Videos/OpenCut that doesn't overwrite anything. */
export async function nextExportPath({
	name,
	extension,
}: {
	name: string;
	extension: string;
}): Promise<string> {
	return nextFreePath({
		folder: join(homedir(), "Videos", "OpenCut"),
		name,
		extension,
		fallbackName: "OpenCut export",
	});
}

/** A path in `folder` (created if needed) that doesn't overwrite anything. */
export async function nextFreePath({
	folder,
	name,
	extension,
	fallbackName,
}: {
	folder: string;
	name: string;
	extension: string;
	fallbackName: string;
}): Promise<string> {
	await mkdir(folder, { recursive: true });

	const safeName =
		parse(name).name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 120) ||
		fallbackName;
	for (let attempt = 0; ; attempt++) {
		const suffix = attempt === 0 ? "" : ` (${attempt})`;
		const candidate = join(folder, `${safeName}${suffix}.${extension}`);
		try {
			await stat(candidate);
		} catch {
			return candidate;
		}
	}
}

export function downloadsFolder(): string {
	return join(homedir(), "Downloads", "OpenCut");
}
