# PureGamma Harness 的 Codex CLI 文本提供商

[English](README.md) | 中文

可选的 `dsh-codex-cli` 提供商通过本机官方 CLI 提供仅文本推理。PureGamma 安装器默认启用[原生 Codex 模型插件](../dsh-codex-cli-models/README.zh.md)，提供浏览器授权和 Harness 工具支持。两者均注册 `codex-cli`，只能启用其中一个。已有依赖保留以便回退。

## 本机认证与配置

安装官方 Codex CLI，并在同一系统用户下使用 `codex login` 登录。每个人都使用自己的 ChatGPT 账号和额度；插件不包含凭据。使用 `codex login status` 检查登录状态。参考[官方 CLI 命令](https://learn.chatgpt.com/docs/cli/reference)。

如需使用此可选提供商，在插件中禁用 `dsh-codex-cli-models` 并手动启用 `dsh-codex-cli` 组合。再次运行 PureGamma 安装器会重新选择原生提供商。在模型菜单选择 **OpenAI Codex CLI (ChatGPT login)** 和 `Codex · CLI default`，由 CLI 选择配置的模型。指定模型 ID 仍受账号权限和已安装 CLI 的支持范围限制。

配置支持用 `binary` 指定 CLI 可执行文件的绝对路径，或在应用启动环境设置 `PG_CODEX_CLI_BIN`。`models` 指定展示的模型 ID，例如 `['codex-default', 'another-model-id']`。

## 推理行为

完整文本历史序列化为 `codex exec --json --ephemeral --sandbox read-only` 请求，在独立临时工作目录执行，不复用跨会话线程，也不经过 shell 插值。取消或超过五分钟时终止进程。提示上限为 1 MiB，响应上限为 8 MiB；缺少 CLI、请求失败、空响应和内容超限均报错，不会静默截断历史。

图片和文件内容会被拒绝。此提供商不桥接 Harness 工具声明或工具调用；CLI 内部工具不会记录为 Harness 工具调用。官方 CLI 管理登录、模型访问和用量限制。此提供商不复制登录文件、token、cookie 或订阅标识。自动测试使用模拟 CLI，不验证特定账号的推理权限。
