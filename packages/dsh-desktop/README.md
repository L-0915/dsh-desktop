# @debb74/dsh-desktop

DSH Desktop Launcher 插件——在 DSH Web GUI 的设置页提供桌面快捷方式管理：创建/删除桌面快捷方式、自定义图标（支持所有常见图片格式 + 自动去背景）、启动配置管理。配合 Tauri 壳（见仓库根目录）即可像桌面软件一样启动 DeepSeek Harness。

## 安装

```sh
dsh plugin --profile web add link:<本仓库路径>/packages/dsh-desktop
```

或在 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: desktop
      name: '@debb74/dsh-desktop'
```

## 功能

- 设置页「插件配置 → desktop」卡片：状态查看、快捷方式创建/删除、图标选择/上传、启动配置
- 图标：内置图标动态发现（`assets/icons/` 下任意 `.ico` 自动出现）；上传支持 PNG/JPG/WebP/GIF/BMP 等，自动去纯色背景
- 皮肤适配：UI 使用 `--dsw-alias-*` 变量，跟随 DSH 主题

## API

Host 半区提供 `/api/dsh-desktop/*` 路由：

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/dsh-desktop/status` | GET | 平台/壳/快捷方式/配置/图标列表 |
| `/api/dsh-desktop/config` | POST | 保存启动配置 |
| `/api/dsh-desktop/shortcut` | POST/DELETE | 创建/删除桌面快捷方式 |
| `/api/dsh-desktop/icon` | POST | 上传自定义图标（PNG base64） |
| `/api/dsh-desktop/icon/<name>` | GET | 内置图标文件 |
| `/api/dsh-desktop/icon/user/<name>` | GET/DELETE | 自定义图标文件 |

## 开发

```sh
pnpm install
pnpm run build    # tsc 类型 + tsdown 双 bundle（lib/index.mjs + lib/client.js）
pnpm run typecheck
```

## License

MIT
