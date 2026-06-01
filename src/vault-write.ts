import { App, normalizePath, TFile } from "obsidian";
import { normalizeFolderPath } from "./activity-log";

export async function ensureFolderPath(app: App, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  const parts = normalized.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (app.vault.getAbstractFileByPath(current)) {
      continue;
    }
    await app.vault.createFolder(current);
  }
}

export async function writeVaultNote(app: App, notePath: string, content: string): Promise<void> {
  const path = normalizePath(notePath);
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent) {
    await ensureFolderPath(app, parent);
  }

  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return;
  }

  await app.vault.create(path, content);
}

export function isUnderFolder(filePath: string, folderPath: string): boolean {
  const folder = normalizePath(normalizeFolderPath(folderPath));
  const file = normalizePath(normalizeFolderPath(filePath));
  if (file === folder || file.startsWith(`${folder}/`)) {
    return true;
  }
  const folderLower = folder.toLowerCase();
  const fileLower = file.toLowerCase();
  return fileLower === folderLower || fileLower.startsWith(`${folderLower}/`);
}

export function shouldExcludeFromMediaScan(filePath: string, excludePrefixes: string[]): boolean {
  return excludePrefixes.some((prefix) => isUnderFolder(filePath, prefix.replace(/\/$/, "")));
}
