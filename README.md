# Immich Vault Sync

Upload a vault media folder to Immich and rewrite `[[wiki links]]` to public asset URLs.

## Setup

1. Install into `.obsidian/plugins/immich-vault-sync/` (`main.js`, `manifest.json`, optional `styles.css`).
2. Enable in **Settings → Community plugins**.
3. Set Immich URL, API key, media folder, album, and share key in plugin settings.

Build from source: `npm install`, then `npm run dev` or `npm run build`.

## Commands

- **Immich: Upload media from configured folder and replace links**
- **Immich: Test connection**

## Behavior

Uploads images and videos from the configured folder; originals stay in the vault. Matching embeds become Immich URLs (images as `![…](url)`, videos as `<video>`). Unchanged files are skipped via a local cache under `.obsidian/plugins/immich-vault-sync/`.

Runs locally; only talks to your Immich instance.
