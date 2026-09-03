// Popula a base com uma família de exemplo e ~6 semanas de histórico.
// Uso: npm run seed        (recusa rodar se já houver dados)
//      npm run seed -- --force   (limpa tudo e recria)
import { commit, getDb, id, token } from '../src/store.js';
import { CHILD_COLORS, shiftDate, today, weekdayOf } from '../src/domain.js';
import { hashPassword } from '../src/auth.js';

const force = process.argv.includes('--force');
const db = getDb();

if ((db.parents.length || db.children.length) && !force) {
  console.error('A base já tem dados. Use "npm run seed -- --force" para recriar do zero.');
  process.exit(1);
}

const SENHA = 'demo1234';
const rng = (seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const random = rng(42);

const { salt, hash } = hashPassword(SENHA);
const parent = {
  id: id('p_'), name: 'Responsável Demo', email: 'demo@xibata.local',
  salt, hash, createdAt: new Date().toISOString(),
};

const kids = [
  { name: 'Ana', emoji: '👧', skill: 0.88 },
  { name: 'Bruno', emoji: '👦', skill: 0.62 },
  { name: 'Cecília', emoji: '🐣', skill: 0.75 },
].map((k, i) => ({
  id: id('c_'), name: k.name, emoji: k.emoji, color: CHILD_COLORS[i],
  birthdate: null, active: true, cardToken: token(18),
  createdAt: new Date().toISOString(), skill: k.skill,
}));

const CATALOGO = [
  { title: 'Arrumar a cama', points: 10, weekdays: [0, 1, 2, 3, 4, 5, 6] },
  { title: 'Guardar a louça', points: 15, weekdays: [1, 2, 3, 4, 5] },
  { title: 'Levar o lixo para fora', points: 20, weekdays: [1, 3, 5] },
  { title: 'Organizar a mochila', points: 10, weekdays: [0, 2, 4] },
  { title: 'Regar as plantas', points: 10, weekdays: [2, 6] },
];

const PROATIVAS = [
  'Organizei o armário', 'Ajudei na cozinha', 'Estudei sem pedirem',
  'Cuidei do pet', 'Varri a sala', 'Ajudei meu irmão com a lição',
];

const START = shiftDate(today(), -41);
const routines = [];
const tasks = [];
const proactive = [];

for (const kid of kids) {
  for (const modelo of CATALOGO.slice(0, 3 + Math.floor(random() * 3))) {
    routines.push({
      id: id('r_'), childId: kid.id, title: modelo.title, description: '',
      points: modelo.points, weekdays: modelo.weekdays, active: true,
      startDate: START, createdAt: new Date().toISOString(),
    });
  }
}

for (let offset = 41; offset >= 0; offset -= 1) {
  const date = shiftDate(today(), -offset);
  const weekday = weekdayOf(date);

  for (const routine of routines) {
    if (!routine.weekdays.includes(weekday)) continue;
    const kid = kids.find((k) => k.id === routine.childId);
    // Dias mais recentes tendem a ir melhor — dá uma curva visível no gráfico.
    const boost = (41 - offset) / 41 * 0.12;
    const done = offset > 0 && random() < Math.min(0.97, kid.skill + boost);
    tasks.push({
      id: id('t_'), childId: kid.id, routineId: routine.id, date,
      title: routine.title, description: '', points: routine.points,
      status: done ? 'done' : 'pending',
      completedAt: done ? `${date}T19:00:00.000Z` : null,
      createdAt: `${date}T07:00:00.000Z`, origin: 'rotina',
    });
  }

  for (const kid of kids) {
    if (random() > 0.18) continue;
    const status = offset === 0 ? 'pending' : (random() < 0.8 ? 'approved' : 'rejected');
    proactive.push({
      id: id('pa_'), childId: kid.id, date,
      title: PROATIVAS[Math.floor(random() * PROATIVAS.length)],
      description: '', points: 5, status,
      createdAt: `${date}T18:00:00.000Z`,
      reviewedAt: status === 'pending' ? null : `${date}T20:00:00.000Z`,
    });
  }
}

commit((d) => {
  d.parents = [parent];
  d.children = kids.map(({ skill, ...rest }) => rest);
  d.routines = routines;
  d.tasks = tasks;
  d.proactive = proactive;
  d.sessions = [];
});

console.log(`Base de demonstração criada:
  responsável : ${parent.email} / ${SENHA}
  filhos      : ${kids.length}
  rotinas     : ${routines.length}
  tarefas     : ${tasks.length}
  proativas   : ${proactive.length}

Carteirinhas:`);
for (const kid of kids) console.log(`  ${kid.emoji} ${kid.name.padEnd(10)} /c/${kid.cardToken}`);
