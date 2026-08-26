#!/usr/bin/env bash
set -Eeuo pipefail

command -v gh >/dev/null 2>&1 || { echo "gh não encontrado." >&2; exit 1; }

echo "Configure um Cloudflare API Token com permissão Edit Cloudflare Workers."
echo

read -rp "Cloudflare Account ID: " ACCOUNT_ID
[[ -n "$ACCOUNT_ID" ]] || { echo "Account ID vazio." >&2; exit 1; }

read -rsp "Cloudflare API Token: " API_TOKEN
echo
[[ -n "$API_TOKEN" ]] || { echo "API Token vazio." >&2; exit 1; }

gh secret set CLOUDFLARE_ACCOUNT_ID --body "$ACCOUNT_ID"
gh secret set CLOUDFLARE_API_TOKEN --body "$API_TOKEN"

unset ACCOUNT_ID API_TOKEN

echo
echo "Secrets configurados."
echo "Disparando deploy..."
gh workflow run "Deploy inference Worker"

echo
echo "Acompanhe com:"
echo '  gh run list --workflow="deploy-inference-worker.yml" --limit 3'
echo '  gh run watch'
