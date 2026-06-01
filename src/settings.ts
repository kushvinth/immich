import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ImmichUploaderPlugin from "./main";
import { clearUploadCache, clearUploadedAssetsInSettings } from "./upload-cache";

export type LinkStyle = "preview" | "original";
export type ReplaceScope = "vault" | "folder";

export interface UploadRecord {
	assetId: string;
	mtime: number;
	url: string;
	status?: "uploaded" | "duplicate" | "error";
	lastUploadedAt?: string;
	lastAttemptAt?: string;
	lastError?: string;
	fileName?: string;
	fileSize?: number;
}

export interface PluginSettings {
	immichUrl: string;
	immichApiKey: string;
	albumName: string;
	albumId: string;
	albumShareKey: string;
	imageFolder: string;
	/** Override; default is `{imageFolder}/Assets-Base-Data`. */
	dashboardFolder: string;
	includeSubfolders: boolean;
	linkStyle: LinkStyle;
	replaceScope: ReplaceScope;
	/** Show sync log modal and write Immich Sync Log.md after each run. */
	showSyncLog: boolean;
	uploadedAssets: Record<string, UploadRecord>;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	immichUrl: "",
	immichApiKey: "",
	albumName: "Obsidian Uploads",
	albumId: "",
	albumShareKey: "",
	imageFolder: "Meta/Media",
	dashboardFolder: "",
	includeSubfolders: true,
	linkStyle: "original",
	replaceScope: "vault",
	showSyncLog: true,
	uploadedAssets: {},
};

export class ImmichSettingTab extends PluginSettingTab {
	plugin: ImmichUploaderPlugin;

	constructor(app: App, plugin: ImmichUploaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Immich url")
			.setDesc("Use the base url for your Immich instance, with no trailing slash.")
			.addText((text) =>
				text
					.setPlaceholder("https://immich.example.com")
					.setValue(this.plugin.settings.immichUrl)
					.onChange(async (value) => {
						this.plugin.settings.immichUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Immich api key")
			.setDesc("Needs permissions for asset upload and album management.")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setValue(this.plugin.settings.immichApiKey)
					.onChange(async (value) => {
						this.plugin.settings.immichApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Album name")
			.setDesc("Uploads are added to this album (created if missing).")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.albumName)
					.onChange(async (value) => {
						this.plugin.settings.albumName = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Album id (optional)")
			.setDesc("If set, the plugin will use this album directly.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.albumId)
					.onChange(async (value) => {
						this.plugin.settings.albumId = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Album share key")
			.setDesc("Required to build public urls after upload.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.albumShareKey)
					.onChange(async (value) => {
						this.plugin.settings.albumShareKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Media discovery")
			.setDesc("Configure which vault folder is scanned for image and video uploads.");

		new Setting(containerEl)
			.setName("Media folder")
			.setDesc("Vault-relative path (for example, meta/media). Images and videos in this folder are uploaded.")
			.addText((text) =>
				text
					.setPlaceholder("For example, meta/media")
					.setValue(this.plugin.settings.imageFolder)
					.onChange(async (value) => {
						this.plugin.settings.imageFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Asset dashboard folder")
			.setDesc(
				"Metadata notes (preview, Immich URL, frontmatter) are written here. Leave empty to use {media folder}/asset/base/data.",
			)
			.addText((text) =>
				text
					.setPlaceholder("For example, meta/media/asset/base/data")
					.setValue(this.plugin.settings.dashboardFolder)
					.onChange(async (value) => {
						this.plugin.settings.dashboardFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show sync log")
			.setDesc("After each upload, open a log window and update Immich Sync Log.md in the media folder.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showSyncLog).onChange(async (value) => {
					this.plugin.settings.showSyncLog = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Link style")
			.setDesc("Choose which Immich link format to insert in notes.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("original", "Original file URL")
					.addOption("preview", "Preview thumbnail URL")
					.setValue(this.plugin.settings.linkStyle)
					.onChange(async (value) => {
						this.plugin.settings.linkStyle = value as LinkStyle;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Replace scope")
			.setDesc("Wiki link replacement runs across the full vault.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("vault", "Entire vault")
					.setValue("vault")
					.onChange(async () => {
						this.plugin.settings.replaceScope = "vault" as ReplaceScope;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Validate the connection to your Immich server.")
			.addButton((button) => {
				button.setButtonText("Test");
				button.onClick(async () => {
					await this.plugin.testConnection();
				});
			});

		new Setting(containerEl)
			.setName("Clear upload cache")
			.setDesc(
				"Use if files show as skipped but are missing from Immich. Clears cached upload state; run Force re-upload next.",
			)
			.addButton((button) => {
				button.setButtonText("Clear cache");
				button.onClick(async () => {
					await clearUploadCache(this.app, this.plugin.manifest.id);
					clearUploadedAssetsInSettings(this.plugin.settings);
					await this.plugin.saveSettings();
					new Notice("Immich upload cache cleared.");
				});
			});
	}
}
