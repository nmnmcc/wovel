---
title: Ren'Py 全功能清单与 Web Native 实现方案
description: 按 Ren'Py 文档的 15 类功能，逐项给出 Wovel 的实现方法。
---

> 作者 Yinhao Huang，2026 年 10 月 21 日。

## 概述

本文按 Ren'Py 官方文档的章节，把它的功能分成 15 类逐项列出，每一项给出 Web Native 引擎 Wovel 中的实现方法。三条架构原则贯穿全文：

- **DOM + CSS 渲染**：对话框、菜单、立绘、背景都是 HTML 元素，动画用 CSS 与 Web Animations API；只有着色器、粒子等特效才局部使用 Canvas/WebGL。
- **Markdown 剧本**：剧本格式叫 MDW，即 CommonMark + GFM + frontmatter + 舞台指令 + 插值，其余都是原汁原味的 Markdown。标题是场景（标题文字即场景名），段落是旁白，`**名字**：` 是台词，链接列表是选项，`::指令` 是舞台指令，` ```js ` 代码块是逻辑。
- **Git 式状态**：每推进一步产生一个不可变 commit（执行位置 + 变量 + 声明式舞台状态），存档是 ref，回滚是 checkout 父节点，分支即路线。渲染层只根据状态做 diff 更新 DOM。

每节表格的「Web 实现」一列写的是推荐方案，「难度」分低、中、高三档，用于排期。最后一节给出分阶段路线图。

## 1. 剧本语言与流程控制

剧本语言全部映射到 Markdown 元素，解析用 unified/remark 得到 mdast，再编译成线性指令序列，由一个可序列化的解释器逐条执行。

| 功能                 | Ren'Py 中的形式                         | Web 实现                                                                                                                                    | 难度 |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 标签                 | `label start:`                          | 标题 `# 开场`，按标题文字生成锚点作为跳转目标（与 GitHub、VS Code 规则一致）；lint 检查重名。改标题等于改场景名，存档靠语句内容哈希重新定位 | 低   |
| 跳转                 | `jump x`                                | 单独一行链接 `[→](#x)` 或 `::jump[x]`                                                                                                       | 低   |
| 调用与返回           | `call x` / `return`                     | `::call[x]` / `::return`；解释器维护调用栈，栈本身放入状态 commit                                                                           | 低   |
| 动态跳转             | `jump expression`                       | `::jump{expr="route + '_end'"}`                                                                                                             | 低   |
| 选项菜单             | `menu:`                                 | 只含链接的列表；菜单前的段落作为提问台词                                                                                                    | 低   |
| 条件选项             | `"选项" if cond`                        | 列表项属性 `{if="affection >= 3"}`                                                                                                          | 低   |
| 菜单集合             | `menu (set=...)`                        | `{set=chosen}`，已选项自动隐藏                                                                                                              | 低   |
| 菜单参数与自定义屏幕 | `menu (screen=...)`                     | `{screen="map-choice"}` 指定自定义组件                                                                                                      | 中   |
| 条件分支             | `if/elif/else`                          | 容器指令 `:::if{cond=...}` … `:::` 包裹剧本片段                                                                                             | 中   |
| 循环                 | `while`                                 | `:::while{cond=...}`，或只允许在 JS 代码块里循环                                                                                            | 中   |
| 单行 Python          | `$ x = 1`                               | 行内 `::set{affection="+1"}` 或短代码块                                                                                                     | 低   |
| Python 块            | `python:`                               | ` ```js ` 代码块，在受控作用域（store 代理）里执行                                                                                          | 中   |
| 初始化代码           | `init python:` / `init offset`          | ` ```js init ` 代码块，按优先级在启动时执行，不进入状态                                                                                     | 低   |
| 变量声明             | `default x = 0`                         | frontmatter 的 `defaults:` 或 ` ```js default `；新游戏和读旧档时补齐                                                                       | 低   |
| 常量                 | `define e = Character(...)`             | frontmatter 的 `define:`/`characters:`，不进存档                                                                                            | 低   |
| 存储命名空间         | `store`、`store.xxx`                    | 一个普通对象树，用 Proxy 记录写入，供生成 commit                                                                                            | 中   |
| 文本插值             | `[name]`、`[x!u]`                       | `{name}`、`{x\|upper}`，带过滤器管道                                                                                                        | 低   |
| 文件拆分             | 多个 `.rpy` 文件                        | 多个 `.md` 文件，label id 全局唯一；目录即章节                                                                                              | 低   |
| 等价函数             | `renpy.jump()`、`renpy.call()` 等       | JS API `wovel.jump()`、`wovel.call()`，代码块中可用                                                                                         | 低   |
| pass 与注释          | `pass`、`#`                             | HTML 注释 `<!-- -->`，解析时丢弃                                                                                                            | 低   |
| 剧本内屏幕调用       | `show screen`、`call screen`            | `::screen[inventory]{mode=call}`，返回值写入 `_return`                                                                                      | 中   |
| 生命周期与特殊标签   | `splashscreen`、`after_load`、`quit` 等 | 约定 id：`#splashscreen`、`#after-load`、`#quit`，引擎在对应时机调用                                                                        | 低   |

> 关键约束：解释器状态（执行位置、调用栈、store）必须是纯数据，才能被 Git 式仓库哈希和回滚。

## 2. 显示系统

舞台状态是一份声明式描述（每个图层上有哪些图像、标签、属性、变换），渲染层把它 diff 到 DOM：每个图层是一个绝对定位的 `<div>`，每个图像是一个 `<img>` 或组件。

