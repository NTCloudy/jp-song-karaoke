// Spaced repetition (a small SM-2 variant). grade: 0 忘了, 1 困難, 2 記得, 3 簡單.

const DAY = 86400000;

export function review(card, grade, now = Date.now()) {
  const c = { ...card };
  c.ease = c.ease || 2.5;
  c.reps = c.reps || 0;
  if (grade === 0) {
    c.reps = 0;
    c.lapses = (c.lapses || 0) + 1;
    c.interval = 0;
    c.due = now + 10 * 60000;                 // see it again in 10 minutes
    c.ease = Math.max(1.3, c.ease - 0.2);
    return c;
  }
  c.reps += 1;
  if (c.reps === 1) c.interval = grade === 3 ? 3 : 1;
  else if (c.reps === 2) c.interval = grade === 3 ? 7 : grade === 1 ? 2 : 4;
  else c.interval = Math.round(c.interval * (grade === 1 ? 1.2 : grade === 3 ? c.ease * 1.3 : c.ease));
  c.ease = Math.max(1.3, c.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0));
  c.due = now + c.interval * DAY;
  return c;
}

export const isDue = (card, now = Date.now()) => !card.due || card.due <= now;

export function nextLabel(card, grade, now = Date.now()) {
  const n = review(card, grade, now);
  const ms = n.due - now;
  return ms < 3600000 ? `${Math.round(ms / 60000)} 分` : `${Math.round(ms / DAY)} 天`;
}
