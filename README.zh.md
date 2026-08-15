# dsh-desktop

> 双击桌面快捷方式，以独立应用窗口打开 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)——无浏览器痕迹，不弹终端，就是一个软件。

[English](README.md) | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/Platform-Windows%20x64-0078D6.svg)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/L-0915/dsh-desktop/pulls)

Tauri 壳 + DSH 插件，把 DSH Web GUI 变成原生桌面应用体验。

## ✨ 特性

- 🖥️ **独立窗口**：Tauri 壳（Rust + WebView）加载 `http://127.0.0.1:3080`——没有浏览器标签页、没有地址栏
- 🚀 **自动拉起服务**：启动时探测 DSH Web 服务；未运行则执行你配置的启动命令并等待就绪
- 📌 **桌面快捷方式**：设置页一键创建 / 删除 Windows `.lnk`
- 🎨 **图标完全自定义**：
  - 内置图标动态发现——往 `assets/icons/` 丢任意 `.ico` 即自动出现，无需改代码
  - 上传自定义图标支持 **PNG / JPG / WebP / GIF / BMP 等常见格式**（浏览器自动转换）
  - **自动去除纯色背景**——带背景的图片自动透明化，无需手动抠图
  - 点选图标**立即应用到桌面快捷方式**
- 🧠 **皮肤适配**：设置卡片使用 DSH 皮肤变量（`--dsw-alias-*`），跟随当前主题
- ⚙️ **启动可配置**：URL、端口、启动命令、工作目录、就绪超时
- 🔄 **开发友好**：client 端改动刷新页面即生效（无需重启服务）

## 📦 安装

### 方式一：npm 一行命令

```sh
dsh plugin --profile web add @debb74/dsh-desktop
```

> ⚠️ **pnpm ≥ 10**：需要放行 sharp 原生构建，否则去背景功能会静默失效。
> 在 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 添加：
> ```yaml
> allowBuilds:
>   sharp: true
> ```
> 然后重新 `pnpm install`，最后**重启 dsh web 服务**。
>
> 插件自带的 `cordis.patch.yml`（`dsh.bundle.patch`）会自动应用，无需手动改配置。

### 方式二：GitHub 克隆安装

克隆仓库并从源码安装插件：

```sh
git clone https://github.com/L-0915/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm build:plugin                       # 构建插件（packages/dsh-desktop/lib/）
dsh plugin --profile web add link:<本仓库绝对路径>/packages/dsh-desktop
```

独立窗口程序（`dsh-desktop.exe`）已随 npm 包内置——无需额外构建或下载。

从源码构建独立窗口：

```sh
# 前置：Node.js ≥ 22.19、pnpm ≥ 9、Rust stable（MSVC 或 GNU 工具链）
pnpm install                            # workspace 依赖
pnpm build:plugin                       # 插件 bundle
cd apps/shell/src-tauri
cargo build --release                   # 壳：target/release/dsh-desktop.exe
```

构建后把 exe 复制到 `packages/dsh-desktop/shell/dsh-desktop.exe`（或在 desktop 卡片里填「壳程序路径」），快捷方式即可找到壳。

### 方式三：手动

1. 把 `packages/dsh-desktop` 链接到 `$DSH_HOME/profiles/web/node_modules/@debb74/dsh-desktop`（Windows 用 junction，改动实时生效）
2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: desktop
      name: '@debb74/dsh-desktop'
```

3. 重启 dsh web 服务，打开 设置 → 插件 → 插件配置 → **desktop**

### 安装后使用

1. 打开 **设置 → 插件 → 插件配置**，展开 **desktop** 卡片
2. 确认「壳程序」显示**已找到**（未找到则从 [Releases](https://github.com/L-0915/dsh-desktop/releases) 下载，见下文）
3. 选择内置图标，或上传自己的图片（自动去背景）
4. 点「创建桌面快捷方式」——桌面出现 **DeepSeek Harness** 图标
5. 双击它 → DSH 在独立窗口打开

> 💡 快捷方式已存在时，**点选图标立即应用**，无需重新创建。

## 🏗️ 架构

```
dsh-desktop/
├── apps/shell/                    # Tauri 壳（Rust）
│   └── src-tauri/                 #   窗口 + 服务探测/拉起 + 加载 GUI
├── packages/dsh-desktop/          # DSH cordis 插件（双面 bundle）
│   ├── src/
│   │   ├── index.ts               #   host 半区：/api/dsh-desktop/* 路由
│   │   ├── routes.ts              #   HTTP API（状态/快捷方式/配置/图标）
│   │   ├── shortcut.ts            #   Windows .lnk 创建/删除 + 缓存刷新
│   │   ├── icons.ts               #   图标动态发现 + 上传存储
│   │   ├── background.ts          #   纯色背景自动去除
│   │   ├── config.ts              #   desktop-launcher.json 读写
│   │   └── client/                #   client 半区：设置卡片
│   ├── assets/icons/              #   内置图标（动态发现）
│   └── cordis.patch.yml           #   插件声明
└── scripts/                       # 开发工具
```

## ⚙️ 配置

设置页可编辑全部配置，或直接编辑 `$DSH_HOME/desktop-launcher.json`：

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

| 字段 | 说明 |
|---|---|
| `url` | Web GUI 地址（壳加载目标） |
| `port` | 服务就绪探测端口 |
| `startCommand` | 服务未运行时执行的启动命令 |
| `startCwd` | 启动命令的工作目录 |
| `timeoutSecs` | 就绪等待超时（秒） |
| `shellPath` | 壳可执行文件路径（留空自动探测） |

## 🖼️ 自定义内置图标

往 `packages/dsh-desktop/assets/icons/` 丢任意 `.ico` 文件，刷新后即出现在选择器中，无需改代码。

PNG/JPG 转 ICO 工具：

```sh
node scripts/convert-to-ico.mjs <图片目录>
```

## 📦 发布

打 tag 自动触发 GitHub Actions 构建 Windows 壳并生成 Release 附件：

```sh
git tag v0.1.0
git push origin v0.1.0
```

## 🔜 路线图

- [ ] macOS 支持（`.app` 快捷方式 + Tauri macOS 构建）
- [ ] Linux 支持
- [ ] 安装包（NSIS / dmg）
- [ ] 自动更新检查

## 🤝 贡献

欢迎 PR！请确保：

1. 修改后 `scripts/verify-artifacts.ps1` + `scripts/smoke.mjs` 全绿
2. Client 端改动遵循 DSH 皮肤变量（`--dsw-alias-*`）
3. 遵守 [AGENTS.md](AGENTS.md) 约定

## 📄 License

[MIT](LICENSE) © 2026 [L-0915](https://github.com/L-0915)
