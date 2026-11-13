# Proposed Proton VPN ↔ Helper integration

## Objective

Give users **one Proton connection, one Proton sign-in and one server-country catalogue**, while allowing a separate open-source Helper to propose per-website country routing. The official Proton browser extension must stay the only holder of VPN credentials and the only manager of Chromium's proxy settings.

## What prevents it today

The current official Proton browser extension's `externally_connectable` manifest permits requests from `https://account.proton.me/*` and does **not** allow third-party extension IDs. Chromium isolates extension storage and service workers, so the Helper cannot read the signed-in account or call a private internal country-switching method.

The browser-proxy configuration is **global** to the profile. Inspecting the current proxy endpoint does not grant access to Proton's authenticated country-specific proxy endpoints or prove that an arbitrary per-host route would authenticate.

## Minimal opt-in contract, for Proton's approval

1. Proton adds an explicit, initially OFF setting in its Split tunnelling screen: **Allow Proton VPN Helper to manage website routing**. It visibly identifies the authorised extension and offers revocation.
2. Proton allowlists the Helper's published extension ID in `externally_connectable.ids`. Proton's own code requires the exact sender ID and a versioned message schema.
3. A read-only `getState` API reports **booleans** for signed-in, connected and proxy-owned, current default exit country, and which capabilities are available. No access/refresh tokens, credentials, cookie values or proxy passwords leave Proton.
4. A read-only `listCountries` API supplies the actual eligible and unavailable server countries, translated names and flags. Proton remains the source of truth for account entitlements.
5. A `setWebsiteCountry` operation takes a canonical hostname, two-letter target country and explicit subdomain scope, checks the Proton account, consent and server availability, then **Proton itself** applies per-website routing within its existing authenticated proxy machinery. Replies include accepted/rejected state, reason and a ruleset generation number.
6. A `removeWebsiteCountry` operation removes only the route belonging to the delegated Helper. A `subscribeChanges` channel sends connection/entitlement/routing updates in both directions, with acknowledgement and versioning.
7. Revocation immediately makes Proton ignore Helper instructions and return control to the original Proton settings without revealing any secrets or leaving stale proxy routes behind.

## Security requirements

- No silent auth reuse, token extraction, browser-profile copying or impersonation of the official extension.
- Never open or rewrite another extension's files or state to force cross-extension communications.
- No helper `chrome.proxy.settings.set`, no separate login, no independent proxy-auth provider, no competing full-profile PAC configuration.
- Atomic routing updates, clear fallback policy and failure-closed handling for unavailable exits, DNS and WebRTC leaks.
- Explicit user-consent and release-version gating for any country switching.
- Test simultaneous destinations with **actual authenticated Proton exit IPs**, reconnects, entitlements, policy conflict, sign-out and revocation.

## Current implementation

The v1.4.1 companion enforces **read-only observational behaviour** and stores pending preferences. It does not claim that this proposed protocol exists. The former experimental Proton fork is retained only in source for analysis; it is not the deployed companion build.

The necessary upstream changes must be developed and reviewed with Proton. Without them, no browser extension can reliably use the official authenticated country pool for simultaneous website-specific exits.

## Working reference implementation in this repository

The bridge is implemented on both sides, **but not installed into Proton's official store extension**:

- `source/companion/js/officialBridge.js` is the Helper-side, versioned protocol client. It sends requests to the **fixed official Proton extension ID** and requires a fresh 128-bit challenge nonce and strict non-secret typed response fields. It fails closed when the official extension does not expose the endpoint.
- `source/js/siteRouter/officialHelperBridgeProvider.ts` is the proposed **Proton-side** endpoint in our unofficial source fork. It allowlists only the Helper extension ID and checks the explicit user consent flag before revealing sign-in state or country entitlement. Routing commands return **unsupported** until Proton itself implements their authenticated transport.
- The unofficial source fork's `source/manifest.json` adds exactly the Helper ID to the external sender list, **without modifying the installed official Proton extension**.
- `source/js/vpn/initMessaging.ts` separates Proton-account site messages from the newly allowlisted Helper sender. A Helper cannot trigger Proton's session-fork login messages.
- `source/js/siteRouter/protonConsentUi.ts` implements the visible user-controlled switch inside our modified fork's split-tunnelling settings. Upstream must review and add it to the actual official extension.
- `source/js/siteRouter/officialHelperBridgeProvider.ts` also adds consent, account-session and proxy-change notifications back to the Helper; every notification carries only a versioned event name, never tokens or VPN credentials.

### What the headless end-to-end mock proves

Run `python3 tests/official_bridge_browser.py`. It creates a **temporary synthetic provider** with an unrelated test-only public key and extension ID, then builds a throwaway Helper copy pointing at that synthetic ID. It confirms:

1. With Proton-side consent OFF, the Helper cannot claim to be signed in.
2. With consent ON, the Helper receives only sign-in booleans, default country and available/locked country metadata.
3. If the provider lacks per-site transport capability, country route commands are rejected.
4. With simulated provider support, a user command reaches the test provider; no real VPN traffic is involved.
5. Revocation and reverse-direction change messages make the Helper abandon the linked state and deny further requests.

**Important:** This test does not impersonate the installed official Proton extension, acquire its private tokens, or validate a real Proton exit country. Real production support requires Proton's explicit upstream changes, approval and acceptance tests.
