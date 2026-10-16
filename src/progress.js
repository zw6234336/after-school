// 记录当天的做题进度（保存在浏览器 localStorage，按日期区分）。

const PREFIX = 'after-school:v1:';

export const STARS = { firstTry: 2, corrected: 1, check: 2 };

export class Progress extends EventTarget {
  constructor(homework) {
    super();
    this.homework = homework;
    this.key = PREFIX + homework.date;
    this.allTasks = homework.subjects.flatMap((s) => s.tasks);
    this.state = this.#load();
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
    return this.state.tasks[task.id]?.answers?.[qi];
  }

  submit(task, qi, given, correct) {
    const ts = this.#task(task.id);
    const rec = (ts.answers[qi] ||= { first: given, firstCorrect: correct, tries: 0, solved: false, revealed: false });
    if (rec.solved) return rec;
    rec.tries += 1;
    rec.last = given;
    if (correct) rec.solved = true;
    const wasDone = ts.done;
    ts.done = task.questions.every((_, i) => ts.answers[i]?.solved);
    this.#commit({ task, completed: ts.done && !wasDone });
    return rec;
  }

  reveal(task, qi) {
    const ts = this.#task(task.id);
    const rec = ts.answers[qi];
    if (!rec || rec.solved) return rec;
    rec.solved = true;
    rec.revealed = true;
    const wasDone = ts.done;
    ts.done = task.questions.every((_, i) => ts.answers[i]?.solved);
    this.#commit({ task, completed: ts.done && !wasDone });
    return rec;
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
    return !!this.state.tasks[task.id]?.done;
  }

  isVerified(task) {
    return !!this.state.tasks[task.id]?.verified;
  }

  taskFraction(task) {
    if (task.kind === 'check') return this.isDone(task) ? 1 : 0;
    const solved = task.questions.filter((_, i) => this.record(task, i)?.solved).length;
    return solved / task.questions.length;
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

  stars() {
    let total = 0;
    for (const task of this.allTasks) {
      if (task.kind === 'check') {
        if (this.isDone(task)) total += STARS.check;
        continue;
      }
      task.questions.forEach((_, i) => (total += questionStars(this.record(task, i))));
    }
    return total;
  }

  reset() {
    this.state = { tasks: {} };
    this.#commit({ reset: true });
  }
}

export function questionStars(rec) {
  if (!rec?.solved || rec.revealed) return 0;
  return rec.firstCorrect ? STARS.firstTry : STARS.corrected;
}
