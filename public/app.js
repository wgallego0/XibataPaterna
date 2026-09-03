// Painel gerencial do responsável.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const EMOJIS = ['🧒', '👦', '👧', '🐣', '🦊', '🐼', '🦁', '🐨', '🚀', '⚽', '🎸', '🦄', '🐙', '🌟'];

const state = {
  parent: null,
  today: null,
  children: [],
  colors: [],
  routines: [],
  metrics: null,
  editing: {},
};

// ------------------------------------------------------------------- utils

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Erro ${res.status}`);
  return payload;
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3600);
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function shortDate(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function childById(id) {
  return state.children.find((c) => c.id === id);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function openDialog(dialog) {
  dialog.showModal();
}

$$('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

// -------------------------------------------------------------- inicializar

async function boot() {
  const session = await api('/api/session');
  state.today = session.today;

  if (session.parent) {
    state.parent = session.parent;
    return showApp();
  }
  $('#view-auth').classList.remove('hidden');
  $(session.needsSetup ? '#form-setup' : '#form-login').classList.remove('hidden');
}

$('#form-setup').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const { parent } = await api('/api/session/setup', {
      method: 'POST',
      body: {
        name: $('#setup-name').value,
        email: $('#setup-email').value,
        password: $('#setup-password').value,
      },
    });
    state.parent = parent;
    $('#view-auth').classList.add('hidden');
    await showApp();
  } catch (err) { toast(err.message, 'error'); }
});

$('#form-login').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const { parent } = await api('/api/session/login', {
      method: 'POST',
      body: { email: $('#login-email').value, password: $('#login-password').value },
    });
    state.parent = parent;
    $('#view-auth').classList.add('hidden');
    await showApp();
  } catch (err) { toast(err.message, 'error'); }
});

$('#btn-logout').addEventListener('click', async () => {
  await api('/api/session/logout', { method: 'POST' });
  location.reload();
});

async function showApp() {
  $('#view-auth').classList.add('hidden');
  $('#view-app').classList.remove('hidden');
  $('#parent-name').textContent = state.parent.name;

  $('#day-date').value = state.today;
  $('#task-date').value = state.today;
  $('#range-to').value = state.today;
  $('#range-from').value = shiftDate(state.today, -29);

  buildStaticInputs();
  await refreshChildren();
  await Promise.all([loadMetrics(), loadDay(), loadRoutines(), loadProactive(), loadParents()]);
}

function buildStaticInputs() {
  $('#child-emoji').innerHTML = EMOJIS.map((e) => `<option value="${e}">${e}</option>`).join('');
  $('#routine-weekdays').innerHTML = WEEKDAY_LABELS.map((label, index) => `
    <label class="pill" style="cursor:pointer">
      <input type="checkbox" value="${index}" style="width:auto;margin:0 4px 0 0"> ${label}
    </label>`).join('');
}

// ------------------------------------------------------------------- abas

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab.dataset.tab}`));
}));

// -------------------------------------------------------------- dashboard

$$('[data-range]').forEach((btn) => btn.addEventListener('click', () => {
  $('#range-to').value = state.today;
  $('#range-from').value = shiftDate(state.today, -(Number(btn.dataset.range) - 1));
  loadMetrics();
}));
$('#range-from').addEventListener('change', loadMetrics);
$('#range-to').addEventListener('change', loadMetrics);

async function loadMetrics() {
  const from = $('#range-from').value;
  const to = $('#range-to').value;
  if (!from || !to || from > to) return;
  try {
    state.metrics = await api(`/api/metrics?from=${from}&to=${to}`);
    renderKpis();
    renderChart();
    renderRanking();
    renderHeatmap();
  } catch (err) { toast(err.message, 'error'); }
}

function renderKpis() {
  const t = state.metrics.totals;
  const days = state.metrics.byDay.length;
  const kpis = [
    { label: 'Taxa de conclusão', value: `${t.rate}%`, hint: `${t.done} de ${t.assigned} tarefas` },
    { label: 'Tarefas concluídas', value: t.done, hint: `em ${days} dia(s) analisados` },
    { label: 'Dias com execução', value: t.activeDays, hint: `${t.perfectDays} dia(s) 100% concluídos` },
    { label: 'Pontos do período', value: t.totalPoints, hint: `${t.proactivePoints} vindos de proatividade` },
    { label: 'Proatividades', value: t.proactive, hint: `${t.proactiveApproved} aprovada(s)` },
    { label: 'Pendentes de análise', value: t.pendingReview, hint: 'registros na aba Proatividade' },
  ];
  $('#kpis').innerHTML = kpis.map((k) => `
    <div class="kpi">
      <div class="label">${k.label}</div>
      <div class="value">${k.value}</div>
      <div class="hint">${k.hint}</div>
    </div>`).join('');

  $('#badge-pending').classList.toggle('hidden', !t.pendingReview);
  $('#badge-pending').textContent = t.pendingReview;
}

