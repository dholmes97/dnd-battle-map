export const BEYOND20_DOWNLOAD = "/downloads/beyond20-flc-2.20.1-r1.zip";

export function Beyond20Download() {
  return <details className="qa-session-launcher beyond20-download" id="beyond20-setup">
    <summary><span><span className="eyebrow">Player setup</span><strong>D&amp;D Beyond HP sync</strong></span><small>Extension &amp; instructions <span aria-hidden="true">⌄</span></small></summary>
    <div className="beyond20-download-body">
      <p>Use our patched Beyond20 extension to send HP changes from your character sheet to the battle map. This is an unofficial Chrome desktop build, not a Safari extension or a Chrome Web Store release.</p>
      <a className="beyond20-download-button" href={BEYOND20_DOWNLOAD} download>Download patched Beyond20 · ZIP</a>
      <ol>
        <li>Download and unzip the file. Move the extracted folder somewhere permanent; Chrome needs it to remain there.</li>
        <li>Open <code>chrome://extensions</code> in Chrome. Disable any existing Beyond20 copy to avoid duplicate events, then turn on <strong>Developer mode</strong>.</li>
        <li>Choose <strong>Load unpacked</strong> and select the extracted <strong>chrome</strong> folder—the one containing <code>manifest.json</code>.</li>
        <li>Open the patched extension’s options. In <strong>List of custom domains to load Beyond20</strong>, add <code>https://dnd.fridaylunchcrew.com/</code>. Click <strong>Apply</strong>, approve that site’s permission, then <strong>Save</strong>.</li>
        <li>Open your D&amp;D Beyond sheet and the battle map in the same Chrome profile. Separate windows are fine. With the battle map active, click the Beyond20 extension icon to activate it, then refresh both tabs.</li>
        <li>On the battle map, open <strong>B20</strong> in the top toolbar and enable <strong>Sync HP</strong>. This choice is remembered for your linked character in this browser.</li>
      </ol>
      <p><strong>Check the connection:</strong> B20 should show “Beyond20 detected” and your linked sheet. Only your own linked character can sync, and maximum HP must match. Errors pause syncing until you enable it again. Rolls from Beyond20 are previews, not automatic battle-map attacks.</p>
      <details><summary>Troubleshooting, updates &amp; source</summary><p>If nothing arrives, check that only the patched copy is enabled, recheck the custom domain permission, and activate the extension on the battle-map tab again. Don’t test HP changes during active play without agreeing with the table.</p><p>This build does not auto-update. For a replacement, extract the new download, disable the old patched copy, and load the new chrome folder. To undo installation, disable this copy and re-enable the store version.</p><p>Based on Beyond20 2.20.1 by KaKaRoTo and contributors. The ZIP includes the modified source, build instructions, patch, and upstream GPLv3/MIT licenses. Local testing only: also add <code>http://localhost:3001/</code> if you use the development server.</p></details>
    </div>
  </details>;
}
