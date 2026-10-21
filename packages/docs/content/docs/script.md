---
title: MDW 剧本语法
description: MDW 是 CommonMark + GFM + frontmatter + 指令 + 插值。
---

MDW 就是 Markdown。`.mdw` 文件一定是剧本；`.md` 文件要在插件里打开 `markdown: true` 才会当成剧本。

## Frontmatter

```yaml
---
title: 雨夜 # 游戏标题
start: 开场 # 起始场景，默认是第一个文件的第一个场景
defaults: # 变量和初始值；读旧存档时补上缺少的变量
  affection: 0
characters:
  xue:
    name: 小雪
    color: "#e7b7d8" # 名字的颜色
    image: xue # 带表情台词使用的图像标签，默认是角色 id
    prefix: "（" # 每句前后自动加的文字
    suffix: "）"
  me: 我 # 只写名字也可以
images: # 手动登记的图像；通常用 images/ 目录自动登记
  bg sky: https://example.com/sky.webp
audio:
  theme: /music/theme.ogg
---
```

多个文件的 frontmatter 会合并。

## 场景

任何级别的标题都是一个场景，标题文字就是场景名。跳转目标用 GitHub 的锚点规则：`# 开场 问话` 的 id 是 `开场-问话`。场景名重复会报错。

场景会顺序落入下一个场景，和 Ren'Py 的 label 一样。文件结束时相当于 `::return`；调用栈为空时游戏结束。

## 旁白与台词

```md
雨下得很大。
街上没有人。

**小雪**：你好。
**小雪：**冒号写在粗体里也可以。
**xue**：用角色 id 也行。
**???**：没登记的名字照原样显示。
**小雪**{expr=smile at=left}：先换成笑脸、站到左边，再说话。
**小雪**{as="神秘少女"}：这一句临时换个名字。
```

- 一个段落是一句。段落里的换行在两个中日文字之间会被去掉，其他地方变成空格。
- `+ 文字` 接在上一句后面继续显示（延长台词）。
- 粗体、斜体、删除线、行内代码、链接都按 Markdown 显示。
- `:span[文字]{color=red size=1.2em}` 给一段文字加样式。

## 插值与注音

| 写法             | 含义                                             |
| ---------------- | ------------------------------------------------ |
| `{name}`         | 变量或任意 JS 表达式的值                         |
| `{name\|upper}`  | 加过滤器：`upper`、`lower`、`capitalize`、`trim` |
| `{明日\|あした}` | 竖线后面不是过滤器时，就是 ruby 注音             |

## 选项

只含链接的列表就是选项菜单。菜单前紧挨着的那一句是提问，会和菜单一起显示。

```md
::menu{set=asked}

我手里只有一把伞。

- [把伞让给她](#让伞)
- [问她的名字](#名字){if="affection >= 1"}
- 和她一起等雨停
  ::set{affection="+1"}

  **小雪**：嗯，一起等吧。
```

- `{if="…"}` 是条件，条件为假的选项不显示。
- 不是链接的选项，下面缩进的内容就是选了它之后执行的语句，执行完接着走菜单后面的内容。
- 菜单前的 `::menu{set=变量}` 让选过的选项隐藏；选过的选项文字记在这个变量里。
- 没有可选的选项时，菜单会被跳过。

## 跳转与调用

```md
[→](#结局) 单独一行的链接就是跳转
::jump[结局]
::jump{expr="route + '-end'"} 跳到表达式算出的场景
::call[回忆] 调用，场景结束或 ::return 时回来
::return
::end 结束游戏
::pause 不显示新台词，等一次点击
```

## 变量与逻辑

```md
::set{affection="+1" met="true" name="'阿远'"}
```

`+数字` 和 `-数字` 是增减，其他值是 JS 表达式。要赋一个负数，写成 `(-1)`。

````md
```js
visits = (visits ?? 0) + 1
if (visits > 3) wovel.jump("厌倦")
```
````

- 代码块里直接读写变量。新名字会成为变量，不会变成全局变量。
- 变量必须是 JSON：字符串、数字、布尔、null、数组或普通对象。
- `wovel.random()` 是可回滚的随机数，`wovel.jump(场景)`、`wovel.call(场景)` 在代码块结束后跳转。

## 条件与循环

```md
:::if{cond="affection >= 2"}
**小雪**：下次见。
::elif{cond="affection >= 1"}
**小雪**：雨停了呢。
::else
雨一直下。
:::

:::while{cond="count < 3"}
::set{count="+1"}
又过了一分钟。
:::
```

## 舞台

```md
::bg[street]{transition=fade} 背景，同时清掉 master 图层的立绘
::show[xue smile]{at=left transition=dissolve}
::show[xue]{expr=sad} 换表情，保持位置
::hide[xue]{transition=dissolve}
```

- 图像名是「标签 属性…」，例如 `xue smile`。找不到 `xue smile` 时用 `xue`，再找不到就显示占位框。
- 位置：`farleft`、`left`、`center`、`right`、`farright`，或任何 CSS 长度如 `30%`。
- 转场：`dissolve`（0.5 秒）和 `fade`（经过黑场，1 秒）。

## 声音

```md
::music[rain] 默认循环
::music[theme]{loop=false}
::sound[door] 播放一次
::voice[xue-001]
::play[wind]{channel=ambient loop}
::stop[music]
```

## 其他

- HTML 注释 `<!-- -->`、分割线会被忽略。
- 其他语言的代码块、表格、引用块会被忽略，并给出警告。
- 不认识的指令会报错，并给出文件和行号。
