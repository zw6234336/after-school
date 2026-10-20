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

还会列出每篇文章的词数和每课的题目数，方便控制长度。

## 改编规则

1. **只用授权清楚的内容**。每个原作文件都要看它自己的授权声明；版权页上写着 “All Rights Reserved” 又没有 CC 授权的，不用。
2. **只改编文字**。原作里的图片很多是第三方授权，不搬过来。
3. **记清来源和改动**。改编一课，就在 `from` 和 `changes` 里写清楚，并更新 [ATTRIBUTION.md](ATTRIBUTION.md)。
4. **学校教材不进内容库**。孩子学校的课本和作业只写在家里自己的 `homework.json` 里。
5. **保持非商业**。这些内容禁止商用，项目里不能加收费功能或广告。
