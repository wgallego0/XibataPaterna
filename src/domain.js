import { getDb, commit, id, token } from './store.js';

export const TIMEZONE = process.env.TZ_APP || 'America/Sao_Paulo';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de hoje no fuso da família, como 'YYYY-MM-DD'. */
export function today() {
  return dateFormatter.format(new Date());
}

export function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Dia da semana (0 = domingo) de uma data 'YYYY-MM-DD', sem depender do fuso local. */
export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateRange(from, to) {
  const out = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard++ < 1000) {
    out.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return out;
}

export const CHILD_COLORS = ['#2f7dff', '#f2622e', '#12a37a', '#a855f7', '#e0177f', '#f0a020'];

// ---------------------------------------------------------------- crianças

export function publicChild(child) {
  if (!child) return null;
  return {
    id: child.id,
    name: child.name,
    emoji: child.emoji,
    color: child.color,
    birthdate: child.birthdate || null,
    active: child.active !== false,
    cardToken: child.cardToken,
    cardPath: `/c/${child.cardToken}`,
    createdAt: child.createdAt,
  };
}

export function createChild({ name, emoji, color, birthdate }) {
  const db = getDb();
  const child = {
    id: id('c_'),
    name: name.trim(),
    emoji: emoji || '🧒',
    color: color || CHILD_COLORS[db.children.length % CHILD_COLORS.length],
    birthdate: birthdate || null,
    active: true,
    cardToken: token(18),
    createdAt: new Date().toISOString(),
  };
  commit((d) => d.children.push(child));
  return child;
}

export function findChildByToken(cardToken) {
  return getDb().children.find((c) => c.cardToken === cardToken) || null;
}

// ---------------------------------------------------------------- rotinas

export function publicRoutine(routine) {
  return {
    id: routine.id,
    childId: routine.childId,
    title: routine.title,
    description: routine.description || '',
    points: routine.points,
    weekdays: routine.weekdays,
    active: routine.active !== false,
    startDate: routine.startDate,
  };
}

/**
 * Materializa as tarefas das rotinas ativas para uma data.
 * Chamado antes de qualquer leitura para que a agenda do dia exista sozinha.
 */
export function materializeRoutines(dateStr) {
  if (dateStr > today()) return;
  const db = getDb();
  const weekday = weekdayOf(dateStr);
  const created = [];

  for (const routine of db.routines) {
    if (routine.active === false) continue;
    if (!routine.weekdays.includes(weekday)) continue;
    if (routine.startDate && dateStr < routine.startDate) continue;
    const child = db.children.find((c) => c.id === routine.childId);
    if (!child || child.active === false) continue;
    const exists = db.tasks.some((t) => t.routineId === routine.id && t.date === dateStr);
    if (exists) continue;
    created.push({
      id: id('t_'),
      childId: routine.childId,
      routineId: routine.id,
      date: dateStr,
      title: routine.title,
      description: routine.description || '',
      points: routine.points,
      status: 'pending',
      completedAt: null,
      createdAt: new Date().toISOString(),
      origin: 'rotina',
    });
  }

  if (created.length) commit((d) => d.tasks.push(...created));
  return created;
}

export function publicTask(task) {
  return {
    id: task.id,
    childId: task.childId,
    routineId: task.routineId || null,
    date: task.date,
    title: task.title,
    description: task.description || '',
    points: task.points,
    status: task.status,
    completedAt: task.completedAt,
    origin: task.origin || 'avulsa',
  };
}

