# One-extension Proton VPN Helper (experimental)

This is a combined Chromium extension build, derived from the official Proton VPN browser-extension source under GPLv3. It includes its own region-block detector and per-website route rules. Proton's own browser VPN engine remains the sole handler of authentication, connection state, country-server selection and proxy settings.

## What one install means

One **unpacked browser extension** rather than installing a separate companion/controller plus provider fork. It does **not** plug into or upgrade the official Chrome Web Store Proton VPN extension. Disable the official extension in a **separate test browser profile** before enabling the fork: competing proxy-setting extensions can break browsing or expose traffic.

- The fork has a **different extension ID** and does not inherit your official Proton session.
- The official Proton account flow may not authorize the forked extension ID; login and live routing are **unverified**.
- The fork cannot modify the installed official Proton extension.
- This is browser-level HTTPS proxy protection, not a device-wide VPN.
- Per-host policies do not automatically route third-party subresources or CDNs as part of the parent site.
- Automatic alternative-country trials default **off** and must be enabled intentionally.
- A country being detected as accessible is heuristic, not evidence that age/identity verification is legally unnecessary.
- Do not distribute the private signing key or claim endorsement by Proton.

## Build

Use the main branch for published source, or an explicit development branch for experimental changes.

    npm ci --ignore-scripts --no-audit --no-fund
    npx tsc --noEmit
    npm run build

Load the built distribution/ folder into an **isolated Chromium profile** using its Extensions page -> Developer mode -> Load unpacked. A ZIP is included in release/ for transport; extract it before Load unpacked. Neither install nor activation was performed on your normal browsers.

There is one active consolidated repository. The earlier two-extension companion prototype was retired.

## MCP

The fork optionally syncs local site policy via the native messaging host com.local.proton_site_router. No native host is required for ordinary routing. Local MCP policy editor is in native/route_ctl.py. Local source code changes must be rebuilt, verified, and explicitly reloaded.

## Tests

    TS_NODE_SKIP_PROJECT=1 TS_NODE_COMPILER_OPTIONS='{"module":"Node16","moduleResolution":"Node16","target":"ES2020","rootDir":".","ignoreDeprecations":"6.0"}' npx ts-node tests/site_router.test.ts
    python3 -m unittest discover -s tests -p 'test_policy_store.py' -v
    SHORT_QA=1 python3 tests/browser_integration.py

Authenticated live Proton sign-in, network fail-closed and IP/DNS/WebRTC leak tests remain release blockers.

## Toolbar shortcut

The one-extension toolbar action opens a compact per-website country picker. **Alt+Shift+Y** is the suggested keyboard shortcut. The original Proton popup is available through **Proton VPN controls**, and the advanced routing editor through **All website rules**. Pin the icon with your browser's Extensions menu; Chromium does not permit extensions to force themselves into the pinned toolbar.

The shortcut checks existing Proton split tunnelling: one explicit click can remove an exact exclusion or include an exact site in Include-only mode before recording the chosen country. Broad exclusions remain unchanged and require review. Saved rule badges are neutral; only actual VPN/session checks may claim the connection is active.

## Reversible Proton Split tunnelling delegation

Open Proton VPN controls within this fork, go to Settings → Split tunnelling, and opt into **Allow Proton VPN Helper to manage split tunnelling**. Only then can the Helper change individual Include/Exclude entries and apply per-site country preferences. The switch starts off, retains saved rules when revoked, restores the original editor, and updates both views live. This is not account OAuth; the account sign-in step is separate. See docs/CONSENT_AND_ACCOUNT.md.

## Finding the switch before Proton sign-in

The Proton-style connection and settings menu is available after Proton account sign-in, which may not be possible yet with this unofficial extension ID. To configure Helper permissions **without signing in**, open **All website rules** from the Helper toolbar or **Configure Helper split tunnelling** on the signed-out Proton screen. The same reversible switch is at the top of the Helper settings page. Granting it does **not** sign into Proton or activate VPN protection.
