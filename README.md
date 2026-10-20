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
{ "id": "unit-seasons", "unit": "k-seasons-weather", "lessons": "daily" }          // 每天自动排一课（推荐）
{ "id": "unit-seasons", "unit": "k-seasons-weather", "lessons": ["l1-weather"] }   // 自己挑今天做哪几课；不写就是整个单元
```

`"daily"` 的排课规则：

- 属于故事章节的单元（四季与天气）航行期不排课，着陆的第二天开始排；不属于故事的单元（短元音拼读）从第一天就排。
- 每天排单元里还没读完的第一课（读完 = 这一课带文章的阅读题做完），当天排好就固定，做完也不会马上换下一课。没读完的第二天接着排。
- 想一天两课就再写 `"perDay": 2`。课都读完了就不再排，孩子可以去门口试飞。
- 家长报告的故事进度里能看到读完几课、今天排的是哪一课。

现在的 K 年级单元，按 Bix 星的层排，每一层一个拼读单元（门上的解码锁）和一个知识单元（地图上的阅读）：

| 单元 | 课 | 每课的内容 | 来源 |
|---|---|---|---|
| 🔤 **Short Vowels（短元音拼读）** | 5 课：a、e、i、o、u | 看图认词和押韵（RF.K.2–3）、字母块拼词、一篇只用学过的短元音和高频词写的可解码小故事（RL.K.1、RF.K.3c）、朗读计时（RF.K.4） | 原创 |
| 🌦️ **Seasons and Weather（四季与天气）** | 8 课：天气、冬、春、夏、秋、蚱蜢和蚂蚁、暴风雨安全、气象学 | 读 Annie 的信或寓言、答题并找证据（RI/RL.K.1–4、RI.K.8–9），再做一项写作、分类或讲给大人听 | 改编自 Core Knowledge Language Arts（CKLA）的开放课程 |
| 🔡 **Digraphs（二合字母拼读）** · 第 2 层 | 4 课：sh、ch、th、ck | 和短元音拼读一样：看图认词、拼词、可解码小故事、朗读计时 | 原创 |
| 👂 **The Five Senses（五种感官）** · 第 2 层 | 8 课：小诗、看、听、闻、尝、摸、Ray Charles、Helen Keller | 读短文、答题找证据，再做分类（哪种感官、大声小声、甜咸酸、软硬）、写作或讲给大人听 | 改编自 CKLA K 年级 Domain 2 |

内容的授权是 CC BY-NC-SA 4.0，和代码的授权不同，详见 [content/LICENSE.md](content/LICENSE.md) 和 [content/ATTRIBUTION.md](content/ATTRIBUTION.md)。改编内容的文章下面会显示署名。

修改或新增单元后运行 `npm run check:content`，它会用和页面一样的规则在三档难度下检查每个单元。

### 航行、着陆和地面地图

“星际破译”故事从航行期开始：孩子驾驶使命号飞向 Bix 星，主界面是太空里的科目星球。每天把当天的作业全部完成，就给飞船加**一天燃料**（同一天只算一次）；加满 **5 天**燃料就能降落。完成全部作业时的庆祝弹窗会显示燃料进度（“燃料 3/5 天，再坚持 2 天就能降落 Bix 星”），屏幕上方的提示也会提到；加满的那天弹窗里出现 **🛬 降落 Bix 星** 按钮。如果孩子先关掉了弹窗，之后完成当天的作业再点火箭，还会再问一次。

点降落后播放这一层的开场动画：使命号着陆、原住民 Zib 用学过的词打招呼、中途停下来复习两道题、最后预告这一层的新词。开场的台词和题目写在 [`content/story/`](content/README.md#故事章节和开场动画) 里。

开场播完（或跳过）就算**着陆**，主界面从太空里的科目星球换成这一层的**地面地图**：当天的任务按 CCSS 领域自动分到五个站点——🔤 拼读站（RF）、📚 故事屋（RL）、🔬 研究站（RI，第 1 层叫气象站）、🧩 词语站（L）、📡 广播站（W、SL）；数学、语文等没有 CCSS 标准的科目各开一个站点。全部完成后由广播站的信号塔向地球发信号。家长报告仍然按学校的科目分组。燃料天数和着陆状态保存在浏览器里（`localStorage` 的 `after-school:story`）。

家长报告最后的 **🚀 故事进度** 显示燃料天数，航行期可以点 **直接降落**（不用等燃料加满），着陆后可以点 **回到航行期**（着陆、燃料天数和发现图鉴清空，做题记录和读过的课不受影响）。

### 闲逛 Bix 星

着陆以后，地图右下角有 **🧭 去逛逛**（点小宇航员也可以）：镜头从地图降到小宇航员身后，孩子在整颗小星球上点哪儿走哪儿，Zib 跟在旁边，拖动屏幕可以转着看。着陆区外面是一圈天气地带（风之原、晴之丘、雨之林、雪之谷、叶之坡），每个地带有自己的地面颜色、灯光、布景和飘着的东西；一直往前走会绕一圈回来。

地带里藏着 12 样新奇的东西（第一封信里的天气词 6 样，春、夏、秋三课 4 样，学校本周的词 2 样），走近会发光、头上的 ❔ 会跳。点它，小宇航员走过去，Zib 跑过来用学过的话介绍它，弹出发现卡片，可以收进 **📔 图鉴**。名字按翻译机的规则显示：学校本周教过的词一开始就认识；单元里的词要**读完那一课**（这一课带文章的任务做完）才破译，之前显示外星符号，卡片上会写读完哪一课就能破译。闲逛不计分、不限时，五个站点和使命任务还在着陆区，随时点 **🏠 回着陆点**。家长报告的故事进度里会显示今天逛了多久、找到了什么。

地带和发现物写在章节文件的 `explore` 里（见 [content/README.md](content/README.md#故事章节和开场动画)），`npm run check:content` 会检查发现物的名字在那一课的文章里、Zib 的话只用学过的词。

### 给小宇航员穿对衣服

地图右下角的 **🎒 衣柜** 里放着这一层课文讲到的衣服，读完那一课才拿得到：🧤 mittens（Winter）、👢 rain boots（Spring）、🧴 sunscreen（Summer）。还没拿到的名字显示成外星符号，写着读完哪一课就能拿到。

闲逛走进天气地带时，Zib 用学过的话提醒该穿什么，比如在雪之谷说 “Brr! It is cold! Put on your mittens!”，在雨之林说 “It is wet! Put on your rain boots!”。晴之丘要抹防晒霜，戴着连指手套也不行（“No mittens in the sun!”）。

- 穿得不对时，小宇航员会不舒服：冷了发抖、呼白气，没穿雨靴脚下溅水，热了冒汗、头盔发红。
- 提醒会一直留着，直到穿对或者离开这个地带（也可以点 ✕ 关上）。穿对了 Zib 会夸一句、点点头。
- 不拦路、不计分：这里练的是这个单元的核心目标“天气决定穿什么”，也让读完一课有一样看得见的东西。
- 穿着什么会记在浏览器里。家长报告里能看到拿到了几件、还差哪几课。

衣柜写在章节文件的 `wardrobe` 里（见 [content/README.md](content/README.md#衣柜穿对衣服)）。

### 门和两把锁

着陆区发射台的左后方有一扇 **🚪 通往第 2 层** 的门，名牌上显示这一层的课读完了几课。单元的课全部读完以后，点门就能**试飞**，门上有两把锁：

| 锁 | 怎么开 | 标准 |
|---|---|---|
| 🔤 解码锁 | 屏幕上只显示拼读课里的英文单词（cat、hen、pig、box、bug…，不朗读），孩子从三张图里选出它。干扰图优先挑同一个字母开头的词（pig / pin、box / bug / bus），只看首字母猜不出来，要真的拼读出中间的元音。10 个词认出 8 个就开 | RF.K.3 |
| 🔍 理解锁 | 读 Zib 的一封短信（只用高频词和这一层学过的词），每道题都答对，并在信里点出证明答案的句子 | RI.K.1 |

- 试飞只看孩子这一次自己做的结果：没有提示、不计时、不加也不扣星星。
- 没打开的锁会记下**收集到的数据**，比如“没认出来的词：thermometer、mittens → 再读一读《Winter》”“1 道题证据句没找对”，练完再来。
- 打开的锁一直开着，下次只试还锁着的那把。理解锁每次换一封短信。
- 两把锁都开了：门向里打开，旁边的空地升起 **Bix 气象塔**，然后弹出解锁卡片，预告第 2 层（还在建造中）。
- 门只锁故事，不锁使命任务：学校作业和站点里的任务什么时候都能做。
- 家长报告的故事进度里有门的状态、试飞次数和最近一次的数据。“回到航行期”会把门锁和试飞记录一起清空。

门的数据写在章节文件的 `door` 里（见 [content/README.md](content/README.md#通往下一层的门)）。

### 一层一层往下走

门打开以后，解锁卡片和门口都有 **🛗 下到第 N 层**：播放下一层的开场，着陆在下一层的地面地图上。每一层有自己的样子（地面颜色、下不下雨、研究站叫什么、闲逛的地带和发现物）、自己的知识单元和拼读单元、自己的门。下一层的课从着陆的第二天开始排；读过的课、图鉴和打开的门都保留。

| 层 | 地方 | 知识单元 | 拼读单元（解码锁） |
|---|---|---|---|
| 1 | 🛬 着陆区 · 气象站 | 四季与天气 | 短元音（航行期就开始） |
| 2 | 🛍️ 集市 · 感官馆 | 五种感官 | 二合字母 sh、ch、th、ck |

开发时还可以用网址直接操作：

```
http://localhost:5173/?opening=ch01-weather-station   直接播放开场，播完着陆
http://localhost:5173/?explore                         着陆以后直接去逛逛
http://localhost:5173/?story=reset                     回到航行期（着陆、燃料天数、图鉴、门锁和身上的衣服清空）
```

## 学习计划：第 1 章怎么用

孩子每天打开页面做“使命任务”，家长只需要每天把学校作业写进 `homework.json`（单元的课用 `"daily"` 自动排）。第 1 章大约两周半：

| 阶段 | 孩子做什么 | 每天大约 | 家长做什么 |
|---|---|---|---|
| 🚀 航行期（5 天） | 学校作业加一课拼读（短元音 a、e、i、o、u，一天一个）；全部做完给使命号加 1 天燃料 | 学校作业 + 10 分钟 | 每天写好学校作业；看报告、确认打卡和写作；朗读计时的时候在旁边听 |
| 🛬 降落（燃料加满那天） | 庆祝弹窗里点“降落 Bix 星”，看 1 分钟开场动画，复习 2 道题 | 2 分钟 | 不用做什么（也可以在报告里“直接降落”） |
| 🗺️ 着陆后（8 个上学日） | 学校作业加一课单元（读 Annie 的信或寓言、答题找证据，再做一项写作、分类或讲给大人听）。任务按能力分到地图上的五个站点 | 学校作业 + 10–15 分钟 | 打卡任务（讲给大人听、天气预报员）听孩子说完再点“完成啦”；写作看完点“检查通过” |
| 🧭 随时 | 去逛逛：找发现物、读完课破译名字、给小宇航员穿对衣服 | 不限，不计分 | 报告里能看到逛了多久、找到了什么 |
| 🚪 8 课读完 | 去门口试飞：解码锁（看词选图）和理解锁（读 Zib 的短信、找证据），没打开就看“收集到的数据”练一练再来 | 5 分钟一次 | 按报告里的数据陪孩子重读那一课 |
| 🎉 两把锁都开 | 门打开，Bix 气象塔升起来；第 1 层完成 | — | — |

- **漏了一天**：没读完的课第二天接着排，燃料也只在“当天作业全部做完”时加。
- **想快一点或慢一点**：`"perDay": 2` 一天两课；或者把 `"daily"` 换成课的 id 列表自己挑。
- **从头再来**：家长报告里的“回到航行期”清空着陆、燃料、图鉴、门锁和衣服，做题记录和读过的课保留。

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
src/surface.js         着陆后的地面地图：站点名牌、点击、镜头、信号塔；去逛逛和回着陆点的镜头飞行
src/explore.js         闲逛 Bix 星：小宇航员、沿球面行走、第三人称镜头、天气地带、发现物
src/explore-hud.js     闲逛的网页部分：去逛逛按钮、发现卡片、图鉴、翻译机破译名字
src/door.js            通往下一层的门：两把锁、试飞、收集到的数据、家长报告里的门
src/wardrobe.js        衣柜：读完一课拿到衣服、闲逛时 Zib 提醒穿什么、穿得对不对
src/stations.js        按 CCSS 领域把当天任务分到站点
src/story.js           故事进度：燃料、着陆、读过的课、发现图鉴
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
