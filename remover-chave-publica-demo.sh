#!/usr/bin/env bash
set -Eeuo pipefail

cat > api-config.js <<'EOF_CONFIG'
/* Chave pública removida. */
window.SNES_PUBLIC_NVIDIA = {
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "meta/llama-3.3-70b-instruct",
  apiKey: ""
};
EOF_CONFIG

git add api-config.js
git commit -m "chore: remove temporary public NVIDIA key" || true
git push origin main

cat <<'MSG'

A chave foi removida da versão atual do site.

IMPORTANTE:
1. Revogue a chave no NVIDIA API Catalog.
2. A chave antiga continuará no histórico Git, então a revogação é obrigatória.
3. Gere uma nova chave depois para uso somente em backend/Secrets.
MSG
