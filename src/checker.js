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

/**
 * 写作清单：对照 CCSS 的 Language（L.x.2 大写和标点）和 Writing（W.x.1 给出理由）做格式检查。
 * 内容好不好由家长在报告里看。
 */
export function writingChecks(spec, text) {
  const t = String(text ?? '').trim();
  const words = t.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const sentences = t.split(/(?<=[.!?]["'”’)]?)\s+/).filter(Boolean);
  const checks = [
    {
      id: 'capital',
      en: 'Start each sentence with a capital letter',
      zh: '每句话的开头用大写字母',
      ok: sentences.length > 0 && sentences.every((s) => /^["'“‘(]?[A-Z]/.test(s)),
    },
    { id: 'end', en: 'End with . ! or ?', zh: '句末加上标点', ok: /[.!?]["'”’)]?$/.test(t) },
    { id: 'pronoun', en: 'Write “I” as a capital letter', zh: '“I” 永远大写', ok: !/(^|[^A-Za-z'’])i([^A-Za-z'’]|$)/.test(t) },
    { id: 'words', en: `Use at least ${spec.minWords} words`, zh: `至少写 ${spec.minWords} 个单词（现在 ${words.length} 个）`, ok: words.length >= spec.minWords },
    ...spec.require.map((w) => ({
      id: `use-${w}`,
      en: `Use the word “${w}”`,
      zh: `用上 “${w}”`,
      ok: new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i').test(t),
    })),
  ];
  return checks;
}
