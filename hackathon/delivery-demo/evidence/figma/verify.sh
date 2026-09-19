#!/usr/bin/env bash
# UI-01 — kontrole automatyczne dowodu figmowego.
#
# Uruchamia dokładnie te sprawdzenia, które wymieniają kryteria Fazy 2 i 3 planu UI-01,
# żeby weryfikacja była jedną komendą, a nie ręcznym porównaniem pól JSON.

set -uo pipefail

readonly MAX_BYTES=$((1024 * 1024))
readonly MAX_RENDERS=4
# Wzorzec sklejony z fragmentów, żeby skaner nie trafiał we własną definicję.
readonly SECRET_PATTERN="(fig[du]_|Bea""rer |acc""ess_token|ref""resh_token|cli""ent_secret)"

cd "$(dirname "$0")"
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root=""

failures=0

check() {
  local label=$1 status=$2 detail=${3:-}
  case $status in
    ok)   printf '  ✓ %s%s\n' "$label" "${detail:+ — $detail}" ;;
    skip) printf '  – %s%s\n' "$label" "${detail:+ — $detail}" ;;
    *)    printf '  ✗ %s%s\n' "$label" "${detail:+ — $detail}"; failures=$((failures + 1)) ;;
  esac
}

echo "UI-01 — kontrole dowodu figmowego"

if [[ ! -f manifest.json ]]; then
  check "manifest.json istnieje" fail "brak pliku — sekwencja create/update nie została wykonana"
else
  check "manifest.json istnieje" ok

  if jq -e . manifest.json >/dev/null 2>&1; then
    check "manifest.json jest poprawnym JSON-em" ok
  else
    check "manifest.json jest poprawnym JSON-em" fail
  fi

  create_node=$(jq -r '[.steps[]? | select(.op == "create") | .nodeId] | first // empty' manifest.json)
  update_node=$(jq -r '[.steps[]? | select(.op == "update") | .nodeId] | first // empty' manifest.json)

  if [[ -n $create_node && -n $update_node ]]; then
    if [[ $create_node == "$update_node" ]]; then
      check "kroki create i update mają identyczny nodeId" ok "$create_node"
    else
      check "kroki create i update mają identyczny nodeId" fail "create=$create_node update=$update_node"
    fi
  else
    check "kroki create i update obecne w manifeście" fail \
      "create=${create_node:-brak} update=${update_node:-brak}"
  fi

  missing=$(jq -r '.steps[]? | .render' manifest.json | while read -r f; do
    [[ -f $f ]] || echo "$f"
  done)
  if [[ -z $missing ]]; then
    check "pliki renderu z manifestu istnieją" ok
  else
    check "pliki renderu z manifestu istnieją" fail "brakuje: $(echo "$missing" | tr '\n' ' ')"
  fi

  create_sha=$(jq -r '[.steps[]? | select(.op == "create") | .sha256] | first // empty' manifest.json)
  update_sha=$(jq -r '[.steps[]? | select(.op == "update") | .sha256] | first // empty' manifest.json)
  if [[ -n $create_sha && -n $update_sha ]]; then
    if [[ $create_sha != "$update_sha" ]]; then
      check "hashe renderów create i update różnią się" ok
    else
      check "hashe renderów create i update różnią się" fail \
        "identyczny hash — to powtórny odczyt, nie realna zmiana"
    fi
  else
    check "hashe renderów create i update różnią się" skip "brak obu kroków"
  fi
fi

if [[ -f SHA256SUMS ]]; then
  if sha256sum -c SHA256SUMS >/dev/null 2>&1; then
    check "sha256sum -c SHA256SUMS" ok
  else
    check "sha256sum -c SHA256SUMS" fail "$(sha256sum -c SHA256SUMS 2>&1 | grep -v ': OK$' | tr '\n' ' ')"
  fi

  if [[ -f manifest.json ]]; then
    if diff <(sort SHA256SUMS) \
            <(jq -r '.steps[] | "\(.sha256)  \(.render)"' manifest.json | sort) >/dev/null 2>&1; then
      check "SHA256SUMS zgadza się z polami sha256 manifestu" ok
    else
      check "SHA256SUMS zgadza się z polami sha256 manifestu" fail
    fi
  fi
else
  check "SHA256SUMS istnieje" fail "brak pliku"
fi

shopt -s nullglob
renders=(./*.png)
shopt -u nullglob
if (( ${#renders[@]} == 0 )); then
  check "rendery PNG obecne" fail "brak plików .png"
else
  bad_type=""
  bad_size=""
  for f in "${renders[@]}"; do
    [[ $(file --brief --mime-type "$f") == image/png ]] || bad_type+="$f "
    (( $(stat -c %s "$f") <= MAX_BYTES )) || bad_size+="$f "
  done
  [[ -z $bad_type ]] && check "file rozpoznaje każdy render jako PNG" ok "${#renders[@]} plików" \
                     || check "file rozpoznaje każdy render jako PNG" fail "$bad_type"
  [[ -z $bad_size ]] && check "rozmiar każdego renderu w limicie ${MAX_BYTES} B" ok \
                     || check "rozmiar każdego renderu w limicie ${MAX_BYTES} B" fail "$bad_size"
  (( ${#renders[@]} <= MAX_RENDERS )) && check "liczba renderów w limicie $MAX_RENDERS" ok \
                                      || check "liczba renderów w limicie $MAX_RENDERS" fail "${#renders[@]}"
fi

# git grep zwraca 0 przy trafieniu, 1 przy jego braku i >=2 przy błędzie. Kod błędu nie może
# oznaczać "czysto" — nieudany skan sekretów musi wyglądać jak porażka, nie jak przejście.
if [[ -z $repo_root ]]; then
  check "brak wzorców sekretów w hackathon/delivery-demo" fail \
    "skan nie wykonał się — katalog nie jest repozytorium git"
else
  scan_hits=$(git -C "$repo_root" grep -nIE "$SECRET_PATTERN" -- hackathon/delivery-demo 2>&1)
  scan_status=$?
  case $scan_status in
    0) check "brak wzorców sekretów w hackathon/delivery-demo" fail \
         "$(printf '%s' "$scan_hits" | head -3 | tr '\n' ' ')" ;;
    1) check "brak wzorców sekretów w hackathon/delivery-demo" ok ;;
    *) check "brak wzorców sekretów w hackathon/delivery-demo" fail \
         "skan nie wykonał się (git grep zakończył się kodem $scan_status): $(printf '%s' "$scan_hits" | head -1)" ;;
  esac
fi

echo
if (( failures == 0 )); then
  echo "Wynik: wszystkie kontrole przeszły."
else
  echo "Wynik: $failures kontrol(i) nie przeszło."
fi
exit $(( failures > 0 ? 1 : 0 ))
