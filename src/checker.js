// 判断答案是否正确：忽略全角/半角、大小写、多余空格和标点；数字按数值比较。

const NUMBER = /^-?\d+(\.\d+)?$/;
const PUNCT = /[\s,，、。.!！?？;；:：'"“”‘’]/g;

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isCorrect(question, given) {
  const g = normalize(given);
  if (!g) return false;
  return question.answers.some((answer) => {
    const a = normalize(answer);
    if (a === g) return true;
    if (NUMBER.test(a) && NUMBER.test(g)) return Number(a) === Number(g);
    if (NUMBER.test(a)) return false;
    return a.replace(PUNCT, '') === g.replace(PUNCT, '');
  });
}
