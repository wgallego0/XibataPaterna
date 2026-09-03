// Carteirinha de tarefas — visão da criança, acessada pelo link com token.
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const TOKEN = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const WEEKDAY_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const SUGGESTIONS = [
  'Arrumei minha cama', 'Ajudei na cozinha', 'Organizei os brinquedos',
  'Estudei sem pedirem', 'Cuidei do pet', 'Ajudei meu irmão',
];

let card = null;

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3400);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Erro ${res.status}`);
  return payload;
}

function longDate(iso) {
  const date = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC',
  }).format(date);
}

async function load() {
  try {
    card = await api(`/api/card/${encodeURIComponent(TOKEN)}`);
    render();
  } catch {
    $('#loading').classList.add('hidden');
    $('#error').classList.remove('hidden');
  }
}

function render() {
  $('#loading').classList.add('hidden');
  $('#content').classList.remove('hidden');

  const { child, summary, tasks, proactive, week, date } = card;
  document.title = `Carteirinha de ${child.name}`;
  $('#badge').style.background = `linear-gradient(135deg, ${child.color}, ${child.color}aa)`;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', child.color);
  $('#face').textContent = child.emoji;
  $('#name').textContent = child.name;
  $('#date').textContent = longDate(date);
  $('#stat-done').textContent = `${summary.done}/${summary.assigned}`;
  $('#stat-points').textContent = summary.points;
  $('#stat-streak').textContent = summary.streak;
  $('#rate-pill').textContent = `${summary.rate}%`;
  $('#rate-bar').style.width = `${summary.rate}%`;
  $('#rate-bar').style.background = child.color;

  $('#tasks').innerHTML = tasks.length ? tasks.map((task) => `
    <div class="item ${task.status === 'done' ? 'done' : ''}">
      <button class="task-check ${task.status === 'done' ? 'on' : ''}" data-task="${task.id}" data-status="${task.status}"
              aria-label="Marcar ${escapeHtml(task.title)}">✓</button>
      <div class="grow">
        <div class="item-title">${escapeHtml(task.title)}</div>
        ${task.description ? `<div class="small muted">${escapeHtml(task.description)}</div>` : ''}
        <div class="small muted" style="margin-top:4px">${task.points} pontos</div>
      </div>
    </div>`).join('')
    : '<div class="empty">Nenhuma tarefa para hoje. Aproveite! 🎉</div>';

  $('#proactive').innerHTML = proactive.length ? proactive.map((entry) => {
    const pill = {
      pending: '<span class="pill warn">aguardando</span>',
      approved: '<span class="pill ok">aprovada ✓</span>',
      rejected: '<span class="pill danger">não contou</span>',
    }[entry.status];
    return `
      <div class="item">
        <div class="avatar">✋</div>
        <div class="grow">
          <div class="item-title">${escapeHtml(entry.title)}</div>
          ${entry.description ? `<div class="small muted">${escapeHtml(entry.description)}</div>` : ''}
          <div class="row small" style="margin-top:6px"><span class="pill">${entry.points} pts</span>${pill}</div>
        </div>
      </div>`;
  }).join('') : '<div class="empty">Nada registrado ainda hoje.</div>';

  $('#week').innerHTML = week.map((day) => {
    const rate = day.assigned ? day.done / day.assigned : 0;
    const alpha = day.assigned ? 0.12 + rate * 0.78 : 0.06;
    const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
    return `
      <div>
        <div class="d">${WEEKDAY_SHORT[weekday]}</div>
        <div class="dot" title="${day.done}/${day.assigned}" style="background:rgba(33,196,139,${alpha.toFixed(2)})">
          ${day.assigned ? `${day.done}/${day.assigned}` : ''}
        </div>
      </div>`;
  }).join('');
}

$('#tasks').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-task]');
  if (!button) return;
  const next = button.dataset.status === 'done' ? 'pending' : 'done';
  button.disabled = true;
  try {
    await api(`/api/card/${encodeURIComponent(TOKEN)}/tasks/${button.dataset.task}`, {
      method: 'POST',
      body: { status: next },
    });
    if (next === 'done') toast('Boa! Tarefa concluída 🎉', 'ok');
    await load();
  } catch (err) {
    toast(err.message, 'error');
    button.disabled = false;
  }
});

// ------------------------------------------------------------ proatividade

$('#btn-proactive').addEventListener('click', () => {
  $('#form-proactive').reset();
  $('#pro-suggestions').innerHTML = SUGGESTIONS
    .map((text) => `<button type="button" class="pill" data-suggest="${escapeHtml(text)}">${escapeHtml(text)}</button>`)
    .join('');
  $('#dlg-proactive').showModal();
});

$('#pro-suggestions').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-suggest]');
  if (chip) $('#pro-title').value = chip.dataset.suggest;
});

$$('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

$('#form-proactive').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api(`/api/card/${encodeURIComponent(TOKEN)}/proactive`, {
      method: 'POST',
      body: { title: $('#pro-title').value, description: $('#pro-desc').value },
    });
    $('#dlg-proactive').close();
    toast('Registrado! Seu responsável vai revisar 👏', 'ok');
    await load();
  } catch (err) { toast(err.message, 'error'); }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Recarrega ao voltar para a aba, para refletir tarefas novas do responsável.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && card) load();
});

load();
