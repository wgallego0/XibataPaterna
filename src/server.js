import http from 'node:http';
import { getDb, commit, id, token as newToken } from './store.js';
import {
  createParent, createSession, destroySession, parentFromRequest,
  publicParent, readCookie, sessionCookie, verifyPassword,
} from './auth.js';
import {
  CHILD_COLORS, buildMetrics, createChild, currentStreak, findChildByToken,
  isValidDate, materializeRoutines, publicChild, publicProactive, publicRoutine,
  publicTask, shiftDate, tasksFor, today,
} from './domain.js';
import { HttpError, readBody, sendFile, sendJson, serveStatic } from './http.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// ------------------------------------------------------------------ helpers

function requireParent(req) {
  const parent = parentFromRequest(req);
  if (!parent) throw new HttpError(401, 'Faça login como responsável para continuar.');
  return parent;
}

function requireString(value, field, { max = 200, min = 1 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new HttpError(400, `Campo "${field}" é obrigatório.`);
  }
  if (value.trim().length > max) throw new HttpError(400, `Campo "${field}" excede ${max} caracteres.`);
  return value.trim();
}

function parsePoints(value, fallback = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function parseWeekdays(value) {
  if (!Array.isArray(value)) throw new HttpError(400, 'Informe os dias da semana da rotina.');
  const days = [...new Set(value.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (!days.length) throw new HttpError(400, 'Selecione ao menos um dia da semana.');
  return days.sort();
}

function dateParam(url, key = 'date') {
  const raw = url.searchParams.get(key);
  if (!raw) return today();
  if (!isValidDate(raw)) throw new HttpError(400, 'Data inválida (use AAAA-MM-DD).');
  return raw;
}

function childOr404(childId) {
  const child = getDb().children.find((c) => c.id === childId);
  if (!child) throw new HttpError(404, 'Criança não encontrada.');
  return child;
}

// ------------------------------------------------------------------- rotas

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// --- sessão / responsáveis
route('GET', '/api/session', async (ctx) => {
  const db = getDb();
  const parent = parentFromRequest(ctx.req);
  return sendJson(ctx.res, 200, {
    needsSetup: db.parents.length === 0,
    parent: publicParent(parent),
    today: today(),
  });
});

route('POST', '/api/session/setup', async (ctx) => {
  const db = getDb();
  if (db.parents.length > 0) throw new HttpError(409, 'Este sistema já possui um responsável cadastrado.');
  const body = await readBody(ctx.req);
  const name = requireString(body.name, 'nome');
  const email = requireString(body.email, 'e-mail').toLowerCase();
  const password = requireString(body.password, 'senha', { min: 6 });
  const parent = createParent({ name, email, password });
  const session = createSession(parent.id);
  return sendJson(ctx.res, 201, { parent: publicParent(parent) }, { 'Set-Cookie': sessionCookie(session.token, { secure: ctx.secure }) });
});

route('POST', '/api/session/login', async (ctx) => {
  const body = await readBody(ctx.req);
  const email = requireString(body.email, 'e-mail').toLowerCase();
  const password = requireString(body.password, 'senha');
  const parent = getDb().parents.find((p) => p.email === email);
  if (!parent || !verifyPassword(password, parent.salt, parent.hash)) {
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  const session = createSession(parent.id);
  return sendJson(ctx.res, 200, { parent: publicParent(parent) }, { 'Set-Cookie': sessionCookie(session.token, { secure: ctx.secure }) });
});

route('POST', '/api/session/logout', async (ctx) => {
  const sessionToken = readCookie(ctx.req, 'xp_session');
  if (sessionToken) destroySession(sessionToken);
  return sendJson(ctx.res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', { maxAge: 0, secure: ctx.secure }) });
});

// Um responsável já autenticado pode convidar outro responsável.
route('GET', '/api/parents', async (ctx) => {
  requireParent(ctx.req);
  return sendJson(ctx.res, 200, { parents: getDb().parents.map(publicParent) });
});

route('POST', '/api/parents', async (ctx) => {
  requireParent(ctx.req);
  const body = await readBody(ctx.req);
  const name = requireString(body.name, 'nome');
  const email = requireString(body.email, 'e-mail').toLowerCase();
  const password = requireString(body.password, 'senha', { min: 6 });
  if (getDb().parents.some((p) => p.email === email)) throw new HttpError(409, 'Já existe um responsável com este e-mail.');
  const parent = createParent({ name, email, password });
  return sendJson(ctx.res, 201, { parent: publicParent(parent) });
});

route('DELETE', '/api/parents/:id', async (ctx) => {
  const me = requireParent(ctx.req);
  const db = getDb();
  if (db.parents.length <= 1) throw new HttpError(409, 'É preciso manter ao menos um responsável.');
  if (ctx.params.id === me.id) throw new HttpError(409, 'Você não pode remover a si mesmo.');
  const exists = db.parents.some((p) => p.id === ctx.params.id);
  if (!exists) throw new HttpError(404, 'Responsável não encontrado.');
  commit((d) => {
    d.parents = d.parents.filter((p) => p.id !== ctx.params.id);
    d.sessions = d.sessions.filter((s) => s.parentId !== ctx.params.id);
  });
  return sendJson(ctx.res, 200, { ok: true });
});

// --- crianças
route('GET', '/api/children', async (ctx) => {
  requireParent(ctx.req);
  const children = getDb().children.map((c) => ({ ...publicChild(c), streak: currentStreak(c.id) }));
  return sendJson(ctx.res, 200, { children, colors: CHILD_COLORS });
});

route('POST', '/api/children', async (ctx) => {
  requireParent(ctx.req);
  const body = await readBody(ctx.req);
  const name = requireString(body.name, 'nome', { max: 60 });
  const child = createChild({ name, emoji: body.emoji, color: body.color, birthdate: body.birthdate });
  return sendJson(ctx.res, 201, { child: publicChild(child) });
});

route('PATCH', '/api/children/:id', async (ctx) => {
  requireParent(ctx.req);
  const child = childOr404(ctx.params.id);
  const body = await readBody(ctx.req);
  // Valida tudo antes de tocar no estado: um campo inválido não pode deixar
  // a memória alterada pela metade e o arquivo desatualizado.
  const patch = {};
  if (body.name !== undefined) patch.name = requireString(body.name, 'nome', { max: 60 });
  if (body.emoji !== undefined) patch.emoji = String(body.emoji).slice(0, 8) || '🧒';
  if (body.color !== undefined) patch.color = String(body.color).slice(0, 20);
  if (body.birthdate !== undefined) patch.birthdate = body.birthdate || null;
  if (body.active !== undefined) patch.active = Boolean(body.active);
  commit(() => Object.assign(child, patch));
  return sendJson(ctx.res, 200, { child: publicChild(child) });
});

route('POST', '/api/children/:id/rotate-token', async (ctx) => {
  requireParent(ctx.req);
  const child = childOr404(ctx.params.id);
  commit(() => { child.cardToken = newToken(18); });
  return sendJson(ctx.res, 200, { child: publicChild(child) });
});

route('DELETE', '/api/children/:id', async (ctx) => {
  requireParent(ctx.req);
  childOr404(ctx.params.id);
  commit((d) => {
    d.children = d.children.filter((c) => c.id !== ctx.params.id);
    d.tasks = d.tasks.filter((t) => t.childId !== ctx.params.id);
    d.routines = d.routines.filter((r) => r.childId !== ctx.params.id);
    d.proactive = d.proactive.filter((p) => p.childId !== ctx.params.id);
  });
  return sendJson(ctx.res, 200, { ok: true });
});

// --- rotinas (tarefas recorrentes)
route('GET', '/api/routines', async (ctx) => {
  requireParent(ctx.req);
  return sendJson(ctx.res, 200, { routines: getDb().routines.map(publicRoutine) });
});

route('POST', '/api/routines', async (ctx) => {
  requireParent(ctx.req);
  const body = await readBody(ctx.req);
  childOr404(body.childId);
  const routine = {
    id: id('r_'),
    childId: body.childId,
    title: requireString(body.title, 'título', { max: 80 }),
    description: (body.description || '').toString().slice(0, 300),
    points: parsePoints(body.points),
    weekdays: parseWeekdays(body.weekdays),
    active: true,
    startDate: isValidDate(body.startDate) ? body.startDate : today(),
    createdAt: new Date().toISOString(),
  };
  commit((d) => d.routines.push(routine));
  materializeRoutines(today());
  return sendJson(ctx.res, 201, { routine: publicRoutine(routine) });
});

route('PATCH', '/api/routines/:id', async (ctx) => {
  requireParent(ctx.req);
  const routine = getDb().routines.find((r) => r.id === ctx.params.id);
  if (!routine) throw new HttpError(404, 'Rotina não encontrada.');
  const body = await readBody(ctx.req);
  const patch = {};
  if (body.title !== undefined) patch.title = requireString(body.title, 'título', { max: 80 });
  if (body.description !== undefined) patch.description = String(body.description).slice(0, 300);
  if (body.points !== undefined) patch.points = parsePoints(body.points, routine.points);
  if (body.weekdays !== undefined) patch.weekdays = parseWeekdays(body.weekdays);
  if (body.active !== undefined) patch.active = Boolean(body.active);
  commit(() => Object.assign(routine, patch));
  return sendJson(ctx.res, 200, { routine: publicRoutine(routine) });
});

route('DELETE', '/api/routines/:id', async (ctx) => {
  requireParent(ctx.req);
  const routine = getDb().routines.find((r) => r.id === ctx.params.id);
  if (!routine) throw new HttpError(404, 'Rotina não encontrada.');
  commit((d) => {
    d.routines = d.routines.filter((r) => r.id !== ctx.params.id);
    // Mantém o histórico: só remove as ocorrências futuras/pendentes de hoje.
    d.tasks = d.tasks.filter((t) => !(t.routineId === ctx.params.id && t.date >= today() && t.status === 'pending'));
  });
  return sendJson(ctx.res, 200, { ok: true });
});

// --- tarefas do dia
route('GET', '/api/tasks', async (ctx) => {
  requireParent(ctx.req);
  const date = dateParam(ctx.url);
  const childId = ctx.url.searchParams.get('childId');
  return sendJson(ctx.res, 200, { date, tasks: tasksFor(date, childId).map(publicTask) });
});

route('POST', '/api/tasks', async (ctx) => {
  requireParent(ctx.req);
  const body = await readBody(ctx.req);
  const date = isValidDate(body.date) ? body.date : today();
  const childIds = Array.isArray(body.childIds) && body.childIds.length ? body.childIds : [body.childId];
  const title = requireString(body.title, 'título', { max: 80 });
  const description = (body.description || '').toString().slice(0, 300);
  const points = parsePoints(body.points);
  const created = [];
  for (const childId of childIds) {
    childOr404(childId);
    created.push({
      id: id('t_'),
      childId,
      routineId: null,
      date,
      title,
      description,
      points,
      status: 'pending',
      completedAt: null,
      createdAt: new Date().toISOString(),
      origin: 'avulsa',
    });
  }
  commit((d) => d.tasks.push(...created));
  return sendJson(ctx.res, 201, { tasks: created.map(publicTask) });
});

route('PATCH', '/api/tasks/:id', async (ctx) => {
  requireParent(ctx.req);
  const task = getDb().tasks.find((t) => t.id === ctx.params.id);
  if (!task) throw new HttpError(404, 'Tarefa não encontrada.');
  const body = await readBody(ctx.req);
  const patch = {};
  if (body.title !== undefined) patch.title = requireString(body.title, 'título', { max: 80 });
  if (body.description !== undefined) patch.description = String(body.description).slice(0, 300);
  if (body.points !== undefined) patch.points = parsePoints(body.points, task.points);
  if (body.status !== undefined) Object.assign(patch, statusPatch(body.status));
  commit(() => Object.assign(task, patch));
  return sendJson(ctx.res, 200, { task: publicTask(task) });
});

route('DELETE', '/api/tasks/:id', async (ctx) => {
  requireParent(ctx.req);
  const exists = getDb().tasks.some((t) => t.id === ctx.params.id);
  if (!exists) throw new HttpError(404, 'Tarefa não encontrada.');
  commit((d) => { d.tasks = d.tasks.filter((t) => t.id !== ctx.params.id); });
  return sendJson(ctx.res, 200, { ok: true });
});

/** Copia a agenda de um dia para outro — atalho para "repetir o dia de ontem". */
route('POST', '/api/tasks/copy', async (ctx) => {
  requireParent(ctx.req);
  const body = await readBody(ctx.req);
  if (!isValidDate(body.from) || !isValidDate(body.to)) throw new HttpError(400, 'Informe as datas de origem e destino.');
  const source = tasksFor(body.from, body.childId || null);
  const db = getDb();
  const created = source
    .filter((t) => !db.tasks.some((x) => x.date === body.to && x.childId === t.childId && x.title === t.title))
    .map((t) => ({
      id: id('t_'),
      childId: t.childId,
      routineId: null,
      date: body.to,
      title: t.title,
      description: t.description,
      points: t.points,
      status: 'pending',
      completedAt: null,
      createdAt: new Date().toISOString(),
      origin: 'copiada',
    }));
  commit((d) => d.tasks.push(...created));
  return sendJson(ctx.res, 201, { tasks: created.map(publicTask) });
});

function statusPatch(status) {
  if (!['pending', 'done'].includes(status)) throw new HttpError(400, 'Status inválido.');
  return { status, completedAt: status === 'done' ? new Date().toISOString() : null };
}

// --- proatividade (revisão pelo responsável)
route('GET', '/api/proactive', async (ctx) => {
  requireParent(ctx.req);
  const status = ctx.url.searchParams.get('status');
  let entries = getDb().proactive;
  if (status) entries = entries.filter((p) => p.status === status);
  entries = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  return sendJson(ctx.res, 200, { entries: entries.map(publicProactive) });
});

route('PATCH', '/api/proactive/:id', async (ctx) => {
  requireParent(ctx.req);
  const entry = getDb().proactive.find((p) => p.id === ctx.params.id);
  if (!entry) throw new HttpError(404, 'Registro não encontrado.');
  const body = await readBody(ctx.req);
  const patch = {};
  if (body.status !== undefined) {
    if (!['pending', 'approved', 'rejected'].includes(body.status)) throw new HttpError(400, 'Status inválido.');
    patch.status = body.status;
    patch.reviewedAt = new Date().toISOString();
  }
  if (body.points !== undefined) patch.points = parsePoints(body.points, entry.points);
  commit(() => Object.assign(entry, patch));
  return sendJson(ctx.res, 200, { entry: publicProactive(entry) });
});

// --- métricas
route('GET', '/api/metrics', async (ctx) => {
  requireParent(ctx.req);
  const to = dateParam(ctx.url, 'to');
  const fromRaw = ctx.url.searchParams.get('from');
  const from = isValidDate(fromRaw) ? fromRaw : shiftDate(to, -29);
  if (from > to) throw new HttpError(400, 'A data inicial deve ser anterior à final.');
  return sendJson(ctx.res, 200, buildMetrics(from, to));
});

// --- carteirinha (acesso da criança via token, sem senha)
route('GET', '/api/card/:token', async (ctx) => {
  const child = findChildByToken(ctx.params.token);
  if (!child || child.active === false) throw new HttpError(404, 'Carteirinha não encontrada.');
  const date = dateParam(ctx.url);
  const tasks = tasksFor(date, child.id).map(publicTask);
  const proactive = getDb().proactive
    .filter((p) => p.childId === child.id && p.date === date)
    .map(publicProactive);
  const done = tasks.filter((t) => t.status === 'done');
  const week = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = shiftDate(date, -i);
    const dayTasks = getDb().tasks.filter((t) => t.childId === child.id && t.date === d);
    week.push({
      date: d,
      assigned: dayTasks.length,
      done: dayTasks.filter((t) => t.status === 'done').length,
    });
  }
  return sendJson(ctx.res, 200, {
    child: { id: child.id, name: child.name, emoji: child.emoji, color: child.color },
    date,
    today: today(),
    tasks,
    proactive,
    week,
    summary: {
      assigned: tasks.length,
      done: done.length,
      rate: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
      points: done.reduce((sum, t) => sum + (t.points || 0), 0)
        + proactive.filter((p) => p.status === 'approved').reduce((sum, p) => sum + (p.points || 0), 0),
      streak: currentStreak(child.id),
    },
  });
});

route('POST', '/api/card/:token/tasks/:taskId', async (ctx) => {
  const child = findChildByToken(ctx.params.token);
  if (!child || child.active === false) throw new HttpError(404, 'Carteirinha não encontrada.');
  const task = getDb().tasks.find((t) => t.id === ctx.params.taskId && t.childId === child.id);
  if (!task) throw new HttpError(404, 'Tarefa não encontrada.');
  if (task.date !== today()) throw new HttpError(409, 'Só é possível marcar as tarefas do dia de hoje.');
  const body = await readBody(ctx.req);
  const patch = statusPatch(body.status === 'done' ? 'done' : 'pending');
  commit(() => Object.assign(task, patch));
  return sendJson(ctx.res, 200, { task: publicTask(task) });
});

route('POST', '/api/card/:token/proactive', async (ctx) => {
  const child = findChildByToken(ctx.params.token);
  if (!child || child.active === false) throw new HttpError(404, 'Carteirinha não encontrada.');
  const body = await readBody(ctx.req);
  const entry = {
    id: id('pa_'),
    childId: child.id,
    date: today(),
    title: requireString(body.title, 'título', { max: 80 }),
    description: (body.description || '').toString().slice(0, 300),
    points: parsePoints(body.points, 5),
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
  };
  const sameDay = getDb().proactive.filter((p) => p.childId === child.id && p.date === entry.date);
  if (sameDay.length >= 10) throw new HttpError(429, 'Você já registrou muitas atividades hoje. Fale com o responsável.');
  commit((d) => d.proactive.push(entry));
  return sendJson(ctx.res, 201, { entry: publicProactive(entry) });
});

// ------------------------------------------------------------------ router

function match(routeDef, method, pathname) {
  if (routeDef.method !== method) return null;
  const parts = routeDef.pattern.split('/');
  const actual = pathname.split('/');
  if (parts.length !== actual.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(actual[i]);
    else if (parts[i] !== actual[i]) return null;
  }
  return params;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const secure = req.headers['x-forwarded-proto'] === 'https';

  try {
    if (pathname.startsWith('/api/')) {
      for (const routeDef of routes) {
        const params = match(routeDef, req.method, pathname);
        if (params) return await routeDef.handler({ req, res, url, params, secure });
      }
      throw new HttpError(404, 'Rota não encontrada.');
    }

    // Carteirinha: /c/<token> serve o app da criança; o token é lido no cliente.
    if (pathname.startsWith('/c/')) return sendFile(res, 'carteirinha.html');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');
    if (serveStatic(res, pathname)) return undefined;
    return sendFile(res, 'index.html');
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[erro]', err);
    return sendJson(res, status, { error: err.message || 'Erro interno.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`XibataPaterna rodando em http://localhost:${PORT}`);
});

export default server;
