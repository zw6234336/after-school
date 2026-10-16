// Common Core State Standards（英语 ELA，K–5）的简要说明和“I can”学习目标。
// 同一条标准在不同年级的要求是螺旋上升的，这里按“领域 + 序号”给出通用描述，年级从代码里读出。

export const STRANDS = {
  RF: { en: 'Foundational Skills', zh: '阅读基础', icon: '🔤' },
  RL: { en: 'Reading: Literature', zh: '文学阅读', icon: '📚' },
  RI: { en: 'Reading: Informational Text', zh: '信息类阅读', icon: '🔬' },
  L: { en: 'Language', zh: '语言运用', icon: '🧩' },
  W: { en: 'Writing', zh: '写作', icon: '✍️' },
  SL: { en: 'Speaking & Listening', zh: '听与说', icon: '🗣️' },
};
export const STRAND_ORDER = ['RF', 'RL', 'RI', 'L', 'W', 'SL'];

const I_CAN = {
  'RF.1': ['I can understand how books and print work.', '认识书面文字的基本规则'],
  'RF.2': ['I can hear and play with the sounds in words.', '听辨、拆分单词里的发音'],
  'RF.3': ['I can sound out and read words.', '用自然拼读读出单词'],
  'RF.4': ['I can read smoothly and understand what I read.', '流利地朗读并读懂'],
  'RL.1': ['I can answer questions about key details in a story.', '回答故事里关键细节的问题'],
  'RL.2': ['I can retell a story and tell its lesson.', '复述故事，说出它讲的道理'],
  'RL.3': ['I can describe the characters, setting, and events.', '描述人物、场景和事件'],
  'RL.4': ['I can find words that show feelings and senses.', '找出表达感受的词语'],
  'RL.5': ['I can tell how different kinds of texts are built.', '说出不同文体的结构'],
  'RL.6': ['I can tell who is telling the story.', '判断是谁在讲这个故事'],
  'RL.7': ['I can use pictures and words to understand a story.', '结合图画理解故事'],
  'RL.9': ['I can compare characters and their adventures.', '比较不同故事里的人物和经历'],
  'RL.10': ['I can read stories at my grade level.', '读懂本年级难度的故事'],
  'RI.1': ['I can answer questions about key details in a text.', '回答文章里关键细节的问题'],
  'RI.2': ['I can tell the main topic and key details.', '说出文章的主题和要点'],
  'RI.3': ['I can explain how events, ideas, or steps connect.', '说明事件、想法或步骤之间的联系'],
  'RI.4': ['I can figure out what words in a text mean.', '弄懂文章里词语的意思'],
  'RI.5': ['I can use text features to find facts.', '用标题、粗体字等找到信息'],
  'RI.6': ['I can tell what I learn from pictures and from words.', '分清从图片和文字里学到什么'],
  'RI.7': ['I can use pictures and details to describe ideas.', '用图片和细节说明内容'],
  'RI.8': ['I can find the reasons an author gives.', '找出作者给出的理由'],
  'RI.9': ['I can compare two texts on the same topic.', '比较同一主题的两篇文章'],
  'RI.10': ['I can read informational texts at my grade level.', '读懂本年级难度的说明文'],
  'L.1': ['I can use grammar correctly.', '正确使用语法'],
  'L.2': ['I can use capital letters, punctuation, and spelling.', '正确使用大写、标点和拼写'],
  'L.4': ['I can figure out what new words mean.', '推测生词的意思'],
  'L.5': ['I can sort words and find opposites.', '给词语分类、找反义词'],
  'L.6': ['I can use new words I have learned.', '用上学过的新词'],
  'W.1': ['I can write my opinion and give a reason.', '写出自己的观点并给出理由'],
  'W.2': ['I can write facts about a topic.', '写出关于一个主题的事实'],
  'W.3': ['I can write a story with events in order.', '按顺序写一个小故事'],
  'W.5': ['I can make my writing better.', '修改让写作更好'],
  'W.8': ['I can recall information to answer a question.', '回忆信息来回答问题'],
  'SL.1': ['I can take part in conversations.', '参与讨论，轮流发言'],
  'SL.2': ['I can retell and answer questions about what I hear.', '听后复述、回答问题'],
  'SL.3': ['I can ask questions to understand more.', '提问来弄懂更多'],
  'SL.4': ['I can describe people, places, and events clearly.', '清楚地描述人物、地点和事件'],
  'SL.6': ['I can speak in complete sentences.', '用完整的句子表达'],
};

const CODE = /^(RF|RL|RI|L|W|SL)\.(K|[1-5])\.(\d{1,2})([a-z])?$/;

/** 解析 "RI.1.1" 这样的代码；格式不对返回 null */
export function parseStandard(code) {
  const m = CODE.exec(String(code).trim());
  if (!m) return null;
  const [, strand, grade, num, sub = ''] = m;
  const [en, zh] = I_CAN[`${strand}.${Number(num)}`] || [`I can meet standard ${strand}.${num}.`, STRANDS[strand].zh];
  return { code: `${strand}.${grade}.${Number(num)}${sub}`, strand, grade, num: Number(num), ican: en, icanZh: zh };
}

/** 各年级春季朗读流利度的参考目标（每分钟词数，取 Hasbrouck & Tindal 常模中位数附近的整数） */
export const FLUENCY_GOALS = { K: 30, 1: 60, 2: 100, 3: 110, 4: 130, 5: 145 };

/** 标准化评分（standards-based grading）常用的 4 级 */
export const MASTERY = [
  { level: 4, min: 0.9, en: 'Exceeds', zh: '优秀' },
  { level: 3, min: 0.75, en: 'Meets', zh: '达标' },
  { level: 2, min: 0.5, en: 'Approaching', zh: '接近' },
  { level: 1, min: 0, en: 'Beginning', zh: '起步' },
];

export function mastery(ratio) {
  return MASTERY.find((m) => ratio >= m.min);
}

/** 朗读流利度：实际每分钟词数 ÷ 年级目标 */
export function fluencyMastery(ratio) {
  const level = ratio >= 1.15 ? 4 : ratio >= 1 ? 3 : ratio >= 0.75 ? 2 : 1;
  return MASTERY.find((m) => m.level === level);
}