function renderChart() {
  const days = state.metrics.byDay;
  const max = Math.max(1, ...days.map((d) => d.assigned));
  const step = days.length > 20 ? Math.ceil(days.length / 10) : 1;
  $('#chart').innerHTML = days.map((d, i) => {
    const heightPct = Math.round((d.assigned / max) * 100);
    const fillPct = d.assigned ? Math.round((d.done / d.assigned) * 100) : 0;
    const title = `${fmtDate(d.date)} — ${d.done}/${d.assigned} concluídas`;
    return `
      <div class="chart-col" title="${title}">
        <div class="chart-track">
          <div class="chart-bar" style="height:${Math.max(heightPct, 4)}%">
            <i style="height:${fillPct}%"></i>
          </div>
        </div>
        <div class="chart-label">${i % step === 0 ? shortDate(d.date) : '&nbsp;'}</div>
      </div>`;
  }).join('');
}

function renderRanking() {
  const rows = state.metrics.byChild;
  if (!rows.length) {
    $('#ranking').innerHTML = '<div class="empty">Cadastre um filho para ver os indicadores.</div>';
    return;
  }
  $('#ranking').innerHTML = rows.map((r) => `
    <div class="item">
      <div class="avatar" style="background:${escapeHtml(r.child.color)}33">${escapeHtml(r.child.emoji)}</div>
      <div class="grow">
        <div class="row">
          <span class="item-title grow">${escapeHtml(r.child.name)}</span>
          <span class="pill ${r.rate >= 80 ? 'ok' : r.rate >= 50 ? 'warn' : 'danger'}">${r.rate}%</span>
        </div>
        <div class="bar" style="margin:6px 0"><span style="width:${r.rate}%;background:${escapeHtml(r.child.color)}"></span></div>
        <div class="small muted">
          ${r.done}/${r.assigned} tarefas · ${r.totalPoints} pts · ${r.activeDays || 0} dia(s) ativos ·
          🔥 ${r.streak} de sequência · ✋ ${r.proactive} proatividade(s)
        </div>
      </div>
    </div>`).join('');
}

function renderHeatmap() {
  const days = state.metrics.byDay;
  if (!days.length) return;
  // Alinha a primeira coluna ao domingo para que as linhas sejam dias da semana.
  const pad = weekdayOf(days[0].date);
  const cells = [...Array(pad).fill(null), ...days];
  $('#heatmap').innerHTML = cells.map((d) => {
    if (!d) return '<div class="heat" style="opacity:.25"></div>';
    const rate = d.assigned ? d.done / d.assigned : 0;
    const alpha = d.assigned ? 0.12 + rate * 0.78 : 0.06;
    const title = `${fmtDate(d.date)} — ${d.done}/${d.assigned}`;
    return `<div class="heat" title="${title}" style="background:rgba(33,196,139,${alpha.toFixed(2)})"></div>`;
  }).join('');
}

// -------------------------------------------------------- tarefas do dia

$('#day-date').addEventListener('change', loadDay);

async function loadDay() {
  const date = $('#day-date').value;
  if (!date) return;
  try {
    const { tasks } = await api(`/api/tasks?date=${date}`);
    renderDay(date, tasks);
  } catch (err) { toast(err.message, 'error'); }
}

