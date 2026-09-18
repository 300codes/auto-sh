#!/usr/bin/env bash
# UI-01 — utrwalenie renderu Figmy jako dowodu.
#
# Adresy renderów Figmy wygasają, więc pobranie pliku, policzenie sha256 i wpis do manifestu
# muszą nastąpić w jednym kroku, bezpośrednio po odczycie — nie po zakończeniu całej sekwencji.
#
#   ./capture.sh <create|update> <nodeId> <renderUrl> [promptsFile]
#
# Pola kontekstowe manifestu (fileKey, seat, rola, serwer MCP) pobiera ze zmiennych środowiskowych;
# raz ustawione, przetrwają kolejne wywołania:
#
#   FIGMA_FILE_KEY  FIGMA_FILE_URL  FIGMA_SEAT  FIGMA_ROLE  MCP_SERVER  MCP_CLIENT  WORKSTATION
#
# Idempotentne dla danej operacji: ponowne uruchomienie nadpisuje wpis i plik renderu.

set -euo pipefail

readonly MAX_BYTES=$((1024 * 1024))
readonly MAX_RENDERS=4
readonly SCHEMA_VERSION=1

cd "$(dirname "$0")"

op=${1:-}
node_id=${2:-}
render_url=${3:-}
prompts_file=${4:-prompts.md}

if [[ -z $op || -z $node_id || -z $render_url ]]; then
  echo "usage: $0 <create|update> <nodeId> <renderUrl> [promptsFile]" >&2
  exit 2
fi

if [[ $op != create && $op != update ]]; then
  echo "error: operacja musi być 'create' albo 'update', otrzymano '$op'" >&2
  exit 2
fi

render_name="${op}-$(printf '%s' "$node_id" | tr -c 'A-Za-z0-9._-' '-').png"

curl --fail --silent --show-error --location --max-time 60 --output "$render_name" "$render_url"

if ! file --brief --mime-type "$render_name" | grep -qx 'image/png'; then
  echo "error: $render_name nie jest plikiem PNG ($(file --brief "$render_name"))" >&2
  rm -f "$render_name"
  exit 1
fi

bytes=$(stat -c %s "$render_name")
if (( bytes > MAX_BYTES )); then
  echo "error: $render_name ma $bytes B, limit to $MAX_BYTES B" >&2
  rm -f "$render_name"
  exit 1
fi

sha=$(sha256sum "$render_name" | cut -d' ' -f1)
captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
prompt_text=""
[[ -f $prompts_file ]] && prompt_text="patrz $prompts_file → krok $op"

[[ -f manifest.json ]] || printf '{"schemaVersion":%d,"steps":[]}\n' "$SCHEMA_VERSION" > manifest.json

client_name=${MCP_CLIENT:-claude-code}
client_version=$(claude --version 2>/dev/null | awk '{print $1}')

jq \
  --arg workstation "${WORKSTATION:-$(hostname)}" \
  --arg fileKey "${FIGMA_FILE_KEY:-}" \
  --arg fileUrl "${FIGMA_FILE_URL:-}" \
  --arg seat "${FIGMA_SEAT:-}" \
  --arg role "${FIGMA_ROLE:-}" \
  --arg clientName "$client_name" \
  --arg clientVersion "${client_version:-}" \
  --arg mcpServer "${MCP_SERVER:-https://mcp.figma.com/mcp}" \
  --arg op "$op" \
  --arg nodeId "$node_id" \
  --arg prompt "$prompt_text" \
  --arg render "$render_name" \
  --arg sha256 "$sha" \
  --arg at "$captured_at" \
  --arg url "$render_url" \
  --argjson bytes "$bytes" \
  --argjson schemaVersion "$SCHEMA_VERSION" \
  '
    def keep(path; value): if value == "" then . else setpath(path; value) end;
      .schemaVersion = $schemaVersion
  | .capturedAt = $at
  | keep(["workstation"]; $workstation)
  | keep(["figma", "fileKey"]; $fileKey)
  | keep(["figma", "fileUrl"]; $fileUrl)
  | keep(["figma", "seat"]; $seat)
  | keep(["figma", "role"]; $role)
  | keep(["client", "name"]; $clientName)
  | keep(["client", "version"]; $clientVersion)
  | keep(["client", "mcpServer"]; $mcpServer)
  | .steps = ((.steps // []) | map(select(.op != $op)))
      + [{op: $op, nodeId: $nodeId, prompt: $prompt, render: $render,
          sha256: $sha256, bytes: $bytes, at: $at, renderUrl: $url}]
  | .steps |= sort_by(if .op == "create" then 0 else 1 end)
  ' manifest.json > manifest.json.tmp && mv manifest.json.tmp manifest.json

# SHA256SUMS odtwarzany z manifestu, żeby oba pliki nie mogły się rozjechać.
jq -r '.steps[] | "\(.sha256)  \(.render)"' manifest.json > SHA256SUMS

# Usunąć rendery, do których manifest już się nie odwołuje — inaczej po zmianie nodeId
# w katalogu zostaje osierocony plik, którego nie pokrywa SHA256SUMS.
mapfile -t referenced < <(jq -r '.steps[].render' manifest.json)
shopt -s nullglob
for existing in ./*.png; do
  keep=0
  for want in "${referenced[@]}"; do
    [[ ${existing#./} == "$want" ]] && keep=1 && break
  done
  (( keep )) || { rm -f "$existing"; echo "usunięto osierocony render ${existing#./}"; }
done
shopt -u nullglob

render_count=$(ls -1 ./*.png 2>/dev/null | wc -l)
if (( render_count > MAX_RENDERS )); then
  echo "warn: $render_count plików renderu, deklarowany limit to $MAX_RENDERS" >&2
fi

echo "zapisano $op  nodeId=$node_id  $render_name  ${bytes} B  sha256=${sha:0:16}…"
