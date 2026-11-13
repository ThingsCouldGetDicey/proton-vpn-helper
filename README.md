# Proton VPN Helper

**Choose a preferred Proton VPN country for each website, without constantly changing the VPN country for your whole browser.**

An independent, open-source modification of [Proton VPN's browser extension](https://github.com/ProtonVPN/proton-vpn-browser-extension). **Unofficial — not affiliated with or endorsed by Proton.**

> **Developer preview — not ready for everyday VPN use.** The settings interface, saved rules and local policy sync have passed automated browser tests. Signing in to Proton with this modified extension, routing real traffic through different countries, and preventing network leaks have **not** been verified. Do not replace your trusted VPN setup with this build yet.

## The problem

Imagine you normally use a UK VPN server, but one website is only available through a Netherlands exit and another works best through Switzerland.

With the usual browser VPN controls, you have to change the active country when you change websites, then remember to change it back. Conventional split tunnelling can include or exclude websites from the VPN, but it does **not** assign a different VPN country to each website.

**Proton VPN Helper is intended to remove that repeated manual switching.** Give a website a country once; the helper remembers the preference while Proton remains responsible for the actual VPN connection.

## How it should work

| Website | Intended VPN exit |
| --- | --- |
| Anything without a rule | Your normal Proton-selected country |
| `sample.example.com` | Switzerland (`CH`) |
| `news.example.org` | Netherlands (`NL`) |

These are **illustrative routing preferences**, not claims that those exit IPs have been observed in live traffic.

The helper is designed to make three things possible: save a country per website, optionally recognise an explicit geographical restriction and try an eligible alternative, then remember an apparently successful route for next time. Manually saved rules take priority. Detection and automatic switching are **off by default**.

Proton's existing engine remains responsible for authentication, server eligibility, connections and browser proxy settings. This is **one modified extension**, not a second extension fighting Proton for proxy control.

## Try the working settings interface

**For developers and testers only.** Use a disposable Chromium browser profile, **not** the profile where you rely on the official Proton extension.

1. Clone this repository, install dependencies and build the extension:

   ```bash
   git clone https://github.com/ThingsCouldGetDicey/proton-vpn-helper.git
   cd proton-vpn-helper
   npm ci --ignore-scripts --no-audit --no-fund
   npm run build
   ```

2. Open a **separate test profile** in Chrome, Brave, Chromium or Vivaldi. Visit its Extensions page (`chrome://extensions`, `brave://extensions` or `vivaldi://extensions`). Enable **Developer mode**, choose **Load unpacked**, and select this project's `distribution/` folder. Do not run two VPN extensions that control the proxy in the same profile.
3. Open **Proton VPN Helper → Details → Extension options**. Enter a website domain, a two-letter country code such as `CH`, and select **Save route**. The site should appear under **Saved sites**. You can remove it again from the same page.

These steps demonstrate **saving and managing preferences**. They do not prove that the modified extension can log in to Proton or route network traffic safely. Do not enable automatic switching for real browsing until the remaining checks are complete.

### What the interface actually looks like

![Real Chromium screenshot of Proton VPN Helper's Site Router options: one saved sample.example.com rule for Switzerland, with optional detection and automatic switching off](docs/images/routing-settings-demo.png)

*Real screenshot from an isolated Chromium test, not a mock-up. The test saved `sample.example.com → CH`, confirmed that it appeared in the interface, and verified local native-policy synchronisation. **The screen explicitly reports that the VPN is disconnected. Saving a rule is not evidence of a Swiss exit IP.***

## What works, and what still needs proof

| Tested locally | Not yet verified |
| --- | --- |
| Build and load the extension in isolated Chromium | Sign in successfully with the independent extension ID |
| Add, persist, display and remove country rules | Route two websites simultaneously through different *real* exit countries |
| Verify distinct site routes reach separate **local HTTPS test proxies** in Chromium | DNS, WebRTC, redirects and third-party resource leak protection on real Proton servers |
| Save rules through the optional local MCP/native messaging bridge | Safe operation across disconnects, reconnects and browser differences |

The status above reflects the available automated tests, **not** a security certification. A website may still require legal or service-mandated age or identity verification regardless of the VPN country.

## Development, privacy and release

This project is licensed under the **GNU GPLv3**, with attribution to the original [Proton browser extension](https://github.com/ProtonVPN/proton-vpn-browser-extension). It has its own name and icon and does not distribute Proton account credentials. The optional page classification processes visible text locally and is disabled by default.

For technical details, see [development and test instructions](docs/LOCAL_DEVELOPMENT.md), [synthetic browser routing tests](docs/ROUTING_TESTS.md), [privacy](PRIVACY.md), and [security](SECURITY.md). The [marketplace release checklist](docs/STORE_READINESS.md) lists the tests and reviews required before Chrome Web Store submission.

**There is no marketplace release yet.** Once live Proton routing and leak testing pass, this README should include a second, separately verified demonstration showing the actual exit IP for each website, alongside the setup screenshot above.
