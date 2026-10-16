# 🚀 作业星球

用 [three.js](https://threejs.org/) 做的 3D 家庭作业小站：每个科目是一颗星球，每项作业是绕着星球转的小卫星。孩子在页面上答题、自动批改，完成作业给中间的火箭“加燃料”，全部完成后火箭发射、放烟花。家长可以看报告和错题本。

## 功能

- **3D 太空场景**：闪烁星空、星云、流星、泛光特效；点击星球，镜头飞过去
- **自动批改**：选择题、填空题（文字/数字），忽略全角半角、大小写和多余空格
- **适合小朋友**：大号数字键盘、🔊 朗读题目、💡 提示；答错可以再试，3 次后显示正确答案
- **奖励**：一次答对 ⭐⭐，改正后答对 ⭐，完成打卡任务 ⭐⭐
- **口算题自动生成**：加减乘除，同一天题目固定，第二天自动换新
- **家长报告**：完成情况、一次答对率、错题本、打卡任务“检查通过”、打印
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
  "title": "作业星球",
  "child": "小明",              // 显示在左上角
  "subjects": [
    {
      "id": "math",              // 唯一 id（进度按 id 保存）
      "name": "数学",
      "icon": "🔢",
      "color": "#ffc23d",        // 星球颜色
      "tasks": [
        // 1) 打卡任务：没有题目，孩子做完点“完成啦”，家长在报告里确认
        { "id": "math-workbook", "title": "完成练习册第 12 页", "note": "可选的说明" },

        // 2) 题目任务
        {
          "id": "math-story",
          "title": "解决问题",
          "questions": [
            { "q": "12 - 5 = ？", "a": "7", "hint": "可选提示" },               // 数字题 → 显示数字键盘
            { "q": "“大”的反义词？", "a": ["小", "small"] },                  // 多个可接受答案
            { "q": "小蝌蚪的妈妈是？", "options": ["金鱼", "青蛙"], "a": "青蛙" }, // 选择题
            { "q": "apple 是什么意思？", "options": ["苹果", "香蕉"], "a": "苹果", "speak": "apple" } // speak：朗读内容
          ]
        },

        // 3) 自动生成口算题
        {
          "id": "math-mental",
          "title": "口算挑战",
          "generate": { "kind": "arith", "ops": ["+", "-"], "max": 100, "count": 10 }
          // ops 可用 + - × ÷；max：加减法范围；table：乘除法口诀范围（默认 9）
        }
      ]
    }
  ]
}
```

可选字段 `"date": "2026-10-16"` 可以固定日期，不写就用当天日期。文件格式有问题时，页面会直接提示哪一项出错。

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
public/homework.json   作业内容（家长编辑这里）
src/scene.js           three.js 场景：星球、卫星、火箭、相机动画
src/particles.js       烟花和星星粒子
src/ui.js              作业面板、答题、家长报告
src/data.js            读取作业文件、生成口算题
src/checker.js         判断答案对错
src/progress.js        进度和星星（localStorage）
src/audio.js           音效和朗读
```
