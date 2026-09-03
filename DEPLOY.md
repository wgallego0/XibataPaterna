# Colocando o XibataPaterna no ar

O app precisa de um **processo Node rodando** e de um **disco que sobreviva a
reinícios** (os dados ficam em `db.json`). Isso descarta hospedagens só de
arquivos estáticos como o GitHub Pages, e exige atenção ao plano escolhido:
vários planos gratuitos têm disco efêmero e **apagam os dados a cada deploy**.

> **Antes de qualquer coisa:** publique sempre atrás de HTTPS. Sem TLS, o token
> da carteirinha e o cookie de sessão trafegam em claro na rede.

---

## Opção 1 — Fly.io (recomendada)

O Fly tem volume persistente e roda a imagem Docker deste repositório. O
`fly.toml` já está pronto, incluindo o mount em `/data` e o healthcheck.

```bash
# 1. Instale o CLI e faça login
curl -L https://fly.io/install.sh | sh
flyctl auth login

# 2. Crie o app (não faça o deploy ainda)
flyctl launch --no-deploy --copy-config --name xibatapaterna --region gru

# 3. Crie o volume onde o db.json vai morar
flyctl volumes create xibata_data --region gru --size 1

# 4. Deploy
flyctl deploy
```

Ao final, `flyctl open` abre a URL (`https://xibatapaterna.fly.dev`) já com
HTTPS. O primeiro acesso pede a criação do responsável inicial.

**Confira antes:** o nome do app precisa ser único no Fly — troque
`xibatapaterna` se estiver ocupado, e ajuste `app =` no `fly.toml` para o mesmo
nome. O `region` está em `gru` (São Paulo); mude se preferir outro. Verifique
também o plano e os preços atuais no site do Fly antes de subir — as condições
de uso gratuito mudam com o tempo.

**Atenção ao `auto_stop_machines`:** o `fly.toml` deixa a máquina suspender
quando ninguém está usando, o que economiza recursos. A primeira visita depois
de um período parado leva alguns segundos a mais. Se preferir resposta imediata
sempre, troque `min_machines_running` para `1`.

### Deploy automático a cada push (opcional)

O workflow `.github/workflows/deploy-fly.yml` roda os testes e faz o deploy
sozinho quando a `main` muda. Para ativar:

```bash
flyctl tokens create deploy    # copie o token gerado
```

No GitHub: **Settings → Secrets and variables → Actions → New repository
secret**, nome `FLY_API_TOKEN`, valor o token copiado.

---

## Opção 2 — Render

Funciona bem, mas **o disco persistente é recurso de plano pago**. No plano
gratuito o sistema de arquivos é efêmero e o `db.json` é perdido a cada deploy
ou reinício — ou seja, todos os cadastros e o histórico somem.

O `render.yaml` já vem com o disco declarado e o plano `starter`. Passos:

1. No painel do Render: **New → Blueprint** e aponte para este repositório.
2. Confirme que o serviço aparece com o disco `xibata-data` montado em `/data`.
3. Deploy.

Se preferir criar à mão: **New → Web Service**, runtime **Docker**, health check
path `/api/health`, e adicione um disco de 1 GB em `/data`.

---

## Opção 3 — Auto-hospedagem (VPS, mini-PC, Raspberry Pi)

Os dados ficam com você. O `docker-compose.yml` sobe o app escutando apenas em
`127.0.0.1:8080`, para que quem exponha à internet seja um proxy com TLS.

```bash
docker compose up -d --build
```

Depois, coloque um proxy na frente. Com **Caddy**, que resolve o certificado
sozinho, o `Caddyfile` inteiro é:

```
tarefas.seudominio.com.br {
    reverse_proxy 127.0.0.1:8080
}
```

O Caddy já envia `X-Forwarded-Proto: https`, que é o que faz o app marcar o
cookie de sessão como `Secure`. Com Nginx, garanta o equivalente:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Host $host;
```

### Backup

Todo o estado é um arquivo só. Um backup diário resolve:

```bash
docker compose exec app cat /data/db.json > backup-$(date +%F).json
```

Para restaurar, pare o app, substitua o `/data/db.json` e suba de novo — **o
app precisa estar parado**, porque ele mantém o estado em memória e sobrescreve
o arquivo ao gravar.

---

## Variáveis de ambiente

| Variável   | Padrão no container | Descrição                                   |
|------------|---------------------|---------------------------------------------|
| `PORT`     | `8080`              | Porta HTTP.                                 |
| `HOST`     | `0.0.0.0`           | Interface de escuta.                         |
| `DATA_DIR` | `/data`             | Onde fica o `db.json` (aponte para o volume).|
| `TZ_APP`   | `America/Sao_Paulo` | Fuso que decide que dia é "hoje".            |

## Verificando se subiu

```bash
curl https://SEU-DOMINIO/api/health
# {"status":"ok","today":"2026-09-02","timezone":"America/Sao_Paulo","configured":false}
```

`configured: false` significa que o primeiro responsável ainda não foi criado —
é o estado esperado num deploy novo. Abra a URL no navegador para criar.

## Depois do deploy

1. Acesse a URL e crie o responsável inicial. A partir daí a tela de cadastro
   inicial é desativada; novos responsáveis entram pela aba "Responsáveis".
2. Cadastre os filhos e envie o link da carteirinha para cada um.
3. Peça para instalarem no celular: no Chrome, **Menu → Adicionar à tela
   inicial**; no iPhone, **Compartilhar → Adicionar à Tela de Início**.

Se um link de carteirinha vazar, use **"Gerar novo link"** no painel — o antigo
para de funcionar na hora.
