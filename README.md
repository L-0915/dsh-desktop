# dsh-desktop — DSH 桌面启动器 / Desktop Launcher

> 双击桌面图标，以独立应用窗口打开 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI——就像 Codex 桌面版一样。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/Platform-Windows%20x64-0078D6.svg)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/debb74/dsh-desktop/pulls)

一个把 DSH 变成"真正的桌面软件"的插件 + 壳程序：

- **Tauri 壳**（Rust + WebView）提供独立应用窗口，没有浏览器地址栏
- **DSH cordis 插件**在设置页提供完整的快捷方式管理界面
- 兼容现有 DSH 环境，无需修改 dsh 源码（纯插件 + 独立壳）

## ✨ 特性

- 🖥️ **独立应用窗口**：Tauri 壳加载 `http://127.0.0.1:3080`，无浏览器痕迹，双击即用
- 🚀 **自动拉起服务**：窗口启动时探测 DSH Web 服务，未运行则自动执行配置的启动命令并等待就绪
- 📌 **桌面快捷方式**：设置页一键创建 / 删除 Windows `.lnk`
- 🎨 **图标完全自定义**：
  - 内置图标动态发现——往 `assets/icons/` 丢任意 `.ico` 即自动出现，无需改代码
  - 上传自定义图标支持 **PNG / JPG / WebP / GIF / BMP 等所有常见格式**（浏览器自动转换）
  - **自动去除纯色背景**——上传带背景的图片自动透明化，无需手动抠图
  - 点选图标**立即应用到桌面快捷方式**，无需二次操作
- 🧠 **皮肤配色**：设置界面完全使用 DSH 皮肤系统变量（`--dsw-alias-*`），切换皮肤自动适配
- ⚙️ **启动配置**：Web 地址、端口、启动命令、工作目录、等待超时全部可配置
- 🔄 **开发友好**：client 端改动构建后刷新即生效（无需重启服务）

## 🏗️ 架构

```
dsh-desktop/
├── apps/shell/                    # Tauri 壳应用（Rust）
│   ├── src-tauri/
│   │   ├── src/main.rs            #   窗口 + 服务探测/拉起 + 加载 GUI
│   │   ├── tauri.conf.json        #   窗口与打包配置
│   │   └── icons/                 #   壳应用图标（可替换）
│   └── dist/index.html            #   加载等待页（服务启动时的过渡画面）
├── packages/dsh-desktop/          # DSH cordis 插件（双面 bundle）
│   ├── src/
│   │   ├── index.ts               #   host 半区入口：/api/dsh-desktop/* 路由
│   │   ├── routes.ts              #   HTTP API（状态/快捷方式/配置/图标）
│   │   ├── shortcut.ts            #   Windows .lnk 创建/删除 + 图标缓存刷新
│   │   ├── icons.ts               #   图标动态发现 + 上传存储
│   │   ├── background.ts          #   纯色背景自动去除
│   │   ├── config.ts              #   desktop-launcher.json 读写
│   │   └── client/                #   client 半区：设置页「desktop」卡片
│   │       ├── index.ts           #     settings.plugin.item 卡片注册
│   │       ├── Card.tsx           #     卡片 UI（皮肤主题配色）
│   │       └── locales.ts         #     中英文案
│   ├── assets/icons/              #   内置图标（动态发现，任意 .ico）
│   └── cordis.patch.yml           #   插件声明
└── scripts/                       # 开发工具（构建/测试/图标/更新）
```

### 数据流

```
设置页选择图标 → POST /api/dsh-desktop/shortcut → 生成/刷新 .lnk
                                                    ↓
桌面上双击「DeepSeek Harness」 → 壳启动 → 探测 :3080
                                          ↓ 未运行
                                 执行 startCommand（如 pnpm dsh web）
                                          ↓ 就绪
                               WebView 加载 http://127.0.0.1:3080
```

## 🚀 快速开始

### 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 22.19 | DSH 运行环境 |
| pnpm | ≥ 9 | 插件构建 |
| Rust | stable-msvc 或 stable-gnu | Tauri 壳编译 |

### 构建

```sh
# 1. 安装依赖
pnpm install

# 2. 构建插件（产物：packages/dsh-desktop/lib/）
pnpm build:plugin

# 3. 构建 Tauri 壳（产物：apps/shell/src-tauri/target/release/dsh-desktop.exe）
pnpm build:shell
```

