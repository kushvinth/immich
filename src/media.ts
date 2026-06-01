import type { TFile } from "obsidian";

export const IMAGE_EXTENSIONS = new Set([
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
]);

export const VIDEO_EXTENSIONS = new Set([
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

export const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

export function isVideoExtension(extension: string): boolean {
  return VIDEO_EXTENSIONS.has(extension.toLowerCase());
}

export function isVideoFile(file: TFile): boolean {
  return file.extension ? isVideoExtension(file.extension) : false;
}

export function isVideoPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return false;
  }
  return isVideoExtension(path.slice(dot + 1));
}

export function buildMediaEmbed(text: string, url: string, isVideo: boolean): string {
  if (isVideo) {
    return `<video controls src="${escapeHtmlAttr(url)}"></video>`;
  }
  return `![${text}](<${url}>)`;
}

export function buildMediaLink(text: string, url: string): string {
  return `[${text}](<${url}>)`;
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