export function tasksFor(dateStr, childId = null) {
  materializeRoutines(dateStr);
  return getDb().tasks
    .filter((t) => t.date === dateStr && (!childId || t.childId === childId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ------------------------------------------------------------- proatividade

export function publicProactive(entry) {
  return {
    id: entry.id,
    childId: entry.childId,
    date: entry.date,
    title: entry.title,
    description: entry.description || '',
    points: entry.points,
    status: entry.status,
    createdAt: entry.createdAt,
    reviewedAt: entry.reviewedAt || null,
  };
}

// ------------------------------------------------------------------ métricas

function emptyBucket() {
  return { assigned: 0, done: 0, points: 0, proactive: 0, proactiveApproved: 0, proactivePoints: 0 };
}

/**
 * Consolida KPIs do período: por dia, por filho e totais gerais.
 */
export function buildMetrics(from, to) {
  const db = getDb();
  const days = dateRange(from, to);
  const limit = today();
  for (const day of days) {
    if (day <= limit) materializeRoutines(day);
  }

  const tasks = db.tasks.filter((t) => t.date >= from && t.date <= to);
  const proactive = db.proactive.filter((p) => p.date >= from && p.date <= to);
  const children = db.children.filter((c) => c.active !== false);

  const byDay = new Map(days.map((d) => [d, { date: d, ...emptyBucket() }]));
  const byChild = new Map(children.map((c) => [c.id, { child: publicChild(c), ...emptyBucket(), streak: 0, perfectDays: 0 }]));

  for (const task of tasks) {
    const day = byDay.get(task.date);
    const child = byChild.get(task.childId);
    for (const bucket of [day, child]) {
      if (!bucket) continue;
      bucket.assigned += 1;
      if (task.status === 'done') {
        bucket.done += 1;
        bucket.points += task.points || 0;
      }
    }
  }

  for (const entry of proactive) {
    const day = byDay.get(entry.date);
    const child = byChild.get(entry.childId);
    for (const bucket of [day, child]) {
      if (!bucket) continue;
      bucket.proactive += 1;
      if (entry.status === 'approved') {
        bucket.proactiveApproved += 1;
        bucket.proactivePoints += entry.points || 0;
      }
    }
  }

  // Dias perfeitos e sequência atual (conta apenas dias que tinham tarefas).
  for (const [childId, bucket] of byChild) {
    const childTasks = tasks.filter((t) => t.childId === childId);
    const perDay = new Map();
    for (const t of childTasks) {
      const d = perDay.get(t.date) || { assigned: 0, done: 0 };
      d.assigned += 1;
      if (t.status === 'done') d.done += 1;
      perDay.set(t.date, d);
    }
    bucket.perfectDays = [...perDay.values()].filter((d) => d.assigned > 0 && d.done === d.assigned).length;
    bucket.activeDays = [...perDay.values()].filter((d) => d.done > 0).length;
    bucket.streak = currentStreak(childId);
    bucket.rate = bucket.assigned ? Math.round((bucket.done / bucket.assigned) * 100) : 0;
    bucket.totalPoints = bucket.points + bucket.proactivePoints;
  }

  const totals = { ...emptyBucket() };
  for (const bucket of byDay.values()) {
    totals.assigned += bucket.assigned;
    totals.done += bucket.done;
    totals.points += bucket.points;
    totals.proactive += bucket.proactive;
    totals.proactiveApproved += bucket.proactiveApproved;
    totals.proactivePoints += bucket.proactivePoints;
  }
  totals.rate = totals.assigned ? Math.round((totals.done / totals.assigned) * 100) : 0;
  totals.totalPoints = totals.points + totals.proactivePoints;
  totals.activeDays = [...byDay.values()].filter((d) => d.done > 0).length;
  totals.perfectDays = [...byDay.values()].filter((d) => d.assigned > 0 && d.done === d.assigned).length;
  totals.pendingReview = db.proactive.filter((p) => p.status === 'pending').length;

  return {
    range: { from, to },
    totals,
    byDay: [...byDay.values()],
    byChild: [...byChild.values()].sort((a, b) => b.totalPoints - a.totalPoints),
  };
}

/** Dias consecutivos, terminando hoje ou ontem, em que a criança concluiu tudo. */
export function currentStreak(childId) {
  const db = getDb();
  let cursor = today();
  let streak = 0;

  const dayStats = (date) => {
    const items = db.tasks.filter((t) => t.childId === childId && t.date === date);
    if (!items.length) return null;
    return items.every((t) => t.status === 'done');
  };

  // Um dia sem tarefas não quebra a sequência; um dia incompleto quebra.
  const todayStats = dayStats(cursor);
  if (todayStats === false) cursor = shiftDate(cursor, -1);

  for (let i = 0; i < 366; i += 1) {
    const stats = dayStats(cursor);
    if (stats === true) streak += 1;
    else if (stats === false) break;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}
