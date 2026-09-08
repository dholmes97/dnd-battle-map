# Beyond20 — Friday Lunch Crew refresh fix r1

Unofficial modified build, 2026-09-08. Not endorsed by Beyond20 or D&D Beyond.
Chrome desktop only; this package cannot be installed in Safari.

## Install

1. Unzip and keep this folder in a permanent location.
2. In Chrome, open chrome://extensions and disable the existing Beyond20 copy.
3. Enable Developer mode, choose Load unpacked, and select this package's chrome folder.
4. In the patched extension's options, add https://dnd.fridaylunchcrew.com/
   under List of custom domains to load Beyond20. Click Apply, approve the
   permission for that site, then Save.
5. Open your character sheet and the battle map in the same Chrome profile.
   Separate windows work. Click the extension icon while on the battle map to
   activate it, then refresh both tabs.
6. Open B20 on the battle-map toolbar. Confirm Beyond20 detected and your linked
   sheet, then enable Sync HP. Your choice is remembered for that linked character.

Only your own linked character can sync; maximum HP must match. Errors pause
sync until you re-enable it. Beyond20 rolls are previews, not battle-map attacks.
For localhost development, also add http://localhost:3001/ as a custom domain.

There are no automatic updates. Disable this patched copy before loading a new
download. To roll back, disable this copy and re-enable the store extension.
Do not delete the installed folder while using the extension.

## Source, changes, and licenses

Beyond20 by KaKaRoTo and contributors: https://github.com/kakaroto/Beyond20
Base: v2.20.1, commit 3d737952cd1ba505cd73a9f0d4ef8e84c5f47a8b.
Upstream copyright notices and GPLv3/MIT license texts are preserved in both
chrome/ and source/. The source/ directory contains the corresponding modified
source and build inputs; refresh-fix.patch records the transport changes.

Friday Lunch Crew modifications probe stale custom-site receivers after page
refresh, coalesce navigation checks, and recognize localhost permission grants
with ports. The packaged manifest adds an unofficial-build name/version label;
permissions are unchanged. No account settings, sessions, or credentials are included.

To rebuild: in source/, run npm ci --ignore-scripts, then npm run build:chrome.
Load source/build/chrome. Use the supplied refresh-regression.test.cjs with
`node refresh-regression.test.cjs source` from this package's root to test the patch.