| 功能           | Ren'Py 中的形式                                  | Web 实现                                                                                             | 难度 |
| -------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---- |
| 图像定义       | `image eileen happy = "..."`                     | frontmatter 的 `images:` 映射，或目录约定 `images/eileen/happy.webp` 自动注册                        | 低   |
| 自动图像       | 按文件名自动定义                                 | 构建时扫描资源目录生成清单（Vite 插件）                                                              | 低   |
| 显示 / 隐藏    | `show`、`hide`                                   | `::show[eileen]{expr=happy at=left}`、`::hide[eileen]`                                               | 低   |
| 清场           | `scene bg room`                                  | `::bg[room]` 清空主图层并设置背景                                                                    | 低   |
| 图像标签与属性 | `show eileen happy`（同标签替换）                | 状态以标签为键，属性集合合并；切换属性时保持位置                                                     | 中   |
| 位置           | `at left`、`xalign` 等                           | 预设位置映射为 CSS 变量（`--x`、`--y`、`--anchor`），用 `transform` 定位                             | 低   |
| 层叠顺序       | `zorder`、`behind`                               | CSS `z-index`，状态里记录顺序                                                                        | 低   |
| 图层           | `master`、`screens`、`config.layers`             | 每层一个 `<div class="layer">`，可配置新增；`::show{layer=overlay}`                                  | 低   |
| 分离图层       | `renpy.add_layer`、`camera`                      | 图层可整体施加变换（镜头移动、震动）                                                                 | 中   |
| 分层图像       | `layeredimage`                                   | 同一容器内叠多张 `<img>`，属性组决定显示哪些部件；条件部件用表达式                                   | 中   |
| 可显示对象     | `Solid`、`Frame`、`Composite`、`Crop`、`Tile` 等 | 分别对应纯色 `div`、CSS `border-image`、嵌套容器、`object-view-box`/`clip-path`、`background-repeat` | 低   |
| 条件图像       | `ConditionSwitch`、`ShowingSwitch`               | 组件根据 store 表达式选择资源，状态变化时重新计算                                                    | 低   |
| 动态图像       | `DynamicDisplayable`、`[var]` 插值的文件名       | 图像路径支持 `{var}` 插值                                                                            | 低   |
| 文本作为图像   | `Text` displayable                               | 直接放 `<span>` 元素                                                                                 | 低   |
| 图像缓存与预测 | image prediction、`config.image_cache_size`      | 静态分析后续若干语句和所有选项分支，用 `new Image().decode()` 预载；LRU 释放                         | 中   |
| 图像处理       | `im.*`、`Transform` 的着色、翻转                 | CSS `filter`、`transform: scaleX(-1)`；复杂处理见第 12 节                                            | 低   |
| 色彩矩阵       | `matrixcolor`（饱和度、色调、亮度）              | SVG `feColorMatrix` 滤镜或 CSS `filter` 组合                                                         | 中   |
| 图像格式       | PNG、JPG、WEBP、AVIF、SVG                        | 浏览器原生支持全部，额外免费获得 SVG 矢量立绘                                                        | 低   |
| 精灵管理器     | `SpriteManager`、`SnowBlossom`                   | 大量小粒子改用单个 `<canvas>` 2D 绘制                                                                | 中   |
| 房间与图片按钮 | `imagemap`、`imagebutton`                        | 绝对定位的 `<button>`，热区用 `clip-path` 或 alpha 采样做像素级命中                                  | 中   |

## 3. 转场与 ATL 动画

ATL 编译成 Web Animations API 的关键帧，转场用 View Transitions API 实现，二者都能在玩家点击时被立即完成（`animation.finish()`）。

| 功能             | Ren'Py 中的形式                                                  | Web 实现                                                                                                                     | 难度 |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---- |
| 内置转场         | `fade`、`dissolve`、`pixellate`、`move`、`ease` 等               | 用 `document.startViewTransition()` 拍下旧画面，配合 `::view-transition-old/new` 的 CSS 动画；不支持时退化为交叉淡化两份图层 | 中   |
| 推拉擦除         | `wipeleft`、`slideright`、`pushup`                               | 新旧画面的 `clip-path: inset()` 或 `translate` 动画                                                                          | 低   |
| 缩放与开合       | `zoomin`、`irisout`、`squares`                                   | `clip-path: circle()`/`polygon()` 动画；`squares` 用 CSS 遮罩                                                                | 中   |
| 遮罩溶解         | `ImageDissolve`、`AlphaDissolve`                                 | CSS `mask-image` + 动画 `mask-position`，或 WebGL 阈值着色器                                                                 | 中   |
| 带参数转场       | `Fade(0.5, 1, 0.5, color=...)`、`Dissolve(t)`                    | 转场是带参数的函数，`::bg[x]{transition="fade(0.5)"}`                                                                        | 低   |
| 转场作用范围     | `with` 语句、`with None`、按图层转场                             | 记录上次 `with` 之后的状态作为旧画面；支持只对某个图层的 view-transition-name                                                | 中   |
| 多重转场         | `MultipleTransition`、`ComposeTransition`                        | 转场函数可组合，按序或并行执行                                                                                               | 中   |
| ATL 基础         | `xalign 0.0` → `linear 1.0 xalign 1.0`                           | 编译成关键帧数组，调用 `element.animate()`                                                                                   | 中   |
| 插值器（warper） | `linear`、`ease`、`easein_back` 等约 30 种                       | CSS `cubic-bezier()` 与 `linear()` 缓动函数可表达全部 Robert Penner 曲线                                                     | 低   |
| 循环与重复       | `repeat`、`block`                                                | `iterations`、嵌套的动画序列                                                                                                 | 低   |
| 并行             | `parallel`                                                       | 多个 `animate()` 同时运行，使用独立的组合属性（`composite: 'add'`）                                                          | 中   |
| 选择分支         | `choice`                                                         | 在编译出的序列里随机挑选，种子来自状态，保证回滚可重放                                                                       | 低   |
| 事件响应         | `on show`、`on hide`、`on hover`                                 | 组件生命周期钩子，`hide` 时延迟移除元素直到动画结束                                                                          | 中   |
| 函数驱动         | `function` 语句                                                  | `requestAnimationFrame` 回调，传入已用时间                                                                                   | 低   |
| 时间控制         | `pause`、`time`                                                  | 关键帧的 `delay` 与 `offset`                                                                                                 | 低   |
| 变换属性         | 约 80 个属性：位置、锚点、缩放、旋转、裁剪、透明度、模糊、着色等 | 位置与缩放旋转用 `transform`，透明度用 `opacity`，裁剪用 `clip-path`，模糊用 `filter: blur()`                                | 中   |
| 可复用变换       | `transform name(param):`                                         | frontmatter 或 `transforms.js` 中注册命名动画，可带参数                                                                      | 低   |
| 状态保持         | 变换在回滚和读档后恢复                                           | 状态只存变换名和参数，读档时直接跳到动画结束态（或从头播放循环动画）                                                         | 中   |

> 注意：动画的中间帧不进 commit；commit 只记录「最终态 + 正在循环的动画」。

## 4. 文本与对话

文本是 Web Native 方案优势最大的部分：浏览器原生处理 CJK 排版、字体回退、换行禁则、ruby 注音和双向文字，引擎只需负责逐字显示和样式标签。

