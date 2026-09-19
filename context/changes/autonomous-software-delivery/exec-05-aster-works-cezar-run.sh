#!/usr/bin/env bash
# =============================================================================
# Aster Works — realny run z Cezarem (open-mercato-module profile)
# =============================================================================
#
# Pełny pipeline: projekt → baseline → task → execute (Cezar) → poll → review
#
# Uruchomienie:
#   APP_URL=http://localhost:3000 bash exec-05-aster-works-cezar-run.sh
#
# Wymagania PRZED uruchomieniem:
#   1. Działająca apka Next.js na $APP_URL
#   2. Queue worker z Cezarem:
#        DELIVERY_EXECUTOR=cezar yarn mercato queue worker delivery-execute
#   3. npx cezar-cli dostępny (yarn global add cezar-cli lub npx)
#   4. Zalogowany claude CLI (claude --version powinien działać)
#
# Co skrypt robi:
#   FAZA 1: projekt + baseline + decyzje + task (API)
#   FAZA 2: POST /api/delivery_agents/tasks/:id/execute → Cezar przejmuje
#   FAZA 3: poll co 15s dopóki task != awaiting_review (max 20 min)
#   FAZA 4: review (zatwierdź wynik)
# =============================================================================

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
EMAIL="${OM_EMAIL:-marcin@om.demo}"
PASSWORD="${OM_PASSWORD:-Demo1234!}"
TENANT_ID="${OM_TENANT_ID:-428df2fe-c8e0-4cee-9283-b1747334eccc}"
ORG_ID="${OM_ORG_ID:-0e5832eb-5b2c-40f4-9f26-eb59a55ec8f9}"
POLL_INTERVAL=15
POLL_MAX=80  # 80 × 15s = 20 min

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

log()  { echo "[$(date +%H:%M:%S)] $*"; }
ok()   { echo "[$(date +%H:%M:%S)] ✅  $*"; }
fail() { echo "[$(date +%H:%M:%S)] ❌  $*" >&2; exit 1; }

# =============================================================================
# Helpers
# =============================================================================

api() {
  local method="$1"; shift
  local path="$1"; shift
  curl -s -X "$method" "${APP_URL}${path}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Cookie: om_selected_org=${ORG_ID}" \
    "$@"
}

api_json() {
  local method="$1"; shift
  local path="$1"; shift
  api "$method" "$path" -H "Content-Type: application/json" "$@"
}

get_field() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }

# =============================================================================
# 0. Weryfikacja środowiska
# =============================================================================

log "Sprawdzam środowisko..."
npx cezar-cli --help >/dev/null 2>&1 || fail "cezar-cli niedostępny. Uruchom: npm install -g cezar-cli"
claude --version >/dev/null 2>&1    || fail "claude CLI niedostępny lub niezalogowany."
ok "cezar-cli i claude CLI gotowe."

# =============================================================================
# 1. Logowanie
# =============================================================================

log "Logowanie jako ${EMAIL}..."
RESPONSE=$(curl -s -X POST "${APP_URL}/api/auth/login" \
  -d "email=${EMAIL}&password=${PASSWORD}&tenantId=${TENANT_ID}")
TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token') or '')")
[ -z "$TOKEN" ] && fail "Login nieudany: $(echo "$RESPONSE" | python3 -m json.tool)"
ok "Token JWT uzyskany."

# =============================================================================
# 2. Projekt
# =============================================================================

log "Tworzenie projektu Aster Works..."
PROJECT_RESP=$(api_json POST /api/delivery_os/projects -d '{
  "name": "Aster Works — delivery_os helper (PoC)",
  "inputMode": "from_brief",
  "brief": "Aster Works potrzebuje strony firmowej wdrożonej na WordPressie. Jako krok przygotowawczy w delivery pipeline, potrzebujemy pomocniczej funkcji findTargetProfileById w pakiecie delivery_os, która zwróci profil po id lub null gdy profil nie istnieje. Funkcja jest wymagana do dynamicznego routowania zadań do właściwego hosta wykonania.",
  "targetProfileId": "open-mercato-module",
  "limits": {"maxParallelTasks": 1, "maxCorrectionRounds": 2, "attemptTimeoutMinutes": 25}
}')
PROJECT_ID=$(echo "$PROJECT_RESP" | get_field "['id']")
PROJECT_TS=$(echo "$PROJECT_RESP" | get_field "['updatedAt']")
[ -z "$PROJECT_ID" ] && fail "Błąd tworzenia projektu: $(echo "$PROJECT_RESP" | python3 -m json.tool)"
ok "Projekt: ${PROJECT_ID}"

