import { App, normalizePath } from "obsidian";
import type { UploadRecord } from "./settings";
import { LEGACY_DASHBOARD_FOLDER } from "./activity-log";
import { ensureFolderPath, isUnderFolder, writeVaultNote } from "./vault-write";
import { buildMediaEmbed, isVideoPath } from "./media";

const DASHBOARD_BASE_FILE = "Meta/Shortcuts/Bases/Immich Assets.base";

export type DashboardUpdateResult = {
  notesWritten: number;
  notesSkipped: number;
  errors: string[];
  dashboardFolder: string;
};

export type DashboardUpdateOptions = {
  assets: Record<string, UploadRecord>;
  dashboardFolder: string;
  mediaFolder: string;
  log?: (level: "info" | "warn" | "error", message: string, details?: unknown) => void;
};

export async function updateImmichDashboard(
  app: App,
  options: DashboardUpdateOptions,
): Promise<DashboardUpdateResult> {
  const { assets, dashboardFolder, mediaFolder, log } = options;
  const result: DashboardUpdateResult = {
    notesWritten: 0,
    notesSkipped: 0,
    errors: [],
    dashboardFolder,
  };

  const mediaPrefix = normalizePath(mediaFolder);
  const relevant = Object.entries(assets).filter(([assetPath]) => isMediaAsset(assetPath, mediaPrefix));

  log?.("info", `Dashboard folder: ${dashboardFolder}`, {
    totalAssets: Object.keys(assets).length,
    relevantAssets: relevant.length,
    mediaFolder: mediaPrefix,
  });

  if (relevant.length === 0) {
    log?.("warn", "No assets matched the media folder; no dashboard notes written.", { mediaFolder: mediaPrefix });
    return result;
  }

  try {
    await ensureFolderPath(app, "Meta/Shortcuts/Bases");
    await ensureFolderPath(app, dashboardFolder);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to create dashboard folders: ${message}`);
    log?.("error", result.errors[0] ?? "Folder creation failed", error);
    return result;
  }

  for (const [assetPath, record] of relevant) {
    const notePath = `${dashboardFolder}/${toSafeName(assetPath)}.md`;
    try {
      const sourceExists = app.vault.getAbstractFileByPath(assetPath) !== null;
      const content = buildAssetNoteContent(assetPath, record, sourceExists);
      await writeVaultNote(app, notePath, content);
      result.notesWritten += 1;
      log?.("info", `Wrote dashboard note: ${notePath}`, {
        assetId: record.assetId,
        hasUrl: Boolean(record.url),
      });
    } catch (error) {
      result.notesSkipped += 1;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${notePath}: ${message}`);
      log?.("error", `Failed to write dashboard note for ${assetPath}`, error);
    }
  }

  try {
    await writeVaultNote(app, DASHBOARD_BASE_FILE, buildBaseFileContent(dashboardFolder));
    log?.("info", `Updated Bases file: ${DASHBOARD_BASE_FILE}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Bases file: ${message}`);
    log?.("error", "Failed to write Bases file", error);
  }

  return result;
}

function isMediaAsset(assetPath: string, mediaFolder: string): boolean {
  if (!isUnderFolder(assetPath, mediaFolder)) {
    return false;
  }
  if (isUnderFolder(assetPath, LEGACY_DASHBOARD_FOLDER)) {
    return false;
  }
  return true;
}

function toSafeName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function buildAssetNoteContent(assetPath: string, record: UploadRecord, sourceExists: boolean): string {
  const now = new Date().toISOString();
  const lines = [
    "---",
    `asset_path: ${quoteYaml(assetPath)}`,
    `asset_id: ${quoteYaml(record.assetId || "")}`,
    `uploaded: ${!!(record.assetId && record.url)}`,
    `status: ${quoteYaml(record.status || "uploaded")}`,
    `url: ${quoteYaml(record.url || "")}`,
    `source_exists: ${sourceExists}`,
    `file_name: ${quoteYaml(record.fileName || "")}`,
    `file_size: ${record.fileSize ?? 0}`,
    `file_mtime: ${record.mtime ?? 0}`,
    `last_attempt_at: ${quoteYaml(record.lastAttemptAt || "")}`,
    `last_uploaded_at: ${quoteYaml(record.lastUploadedAt || "")}`,
    `last_error: ${quoteYaml(record.lastError || "")}`,
    `dashboard_updated_at: ${quoteYaml(now)}`,
    "tags:",
    "  - immich-asset",
    "---",
    "",
  ];

  if (record.url) {
    const previewPath = record.fileName || assetPath;
    lines.push(buildMediaEmbed("Preview", record.url, isVideoPath(previewPath)));
    lines.push("");
  }

  lines.push(`# ${record.fileName || assetPath}`);
  lines.push("");
  lines.push(`- Source path: \`${assetPath}\``);
  lines.push(`- Uploaded: ${record.assetId && record.url ? "yes" : "no"}`);
  lines.push(record.url ? `- Link: ${record.url}` : "- Link: (none)");
  lines.push("");

  return lines.join("\n");
}

function buildBaseFileContent(dashboardFolder: string): string {
  return [
    "filters:",
    "  and:",
    `    - 'file.inFolder("${dashboardFolder}")'`,
    "    - 'file.ext == \"md\"'",
    "formulas:",
    '  health: \'if(uploaded, "ok", "pending")\'',
    "properties:",
    "  file.name:",
    '    displayName: "Asset"',
    "  uploaded:",
    '    displayName: "Uploaded"',
    "  status:",
    '    displayName: "Status"',
    "  url:",
    '    displayName: "Immich URL"',
    "  source_exists:",
    '    displayName: "Exists in Vault"',
    "  last_uploaded_at:",
    '    displayName: "Last Uploaded"',
    "  last_error:",
    '    displayName: "Last Error"',
    "  formula.health:",
    '    displayName: "Health"',
    "views:",
    "  - type: table",
    '    name: "All assets"',
    "    order:",
    "      - file.name",
    "      - uploaded",
    "      - status",
    "      - formula.health",
    "      - source_exists",
    "      - url",
    "      - last_uploaded_at",
    "      - last_error",
    "  - type: cards",
    '    name: "Gallery"',
    "    order:",
    "      - file.name",
    "      - uploaded",
    "      - status",
    "      - url",
  ].join("\n");
}
