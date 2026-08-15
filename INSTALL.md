# 一句话安装 dsh-desktop（复制给 DSH 助手）

把下面整段复制到 DSH 对话里发送，助手会帮你完成安装：

---

请帮我安装 @debb74/dsh-desktop 插件（DSH 桌面启动器）：

1. 在 web profile 安装插件包：`dsh plugin --profile web add @debb74/dsh-desktop`
2. 检查 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 是否包含 `sharp: true`，没有就加上（sharp 是原生模块，pnpm≥10 默认阻止其构建，不放行会导致"去背景"功能不可用），然后重新 `pnpm install`
3. 重启 dsh web 服务（短暂中断，会话保留）
4. 验证：浏览器打开 `http://127.0.0.1:3080` → 设置 → 插件 → 插件配置，应出现 **desktop** 卡片

注意：本插件是 DSH 桌面启动器，配套的 Tauri 壳程序（独立窗口）需要单独构建，详情见 https://github.com/debb74/dsh-desktop

---

## 手动安装（不通过助手）

```sh
# 1. 安装插件包（pnpm≥10 需先放行 sharp 构建）
dsh plugin --profile web add @debb74/dsh-desktop

# 2. 若 pnpm 阻止 sharp 构建，编辑 $DSH_HOME/profiles/web/pnpm-workspace.yaml：
#    allowBuilds 下加一行  sharp: true，然后重跑 pnpm install

# 3. 重启 dsh web 服务
# 4. 打开设置页 → 插件 → 插件配置 → desktop
```

## 验证安装

| 检查点 | 预期 |
|---|---|
| `pnpm view @debb74/dsh-desktop version` | 输出版本号（如 0.1.0） |
| `dsh plugin --profile web add` 无报错 | 安装成功 |
| 重启后设置页出现 desktop 卡片 | 插件已加载 |
| 卡片显示「壳程序: 已找到」 | 壳已构建（否则需先构建 Tauri 壳） |