### 安装到 DSH Web

**方式一：命令行（推荐）**

```sh
dsh plugin --profile web add link:<本仓库路径>/packages/dsh-desktop
```

**方式二：手动**

1. 把 `packages/dsh-desktop` 链接到 `$DSH_HOME/profiles/web/node_modules/@debb74/dsh-desktop`（Windows 下 junction 即可，改动实时生效）
2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: desktop
      name: '@debb74/dsh-desktop'
```

3. 重启 dsh web 服务，浏览器打开设置页 → 插件 → 插件配置 → **desktop**

## 🎯 使用

1. 打开 **设置 → 插件 → 插件配置**，找到 **desktop** 卡片
2. 点击展开，确认"壳程序"状态为**已找到**
3. 在图标区选择喜欢的内置图标，或上传自己的图片（自动去背景）
4. 点击「创建桌面快捷方式」——桌面出现「DeepSeek Harness」
5. 双击它 → 独立窗口打开 DSH

> 💡 快捷方式已存在时，**点选图标会立即应用**到桌面，无需重新创建。

## ⚙️ 配置

设置页可编辑全部配置，或直接编辑 `$DSH_HOME/desktop-launcher.json`：

```json
{
  "url": "http://127.0.0.1:3080",
  "port": 3080,
  "startCommand": ["pnpm", "dsh", "web"],
  "startCwd": "D:\\deepseek-harness",
  "timeoutSecs": 60,
  "shellPath": "D:\\dsh-home\\dsh-desktop\\apps\\shell\\src-tauri\\target\\release\\dsh-desktop.exe"
}
```

| 字段 | 说明 |
|---|---|
| `url` | Web GUI 地址（壳加载目标） |
| `port` | 服务探测端口 |
| `startCommand` | 服务未运行时执行的启动命令（程序 + 参数） |
| `startCwd` | 启动命令的工作目录 |
| `timeoutSecs` | 等待服务就绪的超时（秒） |
| `shellPath` | 壳可执行文件路径（留空自动探测） |

## 🛠️ 开发

```powershell
# 一键构建 + 契约验证 + 冒烟测试（不重启服务）
powershell -File D:\dsh-home\dsh-desktop\scripts\dev-reload.ps1

# 产物契约验证（__ModuleLoader__ 注册、exports 指向）
powershell -File scripts\verify-artifacts.ps1

# 冒烟测试（核心逻辑：ICO 打包/配置/图标/去背景）
node scripts\smoke.mjs

# 全家桶一键更新（dsh 源码 + @linxin666 插件）
powershell -File D:\dsh-home\update-all.ps1
```

### 生效规则

| 改动类型 | 生效方式 |
|---|---|
| Client 端（UI/文案/卡片） | 构建后**刷新页面**即可，无需重启 |
| Host 端（路由/图标逻辑） | 需要**重启服务** |
| 内置图标文件（assets/icons/*.ico） | **刷新页面**即可（ETag 条件缓存） |

## 🖼️ 自定义内置图标

内置图标**动态发现**：把任意 `.ico` 文件放入 `packages/dsh-desktop/assets/icons/`，刷新设置页即自动出现，**不需要改代码**。

PNG/JPG 转 ICO 工具：

```sh
node scripts/convert-to-ico.mjs <图片目录>
```

## 📦 发布

打 tag 自动触发 GitHub Actions 构建 Windows 产物：

```sh
git tag v0.1.0
git push origin v0.1.0
```

CI 会构建壳 + 插件并上传 Release 附件（见 `.github/workflows/build-release.yml`）。

## 🔜 路线图

- [ ] macOS 支持（`.app` 快捷方式 + Tauri macOS 构建）
- [ ] Linux 支持
- [ ] 安装包（NSIS / dmg）
- [ ] 自动更新检查

## 🤝 贡献

欢迎 PR！请确保：

1. 修改后运行 `scripts/verify-artifacts.ps1` + `scripts/smoke.mjs` 全绿
2. Client 端改动遵循 DSH 皮肤配色（`--dsw-alias-*` 变量）
3. 遵守 [AGENTS.md](AGENTS.md) 约定

## 📄 License

[MIT](LICENSE) © 2026 [debb74](https://github.com/debb74)
