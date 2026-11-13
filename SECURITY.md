# Security — experimental browser VPN fork

Live authenticated country-routing and IP/DNS/WebRTC leak tests are incomplete. Do not treat this project as a system-wide VPN or kill switch.

## Engineering requirements

- Proton's engine retains control of authentication, eligible servers, proxy settings and VPN connections.
- Detection and automatic country trials default off; classification occurs locally only after opt-in.
- Manual country rules take precedence over automated learning.
- Failed explicit per-site proxy routes must not silently fall back to DIRECT.
- Local/private/credential-bearing hostnames and invalid country codes must be rejected.
- Native messaging handles validated policy data only, not shell commands or Proton credentials.
- The fork disables the inherited Proton Sentry crash-report destination.

## Release blockers

Real Proton sign-in; independent per-country exit-IP verification; DNS, WebRTC, redirect, CDN/subresource and failure behaviour; Chrome permissions review; upstream security/dependency review; privacy/trademark policy; accessibility and installation tests.

Report vulnerabilities privately to the repository owner, without publishing credentials or personal browsing history.
