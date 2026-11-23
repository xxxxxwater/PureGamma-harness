---
description: "PureGamma Harness 品牌与默认首页点击浮出的像素鲸鱼。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

## 概述

随产品提供的 Web 与 Desktop 组合加载本包，在空白首页播放点击触发的像素鲸鱼动画。`official` 客户端构建在侧栏和会话首屏显示 PureGamma Harness 品牌。其他 profile 使用外壳和首屏的默认内容。背景只持有临时 Canvas 资源，不增加模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随产品提供的 Web 与 Desktop 组合默认挂载本插件。插件挂载即可启用首页反馈。`official` 客户端构建还会注册 PureGamma 品牌。

### 选择 profile

`DSH_CLIENT_BUILD_PROFILE` 决定渲染哪个品牌。`official` 构建在侧栏显示 PureGamma 燕形标志和产品名，并在会话首屏显示燕形标志。其他取值使用外壳的默认标志和本地构建标签，首屏使用 `dsh-client-ui-conversation` 提供的默认内容。各构建 profile 共用首页背景。

### 首页反馈

默认首页保持留白，主按钮点击空白处才播放一次浅灰色鲸鱼跃起。每次播放结束后的点击在点阵与代码填充之间交替，首次为点阵；两种填充使用相同的大幅动态轮廓。动画持续 5.7 秒，随后清空。连续点击不会打断当前播放。点击由鲸鱼的 frame 层自己判定：外框内部的留白可触发播放，包括输入卡片两侧的空白；输入框、控件、输入卡片、portal 出去的浮层以及结束文字选择的点击都不触发。Canvas 不获取焦点或指针事件，点击由外框接收。窄屏首页中的鲸鱼保留较大比例，在 Canvas 边缘裁切，不增加横向滚动。减少动态效果偏好会禁用它，离开空白首页时释放动画与观察器。

鲸鱼使用非常浅的主题中性色，呈现轻微的背景隐纹；代码文字的对比度略高于点阵。水花保留细小颗粒并使用较深的颜色，尤其是入水时左侧的水花。随包帧图提供动作，首次符合条件的点击时由浏览器经插件 asset 路由加载一次。代码填充使用密排的 7px 文字，内容只来自预设的代码标语，出水与入水时文本随动态轮廓裁切。解码或像素读取失败时停止装饰，首页仍可正常使用，并在日志中提示重新加载。

图形参数固定，本行不接受配置。这是内置呈现，没有需要单独安装的 Bundle 或插件页面开关。

### 替换品牌

使用自有品牌时，可组合另一个占据侧栏和首屏标志 slot 的包。如需提供首页反馈，该包还可占据 `conversation.hero.frame` 层。品牌图形由 slot 组合决定。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

侧栏品牌成组注册。嵌套的 `ctx.slots.inject()` 调用等待侧栏的两个声明，任一声明撤回时会移除整组品牌。首屏标志还会等待自身声明。独立的 `conversation.hero.frame` 层持有 Canvas 绘制器，通过 `ctx.slots.inject()` 等待声明。`hero` 为 true 时以负 `z-index` 绘制 Canvas，位置在 Conversation 背景之上、所有 Conversation 内容之下。外框内、控件和输入卡片外的主按钮点击可触发播放。portal 浮层上的点击和结束文字选择的点击不会触发播放。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)，Node 半部是空的 Loader 席位。[帧图](src/client/assets/breach-atlas.webp) 取自用户提供的[展示视频](https://yinghuo-hg.deepseek.com/wuyexinrui/dev-cpu/web-showcase/orca.mp4) 的 1.5–7.2 秒，以每秒 24 帧采样为 192 × 108 个单元，并以无损 WebP 存储。红色与绿色通道以 32 级分别编码圆点半径和不透明度。绘制器在首次符合条件的点击后读取一次。`DSH_CLIENT_TITLE` 在构建时决定浏览器标题。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌面不够用时阅读以下页面。它们从本包占据的 slot 进入渲染这些 slot 的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md)——在首屏声明 `conversation.hero.brand.mark`，以及本包占用的 `conversation.hero.frame` 层。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)——浏览器插件行如何加载并注册 slot。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了品牌呈现的供给方式。它们是当前包约束，不是品牌设计对比或任务积压。

- **只有一组填充**——替代呈现属于占据相同 slot 的另一个 Cordis 包。
- **装饰绘制需要 Canvas 2D**——上下文不可用或偏好减少动态效果时，首页保持留白。
- **浏览器标题独立**——`DSH_CLIENT_TITLE` 在构建时选择标题文本，而非通过 UI slot。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
