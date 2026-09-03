#!/usr/bin/env bash
# Executado uma vez, quando o Codespace é criado.
set -u
set -o pipefail

FLY_BIN="$HOME/.fly/bin"

echo "→ Instalando o flyctl…"
# Num pipeline o status é o do último comando, então o curl falhando passaria
# despercebido: confirma pelo binário, que é o que realmente importa.
curl -fsSL https://fly.io/install.sh | sh || true

if [ -x "$FLY_BIN/flyctl" ]; then
  echo "✓ flyctl instalado: $("$FLY_BIN/flyctl" version 2>/dev/null | head -1)"
else
  echo "✗ Não foi possível instalar o flyctl agora (rede?)."
  echo "  Rode manualmente depois:  curl -L https://fly.io/install.sh | sh"
fi

# Garante o PATH também em shells abertos fora do devcontainer.json.
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -f "$rc" ] || continue
  grep -q 'FLYCTL_INSTALL' "$rc" || {
    printf '\nexport FLYCTL_INSTALL="$HOME/.fly"\nexport PATH="$FLYCTL_INSTALL/bin:$PATH"\n' >> "$rc"
  }
done

cat <<'FIM'

──────────────────────────────────────────────────────────────
 XibataPaterna — pronto para o deploy no Fly.io

 1) flyctl auth login
      Abre um link; toque nele e autorize no navegador.

 2) flyctl launch --no-deploy --copy-config --name xibatapaterna --region gru
      Se o nome estiver ocupado, escolha outro e ajuste
      o campo "app =" no fly.toml para bater.

 3) flyctl volumes create xibata_data --region gru --size 1
      NÃO pule este passo: sem o volume os dados somem a cada deploy.

 4) flyctl deploy
      Depois, "flyctl open" abre a URL já com HTTPS.

 Para testar antes, aqui mesmo:  npm start
──────────────────────────────────────────────────────────────
FIM
