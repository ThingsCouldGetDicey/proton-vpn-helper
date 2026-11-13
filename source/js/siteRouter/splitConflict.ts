import type {StoredWebsiteFilterList, WebsiteFilter} from '../vpn/WebsiteFilter';
import {SplitTunnelingMode} from '../vpn/WebsiteFilter';

export type SiteSplitConflict = {
  kind: 'none' | 'excluded' | 'include-only';
  matchedDomain?: string;
  canResolve: boolean;
};

export function evaluateSiteSplitConflict(hostInput: string,
  raw: StoredWebsiteFilterList | undefined): SiteSplitConflict {
  const host = hostInput.toLowerCase().replace(/\.$/, '');
  if (!raw || !Array.isArray(raw.value)) return {kind: 'none', canResolve: false};
  const mode = raw.mode === SplitTunnelingMode.Include ? SplitTunnelingMode.Include : SplitTunnelingMode.Exclude;
  const relevant = raw.value.filter((r): r is WebsiteFilter =>
    !!r && typeof r.domain === 'string' &&
    (r.mode || SplitTunnelingMode.Exclude) === mode);
  const enabled = raw.enabled !== undefined ? raw.enabled :
    (mode === SplitTunnelingMode.Include || relevant.length > 0);
  if (!enabled) return {kind: 'none', canResolve: false};
  const match = relevant.find((r) => {
    const domain = r.domain.toLowerCase().replace(/^\./, '');
    return host === domain || (r.withSubDomains && host.endsWith('.' + domain));
  });
  if (mode === SplitTunnelingMode.Exclude && match) {
    const matchedDomain = match.domain.toLowerCase().replace(/^\./, '');
    return {kind: 'excluded', matchedDomain, canResolve: matchedDomain === host};
  }
  if (mode === SplitTunnelingMode.Include && !match) return {kind: 'include-only', canResolve: true};
  return {kind: 'none', canResolve: false};
}
