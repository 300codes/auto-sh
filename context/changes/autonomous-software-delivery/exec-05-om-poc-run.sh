#!/usr/bin/env bash
# =============================================================================
# EXEC-05 OM PoC — Full delivery flow test
# =============================================================================
#
# Przechodzi przez cały pipeline delivery dla targetu open-mercato-module:
#   projekt → baseline → decyzje → task → attempt → Cezar → manifest → evidence
#
# Uruchomienie (pełna wersja z Cezarem):
#   APP_URL=http://localhost:3000 bash exec-05-om-poc-run.sh
#
# Wymagania:
#   - Działająca apka Next.js na $APP_URL (domyślnie http://localhost:3000)
#   - Postgres i Redis uruchomione (docker compose)
#   - Konto z rolą admin/employee (tworzone przez ten skrypt przy pierwszym uruchomieniu)
#   - npx cezar-cli dostępny w PATH (dla fazy 2 — prawdziwy run)
#
# Co skrypt robi:
#   FAZA 1: Tworzy projekt, baseline, decyzje, task, attempt przez API
#           → pobiera task package (zawiera targetProfile + acTestMap)
#   FAZA 2: Uruchamia Cezar na task package (prawdziwe: jest + typecheck + audit)
#           → zbiera wyniki i buduje ResultManifest v1 z prawdziwymi hashami
#   FAZA 3: Importuje manifest przez API → evidence zapisany, task = awaiting_review
#
# Uwaga: W wersji produkcyjnej FAZA 2 wykonuje Cezar. W wersji mockowej
#        (zakomentowany blok) manifest jest budowany z fake hashami — tylko
#        do testowania pipeline'u OSS, bez realnego wykonania kodu.
# =============================================================================

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
EMAIL="${OM_EMAIL:-marcin@om.demo}"
PASSWORD="${OM_PASSWORD:-Demo1234!}"
TENANT_ID="${OM_TENANT_ID:-428df2fe-c8e0-4cee-9283-b1747334eccc}"
ORG_ID="${OM_ORG_ID:-0e5832eb-5b2c-40f4-9f26-eb59a55ec8f9}"

# Katalog roboczy — skrypt musi być uruchamiany z katalogu auto-sh
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
# 0. Uwierzytelnienie
# =============================================================================

log "Logowanie jako ${EMAIL}..."
RESPONSE=$(curl -s -X POST "${APP_URL}/api/auth/login" \
  -d "email=${EMAIL}&password=${PASSWORD}&tenantId=${TENANT_ID}")
TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token') or '')")
[ -z "$TOKEN" ] && fail "Login nieudany: $(echo $RESPONSE | python3 -m json.tool)"
ok "Token JWT uzyskany."

# =============================================================================
# 1. Projekt
# =============================================================================

log "Tworzenie projektu delivery (from_brief, open-mercato-module)..."
PROJECT_RESP=$(api_json POST /api/delivery_os/projects -d '{
  "name": "OM delivery_os target profile PoC",
  "inputMode": "from_brief",
  "brief": "Implement and validate the open-mercato-module target profile for the delivery_os lib. AC-OM-001: profile validates against schema. AC-OM-002: assertRevisionKind returns ok:true for git.",
  "targetProfileId": "open-mercato-module",
  "limits": {"maxParallelTasks":2,"maxCorrectionRounds":2,"attemptTimeoutMinutes":20}
}')
PROJECT_ID=$(echo "$PROJECT_RESP"   | get_field "['id']")
PROJECT_TS=$(echo "$PROJECT_RESP"   | get_field "['updatedAt']")
ok "Projekt: ${PROJECT_ID}"

# =============================================================================
# 2. Upload placeholder screen (wymagany przez baseline freeze)
# =============================================================================

log "Upload placeholder screen PNG..."
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
SCREEN_SIZE=69

ATT_RESP=$(api POST /api/attachments \
  -F "file=@${WORK_DIR}/screen.png;type=image/png" \
  -F "name=poc-screen.png" \
  -F "entityId=delivery_os:delivery_project" \
  -F "recordId=${PROJECT_ID}")
ATTACHMENT_ID=$(echo "$ATT_RESP" | get_field "['item']['id']")
ok "Attachment: ${ATTACHMENT_ID}"

