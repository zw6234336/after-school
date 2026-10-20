# 内容库

英语课程内容放在这里，和每天的作业文件 `public/homework.json` 分开：

- **内容库**（这里）：按单元组织的文章、题目、写作任务。每个单元做一次，长期复用。
- **每日作业**（`public/homework.json`）：家长每天编辑，从内容库里挑今天要做的课，也可以继续手写任务。

内容的授权和代码不一样，见 [LICENSE.md](LICENSE.md)（CC BY-NC-SA 4.0）。来源和署名见 [ATTRIBUTION.md](ATTRIBUTION.md)。

## 目录

```
content/
  LICENSE.md                       内容授权：CC BY-NC-SA 4.0
  ATTRIBUTION.md                   来源和署名汇总
  units/
    k-seasons-weather/unit.json    K 年级 · 四季与天气（改编自 CKLA Domain 8）
  story/
    ch01-weather-station.json      故事第 1 章：第 1 层开场动画
  wordlists/
    dolch.json                     Dolch 高频词表（公有领域），检查开场字幕用
```

## 在作业里使用一个单元

在 `public/homework.json` 的 `subjects` 里加一个带 `unit` 的科目：

```jsonc
{
  "id": "unit-seasons",              // 科目 id，进度按它保存
  "unit": "k-seasons-weather",       // 单元 id，对应 content/units/<id>/unit.json
  "lessons": ["l1-weather"],         // 今天做哪几课；不写就是整个单元
  "tasks": []                        // 可选：再加几项手写的任务，排在单元任务后面
}
```

`name`、`icon`、`color` 不写的话，用单元里的 `titleZh`、`icon`、`color`。改编内容的文章下面会自动显示一行署名。

## unit.json 的格式

```jsonc
{
  "id": "k-seasons-weather",         // 和目录名一致
  "grade": "K",                      // K、1–5
  "title": "Seasons and Weather", "titleZh": "四季与天气",
  "icon": "🌦️", "color": "#7cc8ff",
  "question": "How does the weather change from season to season?",   // 单元核心问题
  "questionZh": "每个季节的天气有什么不同？",
  "license": "CC BY-NC-SA 4.0",      // 这个单元发布用的授权
  "source": {                        // 改编来源；完全原创的单元不写
    "work": "…", "short": "CKLA Kindergarten · Seasons and Weather",
    "author": "Core Knowledge Foundation", "year": 2013,
    "url": "…",                      // 原作下载页
    "license": "CC BY-NC-SA 3.0", "licenseUrl": "…"
  },
  "wordWall": [{ "word": "weather", "meaning": "天气", "emoji": "🌦️", "lesson": "l1-weather" }],
  "lessons": [
    {
      "id": "l1-weather",            // 单元内唯一
      "title": "What's the Weather Like?",
      "genre": "informational",      // literature 或 informational，用来统计文学和说明文的比例
      "from": "Lesson 1: What's the Weather Like?",   // 改编自原作的哪一部分（有 source 时必填）
      "changes": "Shortened and simplified …",       // 改了什么（有 source 时必填）
      "tasks": [ … ]                 // 和 homework.json 里的任务写法完全一样
    }
  ]
}
```

任务和题目的写法见根目录 README 的“英语作业的写法”。单元里的任务 id 要在所有单元里唯一，建议用单元缩写开头，比如 `sw-l1-read`。

## 故事章节和开场动画

`content/story/<id>.json` 是“星际破译”故事的章节，每章引用一个单元，带一段进入这一层时播放的开场动画（`opening`）：

