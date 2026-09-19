# Implementation adaptations — 2026-09-19

The approved bounded F0 intent and public createSite v1 remain unchanged. Native
checks live in a separate internal `demo-native.ts` to keep the operator orchestration
small. Package-local typeRoots precede workspace types because this checkout's root
dependencies are absent; this fixes package typecheck without adding dependencies.

Review found that a completed probe stops its site, whereas createSite replay preserves
that stopped state. The caller now explicitly starts only its owned site, records
`site.start`, and stops it in finally. This is an internal caller correction.

## Studio sandbox archive transport

The first live run created a fresh owned site, then failed with COMMAND_FAILED during
plugin installation. Read-only reconciliation found all three target plugins absent
and blog_public unchanged. Studio 1.19 sandbox mounts only the WordPress directory
for WP-CLI; a private host/state path is not accessible inside that PHP runtime.
The failed operator attempt retained its operation lock and correctly reported the
stop attempt as blocked, rather than claiming cleanup.

Keep verified ZIP bytes outside the served WordPress directory. Adapt the internal
operator installer to serve those frozen bytes over an ephemeral HTTP listener bound
only to 127.0.0.1 with an unguessable per-operation URL. Serve only the exact GET path;
no redirects, directory access, logs or public evidence of the capability URL. Close
all connections and the listener after the bounded WP-CLI operation, including errors.
This is local transport, not a public application API or Studio Preview publication.
Do not change the site's sandbox runtime or stage the paid archive in its web root.
Targeted tests must verify actual fetched bytes and listener cleanup on success/failure.

An operator may reconcile this observed failed attempt only after its command has
finished, the ownership/Studio ID agree, plugin state and absence of target directories
are confirmed, and the exact site is stopped. Record that action separately; the tools
must never remove reconciliation locks or silently adopt sites on automatic retry.

The first loopback attempt was also rejected before installation. A read-only live
`wp_http_validate_url` probe confirmed that WordPress rejects the exact loopback/port
class by default. The installer therefore registers temporary WP-CLI process hooks
allowing only its internally minted exact URL, 127.0.0.1 host and assigned port. All
other host/URL/port decisions retain their incoming policy, and redirects for this
single request are disabled. No persistent WordPress filter, global unsafe URL setting
or TLS bypass is introduced. Independent transport review and a new live run follow.

## User steering during execution

All installation, configuration, build and checks must finish locally before Preview
upload. Studio Preview receives the complete verified snapshot as deployment; no remote
installation/build/configuration or repair step. This F0 operator already runs locally
and performs no upload. Future adapter acceptance must reject publication without local
build/check evidence tied to the approved snapshot, then verify uploaded revision read-only.
