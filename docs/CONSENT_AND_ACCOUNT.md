# Proton account connection and Helper control

## The problem this setting solves

Proton's browser split tunnelling normally offers **Include** and **Exclude** rules. It cannot assign a different VPN country to one website without changing the default country for the browser.

**Proton VPN Helper** is intended to manage which website uses which eligible Proton country, while Proton continues handling account sign-in, eligible VPN servers and connections.

## Enable Helper management

These steps apply to **the unofficial combined Proton VPN Helper extension**, not the unmodified official Proton VPN extension.

1. Open the Helper toolbar popup using Alt+Shift+Y or its browser icon.
2. Select **Proton VPN controls** to open the original Proton-style connection manager within the combined extension.
3. Go to **Settings → Split tunnelling**.
4. Enable **Allow Proton VPN Helper to manage split tunnelling**.
5. Return to the Helper toolbar to assign a VPN country to a website.

The setting starts **off**. While off, the Helper cannot apply site-country routes, modify Proton's Include/Exclude list or run automatic country retries. Saved rules remain available but inactive. Revocation restores the original editor.

While on, the original Proton settings display a live count of saved Helper rules and link to the full rule manager. The Helper reflects permission changes and connection state. A disabled country rule gets a warning icon badge when the permission is revoked.

### Example

Suppose the default VPN connection is in the UK and an exact website is in Proton's Exclude list, which would otherwise bypass the VPN.

With Helper permission on, selecting Netherlands in the Helper offers to convert that exact website from Exclude into a Netherlands country preference with one click. A broad parent-domain exclusion is never removed automatically. The VPN engine, not the Helper, handles authentication and proxy connections.

This is the intended workflow. It has passed simulated browser and UI tests, **not live authenticated Proton multi-country traffic tests**.

## Account login is a separate permission

The split-tunnelling switch controls **local delegation**, not access to Proton account secrets. It does not sign the user in, access another extension's private session, or copy tokens, passwords or VPN proxy credentials.

For the user's Proton subscription, sign in through the Proton account interface **within the combined extension**. The Helper may mirror nonsecret information, including account sign-in status, connection status and default country, using the shared connection engine.

The modified extension has a different extension ID from the official Proton store extension. Whether Proton accepts that ID for account sign-in and real multi-country routing remains unverified.

## Tests

The isolated Chromium test in tests/toolbar_integration.py checks permission off by default, granting consent only through the original settings, rule-count and state synchronisation in both directions, exact Exclude and Include-only changes, parent-exclusion protection, and revocation that restores original controls.

These tests do not prove actual Proton authentication, subscriber entitlements, or leak-free country-specific network traffic.