```jsonc
{
  "id": "ch01-weather-station", "title": "第 1 章 · 气象站", "layer": 1, "unit": "k-seasons-weather",
  "opening": {
    "title": "第 1 层 · 着陆区", "subtitle": "🌦️ 气象站 · Seasons and Weather", "intro": "开始卡片上的一句话",
    "vocab": { "school": ["jet", "wet"], "names": ["zib"], "extra": ["hi"] },   // 字幕里允许用的额外词
    "shots": [
      { "type": "fly", "camera": "approach", "action": "approach", "zh": "中文旁白", "ms": 5200 },
      { "type": "say", "camera": "zib", "action": "zib-appear", "text": "A jet! It is wet!" },
      { "type": "ask", "camera": "zib", "q": "Listen. Which word?", "speak": "wet", "options": ["net", "wet", "jet"], "a": "wet",
        "hint": "w … e … t — wet", "review": { "source": "学校本周 · 字母 Ee", "standard": "RF.K.3" } },
      { "type": "preview", "camera": "sign", "action": "sign", "word": "weather", "text": "What is this? Let's find out!" },
      { "type": "title", "camera": "station", "ms": 3200 }
    ]
  }
}
```

- `camera` 和 `action` 是 `src/bix.js` 里的镜头预设和动作名。
- `surface.stations` 可以改这一层站点的名字和图标，比如 `{ "RI": { "name": "气象站", "icon": "🌦️" } }`。站点的键是 `RF`、`RL`、`RI`、`L`、`WSL`（写作和听说共用广播站）。
- 字幕（`text`、`q`、`options`、`hint`）只能用 [`wordlists/dolch.json`](wordlists/dolch.json) 里的高频词（Dolch 词表，公有领域）、更浅的层里学过的单元词，以及 `vocab` 里声明的词；`preview` 的新词必须是本章单元要学的词，每段最多一个。`npm run check:content` 会检查这些。
- 开发时打开 `http://localhost:5173/?opening=ch01-weather-station`（或 `?opening=layer-1`）预览。

### 闲逛：地带和发现物

章节里还可以写 `explore`，着陆以后孩子可以离开着陆区，在整颗星球上闲逛：

```jsonc
"explore": {
  "zones": [   // 着陆区四周的天气地带，按经度（lon，0–360）排一圈；经度 0 在发射台后面
    { "id": "wind", "icon": "🌬️", "name": "风之原", "color": "#3a7bd5", "lon": 0 }
  ],
  "discoveries": [
    { "id": "pinwheel-flowers", "zone": "wind", "emoji": "🌬️", "zh": "风车花",
      "word": "windy",                   // 名字：学过才显示英文，没学过显示外星符号
      "say": "It is windy!",             // Zib 介绍它的话，要说出 word
      "note": "花瓣像风车一样，一直在风里转",   // 中文旁白：这个单元一课都还没读完时显示
      "from": { "lesson": "l1-weather" },   // 读完哪一课破译；学校本周教过的词写 { "school": "学校本周 · 天气" }
      "at": [49, 346] }                  // 在星球上的位置：[纬度, 经度]，纬度最多 60（再往北就是着陆区）
  ]
}
```

- 地带的 `id` 决定三维布景和飘着的东西（`wind`、`sun`、`rain`、`snow`、`leaves`），发现物的 `id` 决定它的模型，见 `src/explore.js`；没有专门模型的发现物显示成一簇发光的水晶。
- `from.lesson` 的发现物，`word` 必须出现在那一课的文章或生词里；`say` 只能用高频词、`opening.vocab` 里的词、更浅的层学过的词、那一课文章里的词和它自己的名字。发现物之间至少隔开 3.5（星球半径是 14）。`npm run check:content` 会检查这些。

### 衣柜：穿对衣服

章节里可以写 `wardrobe`：读完一课，衣柜里多一件这一课讲到的衣服；闲逛走进某个地带时，Zib 提醒该穿什么。

```jsonc
"wardrobe": {
  "items": [   // 衣服：word 要出现在那一课的文章里；id 决定三维模型（mittens、rain-boots、sunscreen，见 src/explore.js）
    { "id": "mittens", "word": "mittens", "emoji": "🧤", "zh": "连指手套", "from": { "lesson": "l2-winter" } }
  ],
  "zones": {   // 键是 explore.zones 里的地带；没写的地带穿什么都行
    "sun": {
      "wear": "sunscreen",                  // 要穿的那件
      "feel": "hot",                        // 没穿对时的样子：cold 发抖 / wet 溅水 / hot 冒汗
      "need": "It is hot! Put on sunscreen!",   // 没穿时 Zib 说的话
      "good": "Good! No sunburn for you!",      // 穿对了说的话
      "off": { "mittens": "No mittens in the sun!" }   // 在这里不能穿的衣服，穿着时说的话
    }
  }
}
```

