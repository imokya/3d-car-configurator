# X 爆款拆解 + 发布文案（Car Configurator）

> 目标账号：@xingar_dev ｜ 项目：tsl-car-conf（Astra + Blender 建模 / three.js WebGPU 渲染 / creative coding）
> 生成日期：2026-09-22

---

## 一、X 上这个赛道的爆款长什么样

我扒了 Astra + 3D 赛道近三周真正跑出量的帖子，最直接的参照物是 **@ashebytes** 那条（同类里数据最好、也被最多大号转发）：

> **@ashebytes**
> I used GPT-6 Astra to create a 3D website that pulls apart a Tesla Model X into **334 modeled pieces**
> we are in a **renaissance**…

同赛道的其他爆款（按传播量级排）：

| 账号 | 内容 | 爆点数字 / 原句 |
|---|---|---|
| @ashebytes | Tesla Model X 拆解成 334 个部件，可点击查说明 | **334 modeled pieces**（+ 后续人体 2,234 件） |
| @anshuc | 45 分钟做出可玩 3D 游戏 | "dude GPT-6 Astra is some kind of **turbo-AGI machine god**... It one-shot this in **45 minutes** for hardly a couple % of my quota. The trick is image gen. **I'll share the process below.**" |
| @NFT_Chen / SuSu | 24 分钟用 Three.js 还原整座杭州 | **24 分钟**、西湖/雷峰塔/龙井茶山、昼夜切换 |
| @rileybrown | 浏览器版 CoD-like FPS | "**I'm in disbelief right now.** 12 months ago I remember making flappy bird with AI in 2-3 prompts... Now it can make a call of duty game." |
| @tomkrcha | 老火车图纸 → Blender 模型 | **3,295 editable objects**，60fps |
| @Yokohara_h | 一张街景照 → Blender 3D 场景 | "**不用人手来做 3D 的时代开始了**" |
| @superalesha | 霓虹赛道未来赛车原型（Three.js + Blender 车模） | "Astra used Blender for the car models even though I didn't ask" |
| @xikhar | 浏览器赛车游戏（three.js + Blender 车模） | "**下一部 GTA 会由 AI 做出来**" |

### 这些帖子共用的四段式结构

```
① 第一句：工具 + 动作 + 硬数字        ← 决定这条推文能不能被截图传播
② 第二句：升维感叹（一句时代感的话）  ← 决定愿不愿意转发
③ 视频 / GIF 同帖                     ← 决定完播率
④ 技术栈与过程                        ← 放在正文末尾或首发回复
```

**关键规律（这是重点）：没有硬数字的同类帖，全部没跑起来。** 334 pieces、45 minutes、24 分钟、3,295 objects、2048 star systems——数字是这类帖子的传播货币，因为它同时承担了"可信度"和"可引用性"。

---

## 二、你手上可以直接用的真实数字

这些是我从你的工程里实测出来的，不是编的，可以放心写进推文：

| 指标 | 数值 | 用法 |
|---|---|---|
| 三角形 | **992,628**（≈ 100 万） | 主推的头部数字 |
| 建模部件（mesh pieces） | **96** | 对标 334 pieces 那句 |
| 材质 | **36**（含 clearcoat / transmission / IOR 实体材质） | 技术可信度 |
| 资产体积 | **4.19 MB**（Draco 压缩，原始 17 MB） | "hand-optimized for the web" |
| 流线线条 | **34 条**程序化生成（TSL） | creative coding 卖点 |
| 车漆配色 | 6 色 + 水墨扩散换色动画 | 视觉钩子 |
| 相机机位 | 5 个（Overview / Front / Wheels / Aero / Cockpit） | 展示交互深度 |
| 主文件代码量 | main.js 1,820 行 / 全工程 2,648 行 | "one file of node graphs" |

> ⚠️ **关于帧率**：帖子里不要写具体 fps，除非你在自己机器上实测过。改写"runs in a single browser tab"就没风险。真要写，先跑一次实测填进去。

---

