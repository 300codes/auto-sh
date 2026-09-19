# QA delivery — Plan Brief

Pełny plan: [plan.md](plan.md). Badanie: [research.md](research.md).

## Co i po co

Przygotować powtarzalny odbiór istniejącego backendu delivery oraz pakiet scenariuszy
dla przyszłego wykonawcy i WordPressa. Ustalić, które wyniki są dowodem działania,
które sprawdzają wyłącznie fixture, a które nadal wymagają implementacji lub próby live.

## Punkt startowy

OSS ma API R1–R19 i rozbudowane testy z atrapami. Brakuje rzeczywistych integracji
dwóch tenantów oraz pełnego HTTP flow do review. Narzędzia WP dostarczają snapshot,
ale ich raport nie spełnia kontraktu OSS. Modułu wykonawczego delivery_agents jeszcze nie ma.

## Wynik po implementacji planu

Samodzielne testy HTTP i izolowane dane pokażą stan zabezpieczeń i procesu OSS.
Scenariusze awarii, mapowanie WP na fixture, runbook i indeks dowodów pozwolą
dołączyć EXEC/UI bez zmiany znaczenia PASS. Błędy produktu zostaną udokumentowane;
ich naprawy nie będą ukryte w pracach nad QA.

## Decyzje

| Decyzja | Wybór | Źródło |
|---|---|---|
| Granica tej sesji | Dokumenty, plan i review; kod/test execution później | Użytkownik |
| Dane | Dwa tenanty, dodatkowo dwie organizacje w A; nowi ograniczeni aktorzy | Badanie |
| Cleanup | Weryfikowane zakończenie/archiwizacja po teście; fizyczne usunięcie własnego środowiska po suite | Kontrakt append-only |
| Scope produktu | Istniejące R1–R19; R20–R22 i live EXEC jako jawne zależności | Badanie |
| WP | Rozszerzyć test granicy OSS, mapowanie testowe bez produkcyjnego hosta | Użytkownik / badanie |
| Budżet WP | 1 h wykorzystana, 5 h pozostało; dalsze QA mapowania wliczane | Użytkownik, 2026-09-19 |

## Etapy

| Etap | Rezultat | Główne ryzyko |
|---|---|---|
| 1. QA-02 fixture | A/A1+A2, B/B1, ACL, załączniki, cleanup | Soft delete nie usuwa historii |
| 2. API | ACL, scope, wersje, manifesty, duplikaty i wyścigi | Mock nie dowodzi transakcji DB |
| 3. QA-03 backend | Dwa wejścia, proposals, baseline i ready gate | Approval starego baseline |
| 4. OSS flow | Rezerwacja → wynik → review → verified/poprawka | Wynik nie oznacza verified |
| 5. QA-04 przygotowanie | Macierz awarii i model zbierania dowodów | Brak wykonawcy live |
| 6. WP-M02 przygotowanie | Mapowanie i testy fixture | ToolCheck nie jest ResultCheck |
| 7. Odbiór | Uzupełniony runbook, macierz AC, rzeczywiste wyniki | Niepełne kontrole udające PASS |

## Warunki i ograniczenia

Etapy 1–4 wymagają dedykowanej aplikacji testowej, przygotowanego schematu i konta
bootstrap do tworzenia tenantów. Nie resetujemy bazy developera. Etapy 5–6 mogą
powstawać niezależnie; pełne recovery, UI obu wejść i OM→WP→OM pozostają odbiorami późniejszymi.
Nakład orientacyjny QA: 2–3 sesje, zależny od readiness; WP maksymalnie pozostałe 5 h,
łącznie z dalszą analizą/review. Historyczne okna H nie są nową obietnicą terminu.

## Kryteria sukcesu

- Testy ujawniają izolację i odmowy przez rzeczywiste HTTP oraz sprawdzają brak niepożądanych zapisów.
- Fake/fixture, realne HTTP i live executor są osobnymi klasami dowodów.
- Każda wymagana kontrola ma wynik albo jawny brak/blocker/not_run; nic nie znika z mianownika odbioru.