function renderDay(date, tasks) {
  if (!state.children.length) {
    $('#day-list').innerHTML = '<div class="card"><div class="empty">Cadastre um filho na aba “Filhos &amp; carteirinhas” para começar.</div></div>';
    return;
  }
  $('#day-list').innerHTML = state.children.filter((c) => c.active).map((child) => {
    const mine = tasks.filter((t) => t.childId === child.id);
    const done = mine.filter((t) => t.status === 'done').length;
    const rate = mine.length ? Math.round((done / mine.length) * 100) : 0;
    const body = mine.length
      ? mine.map((t) => `
        <div class="item ${t.status === 'done' ? 'done' : ''}">
          <div class="grow">
            <div class="item-title">${escapeHtml(t.title)}</div>
            ${t.description ? `<div class="small muted">${escapeHtml(t.description)}</div>` : ''}
            <div class="row small muted" style="margin-top:6px">
              <span class="pill">${t.points} pts</span>
              <span class="pill">${t.origin}</span>
              ${t.status === 'done' ? '<span class="pill ok">concluída</span>' : '<span class="pill warn">pendente</span>'}
            </div>
          </div>
          <div class="stack">
            <button class="btn-soft btn-sm" data-toggle-task="${t.id}" data-status="${t.status}">
              ${t.status === 'done' ? 'Reabrir' : 'Concluir'}
            </button>
            <button class="btn-danger btn-sm" data-del-task="${t.id}">Excluir</button>
          </div>
        </div>`).join('')
      : '<div class="empty">Nenhuma tarefa para este dia.</div>';

    return `
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <div class="avatar" style="background:${escapeHtml(child.color)}33">${escapeHtml(child.emoji)}</div>
          <div class="grow">
            <h3 style="margin:0">${escapeHtml(child.name)}</h3>
            <div class="small muted">${done}/${mine.length} concluídas · ${fmtDate(date)}</div>
          </div>
          <span class="pill ${rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : ''}">${rate}%</span>
        </div>
        <div class="bar" style="margin-bottom:12px"><span style="width:${rate}%;background:${escapeHtml(child.color)}"></span></div>
        <div class="list">${body}</div>
      </div>`;
  }).join('');
}

$('#day-list').addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-toggle-task]');
  const del = event.target.closest('[data-del-task]');
  try {
    if (toggle) {
      await api(`/api/tasks/${toggle.dataset.toggleTask}`, {
        method: 'PATCH',
        body: { status: toggle.dataset.status === 'done' ? 'pending' : 'done' },
      });
      await Promise.all([loadDay(), loadMetrics()]);
    } else if (del) {
      if (!confirm('Excluir esta tarefa?')) return;
      await api(`/api/tasks/${del.dataset.delTask}`, { method: 'DELETE' });
      await Promise.all([loadDay(), loadMetrics()]);
    }
  } catch (err) { toast(err.message, 'error'); }
});

$('#btn-new-task').addEventListener('click', () => {
  if (!state.children.length) return toast('Cadastre um filho antes de criar tarefas.', 'error');
  $('#form-task').reset();
  $('#task-points').value = 10;
  $('#task-date').value = $('#day-date').value || state.today;
  $('#task-children').innerHTML = state.children.filter((c) => c.active).map((c) => `
    <label class="pill" style="cursor:pointer">
      <input type="checkbox" value="${c.id}" checked style="width:auto;margin:0 4px 0 0"> ${escapeHtml(c.emoji)} ${escapeHtml(c.name)}
    </label>`).join('');
  openDialog($('#dlg-task'));
});

$('#form-task').addEventListener('submit', async (event) => {
  event.preventDefault();
  const childIds = $$('#task-children input:checked').map((i) => i.value);
  if (!childIds.length) return toast('Selecione ao menos um filho.', 'error');
  try {
    await api('/api/tasks', {
      method: 'POST',
      body: {
        childIds,
        title: $('#task-title').value,
        description: $('#task-desc').value,
        points: Number($('#task-points').value),
        date: $('#task-date').value,
      },
    });
    $('#dlg-task').close();
    toast('Tarefa criada.', 'ok');
    $('#day-date').value = $('#task-date').value;
    await Promise.all([loadDay(), loadMetrics()]);
  } catch (err) { toast(err.message, 'error'); }
});

$('#btn-copy-yesterday').addEventListener('click', async () => {
  const to = $('#day-date').value;
  const from = shiftDate(to, -1);
  try {
    const { tasks } = await api('/api/tasks/copy', { method: 'POST', body: { from, to } });
    toast(tasks.length ? `${tasks.length} tarefa(s) copiada(s) de ${fmtDate(from)}.` : 'Nada novo para copiar.', 'ok');
    await Promise.all([loadDay(), loadMetrics()]);
  } catch (err) { toast(err.message, 'error'); }
});

// ------------------------------------------------------------------ rotinas

async function loadRoutines() {
  const { routines } = await api('/api/routines');
  state.routines = routines;
  renderRoutines();
}