## 三、主推文案（直接用）

### 方案 A｜数据流 · 对标 @ashebytes（**推荐，最贴合你的项目**）

```
I built a car configurator that runs in one browser tab.

Blender for the model. three.js + WebGPU for the render. GPT-6 Astra as the pair programmer.

992,628 triangles. 96 modeled parts. 36 materials. 4.19 MB.

Not a single line of GLSL — every material is a TSL node graph.

Watch the paint pour. ↓

[你的 demo 链接]
```

**为什么这样写**：第一句就给了"一个浏览器标签页里跑完整配置器"这个可截图结论；中间三行是硬数字墙，对标 334 pieces 的节奏；"Not a single line of GLSL" 是给 creative coding 圈子的技术钩子（TSL 是他们的心头好）；"Watch the paint pour" 把视频的动作提前预告，拉完播。

---

### 方案 B｜技术内幕流 · 对标 @anshuc（**最容易涨粉 + 被收藏**）

```
992,628 triangles. 34 wind lines. One browser tab.

The trap nobody warns you about with three.js WebGPU:

the render pipeline cache keys off the shader source hash. 34 identical flow lines = 34 pipelines, until I moved the per-line constant into a uniform.

20 minutes of debugging. One line of code.

Process below 🧵

[你的 demo 链接]
```

**为什么这样写**：@anshuc 那条真正被疯转的不是成品，是 "**I'll share the process below**" 这个钩子。你手上刚好有一条**真实且少见的技术洞察**（本次会话里实测出来的 WebGPU 管线缓存按 shader 源码哈希复用），这种东西在技术圈的分量远高于成品展示——会被大量 Bookmark 和引用。后面接 4-5 条的线程把细节铺开。

---

### 方案 C｜时代感流 · 对标 @Yokohara_h / @rileybrown（**最容易破圈，但最看脸**）

```
Two years ago this was an agency project with a five-figure budget and a six-week timeline.

Today: one person, Blender, three.js on WebGPU, and Astra.

992,628 triangles. Pour-on paint. Wind that only exists when you ask for it.

[你的 demo 链接]
```

**为什么这样写**：把"贵/慢"和"一个人/今天"做对比，是这类帖最稳的情绪结构。风险是如果没有视频质感撑着，会显得空——**只在你的视频足够好看时用这条**。

---

## 四、线程版（把方案 B 铺成 5 条）

```
1/ 992,628 triangles, 34 procedural wind lines, one browser tab.
   Built with GPT-6 Astra + Blender + three.js WebGPU.
   Here's what actually broke. 🧵
   [demo link]

2/ The model: 96 parts, 36 materials, 17 MB → 4.19 MB after Draco.
   Real clearcoat, transmission and IOR on the glass instead of faked opacity.
   Blender did the geometry. Astra drove the export pipeline.

3/ The paint. No texture is animated here — it's a TSL node graph:
   an anisotropic distance field, warped by noise, smoothed by a moving front.
   The colour pours across the body like ink on wet paper.

4/ The wind. 34 spline-resampled tubes that hug the real body contour.
   They're not always on — each one has a duty-cycle window and phase noise,
   so it reads as gusts, not decoration.

5/ The trap: three.js WebGPU reuses pipelines by shader source hash.
   34 lines with a per-line constant = 34 pipelines.
   Move that constant into a uniform → 1 pipeline, 34 lines.

   Full build: [demo link]
```

> 注意：线程里"Blender 做几何 / Astra 驱动导出"这句，按实际分工改。如果车模是第三方素材，**补一句 credit**——这个圈子对"藏素材"非常敏感，主动写反而是加分项。

---

## 五、配图 / 视频脚本（比文案更重要）

这类帖 80% 的传播由视频质量决定。

**规格**：16:9 或 1:1，**10–16 秒**，无声（X 默认静音自动播放），<20 MB，首尾可循环。

