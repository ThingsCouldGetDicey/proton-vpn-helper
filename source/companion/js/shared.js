// Small, auditable data-only model. No Proton account or network credentials.
export const OFFICIAL_PROTON_ID = 'jplgfhpmjnbigmhklmmbgecoobifkmpa';
export const POLICY_KEY = 'protonSiteRouterPolicyV1';
export const DEFAULT_POLICY = Object.freeze({
  version: 1, enabled: false, autoDetect: false, autoRetry: false,
  candidates: [], rules: [], revision: 0
});
export const HEALTH_ALARM = 'protonVpnHelperOfficialHealth';

export function domainFrom(input) {
  if (typeof input !== 'string' || input.length > 253 || /[\s@\\]/.test(input))
    throw new Error('Invalid website hostname');
  const url = new URL(input.includes('://') ? input : 'https://' + input);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Only public website hostnames are supported');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ||
      host.split('.').some(p => p.length > 63 || p.startsWith('-') || p.endsWith('-')) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      /\.(local|localhost|internal|test|invalid)$/.test(host))
    throw new Error('Public hostname required');
  return host;
}
export function countryCode(input) {
  const value = String(input || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) throw new Error('Two-letter country code required');
  return value;
}
export function validatedPolicy(raw) {
  const policy = {...DEFAULT_POLICY, rules: [], candidates: [], revision: 0};
  if (!raw || typeof raw !== 'object') return policy;
  const seen = new Set();
  for (const item of Array.isArray(raw.rules) ? raw.rules.slice(0,500) : []) {
    try {
      const domain=domainFrom(item.domain);
      const country=countryCode(item.country);
      if(seen.has(domain))continue;
      seen.add(domain);
      policy.rules.push({domain,country,subdomains:item.subdomains!==false,
        source:item.source==='learned'||item.source==='trial'?item.source:'manual'});
    }catch {/* Untrusted saved or native entries are dropped. */}
  }
  // Legacy auto routing settings are deliberately ignored in companion mode.
  // No stored flag is allowed to re-enable browser proxy routing.
  policy.enabled=false;
  policy.autoDetect=false;
  policy.autoRetry=false;
  policy.candidates=[];
  policy.revision=Number.isSafeInteger(raw.revision)&&raw.revision>=0?raw.revision:0;
  return policy;
}
export function preferenceFor(host, policy) {
  const normal=domainFrom(host);
  return policy.rules.filter(rule=>
    normal===rule.domain || (rule.subdomains && normal.endsWith('.'+rule.domain)))
    .sort((a,b)=>b.domain.length-a.domain.length)[0] || null;
}