| 功能           | Ren'Py 中的形式                                                  | Web 实现                                                                              | 难度 |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---- |
| 角色对象       | `Character("小雪", color=...)`                                   | frontmatter `characters:`，每个角色生成一组 CSS 变量（名字颜色、对话框样式）          | 低   |
| 旁白与内心独白 | `narrator`、带括号的角色                                         | 普通段落为旁白；角色可定义 `what_prefix`/`what_suffix`，如自动加括号                  | 低   |
| 台词           | `e "你好"`                                                       | `**小雪**：你好`，名字可写显示名或角色 id                                             | 低   |
| 临时名字       | `"???" "…"`、`name` 参数                                         | `**???**：…`；或 `**小雪**{as="神秘少女"}`                                            | 低   |
| 带属性的台词   | `e happy "…"` 同时切换立绘                                       | `**小雪**{expr=happy}：…`，解析为 show + say 两条指令                                 | 低   |
| ADV 模式       | 底部对话框                                                       | `<dialog-box>` 组件，固定在 `screens` 图层                                            | 低   |
| NVL 模式       | `nvl` 角色、`nvl clear`                                          | 全屏文本容器，台词追加到列表；`::nvl-clear`；可按角色或按场景切换模式                 | 低   |
| 打字效果       | `preferences.text_cps`                                           | 按字素簇拆分（`Intl.Segmenter`），逐个设 `visibility`，避免拆散表情符号和组合字符     | 中   |
| 点击继续与暂停 | `{w}`、`{p}`、`{nw}`、`{fast}`                                   | 文本标签解析为显示控制指令，点击等待用 Promise                                        | 低   |
| 延长台词       | `extend`                                                         | `::extend` 或段落以 `+` 开头，接在上一句后继续显示                                    | 低   |
| 样式标签       | `{b}`、`{i}`、`{u}`、`{s}`、`{color}`、`{size}`、`{font}`、`{a}` | Markdown 原生的粗体、斜体、删除线、链接；其余用行内指令 `:span[文字]{color=red}`      | 低   |
| 间距与对齐标签 | `{space}`、`{vspace}`、`{k}` 字距、`{alpha}`                     | CSS `margin`、`letter-spacing`、`opacity`                                             | 低   |
| 自定义文本标签 | `config.custom_text_tags`                                        | 注册行内指令处理器，返回 DOM 片段                                                     | 低   |
| 振假名 / 注音  | `{rb}`、`{rt}`                                                   | 原生 `<ruby><rt>`，语法 `{漢字\|かんじ}`                                              | 低   |
| 字体           | TTF、OTF、字体组 `FontGroup`                                     | `@font-face` + `unicode-range` 实现字体组；CJK 大字体用子集化（构建时按剧本用字裁剪） | 中   |
| 描边与阴影     | `outlines` 样式                                                  | `-webkit-text-stroke`、`paint-order` 与 `text-shadow`                                 | 低   |
| 文本着色器     | `textshaders`（逐字淡入、波浪、抖动）                            | 每个字素一个 `<span>`，用 CSS 动画加 `--i` 索引做延迟；高级效果用 WebGL               | 中   |
| 侧头像         | `side_image`、`SideImage()`                                      | 对话框内的 `<img>`，跟随说话人的当前表情属性自动切换                                  | 低   |
| 对话气泡       | `bubble` 系统                                                    | 绝对定位的气泡组件，锚定到角色立绘或手动坐标；内置可视化编辑器                        | 中   |
| 多人同时说话   | `multiple` 参数                                                  | 多个对话框并排，状态里存为数组                                                        | 低   |
| 文本输入       | `renpy.input()`、`input` 屏幕                                    | 原生 `<input>`，天然支持中文输入法、粘贴和移动端键盘                                  | 低   |
| 文字窗口显隐   | `window show/hide/auto`                                          | 对话框的显示状态写入舞台状态                                                          | 低   |
| 角色回调       | `callback`（打字音、口型同步）                                   | 每个字素显示时触发事件，可绑定音效或嘴型切换                                          | 中   |
| 对话历史       | `history`、`_history_list`                                       | 由 commit 链回溯得出，不必单独维护                                                    | 低   |

## 5. 音频与语音

所有声音走 Web Audio API：每个频道是一条 `GainNode` 链，汇入各自的混音器（音乐、音效、语音），再到主音量。浏览器要求用户手势后才能出声，因此标题画面必须有一次点击来解锁 `AudioContext`。

| 功能           | Ren'Py 中的形式                           | Web 实现                                                                    | 难度 |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------- | ---- |
| 背景音乐       | `play music "x.ogg"`                      | `::music[x]`；长音乐用 `<audio>` 元素接入 `MediaElementSourceNode` 流式播放 | 低   |
| 音效           | `play sound`                              | `::sound[x]`；短音效预解码为 `AudioBuffer`，零延迟                          | 低   |
| 淡入淡出       | `fadein`、`fadeout`                       | `gain.linearRampToValueAtTime()`                                            | 低   |
| 队列           | `queue music`                             | 频道内维护播放列表，`ended` 事件推进                                        | 低   |
| 循环与循环点   | `loop`、`<loop 10.5>`                     | `AudioBufferSourceNode.loopStart/loopEnd` 实现无缝循环和引子段              | 中   |
| 片段播放       | `<from 5 to 10>`                          | `source.start(when, offset, duration)`                                      | 低   |
| 自定义频道     | `renpy.music.register_channel`            | 频道表可配置，指定所属混音器和是否循环                                      | 低   |
| 混音器与音量   | `mixer`、偏好设置中的音量                 | 每个混音器一个 `GainNode`，音量写入全局偏好（不随回滚）                     | 低   |
| 静音           | 按混音器静音                              | 增益设为 0                                                                  | 低   |
| 声像           | `set_pan`                                 | `StereoPannerNode`                                                          | 低   |
| 音频滤镜       | `audio_filters`：低通、高通、混响、延迟等 | `BiquadFilterNode`、`ConvolverNode`、`DelayNode` 直接对应                   | 低   |
| 语音           | `voice "x.ogg"`                           | `::voice[x]`，下一句台词开始时自动停止（可配置保留）                        | 低   |
| 自动语音       | `config.auto_voice`                       | 按语句稳定 ID 推导文件名 `voice/{label}-{n}.ogg`，构建时检查缺失            | 低   |
| 语音维持       | `voice sustain`                           | 指令选项 `{sustain}`                                                        | 低   |
| 角色静音       | 偏好里按角色关闭语音                      | 偏好中存角色黑名单                                                          | 低   |
| 语音重播       | 历史记录中重播                            | 历史条目保存语音路径，点击重播                                              | 低   |
| 音频格式       | OGG、Opus、MP3、WAV、FLAC                 | 全部主流浏览器都支持 Opus 和 MP3；用 `canPlayType` 选择回退格式             | 低   |
| 音乐状态的存档 | 读档时恢复当前音乐                        | 舞台状态里记录各频道的曲目与循环设置，读档后重新播放                        | 低   |
| 音乐鉴赏室     | `MusicRoom`                               | 见第 9 节                                                                   | 低   |

