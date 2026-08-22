# Continuous integration

The GitHub Actions release gate runs with read-only repository permissions and a locked Node 22 dependency installation.

## Jobs

- **Quality and component coverage:** typechecking, warning-free lint, Vitest component contracts, and authored React/shared-module coverage.
- **Build, integration, and domain coverage:** the Sites production build, Node/D1 integration contracts, migration application, Drizzle snapshot drift detection, asset/document integrity, and coverage for the shared core plus Worker command/adapters.
- **Browser and accessibility:** Chromium and WebKit journeys cover desktop plus 320px, 375px, 560px, and tablet layouts; fixed-identity keyboard login; campaign-home rendering; scenario entry; Settings bounds; coarse-pointer targets; tooltip overflow; mobile chat; creature/spell placement; touched-surface text size; and serious/critical WCAG axe checks. Failed runs retain traces, screenshots, video, and the HTML report.
- **Dependency review:** zero-advisory production audit plus rejection of high or critical development advisories.

Run the same checks locally with `npm run verify`, `npm run test:coverage`, and `npm run audit:dependencies`. Install the browser runtimes once with `npx playwright install chromium webkit` when they are not already present.

The Playwright web server uses a fresh temporary Cloudflare persistence directory for each run. Its D1 and R2 state is removed when the server stops, so successful journey data never accumulates in the ordinary developer database.

Coverage floors are an initial ratchet, not a quality target. Raise them as TEST-02, TEST-05, TEST-06, and TEST-07 add missing behavioral contracts. Never reduce a floor solely to make a change pass.
