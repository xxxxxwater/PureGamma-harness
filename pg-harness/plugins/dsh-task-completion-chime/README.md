# Task completion chime

English | [中文](README.zh.md)

A native macOS PureGamma Harness plugin. Each successfully completed top-level conversation turn plays one generated, approximately one-second, two-note chime, including while the app is in the background.

Only newly appended `turn/end` completion events notify. Tools in progress, stopped or failed turns, waiting for user action, subagent completion, and restored history stay silent. Each successful turn in a multi-turn task can notify separately. Playback errors are logged without affecting the conversation.

Enable or disable `dsh-task-completion-chime` in Plugins. Mac system volume and mute settings control audibility. The installer enables this package only on macOS.

To adjust volume, add the following to the desktop profile's `cordis.patch.yml`:

```yaml
- id: task-completion-chime
  config:
    volume: 0.7
    playbackTimeoutMs: 5000
```

`volume` ranges from 0 to 1. The generated audio needs no network or third-party runtime dependency and reads no conversation content or credentials. Unloading stops and waits for owned sound processes.
