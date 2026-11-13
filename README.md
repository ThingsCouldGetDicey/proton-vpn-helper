# Proton VPN Helper (Unofficial)

**Experimental GPLv3 browser extension derived from Proton VPN's open-source browser extension. Not affiliated with, maintained by, or endorsed by Proton AG.**

A single Chromium extension with Proton's browser VPN engine and an additional website country-routing controller.

## Features

- Save a preferred VPN exit country for a hostname and optionally its subdomains.
- Keep other websites on the normally selected Proton exit.
- Optionally detect explicit region restrictions and try a small set of alternative eligible countries.
- Keep local, reviewable manual and learned routing rules.
- Optionally sync policies through a user-installed, data-only native messaging helper for MCP automation.

The underlying Proton engine handles authentication, eligible VPN servers, proxy configurations and connections. The helper makes routing decisions internally; it is not a second proxy-controlling extension.

## Current status

**Developer preview, not production safe, not yet submitted to a browser marketplace.** This is a modified fork, not an add-on to the official installed Proton VPN extension. It has an independent extension ID; compatibility with Proton's sign-in service has NOT been verified.

Do not install it alongside the official extension in an ordinary browser profile. Two proxy-setting extensions can conflict. Use only a disposable test profile until authenticated routing and network leak tests pass.

Automatic restriction detection and automatic country switching are OFF by default. The optional scanner reads a limited amount of visible page text locally after the user enables detection. It does not persist or send that raw text to this project's maintainer.

A changed VPN country does not establish compliance with website or legal age/identity verification requirements.

## Build

    npm ci --ignore-scripts --no-audit --no-fund
    npx tsc --noEmit
    npm run build

The unpacked extension is produced in distribution/. Test instructions are in docs/LOCAL_DEVELOPMENT.md.

## Documentation

- [Development and tests](docs/LOCAL_DEVELOPMENT.md)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [Marketplace readiness](docs/STORE_READINESS.md)
- [Single extension guide](README_ALL_IN_ONE.md)
- [Original Proton README](UPSTREAM_README.md)
- [GNU GPLv3 licence](LICENSE)

## Attribution

Derived from [ProtonVPN/proton-vpn-browser-extension](https://github.com/ProtonVPN/proton-vpn-browser-extension), GPL-3.0. Original notices and source attribution are retained. The Proton name is used descriptively for compatibility and is not a claim of affiliation or endorsement.
