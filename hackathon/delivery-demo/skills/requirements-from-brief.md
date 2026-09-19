# Skill — `requirements-from-brief`

Wynik tej instrukcji jest **propozycją**, nie baseline'em. Człowiek wkleja go w UI projektu
(sekcja *Wymagania* → **Importuj propozycję**) i dopiero import zamraża wersję baseline'u.

Kontraktowe źródło prawdy: `requirementsProposalV1Schema`
(`packages/core/src/modules/delivery_os/lib/contracts.ts`). Ten plik opisuje, jak dojść do manifestu,
nie definiuje schematu po raz drugi.

## Wejście

- brief projektu (pole `brief` w projekcie albo treść podana w sesji),
- `projectId` — UUID z adresu `/backend/delivery/projects/<projectId>`,
- ewentualne odpowiedzi człowieka na wcześniejsze pytania.

## Wyjście

Jeden blok JSON — `RequirementsProposal v1`:

```json
{
  "schemaVersion": "delivery.requirements-proposal/v1",
  "projectId": "<UUID z adresu projektu>",
  "manifestId": "req-<krótki slug tematu>-<n>",
  "requirements": [{ "id": "REQ-1", "title": "…", "description": "…" }],
  "acceptanceCriteria": [{ "id": "AC-1", "requirementId": "REQ-1", "description": "…" }],
  "questions": [{ "id": "Q-1", "text": "…" }],
  "risks": [{ "id": "RISK-1", "text": "…", "mitigation": "…" }],
  "producedBy": { "tool": "claude-code", "sessionRef": null }
}
```

## Reguły

- `schemaVersion` przepisz **dosłownie**. Inna wartość jest odrzucana przez `parseVersioned`
  z kodem `unsupported_schema_version` — to nie jest pole do improwizacji.
- `projectId` musi być projektem, do którego importujesz. Obcy UUID daje `422 foreign_reference`.
- `manifestId` jest stabilny w obrębie sesji: powtórny import **tej samej treści** pod tym samym
  `manifestId` odpowiada `200 duplicate: true` i niczego nie zapisuje. Ta sama nazwa z **inną**
  treścią daje `409 idempotency_conflict` — wtedy zmień `manifestId`, nie treść.
- Zakres docelowy: **3–5 wymagań** i **6–8 kryteriów akceptacji**. Mniej nie zamyka scenariusza
  demo, więcej nie zmieści się w oknie.
- Każde `acceptanceCriteria[].requirementId` musi wskazywać istniejące `requirements[].id` —
  inaczej `foreign_reference` ze ścieżką `acceptanceCriteria.<i>.requirementId`.
- Identyfikatory (`REQ-*`, `AC-*`, `Q-*`, `RISK-*`) są unikalne w swojej liście. Duplikat daje
  `duplicate_stable_id`.
- Kryterium akceptacji opisuje **obserwowalny** rezultat („po zapisaniu formularza lista pokazuje
  nowy wpis"), nie implementację („dodać endpoint POST").
- Czego **nie** wyprowadzać: kryteriów akceptacji z obrazów. Jeśli materiałem wejściowym jest
  design, patrz sekcja niżej.
- Limit ciała importu: 2 MB znaków manifestu. Dialog liczy znaki i odrzuca nadmiar przed wysyłką.

## Manifest pisany ręcznie — wejście FROM_DESIGN

Projekt w trybie `from_design` startuje od **zatwierdzonych ekranów**, a wymagania i AC pisze
człowiek. Agent **nie rekonstruuje** specyfikacji z obrazów — reverse specification nie jest
w zakresie i nie wolno jej deklarować.

Kolejność dla FROM_DESIGN:

1. ekrany wchodzą do draftu (dialog *Dodaj ekran*, patrz `design-from-brief`),
2. człowiek pisze manifest wymagań według szkieletu niżej,
3. import tym samym dialogiem — dalej tor jest identyczny jak FROM_BRIEF.

Minimalny szkielet, wszystkie pola wymagane:

```json
{
  "schemaVersion": "delivery.requirements-proposal/v1",
  "projectId": "<UUID projektu>",
  "manifestId": "req-manual-1",
  "requirements": [{ "id": "REQ-1", "title": "<jedno zdanie>" }],
  "acceptanceCriteria": [{ "id": "AC-1", "requirementId": "REQ-1", "description": "<obserwowalny rezultat>" }],
  "questions": [],
  "risks": [],
  "producedBy": { "tool": "human", "sessionRef": null }
}
```

`questions` i `risks` mogą być puste, ale muszą istnieć. `requirements` musi mieć co najmniej
jedną pozycję. `producedBy.tool` jest widoczne w podglądzie przed importem — to jedyne miejsce,
w którym pochodzenie propozycji jest widoczne w momencie decyzji; w zapisanym baseline zostaje
po niej `manifestId`/`manifestHash` w `importedManifests` oraz wpis w audycie.

## Po zwróceniu manifestu

Powiedz człowiekowi wprost, że to propozycja do przejrzenia, i wypisz `questions` osobno —
pytania bez odpowiedzi są ryzykiem baseline'u, nie ozdobą manifestu.