function renderRoutines() {
  if (!state.routines.length) {
    $('#routine-list').innerHTML = '<div class="card"><div class="empty">Nenhuma rotina cadastrada. As rotinas geram as tarefas do dia automaticamente.</div></div>';
    return;
  }
  const byChild = new Map();
  for (const routine of state.routines) {
    if (!byChild.has(routine.childId)) byChild.set(routine.childId, []);
    byChild.get(routine.childId).push(routine);
  }
  $('#routine-list').innerHTML = [...byChild.entries()].map(([childId, list]) => {
    const child = childById(childId);
    if (!child) return '';
    return `
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <div class="avatar" style="background:${escapeHtml(child.color)}33">${escapeHtml(child.emoji)}</div>
          <h3 class="grow" style="margin:0">${escapeHtml(child.name)}</h3>
        </div>
        <div class="list">
          ${list.map((r) => `
            <div class="item ${r.active ? '' : 'done'}">
              <div class="grow">
                <div class="item-title">${escapeHtml(r.title)}</div>
                ${r.description ? `<div class="small muted">${escapeHtml(r.description)}</div>` : ''}
                <div class="row small" style="margin-top:6px">
                  <span class="pill">${r.points} pts</span>
                  <span class="pill">${r.weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ')}</span>
                  ${r.active ? '' : '<span class="pill danger">pausada</span>'}
                </div>
              </div>
              <div class="stack">
                <button class="btn-soft btn-sm" data-toggle-routine="${r.id}" data-active="${r.active}">${r.active ? 'Pausar' : 'Ativar'}</button>
                <button class="btn-danger btn-sm" data-del-routine="${r.id}">Excluir</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');
}

$('#btn-new-routine').addEventListener('click', () => {
  if (!state.children.length) return toast('Cadastre um filho antes de criar rotinas.', 'error');
  $('#form-routine').reset();
  $('#routine-points').value = 10;
  $('#routine-child').innerHTML = state.children.filter((c) => c.active)
    .map((c) => `<option value="${c.id}">${escapeHtml(c.emoji)} ${escapeHtml(c.name)}</option>`).join('');
  $$('#routine-weekdays input').forEach((i, index) => { i.checked = index >= 1 && index <= 5; });
  openDialog($('#dlg-routine'));
});

$('#form-routine').addEventListener('submit', async (event) => {
  event.preventDefault();
  const weekdays = $$('#routine-weekdays input:checked').map((i) => Number(i.value));
  if (!weekdays.length) return toast('Selecione ao menos um dia da semana.', 'error');
  try {
    await api('/api/routines', {
      method: 'POST',
      body: {
        childId: $('#routine-child').value,
        title: $('#routine-title').value,
        description: $('#routine-desc').value,
        points: Number($('#routine-points').value),
        weekdays,
      },
    });
    $('#dlg-routine').close();
    toast('Rotina criada.', 'ok');
    await Promise.all([loadRoutines(), loadDay(), loadMetrics()]);
  } catch (err) { toast(err.message, 'error'); }
});

$('#routine-list').addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-toggle-routine]');
  const del = event.target.closest('[data-del-routine]');
  try {
    if (toggle) {
      await api(`/api/routines/${toggle.dataset.toggleRoutine}`, {
        method: 'PATCH',
        body: { active: toggle.dataset.active !== 'true' },
      });
      await Promise.all([loadRoutines(), loadDay()]);
    } else if (del) {
      if (!confirm('Excluir esta rotina? O histórico já registrado é mantido.')) return;
      await api(`/api/routines/${del.dataset.delRoutine}`, { method: 'DELETE' });
      await Promise.all([loadRoutines(), loadDay(), loadMetrics()]);
    }
  } catch (err) { toast(err.message, 'error'); }
});

// ------------------------------------------------------------------- filhos

async function refreshChildren() {
  const { children, colors } = await api('/api/children');
  state.children = children;
  state.colors = colors;
  renderChildren();
}

function cardUrl(child) {
  return `${location.origin}${child.cardPath}`;
}

