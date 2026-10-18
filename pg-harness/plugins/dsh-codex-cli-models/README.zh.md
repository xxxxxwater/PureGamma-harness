# Codex CLI 模型插件

[English](README.md) | 中文

适用于 PureGamma Harness 0.2.1-alpha.2，已在 macOS 完成真实运行验证。启用前，请在同一设备、同一系统用户下安装官方 Codex CLI。在设置中打开 **Codex CLI**，点击 **使用 ChatGPT 登录**。浏览器完成授权后，在会话底部的模型菜单选择 **Codex CLI · ChatGPT** 下的模型。已有本机 Codex CLI 登录时会自动识别。安装插件不会修改已有会话的模型选择或全局 Codex 模型配置。

每个人都需登录自己的 ChatGPT 账号，并使用自己账号的额度。插件不包含任何账户、订阅、API key、登录文件或个人会话。设置面板提供重新登录、切换账号、浏览器继续授权链接，以及取消未完成授权的入口。

模型目录来自官方 `codex app-server` 的 `model/list`。该目录返回的所有非隐藏模型均可选择，包括本机 Harness 目录尚不认识的模型 ID；新 ID 使用 Codex Responses 适配器配置，并采用 CLI 返回的上下文或输出限制。这是 Codex CLI 模型目录，并不表示常规 ChatGPT 应用中显示的每个模型都能通过 Codex 使用。模型列出不代表账号有推理权限或剩余额度，实际请求可能返回账号额度限制。官方 CLI 管理登录与续期；插件读取其请求凭据，不向页面返回 token、不复制到 Harness 配置、不写入 CLI 登录文件。

请求消耗当前账号共享的 Codex / ChatGPT Work 工作额度，不使用普通 ChatGPT 聊天消息额度或 OpenAI API 余额。可在官方用量页面或 Codex CLI `/status` 查看剩余额度；Harness 的 token 统计不能换算为订阅额度。参考[官方用量说明](https://learn.chatgpt.com/docs/pricing)。

宿主现有 PiAiAdapter 将完整 Harness 历史、工具调用、推理和图片转换成 Codex Responses 请求。Harness 继续执行和审批工具；插件不会为每条消息启动另一个 Codex 智能体。账号 HTTP 接口使用宿主 Connection 的认证和来源检查。

可选配置：`cliPath` 为绝对可执行路径，`cliHome` 为已有 CLI 登录目录。默认遵循 `CODEX_HOME`，否则为 `~/.codex`。此版本要求 ChatGPT 凭据保存在 `auth.json`；仅使用系统钥匙串时会明确报告登录错误，不会转用环境中的 API key。未安装 CLI 时，需先安装才能加载宿主插件。

禁用或卸载会释放模型入口、设置面板和 CLI 子进程，保留本机 CLI 登录。安装器用此提供商替换早期仅支持文本的 `dsh-codex-cli` 插件组合，保留旧依赖并备份配置以便回退。两者都使用 `codex-cli`，不能同时启用。

协议参考：[Codex app-server](https://learn.chatgpt.com/docs/app-server)。
