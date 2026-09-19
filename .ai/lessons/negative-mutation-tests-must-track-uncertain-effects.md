---
title: "Negative mutation tests must track uncertain effects"
modules: ["delivery_os","delivery_wordpress"]
areas: ["testing","integration","debugging"]
topics: ["testing","data-scoping","concurrency","cleanup"]
---

# Negative mutation tests must track uncertain effects

**Context**: Delivery QA deliberately sends denied writes and races reservations. A successful response under a broken guard, or one successful request alongside a rejected transport, can create records outside the normal setup ledger.

**Problem**: Recording only expected fixture resources can report complete scenario cleanup while unexpected or uncertain writes remain. Parsing a response before recording its successful status has the same gap if parsing fails.

**Rule**: Register unexpected successful writes before parsing their body, retain bounded safe IDs when available, and mark transport failures of mutations as uncertain. Process all settled concurrent outcomes before assertions. Either adopt proven owned resources into cleanup or explicitly report incomplete cleanup requiring disposal of the owned environment. Never infer absence of a write from a lost response.

**Applies to**: HTTP security, idempotency and concurrency tests with API-created fixtures. Regression setups must first pass the unrelated domain guards so a red test demonstrates the intended defect rather than malformed setup.

**Native UI follow-up**: Navigation can create data too. WordPress dashboard Quick Draft creates an auto-draft for a newly logged-in content actor. Log fixture actors directly into the owned editor when the dashboard is outside the scenario. If cleanup finds an unexpected draft, verify the exact native user-option pointer, author, type, status, empty content and absence of children before explicitly reconciling it. Keep the actor-deletion guard; never replace that evidence with cascading deletion of everything authored by the account.