## 6. 视频与 Live2D

视频直接用 `<video>` 元素，比 Ren'Py 的 FFmpeg 解码更省电且支持硬件加速；Live2D 有官方的 Cubism SDK for Web，可原样接入。

| 功能            | Ren'Py 中的形式                            | Web 实现                                                                       | 难度 |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------ | ---- |
| 全屏过场动画    | `renpy.movie_cutscene()`                   | 全屏 `<video>`，点击跳过；返回 Promise                                         | 低   |
| 影片精灵        | `Movie(play=..., mask=...)` 作为立绘或背景 | `<video autoplay muted loop playsinline>` 放入图层，与图片同等对待             | 低   |
| 透明视频        | `mask` 通道视频                            | 首选 WebM VP9 Alpha；Safari 用 HEVC Alpha，或左右并排打包后用 WebGL 合成 alpha | 中   |
| 视频的音频频道  | 影片声音进 `movie` 频道                    | 视频元素接入 Web Audio 的对应混音器                                            | 低   |
| 开始与循环控制  | `start_image`、`loop`、`group`             | `poster` 属性、`loop` 属性；同组视频切换时保持播放位置                         | 低   |
| 视频格式        | WebM、MP4、OGV                             | 输出 WebM（VP9/AV1）与 MP4（H.264）两份，`<source>` 回退                       | 低   |
| Live2D          | `Live2D("hiyori")`，动作与表情作为属性     | Cubism SDK for Web 渲染到图层内的 `<canvas>`；属性映射到 motion 与 expression  | 高   |
| Live2D 动作衔接 | `fade`、`loop`、`update_function`          | SDK 的动作优先级与淡入淡出参数                                                 | 中   |
| 口型同步        | 根据语音音量驱动嘴型                       | `AnalyserNode` 读取语音电平，写入 `ParamMouthOpenY`                            | 中   |
| 其他骨骼动画    | 社区方案（Spine 等）                       | 通过插件接入 Spine Web Player 或 PixiJS，遵循同一 Displayable 接口             | 中   |

> Live2D 的 SDK 有自己的授权条款，引擎只能做适配层，SDK 由作者自行引入。

## 7. Screen Language 与 GUI 定制

屏幕就是 Web Components：引擎内置一套默认组件，作者可以用纯 HTML/CSS 覆盖，也可以用任意前端框架（Lit、Vue、React、Svelte）编写，只要遵守同一个接口——读取 store、触发 Action。

