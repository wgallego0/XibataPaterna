# 🏠 XibataPaterna

PWA simples para registrar e acompanhar as **tarefas de casa diárias** dos filhos.

O responsável usa um **dashboard gerencial** para cadastrar os filhos, montar a rotina
da semana e acompanhar os indicadores. Cada filho recebe um **link de carteirinha**
que abre no celular sem senha, mostra as tarefas do dia e traz um botão
**Proatividade** para registrar algo que ele fez por conta própria.

---

## Como funciona

```
Responsável (login)                       Filho (link, sem senha)
┌───────────────────────────┐             ┌──────────────────────────┐
│ Dashboard                 │  gera link  │ Carteirinha /c/<token>   │
│ · KPIs e métricas         │ ──────────► │ · tarefas de hoje        │
│ · tarefas do dia          │             │ · marcar como concluída  │
│ · rotinas recorrentes     │ ◄────────── │ · botão ✋ Proatividade   │
│ · aprova proatividades    │  registros  │ · últimos 7 dias         │
└───────────────────────────┘             └──────────────────────────┘
```

- **Somente responsáveis autenticados** acessam o dashboard, criam tarefas e geram carteirinhas.
- A carteirinha é acessada por um **token secreto na URL** (sem senha, porque quem usa é criança).
  Ela só enxerga os dados do próprio filho e só marca as tarefas **do dia de hoje**.
- Se um link vazar, o responsável clica em **“Gerar novo link”** e o antigo para de funcionar.

## Funcionalidades

**Dashboard do responsável**
- Cadastro de filhos com avatar, cor e link de carteirinha (copiar / compartilhar / regerar).
- **Rotinas recorrentes**: a tarefa é criada sozinha nos dias da semana escolhidos.
- **Tarefas avulsas** para um ou vários filhos de uma vez, e “repetir dia anterior”.
- **Fila de proatividades** enviadas pelos filhos, para aprovar ou recusar (os pontos só contam depois de aprovados).
- Vários responsáveis podem dividir o mesmo painel.

**KPIs e métricas** (período configurável — 7 / 30 / 90 dias ou intervalo livre)
- Taxa de conclusão, tarefas concluídas, pontos do período e proatividades registradas/aprovadas.
- **Dias de execução** e dias 100% concluídos.
- Gráfico de barras de **execução por dia** (atribuídas × concluídas).
- Heatmap dos **dias de execução** por semana.
- Ranking por filho com taxa, pontos, dias ativos e **sequência (streak)** de dias 100%.

**Carteirinha do filho**
- Crachá colorido com nome, avatar, tarefas do dia, pontos e sequência.
- Marcar/desmarcar tarefas com um toque.
- Botão **✋ Proatividade** com sugestões rápidas e campo livre.
- Histórico visual dos últimos 7 dias.

**PWA**
- Instalável no celular (painel e carteirinha têm manifestos e ícones próprios).
- Service worker com cache do casco do app; a API é sempre buscada da rede.

## Rodando

Requer apenas **Node.js 20+**. Não há dependências de terceiros nem etapa de build.

```bash
npm start           # http://localhost:3000
```

No primeiro acesso o app pede para criar o **primeiro responsável**. Depois disso a
tela de cadastro é desativada e novos responsáveis só entram pela aba “Responsáveis”.

### Dados de demonstração

Para ver o dashboard com histórico (3 filhos, ~6 semanas de tarefas):

```bash
npm run seed        # pare o servidor antes: o seed escreve direto no arquivo
npm start
```

Login: `demo@xibata.local` / `demo1234`. Os links das carteirinhas são impressos no terminal.

Use `npm run seed -- --force` para recriar a base do zero.

### Testes

```bash
npm test            # 51 verificações ponta a ponta contra um servidor real
```

O teste sobe o servidor num diretório temporário e cobre autenticação, isolamento
entre filhos, materialização de rotinas, métricas, validações e path traversal.

## Deploy

O app precisa de um processo Node e de um disco persistente, então **não roda no
GitHub Pages** nem em hospedagens só de arquivos estáticos. O repositório traz
`Dockerfile`, `fly.toml`, `render.yaml` e `docker-compose.yml` prontos.

Veja **[DEPLOY.md](DEPLOY.md)** para o passo a passo do Fly.io (recomendado),
Render e auto-hospedagem com HTTPS.

## Configuração

| Variável   | Padrão              | Descrição                                            |
|------------|---------------------|------------------------------------------------------|
| `PORT`     | `3000`              | Porta HTTP.                                          |
| `HOST`     | `0.0.0.0`           | Interface de escuta.                                 |
| `DATA_DIR` | `./data`            | Onde fica o `db.json`.                               |
| `TZ_APP`   | `America/Sao_Paulo` | Fuso usado para decidir que dia é “hoje”.            |

## Estrutura

```
src/
  server.js       rotas HTTP da API + entrega dos arquivos estáticos
  domain.js       regras de negócio: datas, rotinas, KPIs, streak
  auth.js         senhas (scrypt), sessões em cookie HttpOnly
  store.js        persistência em JSON com escrita atômica e serializada
  http.js         helpers de JSON, body, estáticos (com proteção a path traversal)
public/
  index.html      painel do responsável
  app.js
  carteirinha.html  carteirinha do filho
  carteirinha.js
  styles.css      tema único das duas telas
  sw.js           service worker
  manifest*.webmanifest, icons/
scripts/
  seed-demo.mjs      base de demonstração
  generate-icons.mjs gera os PNGs dos ícones (sem dependências)
test/
  api.test.mjs    suíte ponta a ponta
```

Os dados ficam num único arquivo `data/db.json` — dá para versionar em backup,
inspecionar à mão e copiar entre máquinas. É suficiente para a escala de uma família;
para muitos usuários simultâneos vale trocar `store.js` por um banco de verdade.

## Notas de segurança

- Senhas com `scrypt` + salt por usuário; comparação em tempo constante.
- Sessão em cookie `HttpOnly` + `SameSite=Lax`, com `Secure` automático atrás de um
  proxy que envie `X-Forwarded-Proto: https`.
- O token da carteirinha tem 144 bits de entropia e as páginas do filho enviam
  `noindex, nofollow`.
- **Publique atrás de HTTPS.** Sem TLS, o token da carteirinha e o cookie de sessão
  trafegam em claro.
