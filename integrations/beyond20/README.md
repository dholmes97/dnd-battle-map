# Beyond20 local refresh fix

## Force of Nature sheet links

The DM can save these in the battle map's B20 sheet-link controls. These are
campaign-character links, not name-based ownership rules:

- Dar'eleth (`character-dareleth`): `120144329`
- Malichar (`character-malichar`): `163508159`
- Jelton (`character-jelton`): `119657366`

Publishing source does not itself populate these live database values. Confirm
the links through an authenticated DM session after the schema is deployed.

This is a locally modified Beyond20 extension, not an official release or an
application deployment. It is based on the official `v2.20.1` tag, commit
`3d737952cd1ba505cd73a9f0d4ef8e84c5f47a8b`.

## Causes and fixes

- Beyond20's 100ms delayed tab removal can be cancelled by a fast page reload.
  The old tab registration survives even though its content script does not.
  Probe the current document's receiver before deciding whether to inject.
- Chrome can report a localhost grant including its port. The old permission
  comparison always strips the port from the page's origin. Match the actual
  page URL as well as the port-free origin; do not request broader permissions.
- Coalesce concurrent checks and recheck after a newer completed navigation;
  discard callbacks for closed tabs. A live receiver is not reinjected.

The patch is in `refresh-fix.patch`; the regression harness runs the actual
patched `onTabsUpdated` function with controlled Chrome callbacks and timers.
It is a focused regression test, not a replacement for browser verification.

## Reproduce the build

From the application repository root, use a fresh destination:

```sh
git clone --depth 1 --branch v2.20.1 https://github.com/kakaroto/Beyond20.git .working/beyond20-refresh-fix
git -C .working/beyond20-refresh-fix apply ../../integrations/beyond20/refresh-fix.patch
node integrations/beyond20/refresh-regression.test.cjs .working/beyond20-refresh-fix
cd .working/beyond20-refresh-fix
npm install --ignore-scripts --no-audit --no-fund
npm run build:chrome
```

Load `build/chrome` using Chrome's **Load unpacked**. Disable the store copy
first to avoid duplicate integrations. Add the same custom domains in the
patched copy's options, Apply the site permissions, and Save:

```text
http://localhost:3001/
https://dnd.fridaylunchcrew.com/
```

## Current local installation

- Patched extension ID: `boddjgbkomjimpoigcebcdapollonbef`.
- Build directory: `.working/beyond20-refresh-fix/build/chrome`.
- Store extension ID: `gnblbpbepfbfmoobegdogkglpbhcjofh`, disabled, not removed.
- Keep the build directory while the unpacked extension is installed.
- Rollback: disable the patched copy, enable the store copy, and refresh the
  map and character sheet. This also restores the original refresh defect.
- Sync HP consent is remembered in this browser for the signed-in identity, campaign character, and linked sheet across refresh and encounter reentry. A rejected update or error disables the remembered consent until explicitly reenabled. New identities or links default off.
  Re-enable it after entering the encounter. This patch repairs event transport;
  it does not silently change the app's HP-sync consent policy.

## Browser verification, 2026-09-07

Using separate Chrome windows for localhost and Dar'eleth's D&D Beyond sheet:

- Refresh both tabs: damage 124 → 123 received by the map.
- Refresh map only: healing 123 → 124 received by the map.
- Refresh sheet only: damage 124 → 123 and healing 123 → 124 received.
- Strength roll received as a sanitized preview after sheet refresh.
- Three further consecutive map refreshes: a new Strength roll received;
  the map reported Beyond20 detected and no captured console errors.
- No extension restart was needed between these successful refresh tests.
- Final test HP restored to 124/124, temporary HP 0.

Production-domain event delivery has not been exercised; no production code
or database was deployed or changed. The extension is active in this Chrome
profile only. Other players would need the same local patch or an upstream fix.