| 时间 | 画面 | 字幕（屏幕硬字幕，英文） |
|---|---|---|
| 0.0–1.5s | 车侧缓慢横移，**别从黑屏或 loading 开始** | `992,628 triangles` |
| 1.5–4.0s | 点色板 → 水墨扩散换色 | `node-graph paint` |
| 4.0–7.0s | 按住 Aero → 34 条阵风线条掠过车身 | `34 procedural wind lines` |
| 7.0–9.0s | 开大灯 → 夜间，地面反光 | `WebGPU · single tab` |
| 9.0–12s | Wheels 机位推到轮毂特写 | `Blender → glTF` |
| 12–14s | 拉回全景，UI 玻璃面板入画 | `[你的域名]` |

**录制要点**
- 前 1.5 秒不能是静止帧或加载画面——X 的信息流里这决定生死
- 鼠标移动要**提前减速再停下**，别在按下瞬间急停（观感立刻掉一档）
- 用系统录屏 + 剪映/AE 压一遍，输出 H.264 高码率，别用 GIF
- 如果只能发图：发 **4 图轮播**（整车 / 色板特写 / Aero 线条 / 夜间大灯），第一张必须是整车 3/4 前脸

---

## 六、发布清单

### 时机
- **主发时间：北京时间 21:00–22:30** —— 对应美东上午 9–10 点半，是技术圈信息流最活跃的窗口
- 次选：北京时间 09:00–10:00（欧洲下午）
- **避开**：周五晚、周末——技术内容的互动率会掉 30% 以上

### 蹭流量池（最重要的分发动作）
发布后 **10–20 分钟**内，用你的帖子 **Quote Tweet** 这条：

> @ashebytes 的 Model X 334 pieces 那条（https://x.com/ashebytes）

写一句：`Same genre, different machine — mine's a configurator you can actually drive the paint on.`
→ 直接把你的帖子塞进那条爆款的引用流量池，这是同赛道起号最有效的单点动作。

**备选引用对象**：@superalesha（赛车 + Blender 车模）、@MengTo（Three.js 交互研究）、@victormustar（Astra Three.js）。

### Hashtag
最多 3 个，放在正文末尾或第一条回复里：
`#threejs #WebGPU #creativecoding`
加 `#GPT6Astra` 有话题池红利，但会让帖子偏"AI 圈"而非"dev 圈"，看你想要哪边的受众。

### 发布后 30 分钟
- 一楼回复补技术栈 + demo 链接（正文里链接会被降权，放回复里更稳）
- 把自己的每条回复都当成正文写，别回"thanks!"
- **@creativecoding / @threejs 相关大号不要主动 @**，靠引用帖自然带

---

## 七、红线（写了会翻车）

| 别写 | 原因 |
|---|---|
| 具体 fps（除非实测） | 会被要求放 proof，翻车代价高 |
| "one-shot / 30 分钟做完" | 你不是这么做的，被追问就崩 |
| "0 代码 / no code" | 你有 2,648 行 TSL 与交互逻辑，技术圈一眼看穿 |
| 藏掉第三方车模来源 | 同赛道被扒过，主动 credit 是加分 |
| 中文正文 + 英文标签 | @xingar_dev 的技术帖一直用英文，别破坏账号一致性 |

---

## 八、附：中文版（如果要同步发微博/小红书）

```
一辆车，992,628 个三角形，一个浏览器标签页。

Blender 建模，three.js WebGPU 渲染，GPT-6 Astra 当搭子。

96 个建模部件、36 种材质、4.19MB。
没有一行 GLSL，材质全是 TSL 节点图。

车漆像墨水一样漫开，34 条风线只在你要的时候才出现。

[链接]
```

---

## 九、埋点建议

发完记下这几个数，下次直接对比（起号的唯一方法）：

| 指标 | 目标 |
|---|---|
| 首 2 小时曝光 | 记录基线 |
| 视频完播率 | > 25% 才算视频有效 |
| 点击率（链接点击/曝光） | > 1.5% |
| Bookmark 数 | 技术内幕流的真实指标，比 Like 重要 |
| 涨粉 | 记录 /1000 曝光的新增粉 |