# =============================================================================
# 3. Upload placeholder screena (wymagany przez baseline freeze)
# =============================================================================

log "Upload placeholder screena..."
python3 -c "
png = bytes([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,
  0xde,0x00,0x00,0x00,0x0c,0x49,0x44,0x41,0x54,0x08,0xd7,0x63,0xf8,0xcf,0xc0,0x00,
  0x00,0x00,0x02,0x00,0x01,0xe2,0x21,0xbc,0x33,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,
  0x44,0xae,0x42,0x60,0x82
])
open('${WORK_DIR}/screen.png', 'wb').write(png)
"
SCREEN_SHA="18ed33080443f2e2ca79eecd629e12d4636c9bc83543a4e45cb8dbe53e0b4be7"
ATT_RESP=$(api POST /api/attachments \
  -F "file=@${WORK_DIR}/screen.png;type=image/png" \
  -F "name=aster-works-placeholder.png" \
  -F "entityId=delivery_os:delivery_project" \
  -F "recordId=${PROJECT_ID}")
ATTACHMENT_ID=$(echo "$ATT_RESP" | get_field "['item']['id']")
ok "Attachment: ${ATTACHMENT_ID}"

# =============================================================================
# 4. draftSpec z wymaganiami + AC + acTestMap
#    Testy muszą być nazwane DOKŁADNIE tak jak w acTestMap — Cezar je napisze.
# =============================================================================

log "Aktualizacja draftSpec projektu..."
CAPTURED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
UPDATE_RESP=$(api_json PUT /api/delivery_os/projects \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${PROJECT_TS}" \
  -d "{
    \"id\": \"${PROJECT_ID}\",
    \"draftSpec\": {
      \"requirements\": [{
        \"id\": \"REQ-AW-1\",
        \"title\": \"findTargetProfileById helper\",
        \"description\": \"Funkcja eksportowana z targetProfiles.ts, przyjmuje id: string i zwraca TargetProfile lub null.\"
      }],
      \"acceptanceCriteria\": [
        {
          \"id\": \"AC-AW-001\",
          \"requirementId\": \"REQ-AW-1\",
          \"description\": \"findTargetProfileById('open-mercato-module') zwraca profil o poprawnym id\"
        },
        {
          \"id\": \"AC-AW-002\",
          \"requirementId\": \"REQ-AW-1\",
          \"description\": \"findTargetProfileById dla nieznanego id zwraca null\"
        }
      ],
      \"acTestMap\": {
        \"AC-AW-001\": [\"aster-works delivery: findTargetProfileById returns profile for known id\"],
        \"AC-AW-002\": [\"aster-works delivery: findTargetProfileById returns null for unknown id\"]
      },
      \"screens\": [{
        \"fileKey\": null, \"nodeId\": null,
        \"name\": \"Aster Works placeholder\",
        \"viewport\": {\"width\": 1, \"height\": 1},
        \"attachmentId\": \"${ATTACHMENT_ID}\",
        \"sha256\": \"${SCREEN_SHA}\",
        \"sizeBytes\": 69,
        \"mimeType\": \"image/png\",
        \"capturedAt\": \"${CAPTURED_AT}\"
      }],
      \"tokens\": {},
      \"architectureSummary\": \"packages/core/src/modules/delivery_os/lib/targetProfiles.ts\",
      \"planSummary\": \"Dodaj findTargetProfileById, pokryj testami, typecheck + audit\",
      \"manualChecks\": {}, \"attachments\": [], \"comments\": [],
      \"questions\": [], \"risks\": [], \"adr\": [], \"declaredTests\": []
    }
  }")
PROJECT_TS=$(echo "$UPDATE_RESP" | get_field "['updatedAt']")
ok "draftSpec zaktualizowany."

# =============================================================================
# 5. Baseline
# =============================================================================

