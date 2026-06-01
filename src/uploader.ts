import { App, Notice, TFile } from "obsidian";
import { buildAssetUrl, ImmichClient, normalizeImmichUrl } from "./immich";
import type { PluginSettings, UploadRecord } from "./settings";
import { replaceWikiLinks } from "./link-rewriter";
import { updateImmichDashboard } from "./dashboard";
import {
  ImmichSyncLogger,
  LEGACY_DASHBOARD_FOLDER,
  normalizeFolderPath,
  resolveDashboardFolder,
  resolveLogFilePath,
} from "./activity-log";
import { isUnderFolder, shouldExcludeFromMediaScan } from "./vault-write";
import {
  buildAssetsForScan,
  clearUploadCache,
  clearUploadedAssetsInSettings,
  evaluateSkip,
  findCachedRecord,
  loadMergedUploadCache,
  writeUploadCache,
} from "./upload-cache";

const MEDIA_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "heic",
  "heif",
  "bmp",
  "tiff",
  "tif",
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "mpg",
  "mpeg",
  "3gp",
  "ogv",
]);

export type UploadOptions = {
  forceReupload?: boolean;
};

export async function uploadFolderImages(
  app: App,
  settings: PluginSettings,
  saveSettings: () => Promise<void>,
  pluginId: string,
  options: UploadOptions = {},
): Promise<void> {
  const forceReupload = options.forceReupload ?? false;
  const mediaFolder = normalizeFolderPath(settings.imageFolder);
  const dashboardFolder = resolveDashboardFolder(settings);
  const logger = new ImmichSyncLogger(
    app,
    resolveLogFilePath(mediaFolder),
    settings.showSyncLog,
  );

  const logDashboardExclude = `${dashboardFolder}/`;
  const legacyExclude = `${LEGACY_DASHBOARD_FOLDER}/`;

  try {
    const issues = validateSettings(settings);
    if (issues.length > 0) {
      logger.warn("Missing settings", issues);
      new Notice(`Immich settings missing: ${issues.join(", ")}`);
      await logger.finish(`Blocked: missing ${issues.join(", ")}`);
      return;
    }

    logger.info("Configuration", {
      immichUrl: settings.immichUrl,
      albumName: settings.albumName,
      albumId: settings.albumId || "(auto)",
      mediaFolder,
      dashboardFolder,
      linkStyle: settings.linkStyle,
      forceReupload,
      hasApiKey: Boolean(settings.immichApiKey),
      hasShareKey: Boolean(settings.albumShareKey),
    });

    const baseUrl = normalizeImmichUrl(settings.immichUrl);
    const client = new ImmichClient(settings);

    logger.info("Connecting to Immich and resolving album…");
    const albumId = await client.ensureAlbum();
    logger.success(`Using album: ${albumId}`);
    if (albumId !== settings.albumId) {
      settings.albumId = albumId;
      await saveSettings();
    }

    const scan = collectMediaFiles(app, mediaFolder, [logDashboardExclude, legacyExclude]);
    logger.info("Vault scan", scan.stats);

    if (scan.files.length === 0) {
      const reason = !scan.stats.folderExists
        ? `Media folder not found: ${mediaFolder}`
        : scan.stats.totalMedia === 0
          ? `No images or videos in ${mediaFolder}`
          : `No supported media in ${mediaFolder}`;
      new Notice(reason);
      await logger.finish(reason);
      return;
    }

    const files = scan.files;
    logger.info(`Found ${files.length} media file(s) to process`);
    new Notice(
      forceReupload
        ? `Immich: re-uploading ${files.length} file(s)…`
        : `Immich: uploading ${files.length} file(s)…`,
    );

    const cachedAssets = await loadMergedUploadCache(app, pluginId, settings.uploadedAssets ?? {});
    logger.info(`Cache entries loaded: ${Object.keys(cachedAssets).length}`);

    const updatedAssets: Record<string, UploadRecord> = { ...cachedAssets };
    let uploadedCount = 0;
    let skippedCount = 0;
    let refreshedUrlCount = 0;
    let albumAddFailedCount = 0;
    let failedCount = 0;
    const failedFiles: string[] = [];

    const skipOptions = {
      forceReupload,
      baseUrl,
      shareKey: settings.albumShareKey,
      linkStyle: settings.linkStyle,
    };

    for (const file of files) {
      const nowIso = new Date().toISOString();
      const existing = findCachedRecord(updatedAssets, file.path);
      const skipDecision = evaluateSkip(existing, file, skipOptions);

      if (skipDecision.skip && existing) {
        const url = skipDecision.refreshedUrl ?? existing.url;
        if (skipDecision.refreshedUrl) {
          refreshedUrlCount += 1;
        }
        logger.info(`Skip (${skipDecision.reason}): ${file.path}`, { assetId: existing.assetId });
        updatedAssets[file.path] = {
          ...existing,
          url,
          status: existing.status ?? "uploaded",
          fileName: file.name,
          fileSize: file.stat.size,
          mtime: file.stat.mtime,
          lastAttemptAt: nowIso,
        };
        skippedCount += 1;
        continue;
      }

      if (existing && !skipDecision.skip) {
        logger.info(`Re-uploading (${skipDecision.reason}): ${file.path}`);
      }

      try {
        logger.info(`Uploading: ${file.path}`);
        const data = await app.vault.readBinary(file);
        const uploadResult = await client.uploadAsset(file, data);
        logger.success(`Uploaded: ${file.path}`, { assetId: uploadResult.id, status: uploadResult.status });

        const url = buildAssetUrl(baseUrl, uploadResult.id, settings.albumShareKey, settings.linkStyle);
        updatedAssets[file.path] = {
          assetId: uploadResult.id,
          mtime: file.stat.mtime,
          url,
          status: uploadResult.status === "duplicate" ? "duplicate" : "uploaded",
          fileName: file.name,
          fileSize: file.stat.size,
          lastAttemptAt: nowIso,
          lastUploadedAt: nowIso,
          lastError: "",
        };
        uploadedCount += 1;

        try {
          await client.addAssetToAlbum(albumId, uploadResult.id);
          logger.info(`Added to album: ${file.name}`);
        } catch (albumError) {
          albumAddFailedCount += 1;
          logger.warn(`Uploaded but album add failed: ${file.path}`, albumError);
        }
      } catch (error) {
        failedCount += 1;
        failedFiles.push(file.path);
        const message = error instanceof Error ? error.message : String(error);
        updatedAssets[file.path] = {
          assetId: existing?.assetId ?? "",
          mtime: existing?.mtime ?? file.stat.mtime,
          url: existing?.url ?? "",
          status: "error",
          fileName: file.name,
          fileSize: file.stat.size,
          lastAttemptAt: nowIso,
          lastUploadedAt: existing?.lastUploadedAt ?? "",
          lastError: message,
        };
        logger.error(`Upload failed: ${file.path}`, error);
      }
    }

    settings.uploadedAssets = pruneAssetsToMediaFolder(updatedAssets, mediaFolder, files);
    await saveSettings();
    await writeUploadCache(app, pluginId, settings.uploadedAssets);
    logger.info("Saved plugin settings and upload cache");

    const dashboardAssets = buildAssetsForScan(files, settings.uploadedAssets);
    logger.info("Writing asset dashboard notes…", { count: Object.keys(dashboardAssets).length });
    const dashboardResult = await updateImmichDashboard(app, {
      assets: dashboardAssets,
      dashboardFolder,
      mediaFolder,
      log: (level, message, details) => {
        if (level === "error") {
          logger.error(message, details);
        } else if (level === "warn") {
          logger.warn(message, details);
        } else {
          logger.info(message, details);
        }
      },
    });
    logger.info("Dashboard update complete", dashboardResult);

    const assetUrlMap = new Map<string, string>();
    for (const file of files) {
      const record = settings.uploadedAssets[file.path];
      if (record?.url) {
        assetUrlMap.set(file.path, record.url);
      }
    }

    const dashboardPrefix = `${dashboardFolder}/`;
    const replaceResult = await replaceWikiLinks(app, assetUrlMap, undefined, dashboardPrefix);
    logger.info("Link replacement complete", replaceResult);

    const parts = [
      `${uploadedCount} uploaded`,
      `${skippedCount} skipped`,
      `${failedCount} failed`,
      `${dashboardResult.notesWritten} dashboard note(s) → ${dashboardFolder}`,
    ];
    if (refreshedUrlCount > 0) {
      parts.push(`${refreshedUrlCount} url(s) refreshed`);
    }
    if (albumAddFailedCount > 0) {
      parts.push(`${albumAddFailedCount} not added to album`);
    }
    if (dashboardResult.errors.length > 0) {
      parts.push(`${dashboardResult.errors.length} dashboard error(s)`);
    }
    parts.push(
      `${replaceResult.filesUpdated} note(s) updated, ${replaceResult.linksReplaced} link(s) replaced`,
    );

    const summary = parts.join(" · ");
    if (uploadedCount === 0 && skippedCount > 0 && failedCount === 0 && !forceReupload) {
      new Notice(
        `Immich: all ${skippedCount} file(s) skipped (cached). Use "Force re-upload" if Immich is missing them.`,
        8000,
      );
    } else {
      new Notice(`Immich: ${summary}`, 8000);
    }
    await logger.finish(summary);
  } catch (error) {
    logger.error("Sync aborted", error);
    const message = error instanceof Error ? error.message : String(error);
    new Notice(`Immich sync failed: ${message}`);
    await logger.finish(`Failed: ${message}`);
  }
}