# =============================================================================
# 3. Zaktualizuj draftSpec z wymaganiami + AC + screen
# =============================================================================

log "Aktualizacja draftSpec projektu..."
UPDATE_RESP=$(api_json PUT /api/delivery_os/projects \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${PROJECT_TS}" \
  -d "{
    \"id\": \"${PROJECT_ID}\",
    \"draftSpec\": {
      \"requirements\": [{
        \"id\":\"REQ-OM-1\",
        \"title\":\"Target profile validation\",
        \"description\":\"The open-mercato-module profile must validate and use a git revision.\"
      }],
      \"acceptanceCriteria\": [
        {\"id\":\"AC-OM-001\",\"requirementId\":\"REQ-OM-1\",\"description\":\"targetProfileSchema.parse() on openMercatoModuleV1 passes, test catalogue non-empty\"},
        {\"id\":\"AC-OM-002\",\"requirementId\":\"REQ-OM-1\",\"description\":\"assertRevisionKind returns ok:true for git, ok:false for snapshot\"}
      ],
      \"acTestMap\": {
        \"AC-OM-001\": [\"open-mercato-module AC-OM-001: profile validates against schema\"],
        \"AC-OM-002\": [\"open-mercato-module AC-OM-002: OM profile uses git revision\"]
      },
      \"screens\": [{
        \"fileKey\": null, \"nodeId\": null,
        \"name\": \"delivery_os target profile PoC\",
        \"viewport\": {\"width\":1,\"height\":1},
        \"attachmentId\": \"${ATTACHMENT_ID}\",
        \"sha256\": \"${SCREEN_SHA}\",
        \"sizeBytes\": ${SCREEN_SIZE},
        \"mimeType\": \"image/png\",
        \"capturedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"
      }],
      \"tokens\": {},
      \"architectureSummary\": \"delivery_os lib __tests__\",
      \"planSummary\": \"jest + typecheck + audit on delivery_os lib\",
      \"manualChecks\": {}, \"attachments\": [], \"comments\": [],
      \"questions\": [], \"risks\": [], \"adr\": [], \"declaredTests\": []
    }
  }")
PROJECT_TS=$(echo "$UPDATE_RESP" | get_field "['updatedAt']")
ok "draftSpec zaktualizowany."

# =============================================================================
# 4. Baseline
# =============================================================================