function renderChildren() {
  if (!state.children.length) {
    $('#children-list').innerHTML = '<div class="card"><div class="empty">Nenhum filho cadastrado ainda.</div></div>';
    return;
  }
  $('#children-list').innerHTML = state.children.map((child) => `
    <div class="card">
      <div class="row">
        <div class="avatar" style="background:${escapeHtml(child.color)}33">${escapeHtml(child.emoji)}</div>
        <div class="grow">
          <h3 style="margin:0">${escapeHtml(child.name)}</h3>
          <div class="small muted">🔥 ${child.streak} dia(s) de sequência ${child.active ? '' : '· <span class="pill danger">inativo</span>'}</div>
        </div>
        <button class="btn-soft btn-sm" data-edit-child="${child.id}">Editar</button>
      </div>
      <div class="field" style="margin-top:12px">
        <label>Link da carteirinha</label>
        <input type="text" readonly value="${escapeHtml(cardUrl(child))}" data-link="${child.id}">
      </div>
      <div class="row">
        <button class="btn-sm" data-copy-link="${child.id}">Copiar link</button>
        <a class="btn-soft btn-sm" style="text-decoration:none;padding:6px 11px;border-radius:8px;border:1px solid var(--line)" href="${escapeHtml(child.cardPath)}" target="_blank" rel="noopener">Abrir</a>
        <button class="btn-soft btn-sm" data-share-link="${child.id}">Compartilhar</button>
        <div class="grow"></div>
        <button class="btn-ghost btn-sm" data-rotate="${child.id}">Gerar novo link</button>
        <button class="btn-danger btn-sm" data-del-child="${child.id}">Excluir</button>
      </div>
    </div>`).join('');
}

$('#children-list').addEventListener('click', async (event) => {
  const copy = event.target.closest('[data-copy-link]');
  const share = event.target.closest('[data-share-link]');
  const rotate = event.target.closest('[data-rotate]');
  const del = event.target.closest('[data-del-child]');
  const edit = event.target.closest('[data-edit-child]');

  try {
    if (copy) {
      const child = childById(copy.dataset.copyLink);
      await navigator.clipboard.writeText(cardUrl(child));
      toast('Link copiado.', 'ok');
    } else if (share) {
      const child = childById(share.dataset.shareLink);
      const data = { title: `Carteirinha de ${child.name}`, text: 'Suas tarefas de hoje 👇', url: cardUrl(child) };
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(data.url); toast('Link copiado.', 'ok'); }
    } else if (rotate) {
      if (!confirm('Gerar um novo link? O link antigo deixará de funcionar.')) return;
      await api(`/api/children/${rotate.dataset.rotate}/rotate-token`, { method: 'POST' });
      await refreshChildren();
      toast('Novo link gerado.', 'ok');
    } else if (del) {
      const child = childById(del.dataset.delChild);
      if (!confirm(`Excluir ${child.name} e todo o histórico? Esta ação não pode ser desfeita.`)) return;
      await api(`/api/children/${child.id}`, { method: 'DELETE' });
      await refreshChildren();
      await Promise.all([loadDay(), loadRoutines(), loadMetrics()]);
      toast('Cadastro removido.', 'ok');
    } else if (edit) {
      openChildDialog(childById(edit.dataset.editChild));
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast(err.message, 'error');
  }
});

$('#btn-new-child').addEventListener('click', () => openChildDialog(null));

function openChildDialog(child) {
  state.editing.child = child?.id || null;
  $('#dlg-child-title').textContent = child ? 'Editar filho' : 'Cadastrar filho';
  $('#child-name').value = child?.name || '';
  $('#child-emoji').value = child?.emoji || EMOJIS[0];
  $('#child-birth').value = child?.birthdate || '';
  const selected = child?.color || state.colors[state.children.length % state.colors.length];
  $('#child-colors').innerHTML = state.colors.map((color) => `
    <label style="cursor:pointer">
      <input type="radio" name="child-color" value="${color}" ${color === selected ? 'checked' : ''} style="display:none">
      <span style="display:block;width:30px;height:30px;border-radius:9px;background:${color};outline:${color === selected ? '2px solid #fff' : 'none'};outline-offset:2px"></span>
    </label>`).join('');
  openDialog($('#dlg-child'));
}

$('#child-colors').addEventListener('change', () => {
  const value = $('#child-colors input:checked')?.value;
  $$('#child-colors span').forEach((span) => {
    const input = span.previousElementSibling;
    span.style.outline = input.value === value ? '2px solid #fff' : 'none';
  });
});

$('#form-child').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {
    name: $('#child-name').value,
    emoji: $('#child-emoji').value,
    color: $('#child-colors input:checked')?.value,
    birthdate: $('#child-birth').value || null,
  };
  try {
    if (state.editing.child) await api(`/api/children/${state.editing.child}`, { method: 'PATCH', body });
    else await api('/api/children', { method: 'POST', body });
    $('#dlg-child').close();
    await refreshChildren();
    await Promise.all([loadDay(), loadMetrics()]);
    toast('Cadastro salvo.', 'ok');
  } catch (err) { toast(err.message, 'error'); }
});

