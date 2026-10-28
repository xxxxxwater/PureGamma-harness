# PureGamma Harness × REA 桌面安装与启用

PureGamma Harness 集成的是 **`dsh-rea-bundle` 原生 Cordis 插件**，而不是
REA Git 仓库的 CLI 根包。目标是在 Desktop 会话中使用
`mcp__rea__*` 本地逆向工程工具。

## 固定版本

| 项目 | 当前值 |
| --- | --- |
| 插件 | `dsh-rea-bundle@0.2.0` |
| 默认安装地址 | `https://github.com/xxxxxwater/rea/releases/download/dsh-v0.2.0/dsh-rea-bundle-0.2.0.tgz` |
| 实际写入的依赖 | `file:../../bundled-plugin-archives/dsh-rea-bundle-0.2.0.tgz`（先下载并校验下方 SHA-256，不匹配则中止安装） |
| 已发布归档 SHA-256 | `011e78aebde2b71577286869b65719af83de888e01313445e744999d78844630` |
| 插件依赖的 REA 引擎 | `rea-agents@6.4.0` |
| 另一种 Git 发行标签 | `https://github.com/xxxxxwater/rea#dsh-plugin-v0.2.0` |

REA 的 `main` 已领先于该稳定插件绑定的引擎版本；更新 Git 主干
**不会自动让插件运行新版引擎**。待新插件发布并测试通过后，再升级版本。
不要直接使用不带标签的 REA 仓库根目录，也不要放宽
`pnpm allowBuilds`。仓库根包含构建钩子，不是 Harness 原生插件。

## Intel Mac / Apple Silicon / Windows 安装

1. **完全退出** PureGamma Harness / DeepSeek Harness。
2. 使用安装包附带的 `Install PureGamma Harness`。
   安装器使用应用内置 Node/pnpm，将 Desktop Profile 和锁文件
   备份到 `~/.dsh/pg-harness-backups`。
3. 如果没有 REA 插件依赖，安装器添加经过版本固定的 `dsh-v0.2.0`
   独立插件压缩包地址；首次获取依赖需要网络。
4. **安装器还会把 `dsh-rea-bundle` 追加进
   `dsh.profile.bundles`**。只在 `dependencies` 中有包名并不足以启用，
   必须让 Cordis 合成 `rea-launcher` 和 `rea-mcp`。
5. 完全重启 Desktop，打开新会话检查 `mcp__rea__*` 工具。

### 已安装成功，但没有启用

例如你的 Desktop 配置有 `dsh-rea-bundle` 依赖、pnpm 日志成功，
却没有该 `dsh.profile.bundles` 项。这不是 REA 引擎损坏。
优先在 **插件 → 已安装插件 → dsh-rea-bundle** 中打开开关。
如 UI 无法操作，**无需重新安装整套插件**：完全退出 Desktop，
直接用 PureGamma 的本机激活工具修复选择列表。该命令只操作已安装且
入口可解析的 REA，失败时保持原文件不变：

~~~sh
# 本机已有 Node.js 且已克隆本仓库：
node pg-harness/rea-plugin.mjs --status
# 完全退出 Desktop 后：
node pg-harness/rea-plugin.mjs --activate
# 重新启动 Desktop 后：
node pg-harness/rea-plugin.mjs --verify
~~~

安装版的 Intel Mac 不需要额外安装 Node，可调用应用内置的 Electron Node：

~~~sh
APP="/Applications/PureGamma Harness.app"
# 完全退出应用后：
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/PureGamma Harness" \
  "$APP/Contents/Resources/pg-harness/rea-plugin.mjs" --activate
~~~

成功激活会打印原始 `package.json.rea-backup-...` 的绝对路径。
脚本不会修改 `pnpm-lock.yaml`、其他依赖、凭据或现有 bundle 顺序，
重复运行不会再次写入。要回滚，请在应用退出后使用备份恢复
`package.json`。也可以继续运行 PureGamma 配套安装器，但它可能
进行整套依赖检查，因此不是此场景的首选。

安装器不会覆盖已有 REA 依赖来源、版本或其他插件，只会对没有启用
的 REA 追加一次，保留原数组顺序、配置、会话和凭据。
运行 PureGamma 安装器意味着你主动同意启用其配套插件；
若想长期关闭 REA，请安装完成后在 UI 关闭，且不要重新运行安装器。

## 本地只读诊断

源码环境有 Node.js 时：

~~~sh
node pg-harness/rea-plugin.mjs --status
# 重启 Desktop 后：
node pg-harness/rea-plugin.mjs --verify
~~~

macOS 安装版可以直接调用应用内置 Node，**不需要系统 Node 或全局 dsh CLI**：

~~~sh
APP="/Applications/PureGamma Harness.app"
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/PureGamma Harness" \
  "$APP/Contents/Resources/pg-harness/rea-plugin.mjs" --status
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/PureGamma Harness" \
  "$APP/Contents/Resources/pg-harness/rea-plugin.mjs" --verify
~~~

两条命令只读，不修改本地文件。它们检查依赖是否登记、是否被选中、
插件配置与 REA 脚本是否可解析，以及重新生成的 `cordis.yml`
是否有正确项目和新的时间戳。即使 `--verify` 成功，
**也不等于已确认 MCP 子进程运行或 170 个工具均可用**；
仍需在真实桌面会话检查 `mcp__rea__*`。

如果 `$DSH_HOME/cordis.patch.yml` 仍有旧的 `rea-mcp` 行，
其全局优先级可能覆盖新插件。诊断程序会报告，但**不会自动删除**；
请先备份该文件、仅清理旧 REA 冲突配置。
如果依赖尚未正确安装，检查 Desktop 安装日志并使用配套安装器补齐，
不要通过允许不安全构建脚本来掩盖问题。

## 验证范围

本次仅更新 GitHub 源码，未操作你的 Mac 或任何服务器，
也没有发布新的桌面安装包。
回归测试覆盖首次添加、漏启用迁移、重复执行、保留用户依赖、
畸形配置拒绝、旧全局配置遮蔽及 Cordis 旧文件识别。
独立 CI 会在 Linux 校验发布归档和运行入口，
但 Intel macOS Electron GUI 与真实会话仍需实机验收。