export async function forceReuploadAll(
  app: App,
  settings: PluginSettings,
  saveSettings: () => Promise<void>,
  pluginId: string,
): Promise<void> {
  await clearUploadCache(app, pluginId);
  clearUploadedAssetsInSettings(settings);
  await saveSettings();
  await uploadFolderImages(app, settings, saveSettings, pluginId, { forceReupload: true });
}

function pruneAssetsToMediaFolder(
  assets: Record<string, UploadRecord>,
  mediaFolder: string,
  scannedFiles: TFile[],
): Record<string, UploadRecord> {
  const pruned: Record<string, UploadRecord> = {};
  for (const file of scannedFiles) {
    const record = assets[file.path] ?? findCachedRecord(assets, file.path);
    if (record) {
      pruned[file.path] = record;
    }
  }
  for (const [path, record] of Object.entries(assets)) {
    if (isUnderFolder(path, mediaFolder) && !pruned[path]) {
      pruned[path] = record;
    }
  }
  return pruned;
}

function validateSettings(settings: PluginSettings): string[] {
  const missing: string[] = [];
  if (!settings.immichUrl.trim()) {
    missing.push("Immich URL");
  }
  if (!settings.immichApiKey.trim()) {
    missing.push("API key");
  }
  if (!settings.albumShareKey.trim()) {
    missing.push("album share key");
  }
  if (!settings.albumId.trim() && !settings.albumName.trim()) {
    missing.push("album name or ID");
  }
  if (!normalizeFolderPath(settings.imageFolder)) {
    missing.push("media folder");
  }
  return missing;
}

