// 内容库：打包时把 content/units/*/unit.json 一起打进来。
// 内容的授权（CC BY-NC-SA 4.0）和代码不同，见 content/LICENSE.md。

const modules = import.meta.glob('../content/units/*/unit.json', { eager: true, import: 'default' });

export const UNITS = Object.fromEntries(Object.values(modules).map((unit) => [unit.id, unit]));

// 故事章节（星际破译）：每章引用一个单元，带一段开场动画
const stories = import.meta.glob('../content/story/*.json', { eager: true, import: 'default' });

export const STORY = Object.fromEntries(Object.values(stories).map((chapter) => [chapter.id, chapter]));
