# Marketplace submission checklist — NOT READY

Initial target: Chrome Web Store, with Brave and Vivaldi compatibility testing. Firefox Add-ons would require a separate build and review.

- [ ] Independent-ID Proton authentication works or an authorised provider integration is available.
- [ ] Two simultaneous site-country routes are verified with observed exit IPs.
- [ ] Redirects, third-party resources, DNS/WebRTC, reconnects, disconnects and fail-closed behaviour are tested.
- [ ] Detection consent, manual overrides, retry bounds and persistence are tested under real browsing conditions.
- [ ] Browser permissions, upstream dependencies, telemetry and privacy disclosures are audited.
- [ ] Branding, title, icons and UI cannot be confused with an official Proton extension.
- [ ] GPLv3 source attribution, third-party licences and trademark obligations are satisfied.
- [ ] A reliable privacy-policy URL, support contact, store listing, screenshots, icons and release notes are prepared.
- [ ] Clean install, update, rollback and uninstall are tested on supported browsers.
- [ ] The developer account and marketplace review requirements are confirmed.

Do not advertise the extension as bypassing legally mandatory age or identity verification.

Chrome Web Store policies: https://developer.chrome.com/docs/webstore/program-policies/policies

The new toolbar shortcut and split-tunnelling conversion have isolated Chromium tests; these are NOT evidence of authenticated Proton traffic, permission compatibility on every browser, or marketplace approval.

- [ ] Confirm that the new opt-in delegation control is clearly visible next to Proton split-tunnelling settings, starts off, can be revoked, and does not conflict with connection management in live authenticated sessions.

- [ ] Demonstrate authorised login in the independent fork and verify subscription-dependent country availability matches original Proton, including locked regions and flag icons.
- [ ] Capture reproducible proof of authenticated country-specific Proton proxy exits and their actual external IPs; proxy ownership alone is not enough.
- [ ] Verify no DNS/WebRTC/subresource leaks and safe reconnect/failure behaviour under the recurring health monitor.