type ScanStats = {
  folderPath: string;
  folderExists: boolean;
  totalFiles: number;
  totalMedia: number;
  samplePaths: string[];
  allMediaPaths: string[];
};

function collectMediaFiles(
  app: App,
  folderPath: string,
  excludePrefixes: string[],
): { files: TFile[]; stats: ScanStats } {
  const allFiles = app.vault.getFiles();
  const filesInTargetFolder = allFiles.filter((file) => {
    if (!isUnderFolder(file.path, folderPath)) {
      return false;
    }
    return !shouldExcludeFromMediaScan(file.path, excludePrefixes);
  });
  const isSupportedMedia = (file: TFile): boolean => MEDIA_EXTENSIONS.has(getExtension(file));
  const mediaFiles = filesInTargetFolder.filter(isSupportedMedia);
  const folderExists = app.vault.getAbstractFileByPath(folderPath) !== null;

  return {
    files: mediaFiles,
    stats: {
      folderPath,
      folderExists,
      totalFiles: filesInTargetFolder.length,
      totalMedia: mediaFiles.length,
      samplePaths: mediaFiles.slice(0, 5).map((file) => file.path),
      allMediaPaths: mediaFiles.map((file) => file.path),
    },
  };
}

function getExtension(file: TFile): string {
  if (file.extension) {
    return file.extension.toLowerCase();
  }

  const parts = file.name.split(".");
  if (parts.length <= 1) {
    return "";
  }

  const ext = parts.at(-1);
  return ext ? ext.toLowerCase() : "";
}
