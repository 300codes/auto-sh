---
title: "Reuse tool capabilities does not imply reuse of orchestration runtime"
modules: ["delivery_wordpress"]
areas: ["architecture","ai-workflow"]
topics: ["module-boundaries","provider-lifecycle","scope"]
---

# Reuse tool capabilities does not imply reuse of orchestration runtime

**Context**: A user asked for existing WordPress capabilities in a new orchestrator, then clarified that the new system must own execution and create a new target.

**Problem**: Planning against the former server's API, sessions, queue and reports silently introduced a runtime dependency the user did not request.

**Rule**: Separate reusable tool behavior from the system that previously coordinated it. When the requested owner is a new orchestrator, implement a standalone provider interface and explicit callers; treat previous code as a reference unless runtime reuse is authorized. State which lifecycle and integration responsibilities remain outside the tool.

**Verification**: Demonstrate the new tool with the former server unavailable. A standalone smoke test proves tool independence, not integration with unfinished domain or workflow modules. Update conflicting plan assumptions after a user correction while preserving unearned acceptance criteria as incomplete.
