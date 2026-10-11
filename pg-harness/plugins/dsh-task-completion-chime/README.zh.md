# 任务完成提示音

[English](README.md) | 中文

PureGamma Harness 的本机 macOS 插件。每次会话正常完成一轮任务后，播放一次约一秒的双音“叮咚”，在后台也会播放。

只监听新产生的 `turn/end` 完成事件。工具调用中途、停止、报错、等待操作、子代理结束及加载历史会话不响。多轮任务每轮正常完成时分别提醒；播放失败只写日志，不影响会话。

在“插件”中启用或禁用 `dsh-task-completion-chime`。音量受 Mac 系统音量和静音状态影响。安装器仅在 macOS 启用此插件。

如需调音量，可在桌面 profile 的 `cordis.patch.yml` 中加入：

```yaml
- id: task-completion-chime
  config:
    volume: 0.7
    playbackTimeoutMs: 5000
```

`volume` 范围为 0–1。音频由本插件生成，无网络请求、无第三方运行依赖，也不读取会话内容或凭据。卸载会停止并等待所有自有播放进程。
