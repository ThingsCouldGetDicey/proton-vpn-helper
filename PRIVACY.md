# Privacy — developer preview

**This is an unofficial derivative of Proton VPN's browser extension, not an audited privacy product.**

## Local website classification

Only if the user enables detection, the helper reads a limited amount of visible text on the current page to classify an explicit region restriction or age-verification message. The helper sends a small classification result internally. Raw page text, document IDs, search queries, passwords, and URL paths are not intended to be retained in routing rules or sent to this project's maintainer.

Saved rules contain domain names, country codes, subdomain settings, rule source (manual/trial/learned), and limited observation timestamps. Rules live in browser extension storage. An optional user-installed native messaging host can sync the same policy to a file on that user's computer.

## Proton services

The underlying Proton-derived engine still communicates with Proton services for account authentication, server catalogue, entitlement checks and VPN proxy connections. These are Proton-operated services, not a new data collection service controlled by the project's maintainer. Consult Proton's own privacy disclosures about its backend.

The inherited Proton Sentry diagnostics endpoint is disabled in this fork's build configuration. No independent helper analytics or cloud sync service is included.

## Permissions and removal

The inherited VPN requires browser proxy, webRequest, storage, tabs and related permissions. The helper adds optional on-page classification. Broad website permissions need detailed review before any marketplace submission.

Removing the extension removes its browser-local rules. If the optional native host was installed, its local policy file must be removed separately.

This is intended behaviour documented from the source, not an independent audit or guarantee that network traffic cannot leak.
