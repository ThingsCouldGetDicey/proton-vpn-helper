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
