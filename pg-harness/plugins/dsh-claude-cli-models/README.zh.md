# Claude CLI 模型插件

[English](README.md) | 中文

这个可选的 PureGamma Harness 插件使用本机官方 Claude CLI 账户。安装 Claude Code，在终端运行 `claude auth login`，然后在 Harness 会话模型菜单中选择 **Claude CLI · claude.ai account**。插件从 Claude 自己的模型选择器读取当前账户的选项，并每分钟刷新一次。

Claude CLI 自己管理登录、令牌保存和续期。插件不读取或复制凭据，并从子进程环境中排除已有的 Anthropic API Key。模型出现在列表里不代表请求一定成功；只有完成的响应才能验证访问权限。即使会话已过期，`claude auth status` 也可能报告留存的登录记录。

当前版本传递文本会话历史并返回文本响应。它禁用 Claude 内置工具，防止 Claude 绕过 Harness 审批去修改文件或运行命令。此提供商暂不支持 Harness 工具调用和图片。已有的 Anthropic API Key 路由仍独立保留。

Anthropic 要求第三方产品在提供 claude.ai 登录或订阅额度前取得批准。此插件只应在获批的集成中启用。本机 PureGamma Harness 的所有者已确认此安装获得批准。
