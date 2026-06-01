import { App, Modal, normalizePath } from "obsidian";
import { writeVaultNote } from "./vault-write";

export type LogLevel = "info" | "warn" | "error" | "success";

const LOG_PREFIX = "[Immich]";

export class ImmichSyncLogger {
  private readonly lines: string[] = [];
  private readonly startedAt = new Date();

  constructor(
    private readonly app: App,
    private readonly logFilePath: string,
    private readonly showModal: boolean,
  ) {
    this.info("Sync run started");
  }

  info(message: string, details?: unknown): void {
    this.write("info", message, details);
  }

  warn(message: string, details?: unknown): void {
    this.write("warn", message, details);
  }

  error(message: string, details?: unknown): void {
    this.write("error", message, details);
  }

  success(message: string, details?: unknown): void {
    this.write("success", message, details);
  }

  private write(level: LogLevel, message: string, details?: unknown): void {
    const stamp = formatTime(new Date());
    const line = `[${stamp}] [${level.toUpperCase()}] ${message}`;
    this.lines.push(line);

    if (details !== undefined) {
      const detailText = formatDetails(details);
      this.lines.push(`  ${detailText}`);
      console.log(`${LOG_PREFIX} ${message}`, details);
    } else {
      console.log(`${LOG_PREFIX} ${message}`);
    }
  }

  async finish(summary: string): Promise<void> {
    const elapsedMs = Date.now() - this.startedAt.getTime();
    this.info(`Sync run finished in ${(elapsedMs / 1000).toFixed(1)}s`);
    this.info(summary);

    await this.persistLogFile();
    if (this.showModal) {
      new SyncLogModal(this.app, this.lines, summary).open();
    }
  }

  getText(): string {
    return this.lines.join("\n");
  }

  private async persistLogFile(): Promise<void> {
    const header = [
      "# Immich sync log",
      "",
      `Last run: ${this.startedAt.toISOString()}`,
      "",
      "```text",
      ...this.lines,
      "```",
      "",
    ].join("\n");

    try {
      const path = normalizePath(this.logFilePath);
      await writeVaultNote(this.app, path, header);
      this.info(`Log saved to ${path}`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to write log file`, error);
    }
  }
}

class SyncLogModal extends Modal {
  constructor(
    app: App,
    private readonly lines: string[],
    private readonly summary: string,
  ) {
    super(app);
    this.titleEl.setText("Immich sync log");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("immich-sync-log-modal");

    contentEl.createEl("p", {
      cls: "immich-sync-log-summary",
      text: this.summary,
    });

    const pre = contentEl.createEl("pre", { cls: "immich-sync-log-body" });
    pre.setText(this.lines.join("\n"));

    const footer = contentEl.createDiv({ cls: "immich-sync-log-footer" });
    footer.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
  }
}

export function resolveLogFilePath(mediaFolder: string): string {
  const folder = normalizeFolderPath(mediaFolder);
  return `${folder}/Immich Sync Log.md`;
}

export function resolveDashboardFolder(settings: {
  imageFolder: string;
  dashboardFolder?: string;
}): string {
  const custom = settings.dashboardFolder?.trim();
  if (custom) {
    return normalizeFolderPath(custom);
  }

  const media = normalizeFolderPath(settings.imageFolder);
  return `${media}/asset/base/data`;
}

/** Legacy typo path kept for exclusion during scans. */
export const LEGACY_DASHBOARD_FOLDER = "Meta/Media/Asserts-Base-Data";

export function normalizeFolderPath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function formatDetails(details: unknown): string {
  if (details instanceof Error) {
    return details.stack ?? details.message;
  }
  if (typeof details === "string") {
    return details;
  }
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}