// ------------------------------------------------------------- proatividade

$('#proactive-filter').addEventListener('change', loadProactive);

async function loadProactive() {
  const status = $('#proactive-filter').value;
  const { entries } = await api(`/api/proactive${status ? `?status=${status}` : ''}`);
  if (!entries.length) {
    $('#proactive-list').innerHTML = '<div class="card"><div class="empty">Nenhum registro nesta situação.</div></div>';
    return;
  }
  $('#proactive-list').innerHTML = `<div class="card"><div class="list">${entries.map((e) => {
    const child = childById(e.childId);
    const statusPill = { pending: '<span class="pill warn">aguardando</span>', approved: '<span class="pill ok">aprovada</span>', rejected: '<span class="pill danger">recusada</span>' }[e.status];
    return `
      <div class="item">
        <div class="avatar" style="background:${escapeHtml(child?.color || '#333')}33">${escapeHtml(child?.emoji || '✋')}</div>
        <div class="grow">
          <div class="item-title">${escapeHtml(e.title)}</div>
          ${e.description ? `<div class="small muted">${escapeHtml(e.description)}</div>` : ''}
          <div class="row small muted" style="margin-top:6px">
            <span>${escapeHtml(child?.name || 'Removido')}</span>
            <span class="pill">${fmtDate(e.date)}</span>
            <span class="pill">${e.points} pts</span>
            ${statusPill}
          </div>
        </div>
        <div class="stack">
          ${e.status !== 'approved' ? `<button class="btn-sm" data-approve="${e.id}">Aprovar</button>` : ''}
          ${e.status !== 'rejected' ? `<button class="btn-danger btn-sm" data-reject="${e.id}">Recusar</button>` : ''}
        </div>
      </div>`;
  }).join('')}</div></div>`;
}

$('#proactive-list').addEventListener('click', async (event) => {
  const approve = event.target.closest('[data-approve]');
  const reject = event.target.closest('[data-reject]');
  if (!approve && !reject) return;
  const id = (approve || reject).dataset.approve || reject.dataset.reject;
  try {
    await api(`/api/proactive/${id}`, { method: 'PATCH', body: { status: approve ? 'approved' : 'rejected' } });
    await Promise.all([loadProactive(), loadMetrics()]);
  } catch (err) { toast(err.message, 'error'); }
});

// -------------------------------------------------------------- responsáveis

async function loadParents() {
  const { parents } = await api('/api/parents');
  $('#parents-list').innerHTML = `<div class="card"><div class="list">${parents.map((p) => `
    <div class="item">
      <div class="avatar">👤</div>
      <div class="grow">
        <div class="item-title">${escapeHtml(p.name)} ${p.id === state.parent.id ? '<span class="pill">você</span>' : ''}</div>
        <div class="small muted">${escapeHtml(p.email)}</div>
      </div>
      ${p.id === state.parent.id || parents.length <= 1 ? '' : `<button class="btn-danger btn-sm" data-del-parent="${p.id}">Remover</button>`}
    </div>`).join('')}</div></div>`;
}

$('#btn-new-parent').addEventListener('click', () => {
  $('#form-parent').reset();
  openDialog($('#dlg-parent'));
});

$('#form-parent').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/parents', {
      method: 'POST',
      body: {
        name: $('#parent-name-in').value,
        email: $('#parent-email').value,
        password: $('#parent-password').value,
      },
    });
    $('#dlg-parent').close();
    await loadParents();
    toast('Responsável adicionado.', 'ok');
  } catch (err) { toast(err.message, 'error'); }
});

$('#parents-list').addEventListener('click', async (event) => {
  const del = event.target.closest('[data-del-parent]');
  if (!del) return;
  if (!confirm('Remover este responsável?')) return;
  try {
    await api(`/api/parents/${del.dataset.delParent}`, { method: 'DELETE' });
    await loadParents();
  } catch (err) { toast(err.message, 'error'); }
});

// -------------------------------------------------------------------- PWA

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot().catch((err) => {
  document.body.innerHTML = `<div class="container"><div class="card"><h2>Não foi possível carregar</h2><p class="muted">${escapeHtml(err.message)}</p></div></div>`;
});
