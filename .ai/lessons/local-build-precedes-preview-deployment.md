---
title: "Local build precedes preview deployment"
modules: ["delivery_wordpress"]
areas: ["architecture", "testing"]
topics: ["build-output", "provider-lifecycle", "deployment"]
---

# Local build precedes preview deployment

**Context**: The user clarified that Studio Preview receives the finished local system as a deployment.

**Problem**: Calling a preview target a runtime can blur the boundary and suggest installing plugins, dependencies or building assets remotely.

**Rule**: Complete installation, configuration, build, tests and review locally. Bind the resulting snapshot/hash to the required approval before upload. Treat Preview as a deployment target, with no remote installation, configuration or build; prepare fixes locally and redeploy.

**Verification**: Local build/check evidence and the uploaded revision must agree. Post-upload checks are read-only verification of that revision. A local plugin probe or Preview HTTP 200 alone does not prove the complete build or delivery flow.