引擎自带的默认界面用 [Foldkit](https://foldkit.dev) 实现：它基于 Effect，采用 Elm 架构，界面状态是一个 Schema 定义的 Model，玩家的操作是 Message，与 Game 服务的交互是 Command。store 对应 Model，Action 对应 Message。

| 功能             | Ren'Py 中的形式                                                                                                                            | Web 实现                                                                                                 | 难度 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---- |
| 屏幕定义         | `screen name(params):`                                                                                                                     | 自定义元素 `<wovel-screen-name>`，或 `screens/*.html` 模板                                               | 中   |
| 布局容器         | `vbox`、`hbox`、`grid`、`fixed`、`frame`、`side`                                                                                           | Flexbox、CSS Grid、绝对定位，一一对应                                                                    | 低   |
| 视口与滚动       | `viewport`、`vpgrid`、`scrollbars`                                                                                                         | `overflow: auto` 容器；`vpgrid` 用虚拟列表                                                               | 低   |
| 基础控件         | `text`、`image`、`button`、`textbutton`、`imagebutton`                                                                                     | 原生元素，键盘与焦点开箱即用                                                                             | 低   |
| 数值控件         | `bar`、`vbar`、`slider`、`AnimatedValue`                                                                                                   | `<input type=range>` 自定义样式，或 `<progress>`                                                         | 低   |
| 文本输入         | `input`                                                                                                                                    | `<input>` / `<textarea>`                                                                                 | 低   |
| 图片地图         | `imagemap`、`hotspot`、`hotbar`                                                                                                            | 绝对定位按钮，热区可像素级命中                                                                           | 中   |
| 屏幕语句         | `use`、`transclude`、`for`、`if`、`showif`、`default`                                                                                      | 模板语法（组件嵌套、插槽 `<slot>`、循环、条件）；`showif` 在显隐时播放动画                               | 中   |
| 屏幕的显示方式   | `show screen`、`call screen`、`hide screen`、`modal`、`zorder`、`tag`                                                                      | 屏幕管理器：模态时在其下层加遮罩并 `inert`；同 tag 互相替换                                              | 中   |
| 交互动作         | `Jump`、`Call`、`Return`、`SetVariable`、`ToggleVariable`、`Show`、`Hide`、`Play`、`FileSave`、`Preference` 等约 100 个                    | `data-action` 属性或 JS 函数 `actions.jump('x')`；每个 Action 声明是否可用、是否选中，用于自动置灰与高亮 | 中   |
| 悬停提示         | `tooltip`、`hovered`/`unhovered`                                                                                                           | `:hover`/`:focus-visible` 样式加 `title` 或自定义浮层                                                    | 低   |
| 快捷键           | `key` 语句                                                                                                                                 | 屏幕内注册键位，挂到全局 keymap                                                                          | 低   |
| 定时器           | `timer`                                                                                                                                    | 屏幕生命周期内的 `setTimeout`，暂停菜单打开时冻结                                                        | 低   |
| 拖放             | `drag`、`draggroup`                                                                                                                        | Pointer Events 实现，支持吸附和 drop 回调；不用 HTML5 原生 DnD（移动端不可靠）                           | 中   |
| 特殊屏幕         | `say`、`choice`、`nvl`、`input`、`main_menu`、`game_menu`、`save`、`load`、`preferences`、`history`、`confirm`、`skip_indicator`、`notify` | 默认组件全套提供，按名字覆盖即可                                                                         | 中   |
| 样式系统         | `style`、继承、前缀 `hover_`、`selected_`、`insensitive_`                                                                                  | CSS 本身；状态前缀映射为 `:hover`、`[aria-selected]`、`:disabled`                                        | 低   |
| 样式属性         | 约 200 个（位置、文本、窗口、按钮、条、盒子）                                                                                              | 对应 CSS 属性，文档提供对照表                                                                            | 低   |
| GUI 快速定制     | `gui.rpy` 的变量（颜色、字体、尺寸）                                                                                                       | 一组 CSS 自定义属性（`--wovel-accent` 等），启动器提供可视化配色器                                       | 低   |
| 分辨率与缩放     | 固定设计分辨率，整体缩放                                                                                                                   | 舞台用固定逻辑尺寸加 `transform: scale()` 等比铺满；UI 可选响应式布局                                    | 中   |
| 屏幕优化         | `const`、预测、`screen_optimization`                                                                                                       | 组件按依赖的 store 键做细粒度更新（signals）                                                             | 中   |
| 通知             | `renpy.notify()`                                                                                                                           | 短暂浮层，`aria-live=polite`                                                                             | 低   |
| 确认框           | `Confirm`、`layout.yesno_prompt`                                                                                                           | 原生 `<dialog>` 元素                                                                                     | 低   |
| 光标             | `config.mouse`、动态光标                                                                                                                   | CSS `cursor: url()`；动画光标用跟随的元素                                                                | 低   |
| 片头与预加载画面 | `splashscreen`、`presplash`                                                                                                                | 首屏 HTML 内联的加载画面（无需等 JS），之后播放 `#splashscreen` 标签                                     | 低   |

## 8. 存档、回滚与持久数据

这一类功能全部由 Git 式状态仓库统一实现：Ren'Py 需要分别维护的存档、回滚日志、历史记录和已读集合，在这里都是同一个 commit 图上的不同查询。

| 功能                | Ren'Py 中的形式                                | Web 实现                                                                               | 难度 |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- | ---- |
| 存档                | `FileSave(slot)`、多页存档位                   | 新建 ref `save/1-3` 指向 HEAD；对象存 IndexedDB                                        | 低   |
| 读档                | `FileLoad(slot)`                               | checkout 该 ref，重建舞台与音频                                                        | 低   |
| 快速存档 / 自动存档 | `QuickSave`、`config.autosave_frequency`       | ref `quick`、`auto/N` 环形覆盖；在选项点和场景切换时自动打点                           | 低   |
| 存档缩略图          | 截图保存在存档中                               | 渲染层截取：用离屏 Canvas 重绘当前舞台（DOM 不能直接截图），存为 WebP 对象             | 中   |
| 存档元数据          | `save_name`、时间、`extra_info`                | commit 的 `meta` 字段，存档界面直接读取                                                | 低   |
| 删除存档            | `FileDelete`                                   | 删除 ref；不可达对象由 GC 回收                                                         | 低   |
| 回滚                | 滚轮上 / PageUp                                | checkout `HEAD^`；只移动指针                                                           | 低   |
| 前滚                | 回滚后滚轮下                                   | 在回滚之前记住原 HEAD，沿该路径前进                                                    | 低   |
| 回滚中改选          | `config.fix_rollback`（禁止或允许重选）        | 允许时产生新分支；固定时选项按原分支锁定                                               | 低   |
| 回滚上限            | `config.rollback_length`                       | 不需要上限；持久化时做浅历史以控制体积                                                 | 低   |
| 不可回滚区段        | `renpy.block_rollback()`、`fix_rollback`       | commit 上标记 `barrier`，回滚到此停止                                                  | 低   |
| 不随回滚的变量      | `NoRollback`、`renpy.retain_after_load`        | 放在仓库之外的「工作区」对象                                                           | 低   |
| 持久数据            | `persistent.xxx`（跨存档、跨周目）             | 独立的 IndexedDB 存储，不进 commit；合并策略可声明                                     | 低   |
| 多游戏共享数据      | `MultiPersistent`                              | 同源下按命名空间共享；跨域时用导出码或账户同步                                         | 中   |
| 已读判定            | `renpy.seen_label`、`seen_image`、`seen_audio` | 持久存储中的已读集合，以语句稳定 ID 为键；用于跳过已读与解锁                           | 低   |
| 存档兼容            | `after_load` 标签、`default` 补齐              | 读档时运行迁移函数，并按语句 ID 与内容哈希重新定位执行位置                             | 中   |
| 存档安全            | 存档签名与可信密钥（8.x 起）                   | 存档是 JSON，不执行代码，因此天然避免 pickle 反序列化风险；导入外部存档时做结构校验    | 低   |
| 存档导入导出与同步  | Ren'Py Sync（上传存档获取口令）                | 导出为单个文件，或生成短口令上传到同步服务；可选 File System Access API 写到本地文件夹 | 中   |
| 路线图              | 无内置，需自行实现                             | commit 图本身即路线图，只需一个可视化组件                                              | 中   |

> 存储配额：调用 `navigator.storage.persist()` 申请持久化存储，避免浏览器在空间紧张时清除存档。

## 9. 玩家体验

这些是玩家每天都会用到的功能，默认组件必须开箱即用；输入统一抽象为「语义动作」（推进、回滚、跳过、菜单），再由键鼠、手柄、触屏分别映射。

| 功能           | Ren'Py 中的形式                                    | Web 实现                                                                                     | 难度 |
| -------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---- |
| 跳过已读       | Ctrl / Tab、`skip` 模式                            | 查已读集合，连续推进并把动画直接 `finish()`；遇到选项或未读停下                              | 低   |
| 跳过全部       | 偏好「跳过未读」                                   | 同上，忽略已读判断                                                                           | 低   |
| 快进到下一选项 | `Skip(fast=True)`                                  | 静态分析找到下一个选项节点，批量执行到该处                                                   | 中   |
| 自动播放       | `auto-forward`，时长按字数                         | 按字素数和语音时长计算等待；语音结束后再推进                                                 | 低   |
| 隐藏界面       | 中键 / H 键                                        | 切换 `screens` 图层的 `hidden`                                                               | 低   |
| 对话历史       | `history` 屏幕                                     | 沿 commit 链回溯生成；点击某句可跳回该点                                                     | 低   |
| 偏好设置       | 全屏、文字速度、自动速度、音量、跳过设置、转场开关 | 偏好对象存 localStorage；全屏用 Fullscreen API；关闭转场时 `prefers-reduced-motion` 一并生效 | 低   |
| 键位           | `config.keymap`、自定义键位                        | 全局 keymap 表，允许玩家重绑定                                                               | 低   |
| 手柄           | 内置手柄支持与焦点导航                             | Gamepad API 轮询；方向键做空间焦点导航（按元素几何位置找最近邻）                             | 中   |
| 触屏与手势     | 点击、长按、`gesture` 映射                         | Pointer Events；左右滑动、双指点击映射为回滚、隐藏界面等                                     | 低   |
| 鼠标滚轮       | 滚轮回滚                                           | `wheel` 事件，带节流                                                                         | 低   |
| 截图           | S 键保存截图                                       | 离屏 Canvas 重绘舞台后下载 PNG；或提示使用系统截图                                           | 中   |
| 剪贴板         | `renpy.copy_to_clipboard`                          | Clipboard API                                                                                | 低   |
| 图片鉴赏       | `Gallery` 类：按条件解锁、逐张浏览                 | 组件读取持久数据中的已见图像集合                                                             | 低   |
| 音乐鉴赏室     | `MusicRoom`：已听解锁、顺序与随机播放              | 组件读取已听音频集合；可选 Media Session API 显示系统媒体控件                                | 低   |
| 场景回放       | `Replay`，从某标签重玩一段                         | 新建临时仓库从该标签开始，结束后丢弃                                                         | 低   |
| 成就           | `achievement` 模块，可对接 Steam                   | 持久数据记录；提供平台适配器接口（Steam、Itch 等）                                           | 低   |
| 年龄与内容分级 | `age` 相关功能                                     | 首次启动的确认屏幕，结果写入持久数据                                                         | 低   |
| 退出与暂停     | 主菜单、游戏菜单、退出确认                         | 网页无「退出」，改为回主菜单；`visibilitychange` 时自动暂停音频并自动存档                    | 低   |

## 10. 无障碍

Ren'Py 需要自己实现朗读和焦点系统，而 DOM 方案可以直接接入操作系统的屏幕阅读器，这是选择 Web Native 的最大理由之一。

| 功能             | Ren'Py 中的形式                        | Web 实现                                                                                                    | 难度 |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| 自动朗读         | `self_voicing`（V 键）                 | 两条路：对话框设 `aria-live`，交给系统屏幕阅读器（NVDA、VoiceOver、TalkBack）；或用 Web Speech API 内置朗读 | 低   |
| 剪贴板朗读       | Shift+C 把文本复制到剪贴板供外部工具读 | 文本本身可选中，外部工具直接读取，无需此功能                                                                | 低   |
| 图像替代文本     | `alt` 属性、`config.descriptive_text`  | 立绘和背景生成 `alt`；可选「描述性文本」旁白，在显示图像时朗读                                              | 低   |
| 键盘可达         | 焦点导航                               | 原生 `tabindex` 与焦点顺序；模态屏幕用 `inert` 锁定焦点                                                     | 低   |
| 文字缩放         | `font_size` 偏好、`font_transform`     | 字号用 `rem`，跟随系统字号；提供易读字体（如 OpenDyslexic）切换                                             | 低   |
| 行距与字距       | `font_line_spacing` 偏好               | CSS `line-height`、`letter-spacing` 变量                                                                    | 低   |
| 高对比度对话框   | `high_contrast` 偏好                   | 一套高对比主题，也响应 `prefers-contrast` 与 `forced-colors`                                                | 低   |
| 减少动态效果     | 偏好中关闭转场                         | 响应 `prefers-reduced-motion`：转场改为即时，屏幕震动关闭                                                   | 低   |
| 单声道音频       | `mono_audio` 偏好                      | 混音末端合成单声道（`ChannelMergerNode`）                                                                   | 低   |
| 语音音量独立调节 | 语音混音器                             | 第 5 节已覆盖                                                                                               | 低   |
| 无障碍菜单       | Shift+A 打开                           | 内置无障碍面板，与偏好设置联动                                                                              | 低   |

## 11. 国际化与翻译

翻译以语句稳定 ID 为键：每种语言一份平行的 Markdown 文件，只覆盖文本，结构（跳转、指令、代码）始终来自原文。

| 功能               | Ren'Py 中的形式                    | Web 实现                                                                                | 难度 |
| ------------------ | ---------------------------------- | --------------------------------------------------------------------------------------- | ---- |
| 对话翻译           | `translate chinese start_xxxx:` 块 | `tl/zh/*.md`：每句以 `<!-- id: start-12 -->` 对应原文；也可导出 XLIFF / PO 交给翻译平台 | 中   |
| 字符串翻译         | `_("…")`、`translate strings`      | UI 字符串表（JSON），用 `Intl.MessageFormat` 风格处理复数与变量                         | 低   |
| 生成翻译文件       | 启动器「生成翻译」                 | CLI `wovel tl extract zh`，增量更新，标出原文已改动的句子                               | 中   |
| 语言切换           | `Language()` 动作，运行中切换      | 只换文本层，执行位置与状态不变；立即重绘当前句                                          | 低   |
| 默认语言           | `config.language`、按系统语言选择  | 读取 `navigator.languages` 匹配                                                         | 低   |
| 按语言替换资源     | `tl/<lang>/` 下的图片与语音        | 资源解析时先查语言目录再回退                                                            | 低   |
| 按语言换字体与样式 | `translate chinese style`          | `:lang(zh)` CSS 选择器                                                                  | 低   |
| 竖排文字           | `vertical` 文本                    | `writing-mode: vertical-rl`，浏览器原生处理标点旋转                                     | 低   |
| 从右到左           | RTL 支持                           | `dir="rtl"`，CSS 逻辑属性（`margin-inline-start` 等）让布局自动镜像                     | 低   |
| 复杂文字排版       | HarfBuzz 整形                      | 浏览器原生整形，阿拉伯文、印地文等无需额外处理                                          | 低   |
| 翻译统计           | 启动器显示未翻译数量               | CLI 输出覆盖率报告                                                                      | 低   |
| 引擎自身翻译       | 默认界面的多语言                   | 默认组件的字符串表随引擎附带                                                            | 低   |

## 12. 渲染与特效

这是 DOM 方案唯一需要「降级到画布」的地方：常规效果用 CSS，自定义着色器用一个按需创建的 WebGL2 图层，保持其余部分仍是 DOM。

| 功能             | Ren'Py 中的形式                                                                                  | Web 实现                                                                                                | 难度 |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---- |
| 基于模型的渲染器 | GL2 渲染器，所有图像是带纹理的网格                                                               | 默认用浏览器合成器（GPU 加速的 CSS 图层）；需要着色器的元素才进 WebGL                                   | 中   |
| 自定义着色器     | `renpy.register_shader`、`shader` 变换属性                                                       | 着色器 Displayable：把源图作为纹理绘制到 `<canvas>`，GLSL ES 3.0 与 Ren'Py 的 GLSL 接近，可提供移植指南 | 高   |
| 网格变形         | `mesh`、`mesh_pad`、`blend` 混合模式                                                             | WebGL 网格；混合模式用 CSS `mix-blend-mode`（加法、正片叠底、滤色等）                                   | 中   |
| 模糊             | `blur` 属性                                                                                      | `filter: blur()`；背景虚化用 `backdrop-filter`                                                          | 低   |
| 色彩矩阵         | `matrixcolor`：`TintMatrix`、`SaturationMatrix`、`BrightnessMatrix`、`HueMatrix`、`InvertMatrix` | 组合为一个 4×5 矩阵，转为 SVG `feColorMatrix`；简单情况用 CSS `filter`                                  | 中   |
| 3D 舞台          | `3dstage`：`zpos`、`camera`、透视                                                                | CSS `perspective` + `translateZ`，镜头即对图层容器施加反向变换                                          | 中   |
| 3D 矩阵变换      | `Matrix` 类、`matrixtransform`、`matrixanchor`                                                   | CSS `matrix3d()`，或 DOMMatrix API 计算                                                                 | 低   |
| 遮罩             | `AlphaMask`                                                                                      | CSS `mask-image`                                                                                        | 低   |
| 像素化           | `pixellate` 转场、像素风缩放                                                                     | `image-rendering: pixelated`；像素化转场用着色器或分步缩放                                              | 中   |
| 粒子             | `SnowBlossom`、`SpriteManager`                                                                   | `<canvas>` 2D 粒子系统，数据驱动（发射率、速度、生命周期）                                              | 中   |
| 屏幕震动         | `hpunch`、`vpunch`                                                                               | 对图层做 `translate` 关键帧动画                                                                         | 低   |
| 高分屏与缩放     | 根据窗口缩放、`config.physical_width`                                                            | `devicePixelRatio` 选择资源倍率（`srcset`），矢量 UI 天然清晰                                           | 低   |
| 帧率与性能       | 动态降帧、`config.framerate`                                                                     | 只在有动画时运行 `requestAnimationFrame`，静止时零开销；只动画 `transform` 与 `opacity` 以留在合成线程  | 中   |
| 渲染器回退       | GL2 → GLES → 软件                                                                                | 无 WebGL 时着色器效果降级为无效果或 CSS 近似，引擎主体不受影响                                          | 低   |
| 自定义渲染       | `Render` 对象、`renpy.render()`                                                                  | 见第 13 节的 Displayable 插件接口                                                                       | 中   |

## 13. 脚本扩展与插件体系

Ren'Py 的扩展点都依赖 Python；在 Web 版里，它们统一成一个 JS/TS 插件接口：`definePlugin({ directives, displayables, actions, textTags, hooks })`。

| 功能             | Ren'Py 中的形式                                                      | Web 实现                                                                   | 难度 |
| ---------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---- |
| 自定义可显示对象 | Creator-Defined Displayables（`render`、`event`、`visit`）           | 组件接口：`mount(el, props)`、`update(props)`、`unmount()`，可用任意框架写 | 中   |
| 自定义剧本语句   | Creator-Defined Statements（`renpy.register_statement`）             | 注册新的 `::指令` 名，提供解析、lint、预测、执行四个函数                   | 中   |
| 自定义文本标签   | `config.custom_text_tags`                                            | 注册行内指令                                                               | 低   |
| 角色回调         | `Character(callback=...)`                                            | 角色事件：`begin`、`show`、`slow_done`、`end`                              | 低   |
| 屏幕中的 Python  | `screen_python`、`renpy.get_screen()`                                | 组件内直接写 JS，访问 store 与 actions                                     | 低   |
| 第三方库         | 纯 Python 包（受限），`python early`                                 | npm 生态全部可用，Vite 打包                                                | 低   |
| 文件访问         | `renpy.open_file`、`renpy.loadable`                                  | `fetch()` 读取资源；`wovel.loadable(path)` 查构建清单                      | 低   |
| 网络请求         | `renpy.fetch()`                                                      | 原生 `fetch()`                                                             | 低   |
| 颜色工具         | `Color` 类（HSV、插值、明暗）                                        | CSS `color-mix()`、`oklch()`，以及一个小型颜色工具函数                     | 低   |
| 配置变量         | 数百个 `config.*`                                                    | 一个类型化的 `wovel.config.ts`，带默认值和 TS 类型提示                     | 低   |
| 回调钩子         | `config.start_callbacks`、`interact_callbacks`、`label_callbacks` 等 | 事件总线：`on('label', fn)`、`on('say', fn)` 等                            | 低   |
| 随机数           | `renpy.random`（回滚安全）                                           | 带种子的 PRNG（如 xoshiro），种子在状态里                                  | 低   |
| 应用内购买       | `iap` 模块                                                           | 平台适配器：Web 端走 Payment Request 或 Stripe，原生壳走商店 SDK           | 中   |
| 剧本沙箱         | 无（Python 代码完全信任）                                            | 加载第三方剧本时代码块在 Web Worker 或沙箱 iframe 中运行                   | 中   |

## 14. 开发工具

工具链围绕一个 Vite 插件和一个 CLI（命令名 `wovel`，包名 `@wovel/cli`）构建：开发服务器负责热更新，CLI 负责新建、检查、翻译和打包。

| 功能           | Ren'Py 中的形式                                                 | Web 实现                                                                                                                   | 难度 |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| 启动器         | Launcher：新建项目、启动、打开目录、选择编辑器                  | `npm create @wovel` 脚手架加 `wovel dev`；之后可做一个网页版启动器                                                         | 低   |
| 项目模板       | 新建项目时选择分辨率、主题色                                    | 脚手架交互式询问，生成配置                                                                                                 | 低   |
| 热重载         | Shift+R 重载脚本，保持当前位置                                  | Vite HMR：剧本变更后重新编译，用语句 ID 重新定位当前 commit，舞台不闪烁                                                    | 中   |
| 脚本检查       | Lint：未定义图像、未知角色、跳转目标缺失、统计字数              | `wovel lint`：同样的检查，外加缺失语音、未翻译句、资源未被引用；输出可接 CI                                                | 中   |
| 错误报告       | 出错时显示回溯，可忽略、回滚或重载                              | 错误覆盖层显示剧本文件与行号（借助 Markdown 位置信息），提供「回滚」「忽略」按钮                                           | 中   |
| 调试控制台     | Shift+O：执行 Python、查看变量、`jump`                          | 浏览器 DevTools 已足够；另暴露 `window.wovel` 并提供一个游戏内控制台面板                                                   | 低   |
| 变量查看器     | Shift+D 开发者菜单中的变量浏览                                  | 开发面板显示 store、当前 commit、ref 列表和 commit 图                                                                      | 中   |
| 图像查看器     | 开发者菜单中的图像加载器                                        | 资源面板列出所有已注册图像，点击即显示到舞台                                                                               | 低   |
| 样式检查       | Shift+I 查看鼠标下的样式与可显示对象                            | DevTools 元素检查器直接可用，这是 DOM 方案的免费红利                                                                       | 低   |
| 交互式导演     | Interactive Director（D 键）：游戏内增删 show、scene、play 语句 | 开发面板里修改舞台后，把对应 `::指令` 写回 Markdown 源文件（通过开发服务器）                                               | 高   |
| 快速跳转       | 启动器中「跳到某个标签」、`--warp` 到某行                       | URL 参数 `?warp=label-id` 或 `?warp=file.md:42`                                                                            | 低   |
| 编辑器集成     | VS Code 的 Ren'Py 插件、Atom、jEdit                             | 先不写 LSP：把 \*.mdw 关联为 Markdown，用 VS Code 内置 Markdown 功能，加 vscode-remark 跑 Wovel 的 lint 规则；详见下方小节 | 中   |
| 自动化测试     | `testcases`：脚本化点击与断言                                   | 内置测试运行器：`run("start").choose("把伞让给她").expect({affection: 1})`；也可用 Playwright 做端到端                     | 中   |
| 统计           | 字数、对话数、选项数                                            | `wovel stats`，按角色、章节统计                                                                                            | 低   |
| 命令行         | `renpy.sh` 的 `lint`、`compile`、`distribute` 等                | `wovel lint`、`wovel build`、`wovel tl`、`wovel stats`                                                                     | 低   |
| 剧本结构可视化 | 无内置                                                          | 从静态分析生成标签与跳转图（Mermaid 或交互式图），这对 Markdown 剧本很容易                                                 | 低   |

### 编辑器支持（暂不写 LSP）

MDW 足够接近纯 Markdown，编辑器支持可以完全用现成工具拼出来，等确有需要再写一个只做补全和悬停的小语言服务器。

| 能力                                                                                 | 来源                                                      | 配置                                                                                |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 跳转链接的标题补全、跨文件跳转目标校验、跳到标题、查找引用、重命名标题时同步更新链接 | VS Code 内置 Markdown 语言功能                            | `files.associations` 把 `*.mdw` 关联为 `markdown`；开启 `markdown.validate.enabled` |
| 未定义角色、未知图像与表情、未知指令、资源缺失、场景重名、不可达场景、缺失语音       | 自写 remark-lint 规则，打包为 `@wovel/lint`               | `wovel lint` 与 CI 中运行；编辑器内由 vscode-remark 扩展实时显示                    |
| 语法高亮                                                                             | Markdown 高亮即可；指令行可用一小段 TextMate 注入语法着色 | 可选                                                                                |
| 格式化                                                                               | Prettier 的 Markdown 解析器                               | `overrides` 把 `*.mdw` 交给 `markdown` 解析器                                       |
| 从这里运行、剧本结构图、与游戏双向同步                                               | 轻量 VS Code 扩展（命令 + Webview），不涉及 LSP           | 阶段 3                                                                              |
| 指令名、图像表情、变量的补全与悬停                                                   | 以后按需写小型语言服务器，复用 `@wovel/parser`            | 暂缓                                                                                |

> 扩展名：`.mdw` 和 `.md` 都支持。`.mdw` 文件无需声明即被识别为剧本，编辑器里关联为 Markdown 即可；`.md` 文件在 GitHub 上直接渲染，所有 Markdown 工具零配置可用，Wovel 通过 `wovel.config.ts` 中声明的剧本目录判断哪些 `.md` 是剧本，避免误把 README 当成剧本。

## 15. 打包发布与平台

Web 是第一平台，构建产物是一个静态站点；其他平台都是在它外面套壳，引擎代码不变。

| 功能                    | Ren'Py 中的形式                              | Web 实现                                                                      | 难度 |
| ----------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- | ---- |
| Web 发布                | Ren'Py Web（WebAssembly 移植，标注为测试版） | `wovel build` 输出静态目录，可直接部署到 itch.io、GitHub Pages、任意 CDN      | 低   |
| 渐进式下载              | Web 版按需加载资源                           | 资源按章节分包，Service Worker 按剧本进度预取                                 | 中   |
| 离线与安装              | 无                                           | PWA：Web App Manifest + Service Worker 缓存，可安装到桌面和手机主屏           | 中   |
| Windows / macOS / Linux | 原生打包                                     | Tauri（体积小）或 Electron（兼容性好）壳；存档写入用户目录                    | 中   |
| Android                 | RAPT 打包 APK/AAB                            | Capacitor 或 TWA（Trusted Web Activity）打包上架                              | 中   |
| iOS                     | Xcode 工程                                   | Capacitor 壳                                                                  | 中   |
| ChromeOS / 树莓派       | 专门支持                                     | 浏览器版直接运行                                                              | 低   |
| Steam 发布与集成        | Steamworks 支持（成就、云存档、覆盖层）      | 桌面壳内接 Steamworks（如 steamworks.js），走第 9 节的成就适配器              | 中   |
| 资源打包与加密          | RPA 归档                                     | 构建时哈希命名与压缩；Web 上无法真正加密，可选混淆                            | 低   |
| 资源压缩                | 启动器「优化资源」（PNG、OGG 处理）          | 构建时自动转 AVIF/WebP、Opus，按设备 DPR 生成多尺寸                           | 中   |
| 更新器                  | Ren'Py Updater（增量更新）                   | Web 版刷新即更新；Service Worker 检测新版本后提示重载；桌面壳用 Tauri updater | 低   |
| 下载器                  | 移动端按需下载大体积资源包                   | 同「渐进式下载」，配合 Background Fetch API 做大包下载                        | 中   |
| 构建配置                | `build.classify`、`build.archive`            | `wovel.config.ts` 的 `build` 字段：包含与排除规则、分包策略                   | 低   |
| 应用图标与启动画面      | 各平台图标                                   | 由一张源图生成 favicon、manifest 图标和各平台图标                             | 低   |
| 存档位置                | 按平台的存档目录                             | 浏览器 IndexedDB；桌面壳可切换到文件系统，并提供导入导出                      | 低   |

## 16. 实现路线图

先把解释器和状态仓库做对，其余功能都建立在它们之上；表格中标为「高」难度的三项（自定义着色器、Live2D、交互式导演）全部放在最后。

实现进度见[实现进度](/docs/progress/)。

阶段 1 的三个模块决定了后续所有功能的形状：解释器状态不可序列化，回滚和存档就无从谈起；舞台不是声明式的，读档重建画面就会处处特判。

## 参考来源

- [Ren'Py 官方文档目录（index.rst）](https://github.com/renpy/renpy/blob/master/sphinx/source/index.rst)：本文的功能分类按其全部章节逐一核对
- [npm 上的 renjs 包](https://npmjs.com/package/renjs)：最初的暂定名 RenJS 已被一个基于 Phaser 的同类引擎使用，因此改名 Wovel
