---
id: asd-oss-t049-audit-fix-oss-polish-close-the-gate
title: "AUDIT-FIX: OSS polish — close the gate patch requests and the unresolved reviewer findings of OSS-01…06"
status: implemented
created: 2026-09-19
owner: OSS stream (Mateusz)
---

## Why

OSS-01…06 shipped with a gate that was not fully green (P1 auth i18n, P4 template parity) and ~117 minor reviewer
notes. Teammates integrate on the frozen v1 contracts, so the polish must be invisible to a conforming client.

## Scope

- A1 auth ACL i18n titles for all `delivery_os.*` features (authorised edit of `auth/i18n/*.json`).
- A2 template parity (`yarn template:sync:fix`, delivery_os line only).
- B: verified reviewer findings fixed with a test each; false positives dropped with a reason.
- C: triage table for every reviewer note; spec wording corrected where it drifted from shipped behaviour.
- D: hand-over `OSS-06-polish.md` + `OSS-06-final.md` §3/§6/§7 updated.

## Hard constraint

Frozen v1: no wire-format, error-code, enum or hash change. Anything that needs one becomes a documented limitation
with a proposed v2 change.
