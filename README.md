# 🚀 使命星球

用 [three.js](https://threejs.org/) 做的 3D 家庭作业小站：每个科目是一颗星球，每项作业是绕着星球转的小卫星。孩子在页面上答题、自动批改，完成作业给中间的火箭“加燃料”，全部完成后火箭发射、放烟花。家长可以看报告和错题本。

孩子在页面上看到的都叫“使命任务”，不会出现“作业”两个字，和“星际破译”的故事主线一致；家长这边（家长报告、这份说明、`homework.json`）仍然叫作业。

## 功能

- **3D 太空场景**：闪烁星空、星云、流星、泛光特效；点击星球，镜头飞过去
- **自动批改**：选择题、填空题（文字/数字），忽略全角半角、大小写和多余空格
- **适合小朋友**：大号数字键盘、🔊 朗读题目、💡 提示；答错可以再试，3 次后显示正确答案
- **奖励**：一次答对 ⭐⭐，改正后答对 ⭐，完成打卡任务 ⭐⭐
- **口算题自动生成**：加减乘除，同一天题目固定，第二天自动换新
- **三档难度**：🌱 简单 / ⭐ 普通 / 🔥 挑战，孩子可以在右上角自己切换（家长也可以锁定）。换难度会换一套题，已完成的打卡任务和星星都保留
- **英语按 Common Core（CCSS ELA）设计**：每项英语作业都标注 CCSS 标准，按“自然拼读 → 读文章找证据 → 朗读流利度 → 写作 → 复述”组织（见下文）
- **家长报告**：完成情况、一次答对率、按 CCSS 标准的掌握情况、错题本、打卡和写作“检查通过”、打印
- **进度自动保存**在浏览器里（按日期区分），刷新不会丢

## 本地运行

```bash
npm install
npm run dev
```

打开终端里显示的地址。开发服务器开了局域网访问，同一 Wi‑Fi 下的平板/手机可以用 `Network` 那一行的地址打开。

## 布置作业：编辑 `public/homework.json`

```jsonc
{
  "title": "使命星球",
  "child": "小明",              // 显示在左上角
  "difficulty": "normal",       // 默认难度：easy（简单）/ normal（普通）/ hard（挑战）
  "lockDifficulty": false,      // true：孩子不能自己换难度
  "subjects": [
    {
      "id": "math",              // 唯一 id（进度按 id 保存）
      "name": "数学",
      "icon": "🔢",
      "color": "#ffc23d",        // 星球颜色
      "tasks": [
        // 1) 打卡任务：没有题目，孩子做完点“完成啦”，家长在报告里确认
        { "id": "math-workbook", "title": "完成练习册第 12 页", "note": "可选的说明" },
        { "id": "math-extra", "title": "挑战：完成拓展题", "level": "hard" },   // 只在挑战难度出现

        // 2) 题目任务
        {
          "id": "math-story",
          "title": "解决问题",
          "questions": [
            { "q": "12 - 5 = ？", "a": "7", "hint": "可选提示" },               // 数字题 → 显示数字键盘
            { "q": "“大”的反义词？", "a": ["小", "small"] },                  // 多个可接受答案
            { "q": "小蝌蚪的妈妈是？", "options": ["金鱼", "青蛙"], "a": "青蛙" }, // 选择题
            { "q": "apple 是什么意思？", "options": ["苹果", "香蕉"], "a": "苹果", "speak": "apple" }, // speak：朗读内容
            { "q": "5 - 2 = ？", "a": "3", "level": "easy" },                  // 只在简单难度出现
            { "q": "5 × 6 - 8 = ？", "a": "22", "level": ["normal", "hard"] }  // 在普通和挑战难度出现
          ]
        },

        // 3) 自动生成口算题
        {
          "id": "math-mental",
          "title": "口算挑战",
          "generate": {
            "kind": "arith",
            "ops": ["+", "-"],        // 可用 + - × ÷
            "max": 100,               // 加减法数字范围
            "table": 9,               // 乘除法口诀范围
            "count": 10,              // 题目数量
            "terms": 2,               // 2：两个数；3：三个数连算（连加连减、乘加乘减）
            "levels": {               // 可选：不同难度下覆盖上面的参数
              "easy": { "max": 20, "count": 6 },
              "hard": { "terms": 3 }
            }
          }
        }
      ]
    }
  ]
}
```

[examples/homework-demo.json](examples/homework-demo.json) 是一份包含语文、数学和各种题型的完整示例，可以复制里面的写法。

可选字段 `"date": "2026-10-16"` 可以固定日期，不写就用当天日期。文件格式有问题时，页面会直接提示哪一项出错。

### 难度怎么生效

- **口算题**：写了 `levels` 就按它来；没写时自动调整：

  | 🌱 简单 | ⭐ 普通 | 🔥 挑战 |
  |---|---|---|
  | 数字范围缩小（100 以内 → 20 以内）、口诀只到 5、题目少四成 | 按文件里的参数 | 三个数连算：连加连减、乘加乘减 |

- **题目和任务**：不写 `level` 的在所有难度都出现；写了的只在对应难度出现。

孩子上次选的难度会记在浏览器里；`lockDifficulty: true` 时始终使用文件里的 `difficulty`。

## 英语：按 Common Core 设计

美国小学英语（ELA）以 [Common Core State Standards](https://www.thecorestandards.org/ELA-Literacy/) 为底层框架：每个技能对应一条标准代码，比如 `RI.1.1` 表示 Reading: Informational Text、一年级、第 1 条。使命星球的英语部分照这个逻辑来设计：

| CCSS 领域 | 在使命星球里的样子 |
|---|---|
| 🔤 **RF** 阅读基础（Foundational Skills） | 自然拼读：点字母块拼单词（`tiles`）；朗读流利度：听示范 → 跟读 → 自己计时读，算出每分钟词数（WPM），对照年级目标 |
| 📚 **RL** 文学阅读 / 🔬 **RI** 信息类阅读 | 以一篇短文为中心：读前先认识生词，读时点单词听发音、“Read to me” 逐句朗读；读后回答问题，并且**在文中点出证明答案的句子**（文本证据，CCSS 的核心要求） |
| 🧩 **L** 语言运用 | 在上下文里推测词义；写作时检查大写、标点 |
| ✍️ **W** 写作 | 观点写作：题目 + 句子开头（sentence starter）+ 实时检查清单，家长在报告里看内容并确认 |
| 🗣️ **SL** 听与说 | 复述给家长听（打卡任务） |

- 每道题和每项作业都显示一句 **“I can …”** 学习目标，这是美国课堂里贴在黑板上的写法。
- 家长报告按标准统计，用美国学校常用的 **标准化评分 4 级**：Exceeds 优秀 / Meets 达标 / Approaching 接近 / Beginning 起步。
- 难度和 CCSS 的“文本复杂度 + 支架”对应：简单难度题目更少、排序步骤更少；挑战难度增加主旨、推断类问题和更长的写作要求。

### 英语作业的写法

```jsonc
{
  "id": "en-frog",
  "title": "Read: From Egg to Frog",
  "standard": "RI.1.1",                 // CCSS 代码：领域.年级.序号，题目没写时用这个
  "passage": {
    "title": "From Egg to Frog",
    "genre": "informational",           // literature（故事）或 informational（说明文）
    "text": "A frog lays many eggs in a pond. A tiny tadpole hatches from each egg. ...",
    "vocab": [{ "word": "tadpole", "meaning": "蝌蚪", "emoji": "🐸" }]   // 读前生词，文中会高亮
  },
  "questions": [
    // evidence：答对后要在文章里点出包含这段文字的句子
    { "q": "What hatches from each egg?", "options": ["a fish", "a tadpole"], "a": "a tadpole", "evidence": "hatches from each egg" },
    // order：按正确顺序写，页面会打乱让孩子排序
    { "q": "Put the steps in order.", "order": ["A frog lays eggs.", "A tadpole hatches.", "It becomes a frog."], "standard": "RI.1.3" }
  ]
}
```

其他英语任务：

```jsonc
// 自然拼读：用字母块拼单词（可以有干扰字母，也可以是 "sh" 这样的组合）
{ "q": "Build the word: 🐟", "tiles": ["f", "i", "sh", "a"], "a": "fish", "speak": "Build the word fish." }

// 句型：答案里有空格时，变成用单词卡拼句子
{ "q": "What season is it? 🌷", "tiles": ["It's", "winter.", "spring."], "a": "It's spring." }

// 听力：listen 为 true 时，题目出现就自动读一遍 speak
{ "q": "🔊 Listen and choose.", "options": ["net", "wet", "vet", "jet"], "a": "vet", "speak": "vet", "listen": true }

// 朗读流利度：引用同一科目里某篇文章；goal 不写时按年级取参考值（一年级 60 WPM）
{ "id": "en-fluency", "title": "Fluency", "standard": "RF.1.4", "fluency": { "passage": "en-frog" } }

// 写作：require 是必须用到的词，minWords 是最少词数
{
  "id": "en-write", "title": "Write: My favorite animal", "standard": "W.1.1",
  "write": { "prompt": "What is your favorite animal? Tell why.", "frame": "My favorite animal is ___ because ___.", "require": ["because"], "minWords": 8 }
}
```

`standard` 写错格式时页面会提示。示例作业是一年级的，换成其他年级只要改代码里的年级数字（比如 `RI.2.1`）和内容。

### 内容库：直接用整个单元

英语课程按单元放在 [`content/`](content/README.md) 里，每个单元包含几课文章、题目和写作任务，写一次就能反复用。在 `homework.json` 里加一个带 `unit` 的科目，就会把这个单元的课展开成作业：

```jsonc
{ "id": "unit-seasons", "unit": "k-seasons-weather", "lessons": ["l1-weather"] }   // lessons 不写就是整个单元
```

现在有一个单元：K 年级 **Seasons and Weather（四季与天气）**，改编自 Core Knowledge Language Arts（CKLA）的开放课程。内容的授权是 CC BY-NC-SA 4.0，和代码的授权不同，详见 [content/LICENSE.md](content/LICENSE.md) 和 [content/ATTRIBUTION.md](content/ATTRIBUTION.md)。改编内容的文章下面会显示署名。

修改或新增单元后运行 `npm run check:content`，它会用和页面一样的规则在三档难度下检查每个单元。

### 开场动画和着陆后的地面地图（原型）

“星际破译”故事里，进入星球的每一层前会播一段开场动画：使命号着陆、原住民 Zib 用学过的词打招呼、中途停下来复习两道题、最后预告这一层的新词。开场的台词和题目写在 [`content/story/`](content/README.md#故事章节和开场动画) 里。

开场播完（或跳过）就算**着陆**，主界面从太空里的科目星球换成这一层的**地面地图**：当天的任务按 CCSS 领域自动分到五个站点——🔤 拼读站（RF）、📚 故事屋（RL）、🔬 研究站（RI，第 1 层叫气象站）、🧩 词语站（L）、📡 广播站（W、SL）；数学、语文等没有 CCSS 标准的科目各开一个站点。全部完成后由广播站的信号塔向地球发信号。家长报告仍然按学校的科目分组。着陆状态保存在浏览器里。

现在还没有在使命任务的流程里自动触发着陆，开发时这样操作：

```
http://localhost:5173/?opening=ch01-weather-station   播放开场，播完着陆
http://localhost:5173/?story=reset                     回到航行期（太空里的科目星球）
```

## 部署到 Cloudflare

项目已经配好 [Cloudflare Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)（见 `wrangler.jsonc`），不需要写任何后端代码。

第一次需要登录 Cloudflare 账号（会打开浏览器授权）：

```bash
npx wrangler login
```

之后每次部署：

```bash
npm run deploy
```

部署完成后地址是 `https://after-school.<你的子域>.workers.dev`，也可以在 Cloudflare 后台给它绑定自己的域名。修改 `homework.json` 后重新运行 `npm run deploy` 即可更新作业。

> 也可以在 Cloudflare 后台 **Workers & Pages → 创建 → 导入 Git 仓库** 连接这个 GitHub 仓库，构建命令填 `npm run build`，部署命令填 `npx wrangler deploy`，之后每次 push 自动部署。

## 目录结构

```
public/homework.json   今天的作业（家长编辑这里）
content/               英语内容库：按单元组织的文章和题目（授权 CC BY-NC-SA 4.0）
scripts/               check-content.mjs：检查内容库
examples/              完整示例作业
src/scene.js           three.js 场景：星球、卫星、火箭、相机动画
src/particles.js       烟花和星星粒子
src/ui.js              作业面板、答题、家长报告
src/data.js            读取作业文件、展开内容库单元、生成口算题
src/content.js         把 content/units 和 content/story 打包进页面
src/opening.js         开场动画播放器：字幕、复习停顿、标题卡、跳过
src/bix.js             Bix 星的三维布景：使命号、五个站点、Zib、镜头预设
src/surface.js         着陆后的地面地图：站点名牌、点击、镜头、信号塔
src/stations.js        按 CCSS 领域把当天任务分到站点
src/story.js           故事进度（是否已着陆）
src/checker.js         判断答案对错
src/progress.js        进度和星星（localStorage）
src/standards.js       CCSS 标准说明、“I can”目标、掌握等级
src/lesson.js          英语课界面：阅读文章、字母块、写作清单、朗读计时、标准报告
src/audio.js           音效和朗读
```

## 设计文档

直接用浏览器打开即可：

- [docs/design.html](docs/design.html)：整体设计思路和可以直接点的交互 demo
- [docs/english-design.html](docs/english-design.html)：英语部分按 Common Core 底层逻辑设计的 7 个页面
- [docs/story-design.html](docs/story-design.html)：“星际破译”故事主线和每一层的开场动画
