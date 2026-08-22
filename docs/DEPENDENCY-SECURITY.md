# Dependency security policy

The release gate distinguishes the deployed dependency graph from local build and test tooling while requiring both to remain reviewed.

## Required checks

- `npm ci` must reproduce `package-lock.json` without mutation.
- `npm run audit:dependencies` requires zero advisories of any severity in production dependencies and rejects high or critical advisories anywhere in the development graph.
- A development-only low or moderate advisory may remain only when this document records its package path, reachability, compensating controls, owner, review date, and removal condition. Unrecorded exceptions are not allowed.
- Framework, RSC, image-processing, Vite, Cloudflare, and Wrangler updates are tested as one compatible toolchain. Do not update only one member when its peer contract requires the others.

## Current baseline

On 2026-08-22 the toolchain was upgraded to Next 16.3.2, React and React Server DOM 19.2.8, Vinext 1.0.0-beta.8, Vite 8.2.2, Cloudflare Vite Plugin 1.53.1, Wrangler 4.125.0, and Sharp 0.35.3. Both the complete graph and the production-only graph report zero known vulnerabilities.

Drizzle Kit 0.31.10 still declares `@esbuild-kit/core-utils`, whose own dependency range selects an obsolete esbuild release. The root package uses a package-scoped override to esbuild 0.28.2. The schema no-op generation test and clean-database migration suite are mandatory compatibility proofs for that override. Remove it when Drizzle Kit no longer installs the legacy loader.

Miniflare 4 remains a direct development dependency because its stable constructor API powers the D1 unit-of-work and storage-lifecycle integration tests; the Cloudflare plugin's Miniflare 5 alpha uses a new incompatible constructor. A package-scoped override keeps Miniflare 4 on patched Undici 7.29.0. The full D1 suite is the compatibility proof, and this override should disappear when those fixtures migrate to Miniflare 5's worker-array API.

Audit results are time-dependent. Re-run them immediately before publishing and triage new results against the current lockfile rather than relying on this historical baseline.
