---
title: "Validate binary fixtures before runtime use"
modules: ["delivery_wordpress"]
areas: ["testing","integration"]
topics: ["binary-fixtures","media","cleanup"]
---

# Validate binary fixtures before runtime use

**Context**: WordPress editor QA creates a small PNG attachment from embedded fixture bytes.

**Problem**: A recognizable signature does not prove that image decoders can read the file. An attachment creation failure may also leave uploaded bytes without a corresponding WordPress record.

**Rule**: Validate the full binary structure, including PNG chunk CRCs, before runtime use. Verify decoding in the browser separately. On a handled attachment failure, remove only the exact newly uploaded regular file when no attachment was created and its bytes still match the fixture. Preserve attached, changed or uncertain files for explicit reconciliation; never remove unrelated uploads.

**Evidence**: The editor fixture tests validate both PNGs and execute the PHP orphan-cleanup branches against attached, changed and orphan outcomes. This record was restored after an interrupted write left it empty.
