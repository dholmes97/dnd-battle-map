# Dependency security update — September 14, 2026

Outcome: **fixed locally**.

## Scope and patch

`package.json` and `package-lock.json` update Next.js and its ESLint configuration from 16.3.2 to 16.3.5, Sharp from 0.35.3 to 0.35.4, and transitive js-yaml from 4.3.1 to 4.3.2. The existing Miniflare override now also resolves Sharp to the root patched version. All three Miniflare copies previously pinned Sharp 0.35.2; changing only the direct dependency would have left those affected copies installed. Cloudflare, Wrangler, and Miniflare versions remain unchanged.

The complete initial audit reported six affected packages (one critical and five high), including downstream effects of Sharp. The resolved runtime and full-development trees both report zero vulnerabilities. The lockfile's larger diff removes duplicate native-image dependencies; an independent review found no unrelated package version changes.

## Relevant boundaries

- Next.js advisories cover Windows-hosted servers and AVIF image optimization. This application runs Vinext on Cloudflare Workers, with image optimization routed through Vinext/Cloudflare Images (`worker/index.ts`). Production exploitation of the reported Next server paths was not demonstrated. Updating the affected installed package removes reliance on that distinction.
- Sharp processes local image inputs in `scripts/prepare-scenario-handout.mjs` and `scripts/prepare-creature-art.mjs`, and image bytes in Miniflare's image adapter. The patched prebuilt dependency reports libheif 1.23.2. All installed Sharp resolutions are 0.35.4.
- js-yaml is an ESLint configuration dependency, not an encounter-data parser. Its patched merge limit now rejects bounded test cases using repeated empty and nonempty merge sources while accepting ordinary configuration.

Upstream references: [Sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [Next AVIF advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), [Next Windows advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36), [YAML merge advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

## Verification

- `npm ls next sharp js-yaml miniflare --all`: patched versions resolved, including every nested Sharp consumer.
- `npm run audit:dependencies`: runtime and full dependency audits both report zero vulnerabilities.
- `npm ci --ignore-scripts --dry-run`: lockfile replay validation passes.
- Existing asset-preparation, catalog-image, and local-display tests: six pass.
- Temporary focused checks: AVIF-to-WebP conversion, truncated-image rejection, normal YAML, empty/nonempty YAML merge-limit rejection, and Miniflare Images resizing pass.
- `npm run verify`: typecheck, lint, Worker build, enforced coverage, 273 server/domain tests, 190 component tests, and all 30 Chromium/WebKit tests pass. These validate ordinary image preparation, campaign, map, and browser behavior after the dependency changes.
- No production exploit payload was executed. Removal of affected versions, the clean audit, patched native-library inspection, and the focused parser checks are the verification substitutes for the reported vulnerabilities.

Production has not been deployed by this change. Existing email-workflow work remains separate and intact.