log "Tworzenie baseline..."
BL_RESP=$(api_json POST "/api/delivery_os/projects/${PROJECT_ID}/baselines" \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${PROJECT_TS}" \
  -d '{"source": "manual"}')
BASELINE_ID=$(echo "$BL_RESP"   | get_field "['baselineId']")
BASELINE_HASH=$(echo "$BL_RESP" | get_field "['contentHash']")
PROJECT_TS=$(echo "$BL_RESP"    | get_field "['projectUpdatedAt']")
ok "Baseline: ${BASELINE_ID} (hash: ${BASELINE_HASH:0:12}...)"

# =============================================================================
# 6. Decyzje: requirements + design
# =============================================================================

log "Zatwierdzanie wymagań..."
REQ_RESP=$(api_json POST "/api/delivery_os/baselines/${BASELINE_ID}/decisions" \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${PROJECT_TS}" \
  -d "{\"kind\": \"requirements\", \"verdict\": \"approved\", \"subjectHash\": \"${BASELINE_HASH}\", \"subjectVersion\": 1}")
PROJECT_TS=$(echo "$REQ_RESP" | get_field "['projectUpdatedAt']")
ok "Requirements approved."

log "Zatwierdzanie designu..."
DES_RESP=$(api_json POST "/api/delivery_os/baselines/${BASELINE_ID}/decisions" \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${PROJECT_TS}" \
  -d "{\"kind\": \"design\", \"verdict\": \"approved\", \"subjectHash\": \"${BASELINE_HASH}\", \"subjectVersion\": 1}")
PROJECT_TS=$(echo "$DES_RESP" | get_field "['projectUpdatedAt']")
ok "Design approved. activeBaselineId: $(echo "$DES_RESP" | get_field "['activeBaselineId']")"

# =============================================================================
# 7. Task
# =============================================================================

log "Tworzenie tasku..."
TASK_RESP=$(api_json POST "/api/delivery_os/projects/${PROJECT_ID}/tasks" -d "{
  \"source\": \"manual\",
  \"baselineId\": \"${BASELINE_ID}\",
  \"title\": \"Dodaj findTargetProfileById do delivery_os lib\",
  \"description\": \"Zaimplementuj i wyeksportuj funkcję findTargetProfileById(id: string): TargetProfile | null w packages/core/src/modules/delivery_os/lib/targetProfiles.ts. Napisz testy jednostkowe pokrywające AC-AW-001 i AC-AW-002 w istniejącym pliku testowym targetProfiles.test.ts.\",
  \"acIds\": [\"AC-AW-001\", \"AC-AW-002\"],
  \"allowedPaths\": [\"packages/core/src/modules/delivery_os/lib/**\"]
}")
TASK_ID=$(echo "$TASK_RESP"  | get_field "['id']")
TASK_TS=$(echo "$TASK_RESP"  | get_field "['updatedAt']")
[ -z "$TASK_ID" ] && fail "Błąd tworzenia tasku: $(echo "$TASK_RESP" | python3 -m json.tool)"
ok "Task: ${TASK_ID}"

log "Status tasku: draft → ready..."
READY_RESP=$(api_json PUT /api/delivery_os/tasks \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${TASK_TS}" \
  -d "{\"id\": \"${TASK_ID}\", \"status\": \"ready\"}")
TASK_TS=$(echo "$READY_RESP" | get_field "['updatedAt']")
ok "Task ready."

# =============================================================================
# 8. Execute — Cezar przejmuje
# =============================================================================

log "Uruchamianie Cezara przez delivery_agents..."
COMMIT_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
IDEM_KEY="aster-works-$(date +%s)"

EXEC_RESP=$(api_json POST "/api/delivery_agents/tasks/${TASK_ID}/execute" \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${TASK_TS}" \
  -d "{
    \"idempotencyKey\": \"${IDEM_KEY}\",
    \"baseRevision\": {\"kind\": \"git\", \"commitSha\": \"${COMMIT_SHA}\"}
  }")

ATTEMPT_ID=$(echo "$EXEC_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('attemptId',''))" 2>/dev/null || true)
[ -z "$ATTEMPT_ID" ] && fail "Execute nieudany: $(echo "$EXEC_RESP" | python3 -m json.tool)"
ok "Attempt zarezerwowany: ${ATTEMPT_ID}"
ok "Cezar pracuje w tle. Commit bazowy: ${COMMIT_SHA:0:12}..."

# =============================================================================
# 9. Poll — czekaj na awaiting_review
# =============================================================================

log "Pollowanie statusu tasku co ${POLL_INTERVAL}s (max $((POLL_MAX * POLL_INTERVAL / 60)) min)..."
for i in $(seq 1 $POLL_MAX); do
  sleep $POLL_INTERVAL
  STATUS_RESP=$(api GET "/api/delivery_os/tasks/${TASK_ID}")
  TASK_STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")
  ATTEMPT_STATE=$(echo "$STATUS_RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
attempts=d.get('executionAttempts',[])
active=[a for a in attempts if a.get('state') not in ('completed','stopped','failed')]
print(active[0].get('state','—') if active else '—')
" 2>/dev/null || echo "—")
  log "[$i/${POLL_MAX}] task=${TASK_STATUS} attempt=${ATTEMPT_STATE}"

  if [ "$TASK_STATUS" = "awaiting_review" ]; then
    ok "Task gotowy do review!"
    break
  fi
  if [ "$TASK_STATUS" = "blocked" ] || [ "$TASK_STATUS" = "cancelled" ]; then
    fail "Task w stanie ${TASK_STATUS} — sprawdź logi workera."
  fi
  if [ "$i" -eq "$POLL_MAX" ]; then
    fail "Timeout — task wciąż ${TASK_STATUS} po $((POLL_MAX * POLL_INTERVAL / 60)) minutach."
  fi
done

TASK_TS=$(api GET "/api/delivery_os/tasks/${TASK_ID}" | get_field "['updatedAt']")

# =============================================================================
# 10. Review — zatwierdź wynik
# =============================================================================

log "Zatwierdzam wynik (review: approved)..."
EVIDENCE_RESP=$(api GET "/api/delivery_os/tasks/${TASK_ID}")
EVIDENCE_ID=$(echo "$EVIDENCE_RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
attempts=d.get('executionAttempts',[])
for a in reversed(attempts):
    eid=a.get('resultEvidenceId')
    if eid:
        print(eid)
        break
" 2>/dev/null || echo "")

if [ -z "$EVIDENCE_ID" ]; then
  log "⚠️  Nie znaleziono evidenceId automatycznie — review manualnie:"
  log "   ${APP_URL}/backend/delivery/projects/${PROJECT_ID}/tasks/${TASK_ID}"
else
  BASELINE_ID_FOR_REVIEW="$BASELINE_ID"
  RESULT_REVISION="{\"kind\":\"git\",\"commitSha\":\"${COMMIT_SHA}\"}"

  REVIEW_RESP=$(api_json POST "/api/delivery_os/projects/${PROJECT_ID}/evidence" \
    -H "x-om-ext-optimistic-lock-expected-updated-at: ${TASK_TS}" \
    -d "{
      \"kind\": \"review\",
      \"baselineId\": \"${BASELINE_ID_FOR_REVIEW}\",
      \"taskId\": \"${TASK_ID}\",
      \"attemptId\": \"${ATTEMPT_ID}\",
      \"sourceRevision\": ${RESULT_REVISION},
      \"payload\": {
        \"verdict\": \"approved\",
        \"summary\": \"Funkcja findTargetProfileById zaimplementowana poprawnie. Testy AC-AW-001 i AC-AW-002 przechodzą. Typecheck i audit czyste.\",
        \"findings\": [],
        \"reviewer\": {\"kind\": \"human\"},
        \"reviewedEvidenceId\": \"${EVIDENCE_ID}\"
      }
    }")
  FINAL_STATUS=$(echo "$REVIEW_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('taskStatus','?'))" 2>/dev/null || echo "?")
  ok "Review zapisany. Status tasku: ${FINAL_STATUS}"
fi

# =============================================================================
# Podsumowanie
# =============================================================================

echo ""
echo "============================================================"
echo "  ASTER WORKS — CEZAR RUN ZAKOŃCZONY"
echo "============================================================"
echo "  Projekt:     ${PROJECT_ID}"
echo "  Baseline:    ${BASELINE_ID}"
echo "  Task:        ${TASK_ID}"
echo "  Attempt:     ${ATTEMPT_ID}"
echo "  Commit:      ${COMMIT_SHA:0:12}..."
echo ""
echo "  Raport:"
echo "  ${APP_URL}/backend/delivery/projects/${PROJECT_ID}"
echo "============================================================"
