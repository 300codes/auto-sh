# Readiness — demo Autonomous Software Delivery

> Wspólny zapis gotowości czytany przez bramkę H3. Każdy strumień wnosi własną linię; nie edytować cudzych.

- **Figma (UI-01)**: `write=blocked`, `update=blocked` — 2026-09-19 — [figma-readiness.md](figma-readiness.md)

## Stan po przeglądzie integracyjnym 2026-09-19

| Obszar | Dostępne | Pozostały warunek |
|---|---|---|
| OSS / Mateusz | Kontrakty v1, projekty/baseline/zadania, proposals, rezerwacja/claim/result/cancel/reconcile/evidence | Review evidence, report i decyzje publikacji/release |
| EXEC / Marcin | [Probe CLI i konfiguracja](../../context/changes/autonomous-software-delivery/exec-01-readiness.md) | Log rzeczywistego workera/concurrency ≥2, provider i bridge |
| UI / Adam | [Skrypty dowodowe](evidence/figma/), raport Figmy i ekran szczegółów z hostem execution | OAuth na stanowisku demo, live write/update/read, lista projektów i baseline UI |
| WP / Michał | [Narzędzia Studio i snapshot](wordpress-reuse.md) | Host wykonania, mapowanie kontroli i skorelowany import do OSS |

Raport CLI WordPressa nie jest ResultManifest. Snapshot ma zgodny kształt SourceRevision, ale checks narzędziowe nie są dowodami AC. Żaden historyczny PASS na innym hoście nie zastępuje testów scalonej rewizji.

[Kolejna lista zadań i mapa połączeń](../../context/changes/autonomous-software-delivery/workstreams/next-tasks-2026-09-19.md).