- Zib 的话只能用高频词、`opening.vocab` 里的词、前面几层学过的词，和这句话提到的衣服那几课文章里的词。衣服还没拿到时，它的名字显示成外星符号。

### 通往下一层的门

章节里还可以写 `door`：单元的课全部读完以后，孩子在门口“试飞”，两把锁都打开就能下到下一层。

```jsonc
"door": {
  "to": { "layer": 2, "name": "集市", "icon": "🛍️" },          // 通往第几层（解锁卡片上预告）
  "decode": {                                                // 🔤 解码锁：看词选图
    "standard": "RF.K.3",
    "need": 8,                                               // 认出几个就开
    "words": ["thermometer", "mittens", "snowmen", …]        // 单元词墙或生词表里带图的词，图不能重复
  },
  "comprehend": {                                            // 🔍 理解锁：读 Zib 的短信，答对并找到证据
    "standard": "RI.K.1",
    "vocab": ["bix", "earth"],                               // 短信里额外允许的词
    "tickets": [                                             // 每次试飞换一封
      { "id": "zib-weather", "title": "A Letter from Zib", "text": "Dear friend, …",
        "questions": [{ "q": "What does Zib wear in the snow?", "options": ["mittens", "sunscreen", "rain boots"], "a": "mittens", "evidence": "I wear mittens" }] }
    ]
  },
  "unlock": { "id": "weather-tower", "emoji": "🌦️", "name": "Bix 气象塔", "note": "解锁卡片上的说明" }
}
```

- 解码锁的图来自词墙（`wordWall`）的 `emoji`，词墙里没有的再看文章生词表；词出自哪一课也从这里找，用来告诉孩子“再读一读哪一课”。
- 短信的题目写法和普通阅读题一样，但每道题都要有 `evidence`。短信正文只能用高频词、这个单元文章里的词、前面几层学过的词和 `comprehend.vocab` 里的词。
- `unlock.id` 决定开门以后升起来的三维建筑，见 `src/bix.js`；第 1 层是 `weather-tower`。

## 检查内容

```bash
npm run check:content
```

会检查：

- 每个单元在三档难度下都能正常加载：答案在选项里、证据句在文章里能找到、字母块拼得出答案等，和页面加载时的检查一样
- 标准代码格式正确，年级和单元的 `grade` 一致（挑战题可以用高一个年级的标准）
- 有 `source` 的单元，每一课都写了 `from` 和 `changes`
- 任务 id 在所有单元里不重复
- 生词表里的词在文章里出现过
- 故事章节：开场字幕只用学过的词；闲逛的发现物名字能破译、Zib 的话只用学过的词、位置不在着陆区里
- 衣柜：衣服的名字在那一课的文章里；地带和衣服的 id 对得上，`feel` 是 cold / wet / hot；Zib 的话只用学过的词
- 门：解码锁的词都有图、图不重复，`need` 不超过词数；理解锁的短信能正常加载（答案在选项里、证据句找得到）、每道题都有证据句、正文只用学过的词

还会列出每篇文章的词数和每课的题目数，方便控制长度。

## 改编规则

1. **只用授权清楚的内容**。每个原作文件都要看它自己的授权声明；版权页上写着 “All Rights Reserved” 又没有 CC 授权的，不用。
2. **只改编文字**。原作里的图片很多是第三方授权，不搬过来。
3. **记清来源和改动**。改编一课，就在 `from` 和 `changes` 里写清楚，并更新 [ATTRIBUTION.md](ATTRIBUTION.md)。
4. **学校教材不进内容库**。孩子学校的课本和作业只写在家里自己的 `homework.json` 里。
5. **保持非商业**。这些内容禁止商用，项目里不能加收费功能或广告。
