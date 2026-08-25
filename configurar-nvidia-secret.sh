#!/usr/bin/env bash
set -Eeuo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh não instalado." >&2
  exit 1
fi

echo "Cole a NOVA chave NVIDIA quando o GitHub CLI solicitar."
gh secret set NVIDIA_API_KEY

echo "Configurando modelo:"
gh variable set NVIDIA_MODEL --body "meta/llama-3.3-70b-instruct"

echo "Configurado."
