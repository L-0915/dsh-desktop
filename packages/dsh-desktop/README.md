# @debb74/dsh-desktop

A DSH plugin that manages a desktop shortcut for the DeepSeek Harness Web GUI: create/remove the shortcut, pick custom icons (all common image formats + automatic background removal), and configure the launch command. Pairs with the Tauri shell in the [dsh-desktop repository](https://github.com/L-0915/dsh-desktop) for a standalone window.

[English](https://github.com/L-0915/dsh-desktop) | [中文](https://github.com/L-0915/dsh-desktop/blob/master/README.zh.md)

## Install

```sh
dsh plugin --profile web add @debb74/dsh-desktop
```

> **pnpm ≥ 10**: add `sharp: true` to `allowBuilds` in
> `$DSH_HOME/profiles/web/pnpm-workspace.yaml`, re-run `pnpm install`, then
> restart the dsh web service.

Or manually append to `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: desktop
      name: '@debb74/dsh-desktop'
```

Then open Settings → Plugins → Plugin configuration → **desktop**.

## Features

- Desktop shortcut create / remove (Windows `.lnk`)
- Icons: dynamic built-in discovery (`assets/icons/`), upload PNG/JPG/WebP/GIF/BMP with automatic solid-background removal, one-click apply to the shortcut
- Skin-aware UI via `--dsw-alias-*` tokens
- Configurable launch URL/port/command via `$DSH_HOME/desktop-launcher.json`

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/dsh-desktop/status` | GET | platform / shell / shortcut / config / icons |
| `/api/dsh-desktop/config` | POST | save launch config |
| `/api/dsh-desktop/shortcut` | POST/DELETE | create / remove desktop shortcut |
| `/api/dsh-desktop/icon` | POST | upload custom icon (PNG base64) |
| `/api/dsh-desktop/icon/<name>` | GET | built-in icon file |
| `/api/dsh-desktop/icon/user/<name>` | GET/DELETE | custom icon file |

## License

MIT
