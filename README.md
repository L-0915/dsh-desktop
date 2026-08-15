# dsh-desktop

> Launch [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) in a standalone desktop window — double-click a shortcut, no browser chrome, no console window.

[English](README.md) | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/Platform-Windows%20x64-0078D6.svg)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/L-0915/dsh-desktop/pulls)

A Tauri shell + DSH plugin that turns the DSH Web GUI into a native-feeling desktop app.

## ✨ Features

- 🖥️ **Standalone window**: a Tauri shell (Rust + WebView) loads `http://127.0.0.1:3080` — no browser tabs, no address bar
- 🚀 **Auto-start service**: probes the DSH web service on launch; if it is down, runs your configured start command and waits until ready
- 📌 **Desktop shortcut**: one-click create / remove a Windows `.lnk` from the settings page
- 🎨 **Fully custom icons**:
  - Built-in icons are discovered dynamically — drop any `.ico` into `assets/icons/` and it appears instantly, no code changes
  - Upload custom icons in **PNG / JPG / WebP / GIF / BMP and other common formats** (converted in the browser)
  - **Automatic background removal** — images with a solid background are made transparent automatically
  - Picking an icon **applies it to the desktop shortcut immediately**
- 🧠 **Skin-aware UI**: the settings card uses the DSH skin tokens (`--dsw-alias-*`), so it follows the active theme
- ⚙️ **Configurable launch**: URL, port, start command, working directory, and readiness timeout
- 🔄 **Dev friendly**: client-side changes appear after a page refresh (no service restart)

## 📦 Install

### Option 1 — from npm (one command)

```sh
dsh plugin --profile web add @debb74/dsh-desktop
```

> ⚠️ **pnpm ≥ 10**: allow the `sharp` native build, or background removal will silently
> fail. Add this to `$DSH_HOME/profiles/web/pnpm-workspace.yaml`:
> ```yaml
> allowBuilds:
>   sharp: true
> ```
> Then re-run `pnpm install` and **restart the dsh web service**.
>
> The plugin's own `cordis.patch.yml` (`dsh.bundle.patch`) applies automatically —
> no manual config editing needed.

### Option 2 — from GitHub (clone)

Clone the repo and install the plugin from source:

```sh
git clone https://github.com/L-0915/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm build:plugin                       # build the plugin (packages/dsh-desktop/lib/)
dsh plugin --profile web add link:<absolute path to this repo>/packages/dsh-desktop
```

To also build the shell (the standalone window) from source:

```sh
# prerequisites: Rust stable (MSVC or GNU toolchain)
cd apps/shell/src-tauri
cargo build --release
# output: apps/shell/src-tauri/target/release/dsh-desktop.exe
```

Or download a prebuilt shell from the [Releases](https://github.com/L-0915/dsh-desktop/releases) page — no toolchain needed.

### Option 3 — manual

1. Link `packages/dsh-desktop` into `$DSH_HOME/profiles/web/node_modules/@debb74/dsh-desktop` (a Windows junction works and stays live)
2. Append to `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: desktop
      name: '@debb74/dsh-desktop'
```

3. Restart the dsh web service, then open Settings → Plugins → Plugin configuration → **desktop**

### After install

1. Open **Settings → Plugins → Plugin configuration** and expand the **desktop** card
2. Make sure **Shell** shows **found** (if not, download it from [Releases](https://github.com/L-0915/dsh-desktop/releases) — see "The shell" below)
3. Pick a built-in icon or upload your own image (background is removed automatically)
4. Click **Create desktop shortcut** — a **DeepSeek Harness** icon appears on the desktop
5. Double-click it → DSH opens in its own window

> 💡 When the shortcut already exists, **clicking an icon applies it immediately** — no need to re-create.

## 🏗️ Architecture

```
dsh-desktop/
├── apps/shell/                    # Tauri shell (Rust)
│   └── src-tauri/                 #   window + service probe/start + GUI load
├── packages/dsh-desktop/          # DSH cordis plugin (dual-face bundle)
│   ├── src/
│   │   ├── index.ts               #   host half: /api/dsh-desktop/* routes
│   │   ├── routes.ts              #   HTTP API (status/shortcut/config/icons)
│   │   ├── shortcut.ts            #   Windows .lnk create/remove + cache refresh
│   │   ├── icons.ts               #   dynamic icon discovery + upload store
│   │   ├── background.ts          #   automatic solid-background removal
│   │   ├── config.ts              #   desktop-launcher.json read/write
│   │   └── client/                #   client half: settings card
│   ├── assets/icons/              #   built-in icons (dynamic discovery)
│   └── cordis.patch.yml           #   plugin declaration
└── scripts/                       # dev tooling
```

## ⚙️ Configuration

Edit everything from the settings page, or `$DSH_HOME/desktop-launcher.json` directly:

```json
{
  "url": "http://127.0.0.1:3080",
  "port": 3080,
  "startCommand": ["pnpm", "dsh", "web"],
  "startCwd": "",
  "timeoutSecs": 60,
  "shellPath": ""
}
```

| Field | Description |
|---|---|
| `url` | Web GUI URL (the shell loads this) |
| `port` | Port probed for service readiness |
| `startCommand` | Command to start the service when it is down |
| `startCwd` | Working directory for the start command |
| `timeoutSecs` | Readiness timeout in seconds |
| `shellPath` | Path to the shell executable (blank = auto-detect) |

## 🖥️ The shell (standalone window)

The **shell** is the standalone window that opens when you double-click the
shortcut. **It ships inside the npm package** (`shell/dsh-desktop.exe`) — install
the plugin and it is already there; the desktop card auto-detects it (Shell
shows **found**). No separate download or build needed.

For other platforms (or to run the latest unreleased shell), grab the prebuilt
`.exe` from the [Releases](https://github.com/L-0915/dsh-desktop/releases) page,
or build from source (see "Option 2 — from GitHub" above).

The plugin itself works without the shell; the shortcut just won't open a
window until the shell is in place.

## 🖼️ Custom built-in icons

Drop any `.ico` file into `packages/dsh-desktop/assets/icons/` — it appears in the picker after a refresh, no code change.

PNG/JPG → ICO converter:

```sh
node scripts/convert-to-ico.mjs <image-dir>
```

## 📦 Release

Tagging triggers GitHub Actions to build the Windows shell and attach it to a Release:

```sh
git tag v0.1.0
git push origin v0.1.0
```

## 🔜 Roadmap

- [ ] macOS support (`.app` shortcut + Tauri macOS build)
- [ ] Linux support
- [ ] Installers (NSIS / dmg)
- [ ] Auto-update checks

## 🤝 Contributing

PRs welcome! Please make sure:

1. `scripts/verify-artifacts.ps1` + `scripts/smoke.mjs` pass after changes
2. Client-side changes follow the DSH skin tokens (`--dsw-alias-*`)
3. Follow the conventions in [AGENTS.md](AGENTS.md)

## 📄 License

[MIT](LICENSE) © 2026 [L-0915](https://github.com/L-0915)
