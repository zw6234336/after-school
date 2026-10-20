// 内容库：打包时把 content/units/*/unit.json 一起打进来。
// 内容的授权（CC BY-NC-SA 4.0）和代码不同，见 content/LICENSE.md。

const modules = import.meta.glob('../content/units/*/unit.json', { eager: true, import: 'default' });

export const UNITS = Object.fromEntries(Object.values(modules).map((unit) => [unit.id, unit]));
