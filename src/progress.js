// 记录当天的做题进度（保存在浏览器 localStorage，按日期区分）。
// 答题记录按“题目”保存而不是按序号，换难度后题目变了也不会串，换回来记录还在。

const PREFIX = 'after-school:v2:';

export const STARS = { firstTry: 2, corrected: 1, check: 2, evidence: 1 };

export class Progress extends EventTarget {
  constructor(homework) {
    super();
    this.key = PREFIX + homework.date;
    this.state = this.#load();
    this.#use(homework);
  }

  /** 换难度后作业内容变了，进度保持不变 */
  setHomework(homework) {
    this.#use(homework);
    this.dispatchEvent(new CustomEvent('change', { detail: { homework: true } }));
  }

  #use(homework) {
    this.homework = homework;
    this.allTasks = homework.subjects.flatMap((s) => s.tasks);
  }

  #load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key));
      if (saved && typeof saved.tasks === 'object') return saved;
    } catch {
      // 没有存档或存档损坏时从头开始
    }
    return { tasks: {} };
  }

  #commit(detail) {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // 隐私模式等情况下无法保存，本次页面内仍可正常使用
    }
    this.dispatchEvent(new CustomEvent('change', { detail }));
  }

  #task(id) {
    return (this.state.tasks[id] ||= { done: false, verified: false, answers: {} });
  }

  record(task, qi) {
    return this.state.tasks[task.id]?.answers?.[task.questions[qi].key];
  }

  submit(task, qi, given, correct) {
    const wasDone = this.isDone(task);
    const answers = this.#task(task.id).answers;
    const key = task.questions[qi].key;
    const rec = (answers[key] ||= { first: given, firstCorrect: correct, tries: 0, solved: false, revealed: false });
    if (rec.solved) return rec;
    rec.tries += 1;
    rec.last = given;
    if (correct) rec.solved = true;
    this.#commit({ task, completed: !wasDone && this.isDone(task) });
    return rec;
  }

  reveal(task, qi) {
    const rec = this.record(task, qi);
    if (!rec || rec.solved) return rec;
    const wasDone = this.isDone(task);
    rec.solved = true;
    rec.revealed = true;
    this.#commit({ task, completed: !wasDone && this.isDone(task) });
    return rec;
  }

  /** 答对后在文章里找证据 */
  submitEvidence(task, qi, correct) {
    const rec = this.record(task, qi);
    if (!rec?.solved || rec.evidenceDone) return rec;
    const wasDone = this.isDone(task);
    rec.evidenceTries = (rec.evidenceTries || 0) + 1;
    if (correct) {
      rec.evidenceDone = true;
      rec.evidenceFirst = rec.evidenceTries === 1;
    }
    this.#commit({ task, completed: !wasDone && this.isDone(task) });
    return rec;
  }

  revealEvidence(task, qi) {
    const rec = this.record(task, qi);
    if (!rec?.solved || rec.evidenceDone) return rec;
    const wasDone = this.isDone(task);
    rec.evidenceDone = true;
    rec.evidenceRevealed = true;
    this.#commit({ task, completed: !wasDone && this.isDone(task) });
    return rec;
  }

  /** 一道题算完成：答对了，并且（如果要求）找到了证据 */
  questionDone(task, qi) {
    const rec = this.record(task, qi);
    return !!rec?.solved && (!task.questions[qi].evidence || !!rec.evidenceDone);
  }

  /** 写作：清单全部通过才算完成；可以反复修改 */
  saveWriting(task, text, passed) {
    const ts = this.#task(task.id);
    const wasDone = ts.done;
    ts.writing = text;
    if (passed) ts.done = true;
    // 内容改了，需要家长重新看
    ts.verified = false;
    this.#commit({ task, completed: !wasDone && ts.done });
  }

  writing(task) {
    return this.state.tasks[task.id]?.writing ?? '';
  }

  /** 朗读计时：保留最近 5 次 */
  saveFluency(task, result) {
    const ts = this.#task(task.id);
    const wasDone = ts.done;
    ts.fluency = [...(ts.fluency || []), result].slice(-5);
    ts.done = true;
    this.#commit({ task, completed: !wasDone });
  }

  fluencyRuns(task) {
    return this.state.tasks[task.id]?.fluency ?? [];
  }

  setChecked(task, done) {
    const ts = this.#task(task.id);
    if (ts.done === done) return;
    ts.done = done;
    if (!done) ts.verified = false;
    this.#commit({ task, completed: done });
  }

  setVerified(task, verified) {
    this.#task(task.id).verified = verified;
    this.#commit({ task, completed: false });
  }

  isDone(task) {
    if (task.kind !== 'quiz') return !!this.state.tasks[task.id]?.done;
    return task.questions.every((_, i) => this.questionDone(task, i));
  }

  isVerified(task) {
    return !!this.state.tasks[task.id]?.verified;
  }

  taskFraction(task) {
    if (task.kind !== 'quiz') return this.isDone(task) ? 1 : 0;
    const done = task.questions.filter((_, i) => this.questionDone(task, i)).length;
    return done / task.questions.length;
  }

  subjectFraction(subject) {
    return subject.tasks.reduce((sum, t) => sum + this.taskFraction(t), 0) / subject.tasks.length;
  }

  overall() {
    return this.allTasks.reduce((sum, t) => sum + this.taskFraction(t), 0) / this.allTasks.length;
  }

  remainingTasks() {
    return this.allTasks.filter((t) => !this.isDone(t)).length;
  }

  /** 今天一共得到的星星，包括在其他难度下得到的 */
  stars() {
    let total = 0;
    for (const ts of Object.values(this.state.tasks)) {
      if (ts.done) total += STARS.check;
      for (const rec of Object.values(ts.answers || {})) total += questionStars(rec);
    }
    return total;
  }

  reset() {
    this.state = { tasks: {} };
    this.#commit({ reset: true });
  }
}

export function questionStars(rec) {
  if (!rec?.solved) return 0;
  const evidence = rec.evidenceFirst ? STARS.evidence : 0;
  if (rec.revealed) return evidence;
  return (rec.firstCorrect ? STARS.firstTry : STARS.corrected) + evidence;
}
