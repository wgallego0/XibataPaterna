// Teste ponta a ponta da API: sobe o servidor num diretório temporário e exercita
// todo o fluxo (setup, filhos, rotinas, carteirinha, proatividade, métricas).
// Execute com: npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xibata-test-'));
const PORT = 3000 + Math.floor(Math.random() * 1000);

const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'inherit'],
});

process.on('exit', () => {
  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('servidor não subiu a tempo')), 10000);
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('rodando')) { clearTimeout(timer); resolve(); }
  });
});

const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let cookieBackup = '';
const results = [];

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function check(name, cond, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' :: ' + extra}`);
}

const s0 = await call('GET', '/api/session');
check('setup necessário', s0.json.needsSetup === true, JSON.stringify(s0.json));
const today = s0.json.today;

// Acesso negado sem sessão
const denied = await call('GET', '/api/children');
check('dashboard bloqueado sem login', denied.status === 401);

const setup = await call('POST', '/api/session/setup', { name: 'Wagner', email: 'pai@casa.com', password: 'segredo123' });
check('setup cria responsável', setup.status === 201, JSON.stringify(setup.json));

const dup = await call('POST', '/api/session/setup', { name: 'X', email: 'y@z.com', password: 'abcdef' });
check('setup só roda uma vez', dup.status === 409);

const c1 = await call('POST', '/api/children', { name: 'Ana', emoji: '👧' });
const c2 = await call('POST', '/api/children', { name: 'Bruno', emoji: '👦' });
check('cadastro de filhos', c1.status === 201 && c2.status === 201, JSON.stringify(c1.json));
const ana = c1.json.child, bruno = c2.json.child;
check('carteirinha tem token', /^\/c\/[\w-]{20,}$/.test(ana.cardPath), ana.cardPath);

// Rotina em todos os dias da semana -> materializa hoje
const rot = await call('POST', '/api/routines', {
  childId: ana.id, title: 'Arrumar a cama', points: 10, weekdays: [0,1,2,3,4,5,6],
});
check('rotina criada', rot.status === 201, JSON.stringify(rot.json));

const day = await call('GET', `/api/tasks?date=${today}`);
check('rotina materializou tarefa do dia', day.json.tasks.some(t => t.title === 'Arrumar a cama' && t.origin === 'rotina'), JSON.stringify(day.json));

// Tarefa avulsa para os dois
const bulk = await call('POST', '/api/tasks', { childIds: [ana.id, bruno.id], title: 'Lavar a louça', points: 15, date: today });
check('tarefa em lote para 2 filhos', bulk.json.tasks.length === 2, JSON.stringify(bulk.json));

// --- Carteirinha (sem login)
cookie = '';
const card = await call('GET', `/api/card/${ana.cardPath.split('/')[2]}`);
check('carteirinha abre sem login', card.status === 200 && card.json.child.name === 'Ana', JSON.stringify(card.json).slice(0,200));
check('carteirinha lista 2 tarefas', card.json.tasks.length === 2, String(card.json.tasks.length));
check('carteirinha traz 7 dias', card.json.week.length === 7);

const taskId = card.json.tasks[0].id;
const tk = ana.cardPath.split('/')[2];
const toggled = await call('POST', `/api/card/${tk}/tasks/${taskId}`, { status: 'done' });
check('criança conclui tarefa', toggled.status === 200 && toggled.json.task.status === 'done', JSON.stringify(toggled.json));

// Não pode mexer em tarefa de outro filho
const brunoTask = bulk.json.tasks.find(t => t.childId === bruno.id);
const cross = await call('POST', `/api/card/${tk}/tasks/${brunoTask.id}`, { status: 'done' });
check('token não alcança tarefa de outro filho', cross.status === 404, String(cross.status));

// Token inválido
const bad = await call('GET', '/api/card/token-invalido');
check('token inválido -> 404', bad.status === 404);

// Criança não acessa dashboard
const kidDash = await call('GET', '/api/metrics');
check('criança não acessa métricas', kidDash.status === 401);

// Proatividade
const pro = await call('POST', `/api/card/${tk}/proactive`, { title: 'Organizei o armário', description: 'sem pedirem' });
check('proatividade registrada', pro.status === 201 && pro.json.entry.status === 'pending', JSON.stringify(pro.json));

const card2 = await call('GET', `/api/card/${tk}`);
check('proatividade aparece na carteirinha', card2.json.proactive.length === 1);
check('pontos contam só tarefa concluída', card2.json.summary.points === card2.json.tasks.find(t=>t.status==='done').points, JSON.stringify(card2.json.summary));

// --- Volta como responsável
const login = await call('POST', '/api/session/login', { email: 'pai@casa.com', password: 'segredo123' });
check('login do responsável', login.status === 200, JSON.stringify(login.json));
const badLogin = await call('POST', '/api/session/login', { email: 'pai@casa.com', password: 'errada' });
check('senha errada rejeitada', badLogin.status === 401);
// (login errado não deve derrubar a sessão boa)
await call('POST', '/api/session/login', { email: 'pai@casa.com', password: 'segredo123' });

const pending = await call('GET', '/api/proactive?status=pending');
check('responsável vê pendências', pending.json.entries.length === 1, JSON.stringify(pending.json));

const approve = await call('PATCH', `/api/proactive/${pro.json.entry.id}`, { status: 'approved', points: 8 });
check('aprovação de proatividade', approve.json.entry.status === 'approved' && approve.json.entry.points === 8, JSON.stringify(approve.json));

const metrics = await call('GET', `/api/metrics?from=${today}&to=${today}`);
const m = metrics.json;
check('métricas: 3 tarefas atribuídas', m.totals.assigned === 3, JSON.stringify(m.totals));
check('métricas: 1 concluída', m.totals.done === 1, JSON.stringify(m.totals));
check('métricas: taxa 33%', m.totals.rate === 33, String(m.totals.rate));
check('métricas: proatividade aprovada soma pontos', m.totals.proactivePoints === 8, JSON.stringify(m.totals));
check('métricas por filho ordenadas', m.byChild.length === 2 && m.byChild[0].child.name === 'Ana', JSON.stringify(m.byChild.map(x=>x.child.name)));

// Copiar dia
const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0,10);
const copy = await call('POST', '/api/tasks/copy', { from: today, to: tomorrow });
check('copiar dia', copy.json.tasks.length === 3 && copy.json.tasks.every(t => t.status === 'pending'), JSON.stringify(copy.json.tasks.length));
const copy2 = await call('POST', '/api/tasks/copy', { from: today, to: tomorrow });
check('copiar dia é idempotente', copy2.json.tasks.length === 0, JSON.stringify(copy2.json));

// Rotate token invalida o antigo
const rotated = await call('POST', `/api/children/${ana.id}/rotate-token`);
const oldToken = await call('GET', `/api/card/${tk}`);
check('link antigo deixa de funcionar', oldToken.status === 404);
const newTk = rotated.json.child.cardToken;
const fresh = await call('GET', `/api/card/${newTk}`);
check('link novo funciona', fresh.status === 200);

// Segundo responsável
const p2 = await call('POST', '/api/parents', { name: 'Maria', email: 'mae@casa.com', password: 'outra123' });
check('segundo responsável', p2.status === 201);
const p2dup = await call('POST', '/api/parents', { name: 'Maria', email: 'mae@casa.com', password: 'outra123' });
check('e-mail duplicado rejeitado', p2dup.status === 409);

// Validações
check('título vazio rejeitado', (await call('POST', '/api/tasks', { childIds: [ana.id], title: '  ' })).status === 400);
check('data inválida rejeitada', (await call('GET', '/api/tasks?date=31-12-2026')).status === 400);
check('rotina sem dias rejeitada', (await call('POST', '/api/routines', { childId: ana.id, title: 'x', weekdays: [] })).status === 400);
check('filho inexistente -> 404', (await call('POST', '/api/tasks', { childIds: ['c_naoexiste'], title: 'x' })).status === 404);

// PATCH inválido não pode alterar o estado pela metade
const anaTasks = await call('GET', `/api/tasks?date=${today}`);
const alvo = anaTasks.json.tasks.find(t => t.childId === ana.id);
const badPatch = await call('PATCH', `/api/tasks/${alvo.id}`, { points: 99, title: '   ' });
check('PATCH inválido rejeitado', badPatch.status === 400, JSON.stringify(badPatch.json));
const depois = await call('GET', `/api/tasks?date=${today}`);
const alvoDepois = depois.json.tasks.find(t => t.id === alvo.id);
check('PATCH inválido não alterou nada', alvoDepois.points === alvo.points && alvoDepois.title === alvo.title,
  JSON.stringify({ antes: alvo, depois: alvoDepois }));

// Criança não altera dias passados
const ontem = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
const ontemTask = await call('POST', '/api/tasks', { childIds: [ana.id], title: 'Tarefa de ontem', date: ontem });
cookieBackup = cookie; cookie = '';
const passado = await call('POST', `/api/card/${newTk}/tasks/${ontemTask.json.tasks[0].id}`, { status: 'done' });
check('criança não marca dia passado', passado.status === 409, String(passado.status));

// Limite diário de proatividades
let ultimo = 201;
for (let i = 0; i < 11; i += 1) {
  ultimo = (await call('POST', `/api/card/${newTk}/proactive`, { title: `Extra ${i}` })).status;
}
check('limite diário de proatividade', ultimo === 429, String(ultimo));
cookie = cookieBackup;

// Path traversal
const trav = await fetch(BASE + '/../src/server.js');
check('path traversal barrado', trav.status === 200 && (await trav.text()).includes('<!doctype html>'));
const trav2 = await fetch(BASE + '/%2e%2e/package.json');
check('path traversal codificado barrado', !(await trav2.text()).includes('"name": "xibata-paterna"'));

// Estáticos e rotas
check('/ serve o painel', (await (await fetch(BASE + '/')).text()).includes('XibataPaterna'));
check('/c/<token> serve a carteirinha', (await (await fetch(BASE + '/c/' + newTk)).text()).includes('Carteirinha'));
check('manifest servido', (await fetch(BASE + '/manifest.webmanifest')).headers.get('content-type').includes('manifest'));
check('sw.js servido', (await fetch(BASE + '/sw.js')).status === 200);
check('ícone png servido', (await fetch(BASE + '/icons/icon-192.png')).status === 200);

// Logout
const out = await call('POST', '/api/session/logout');
check('logout', out.status === 200);
check('sessão encerrada', (await call('GET', '/api/children')).status === 401);

console.log(results.join('\n'));
const failed = results.filter(r => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} testes passaram`);
process.exit(failed.length ? 1 : 0);
