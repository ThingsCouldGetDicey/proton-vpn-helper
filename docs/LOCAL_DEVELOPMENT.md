# Development and testing

Run from this checkout's root:

    export PROJECT_ROOT="$(pwd)"
    npm ci --ignore-scripts --no-audit --no-fund
    npx tsc --noEmit --pretty false
    npx stylelint source/css/site-router.css
    npm run build

    TS_NODE_SKIP_PROJECT=1 TS_NODE_COMPILER_OPTIONS='{"module":"Node16","moduleResolution":"Node16","target":"ES2020","rootDir":".","ignoreDeprecations":"6.0"}' npx ts-node tests/site_router.test.ts
    python3 -m unittest discover -s tests -p 'test_policy_store.py' -v
    SHORT_QA=1 python3 -u tests/browser_integration.py

For optional local policy control, run python3 native/route_ctl.py --help. The native host must be registered separately using python3 native/install_host.py.

These checks do not demonstrate compatibility with Proton's live sign-in, multi-country exit routing or leak isolation.

To verify real Chromium chooses distinct synthetic HTTPS proxy endpoints (no Proton credentials or external browsing):

    python3 tests/pac_transport_integration.py

ChromeDriver, Chromium, OpenSSL, Python requests and the Node dependencies are required. See [synthetic transport tests](ROUTING_TESTS.md).

To verify the new toolbar UI, installed icon/keyboard shortcut, neutral country badges, live exclusion conversion, include-only behaviour and navigation back to original Proton controls in a real isolated Chromium browser:

    python3 -u tests/toolbar_integration.py

For an up-to-date authentic toolbar screenshot:

    TOOLBAR_SCREENSHOT_PATH=docs/images/toolbar-current-site.png python3 -u tests/toolbar_integration.py

Chrome/Brave decides which extension icons are pinned; the extension cannot pin itself. Users pin it through the browser Extensions menu and can customise keyboard shortcuts from the browser's extension shortcut settings.

## Country catalogue and tunnel-status tests

The country list derives from the same `getSortedLogicals()` result as Proton's built-in server picker, filtered by account tier and rendered with upstream flag SVGs. With no account session, it lists no invented destinations. The background connection heartbeat uses Chromium alarms every minute. External exit-IP checks require user opt-in. See [connection verification](CONNECTION_VERIFICATION.md). The headless toolbar integration test asserts signed-out safeguards, monitoring and blocked probes.


## Safe side-by-side loading in Brave

This unofficial combined Proton fork requests Chromium's global proxy permission. It is not an authorised connector into the official Proton VPN extension, and should not be used to log into a second Proton connection while the official extension controls the proxy.

The startup safety fix skips the original automatic localhost:9 proxy assignment unless the Helper already has its own persisted Proton session and connected server; it also suppresses the upstream installation onboarding tab. This lets a fresh, signed-out Helper show its toolbar without immediately hijacking a normal browsing session.

To verify the passive, signed-out startup against a second proxy-managing extension, run:

    python3 tests/coexistence_browser.py

The synthetic test verifies that the exact existing proxy endpoint remains unchanged and no onboarding tab opens. It is not a guarantee of safe simultaneous authenticated VPN connections. For active VPN use, keep only one extension responsible for proxy control.

### Loading into your existing Brave profile

Linux Brave supports a --load-extension flag at startup. When multiple unpacked extensions are needed, use a single comma-separated --load-extension=/path/one,/path/two flag; do not provide two competing flags. On CachyOS, /usr/bin/brave reads ~/.config/brave-flags.conf at launch. The flag change is applied only when Brave fully exits and starts again, not to a session already running. Do not edit a live Chromium Preferences file to force-install the Helper. Pin the Helper icon from Brave's Extensions menu once it appears. A fresh user profile has no Proton account session in the Helper and no default country routing.
