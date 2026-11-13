# Proton VPN Helper — local GPLv3 fork

Status: experimental single-extension variant built and tested with isolated input; NOT yet installed in the user's normal browsers and NOT live-authenticated against Proton. Independent derivative of https://github.com/ProtonVPN/proton-vpn-browser-extension. Not an official Proton product. Retain the original GPLv3 license and credits.

## Features

- Per-site VPN country routing by hostname and subdomains, using Proton browser HTTPS proxy endpoints; normal browsing retains the default selected Proton country.
- Manual rules override learned country choices. Existing split-tunnelling exclusions take precedence.
- The built-in controller detects geographical blocks (HTTP 451 and recognisable text) and age-verification messages locally.
- The built-in controller may request bounded country trials and learning; Proton state management retains full authority over the VPN proxy.
- Native messaging two-way, versioned, strictly data-only policy sync. No source code execution or credential access through native host.
- Options page for manually editing rules and enabling optional automatic country trials. Explicit button to reload the extension after MCP rebuilds its code.

## Project locations

Set PROJECT_ROOT to the absolute path of this checkout before using example commands.

Source: $PROJECT_ROOT
Built unpacked Chromium extension: $PROJECT_ROOT/distribution
Native bridge: native/host.py; command line: native/route_ctl.py
Saved policy: ~/.local/state/proton-site-router/rules.json (owner-only permissions)
Signing key: ~/.local/share/proton-site-router/extension.pem (owner-only, NEVER copy/share)
Fork extension ID: see native/extension_id.txt
Official Proton extension is UNCHANGED (ID jplgfhpmjnbigmhklmmbgecoobifkmpa).


## All-in-one option (experimental)

The branch feature/all-in-one-site-router combines Proton's connection engine and an internal controller in **one browser extension**. There is no second extension to install. The controller detects region blocks, saves per-website country rules and asks the Proton state manager to update the proxy. Proton remains responsible for all authentication, eligible server selection, VPN routing and connections.

This option is a **separately built GPLv3 derivative** of Proton VPN, not an add-on to the unmodified official store extension. It has its own extension ID, does not inherit the official Proton login session, and is not guaranteed to authenticate successfully until tested live. Do not load two proxy-controlling VPN extensions at the same time.

MCP native messaging remains optional for local policy updates and development. Automatic retries default off until the user explicitly enables them in Options.

The other branch feature/site-country-router continues to support the two-extension, companion-plus-provider design. Both source branches remain separate.

## Installation — NOT PERFORMED

1. Back up relevant browser settings. Open Brave: brave://extensions or Vivaldi: vivaldi://extensions.
2. In ONE browser, disable the official Proton extension while testing this fork. Do NOT enable two VPN proxy-setting extensions simultaneously; they can conflict. Disabling interrupts protection temporarily.
3. Turn on Developer mode, choose Load unpacked, select the distribution directory above.
4. Open fork Options page. A new extension ID cannot inherit the official extension session. Sign-in compatibility with Proton's site is NOT YET VALIDATED; it may not work. Test in a disposable browser profile first if possible.
5. After authenticating (if supported), test with non-sensitive sites, inspect the actual exit IP, WebRTC/DNS leaks, redirects, unsupported country handling and behaviour under connection failures.
6. To roll back, disable/remove the fork and re-enable the original Proton extension. The original was not edited or disabled by the build.

The optional native host can be registered with python3 native/install_host.py in supported local Chromium browsers. Independent test profiles require their own NativeMessagingHosts file.

## Rune MCP usage

Trusted MCP shell/exec can invoke the following local commands:

    python3 $PROJECT_ROOT/native/route_ctl.py show
    python3 $PROJECT_ROOT/native/route_ctl.py set example.com NL
    python3 $PROJECT_ROOT/native/route_ctl.py set sample.example.com CH --exact
    python3 $PROJECT_ROOT/native/route_ctl.py preferences --candidates NL,CH,US,CA,DE --retry on
    python3 $PROJECT_ROOT/native/route_ctl.py remove example.com

Both directions sync through native messaging, normally within one browser alarm interval (one minute); versioned updates avoid overwriting newer edits. Only the fork can access the host (exact extension-origin allowlist). No other app can request shell execution from this bridge.

Code fixes: MCP edits Git branch, runs automated checks, npm run build, then the user explicitly selects Apply rebuilt extension in Options. Reload interrupts browser VPN service temporarily. Auto-install, stealth background code deployment, credential access and unsafe arbitrary command bridges are not provided.

## Tests and build

    cd $PROJECT_ROOT
    npm ci --ignore-scripts --no-audit --no-fund
    TS_NODE_SKIP_PROJECT=1 TS_NODE_COMPILER_OPTIONS='{"module":"Node16","moduleResolution":"Node16","target":"ES2020","rootDir":".","ignoreDeprecations":"6.0"}' npx ts-node tests/site_router.test.ts
    npx tsc --noEmit --pretty false
    npx stylelint source/css/site-router.css
    npm run build
    SHORT_QA=1 python3 -u tests/browser_integration.py

The isolated Chromium integration test uses a disposable profile, a temporary policy store and no personal Proton credentials. The full test includes native-to-browser alarm propagation.

## Limitations and threat model

- This is a BROWSER proxy extension, not a system-wide VPN; it cannot guarantee a system kill switch.
- Multiple proxy-controlling extensions conflict. Never assume protection when another extension controls browser proxy settings.
- The browser uses a hostname-based rule; third-party CDN/subresource domains are routed independently, not automatically with the embedding first-party page. Some sites may need more rules.
- Learned success is a conservative *heuristic* (HTTP 2xx, substantial body, no recognised block); not proof of lawful access or site eligibility.
- Changing VPN country may not satisfy legal or website-mandated identity/age verification.
- If an explicitly configured country lacks an eligible server, the routing engine provides an unreachable proxy rather than an intentional DIRECT fallback; full browser leak testing is still pending.
- Browser extension login via Proton's own account site may use the official extension ID. A custom ID was deliberately chosen to avoid overwriting the original. Never copy browser credentials or Proton tokens to fix this.
- Proxy endpoints and user-tier entitlements are selected from Proton's upstream catalogue but require live authenticated tests to validate across real countries.
- Native host stores only country/domain/revision metadata, never the page text, passwords, identity documents or VPN authentication secrets.
