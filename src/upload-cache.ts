import { App } from "obsidian";
import type { PluginSettings, UploadRecord } from "./settings";
import { buildAssetUrl } from "./immich";
import type { LinkStyle } from "./settings";
import { TFile } from "obsidian";

const CACHE_FILE_NAME = "upload-cache.json";
export const CACHE_VERSION = 3;

type UploadCacheData = {
  version: number;
  updatedAt: string;
  assets: Record<string, UploadRecord>;
};

export function cacheFilePath(app: App, pluginId: string): string {
  return `${app.vault.configDir}/plugins/${pluginId}/${CACHE_FILE_NAME}`;
}

/** Older builds used these paths before plugin id was wired correctly. */
const LEGACY_CACHE_DIRS = ["immich", "immich-assert-sync", "immich-photo-sync"];

export async function loadMergedUploadCache(
  app: App,
  pluginId: string,
  settingsAssets: Record<string, UploadRecord>,
): Promise<Record<string, UploadRecord>> {
  const merged: Record<string, UploadRecord> = { ...settingsAssets };

  const paths = [
    cacheFilePath(app, pluginId),
    ...LEGACY_CACHE_DIRS.filter((id) => id !== pluginId).map((id) => cacheFilePath(app, id)),
  ];

  for (const path of paths) {
    const chunk = await readCacheFile(app, path);
    Object.assign(merged, chunk);
  }

  return merged;
}

export async function clearUploadCache(app: App, pluginId: string): Promise<void> {
  const paths = [
    cacheFilePath(app, pluginId),
    ...LEGACY_CACHE_DIRS.map((id) => cacheFilePath(app, id)),
  ];

  for (const path of paths) {
    try {
      if (await app.vault.adapter.exists(path)) {
        await app.vault.adapter.remove(path);
      }
    } catch (error) {
      console.warn(`[Immich] Failed to remove cache at ${path}`, error);
    }
  }
}

export async function writeUploadCache(
  app: App,
  pluginId: string,
  cache: Record<string, UploadRecord>,
): Promise<void> {
  const path = cacheFilePath(app, pluginId);
  try {
    const dir = path.split("/").slice(0, -1).join("/");
    await app.vault.adapter.mkdir(dir);
    const payload: UploadCacheData = {
      version: CACHE_VERSION,
      updatedAt: new Date().toISOString(),
      assets: cache,
    };
    await app.vault.adapter.write(path, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn(`[Immich] Failed to write upload cache at ${path}`, error);
  }
}

export function findCachedRecord(
  assets: Record<string, UploadRecord>,
  filePath: string,
): UploadRecord | undefined {
  if (assets[filePath]) {
    return assets[filePath];
  }

  const target = filePath.toLowerCase();
  for (const [key, record] of Object.entries(assets)) {
    if (key.toLowerCase() === target) {
      return record;
    }
  }
  return undefined;
}

export type SkipDecision = {
  skip: boolean;
  reason: string;
  refreshedUrl?: string;
};

export function evaluateSkip(
  existing: UploadRecord | undefined,
  file: TFile,
  options: {
    forceReupload: boolean;
    baseUrl: string;
    shareKey: string;
    linkStyle: LinkStyle;
  },
): SkipDecision {
  if (options.forceReupload) {
    return { skip: false, reason: "force re-upload enabled" };
  }

  if (!existing) {
    return { skip: false, reason: "not in cache" };
  }

  if (!existing.assetId) {
    return { skip: false, reason: "missing asset id in cache" };
  }

  if (!existing.lastUploadedAt) {
    return { skip: false, reason: "cache entry never completed an upload" };
  }

  if (existing.status === "error") {
    return { skip: false, reason: `previous error: ${existing.lastError || "unknown"}` };
  }

  if (existing.mtime !== file.stat.mtime) {
    return { skip: false, reason: "file modified since last upload" };
  }

  if ((existing.fileSize ?? file.stat.size) !== file.stat.size) {
    return { skip: false, reason: "file size changed since last upload" };
  }

  const expectedUrl = buildAssetUrl(
    options.baseUrl,
    existing.assetId,
    options.shareKey,
    options.linkStyle,
  );

  if (!existing.url) {
    return { skip: true, reason: "unchanged (rebuilt url)", refreshedUrl: expectedUrl };
  }

  if (existing.url !== expectedUrl) {
    return { skip: true, reason: "unchanged (share key or link style updated)", refreshedUrl: expectedUrl };
  }

  return { skip: true, reason: "unchanged" };
}

async function readCacheFile(app: App, path: string): Promise<Record<string, UploadRecord>> {
  try {
    const exists = await app.vault.adapter.exists(path);
    if (!exists) {
      return {};
    }

    const raw = await app.vault.adapter.read(path);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const cacheData = parsed as Partial<UploadCacheData>;
    if (cacheData.assets && typeof cacheData.assets === "object" && !Array.isArray(cacheData.assets)) {
      return cacheData.assets;
    }
    return parsed as Record<string, UploadRecord>;
  } catch (error) {
    console.warn(`[Immich] Failed to read upload cache at ${path}`, error);
    return {};
  }
}

export function buildAssetsForScan(
  files: TFile[],
  updatedAssets: Record<string, UploadRecord>,
): Record<string, UploadRecord> {
  const result: Record<string, UploadRecord> = {};
  for (const file of files) {
    const record = updatedAssets[file.path] ?? findCachedRecord(updatedAssets, file.path);
    if (record) {
      result[file.path] = record;
    }
  }
  return result;
}

export function clearUploadedAssetsInSettings(settings: PluginSettings): void {
  settings.uploadedAssets = {};
}
