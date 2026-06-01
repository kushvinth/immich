# Immich Vault Sync

Upload a vault media folder to Immich and rewrite `[[wiki links]]` to public asset URLs.

## Install

1. Open [Releases](https://github.com/kushvinth/immich-vault-sync/releases) and download `main.js`, `manifest.json`, and `styles.css`.
2. Put them in `<Vault>/.obsidian/plugins/immich-vault-sync/`.
3. Reload Obsidian and enable the plugin in **Settings → Community plugins**.
4. Set Immich URL, API key, media folder, album, and share key in plugin settings.

No npm required for install.

## Develop

```bash
npm install
npm run dev    # watch build
npm run build  # production main.js
```

## Commands

- **Immich: Upload media from configured folder and replace links**
- **Immich: Test connection**

## Behavior

Uploads images and videos from the configured folder; originals stay in the vault. Embeds become Immich URLs (images as `![…](url)`, videos as `<video>`). Unchanged files are skipped via cache under `.obsidian/plugins/immich-vault-sync/`.

Runs locally; only talks to your Immich instance.