log "Tworzenie baseline..."
BL_RESP=$(api_json POST "/api/delivery_os/projects/${PROJECT_ID}/baselines" \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${PROJECT_TS}" \
  -d '{"source":"manual"}')
BASELINE_ID=$(echo "$BL_RESP"   | get_field "['baselineId']")
BASELINE_HASH=$(echo "$BL_RESP" | get_field "['contentHash']")
PROJECT_TS=$(echo "$BL_RESP"    | get_field "['projectUpdatedAt']")
ok "Baseline: ${BASELINE_ID} (hash: ${BASELINE_HASH:0:12}...)"

# =============================================================================
# 5. Decyzje: requirements + design → activeBaselineId ustawiony
# =============================================================================

log "Zatwierdzanie wymagań..."
REQ_RESP=$(api_json POST "/api/delivery_os/baselines/${BASELINE_ID}/decisions" \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${PROJECT_TS}" \
  -d "{\"kind\":\"requirements\",\"verdict\":\"approved\",\"subjectHash\":\"${BASELINE_HASH}\",\"subjectVersion\":1}")
PROJECT_TS=$(echo "$REQ_RESP" | get_field "['projectUpdatedAt']")
ok "Requirements approved."

log "Zatwierdzanie designu..."
DES_RESP=$(api_json POST "/api/delivery_os/baselines/${BASELINE_ID}/decisions" \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${PROJECT_TS}" \
  -d "{\"kind\":\"design\",\"verdict\":\"approved\",\"subjectHash\":\"${BASELINE_HASH}\",\"subjectVersion\":1}")
PROJECT_TS=$(echo "$DES_RESP" | get_field "['projectUpdatedAt']")
ACTIVE_BL=$(echo "$DES_RESP"  | get_field "['activeBaselineId']")
ok "Design approved. activeBaselineId: ${ACTIVE_BL}"

# =============================================================================
# 6. Task
# =============================================================================

log "Tworzenie tasku..."
TASK_RESP=$(api_json POST "/api/delivery_os/projects/${PROJECT_ID}/tasks" -d "{
  \"source\": \"manual\",
  \"baselineId\": \"${BASELINE_ID}\",
  \"title\": \"Validate open-mercato-module target profile\",
  \"description\": \"Run contract tests for AC-OM-001 and AC-OM-002 against the delivery_os lib.\",
  \"acIds\": [\"AC-OM-001\",\"AC-OM-002\"],
  \"allowedPaths\": [\"packages/core/src/modules/delivery_os/lib/**\"]
}")
TASK_ID=$(echo "$TASK_RESP"   | get_field "['id']")
TASK_TS=$(echo "$TASK_RESP"   | get_field "['updatedAt']")
ok "Task: ${TASK_ID}"

log "Status tasku: draft → ready..."
READY_RESP=$(api_json PUT /api/delivery_os/tasks \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${TASK_TS}" \
  -d "{\"id\":\"${TASK_ID}\",\"status\":\"ready\"}")
TASK_TS=$(echo "$READY_RESP" | get_field "['updatedAt']")
ok "Task ready."

# =============================================================================
# 7. Attempt (rezerwacja)
# =============================================================================

log "Rezerwacja attempt manual_handoff..."
COMMIT_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
IDEM_KEY="poc-om-$(date +%s)"

ATTEMPT_RESP=$(api_json POST "/api/delivery_os/tasks/${TASK_ID}/attempts" \
  -H "Idempotency-Key: ${IDEM_KEY}" \
  -H "x-om-ext-optimistic-lock-expected-updated-at: ${TASK_TS}" \
  -d "{\"mode\":\"manual_handoff\",\"baseRevision\":{\"kind\":\"git\",\"commitSha\":\"${COMMIT_SHA}\"}}")
ATTEMPT_ID=$(echo "$ATTEMPT_RESP"  | get_field "['attemptId']")
PACKAGE_URL=$(echo "$ATTEMPT_RESP" | get_field "['packageUrl']")
ok "Attempt: ${ATTEMPT_ID}"

# =============================================================================
# 8. Pobierz task package
# =============================================================================

log "Pobieranie task package..."
PKG=$(api GET "${PACKAGE_URL}")
echo "$PKG" > "${WORK_DIR}/task-package.json"
TARGET_PROFILE=$(echo "$PKG" | get_field "['targetProfileId']")
CHECKS=$(echo "$PKG" | python3 -c "import sys,json; d=json.load(sys.stdin); print([c['checkId'] for c in d['validationProfile']['checks']])")
ok "Task package OK — profil: ${TARGET_PROFILE}, checki: ${CHECKS}"

# =============================================================================
# 9a. FAZA 2 — PRAWDZIWY RUN (Cezar)
# =============================================================================
#
# Odkomentuj tę sekcję gdy Cezar jest dostępny i masz czysty checkout repo.
#
# log "Uruchamianie Cezara..."
# CEZAR_OUT="${WORK_DIR}/cezar-result"
# mkdir -p "$CEZAR_OUT"
#
# npx cezar-cli run \
#   --task-package "${WORK_DIR}/task-package.json" \
#   --output-dir   "$CEZAR_OUT" \
#   --base-dir     "$REPO_ROOT" \
#   --no-open
#
# MANIFEST_FILE="${CEZAR_OUT}/result-manifest.json"
# [ -f "$MANIFEST_FILE" ] || fail "Cezar nie wyprodukował result-manifest.json"
# ok "Cezar zakończył. Manifest: ${MANIFEST_FILE}"
#
# MANIFEST_JSON=$(cat "$MANIFEST_FILE")

# =============================================================================
# 9b. FAZA 2 — MOCK (bez Cezara, fake hashe — TYLKO do testów pipeline'u OSS)
# =============================================================================
#
# Usuń tę sekcję gdy używasz prawdziwego Cezara powyżej.
#
log "UWAGA: używam mock manifestu (fake hashe). Cezar nie uruchomiony."
log "Odkomentuj sekcję 9a żeby uruchomić prawdziwy Cezar."

MANIFEST_JSON=$(python3 -c "
import json, sys
pkg = json.load(open('${WORK_DIR}/task-package.json'))
ac_map = pkg['validationProfile'].get('requiredTests', {})
commit = '${COMMIT_SHA}'

# Buduj checki: jeden check per AC + checki bez AC (typecheck, audit)
checks = []
seq = 0
for ac_id, test_ids in ac_map.items():
    for test_id in test_ids:
        seq += 1
        checks.append({
            'checkId': f'unit-tests-{seq}',
            'testId': test_id,
            'acIds': [ac_id],
            'commandProfileId': 'jest-module',
            'validationProfileVersion': pkg['validationProfile']['version'],
            'testDefinitionHash': 'a' * 64,
            'rawReportHash': 'b' * 64,
            'status': 'passed',
            'exitCode': 0,
            'durationMs': 3200,
            'sourceRevision': {'kind': 'git', 'commitSha': commit},
        })

for check in pkg['validationProfile']['checks']:
    if check['kind'] != 'test':
        checks.append({
            'checkId': check['checkId'],
            'testId': check['checkId'],
            'acIds': [],
            'commandProfileId': check['commandProfileId'],
            'validationProfileVersion': pkg['validationProfile']['version'],
            'testDefinitionHash': 'c' * 64,
            'rawReportHash': 'd' * 64,
            'status': 'passed',
            'exitCode': 0,
            'durationMs': 5000,
            'sourceRevision': {'kind': 'git', 'commitSha': commit},
        })

manifest = {
    'schemaVersion': 'delivery.result-manifest/v1',
    'projectId':  pkg['projectId'],
    'taskId':     pkg['taskId'],
    'attemptId':  pkg['attemptId'],
    'baselineId': pkg['baselineId'],
    'baselineHash': pkg['baselineHash'],
    'targetProfileVersion': pkg['targetProfileVersion'],
    'externalRunId': 'manual-poc-run-om-001',
    'baseRevision':   {'kind': 'git', 'commitSha': commit},
    'resultRevision': {'kind': 'git', 'commitSha': commit},
    'baseCommit':   commit,
    'resultCommit': commit,
    'changedPaths': [],
    'artifacts': [],
    'checks': checks,
    'agentDeclaration': {
        'summary': 'Mock PoC run — replace with real Cezar output for production',
        'claimedAcIds': list(ac_map.keys()),
    },
    'findings': [],
    'usage': {'source': 'manual', 'values': 'unknown'},
}
print(json.dumps(manifest))
")

# =============================================================================
# 10. Import result manifestu
# =============================================================================

log "Importowanie result manifestu..."
RESULT=$(api_json POST "/api/delivery_os/tasks/${TASK_ID}/results" \
  -d "{\"attemptId\":\"${ATTEMPT_ID}\",\"manifest\":${MANIFEST_JSON}}")
EVIDENCE_ID=$(echo "$RESULT"   | get_field "['evidenceId']")
TASK_STATUS=$(echo "$RESULT"   | get_field "['taskStatus']")
ok "Evidence ID: ${EVIDENCE_ID}"
ok "Task status: ${TASK_STATUS}"

# =============================================================================
# Podsumowanie
# =============================================================================

echo ""
echo "============================================================"
echo "  EXEC-05 OM PoC — ZAKOŃCZONY"
echo "============================================================"
echo "  Projekt:     ${PROJECT_ID}"
echo "  Baseline:    ${BASELINE_ID}"
echo "  Task:        ${TASK_ID}"
echo "  Attempt:     ${ATTEMPT_ID}"
echo "  Evidence:    ${EVIDENCE_ID}"
echo "  Task status: ${TASK_STATUS}"
echo "  Commit:      ${COMMIT_SHA}"
echo ""
echo "  Raport:"
echo "  ${APP_URL}/backend/delivery/projects/${PROJECT_ID}"
echo ""
echo "  Następny krok (produkcja):"
echo "  1. Odkomentuj sekcję 9a (npx cezar-cli run ...)"
echo "  2. Usuń sekcję 9b (mock manifest)"
echo "  3. Zrób review evidence przez Michała → decyzja deploy"
echo "============================================================"
