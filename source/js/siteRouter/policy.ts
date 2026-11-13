/** Local-only site routing rules. No credentials or browsing history are persisted here. */
export type RouteSource = 'manual' | 'learned' | 'trial';
export interface SiteRule {
	domain: string;
	country: string;
	subdomains: boolean;
	source: RouteSource;
	observedAt?: number;
}
export interface SiteRouterPolicy {
	version: 1;
	enabled: boolean;
	autoDetect: boolean;
	autoRetry: boolean;
	candidates: string[];
	rules: SiteRule[];
	revision: number;
}
export type BlockSignal = 'none' | 'region' | 'age' | 'unknown';
export const STORE_KEY = 'protonSiteRouterPolicyV1';
export const DEFAULT_POLICY: SiteRouterPolicy = {
	version: 1,
	enabled: true,
	autoDetect: false,
	autoRetry: false,
	candidates: ['NL', 'CH', 'US', 'CA', 'DE'],
	rules: [],
	revision: 0,
};

export function normalizeDomain(input: string): string {
	const cleaned = String(input).trim();
	if (!cleaned || cleaned.length > 253 || /[\s@\\]/.test(cleaned)) {
		throw new Error('Invalid website domain');
	}
	const url = new URL(cleaned.includes('://') ? cleaned : 'https://' + cleaned);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new Error('Only public website hostnames are supported');
	}
	const host = url.hostname.replace(/\.$/, '').toLowerCase();
	if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ||
		host.split('.').some((label) => label.length < 1 || label.length > 63 ||
			label.startsWith('-') || label.endsWith('-')) ||
		/^\d+\.\d+\.\d+\.\d+$/.test(host) ||
		host.endsWith('.local') || host.endsWith('.internal') ||
		host.endsWith('.localhost') || host.endsWith('.test') ||
		host.endsWith('.invalid')) {
		throw new Error('Public DNS hostname required; private hosts are not permitted');
	}
	return host;
}
export function normalizeCountry(input: string): string {
	const country = String(input).toUpperCase().trim();
	if (!/^[A-Z]{2}$/.test(country)) throw new Error('ISO country code required');
	return country;
}
export function validatePolicy(input: unknown): SiteRouterPolicy {
	if (!input || typeof input !== 'object') return {...DEFAULT_POLICY, rules: [], candidates: [...DEFAULT_POLICY.candidates]};
	const p = input as Partial<SiteRouterPolicy>;
	const seen = new Set<string>();
	const rules: SiteRule[] = [];
	if (p.rules !== undefined && !Array.isArray(p.rules)) throw new Error('Invalid rule list');
	for (const raw of (p.rules || []).slice(0, 500)) {
		if (!raw || typeof raw !== 'object') continue;
		try {
			const domain = normalizeDomain(String(raw.domain));
			const country = normalizeCountry(String(raw.country));
			if (seen.has(domain)) continue;
			seen.add(domain);
			const source: RouteSource =
				raw.source === 'learned' || raw.source === 'trial' ? raw.source : 'manual';
			rules.push({
				domain, country, subdomains: raw.subdomains !== false, source,
				...(Number.isFinite(raw.observedAt) && Number(raw.observedAt) > 0
					? {observedAt: Number(raw.observedAt)} : {}),
			});
		} catch { /* Reject malformed/imported rules, never interpolate into PAC. */ }
	}
	const candidates: string[] = [];
	for (const c of (Array.isArray(p.candidates) ? p.candidates : DEFAULT_POLICY.candidates).slice(0, 15)) {
		try {
			const normalized = normalizeCountry(String(c));
			if (!candidates.includes(normalized)) candidates.push(normalized);
		} catch { /* ignored */ }
	}
	return {
		version: 1,
		enabled: p.enabled !== false,
		autoDetect: p.autoDetect === true,
		autoRetry: p.autoRetry === true,
		candidates,
		rules,
		revision: Number.isSafeInteger(p.revision) && Number(p.revision) >= 0
			? Number(p.revision) : 0,
	};
}
export function findRule(hostInput: string, rules: SiteRule[]): SiteRule | undefined {
	const host = hostInput.toLowerCase().replace(/\.$/, '');
	return rules.filter((r) =>
		host === r.domain || (r.subdomains && host.endsWith('.' + r.domain)))
		.sort((a, b) => b.domain.length - a.domain.length)[0];
}
export function classifyBlock(body: string, status?: number): BlockSignal {
	const text = String(body || '').toLowerCase().slice(0, 22000).replace(/\s+/g, ' ');
	if (status === 451) return 'region';
	if (/\b(captcha|too many requests|rate limit exceeded|incorrect password)\b/.test(text)) return 'unknown';
	if (/\b(age verification|verify your age|prove your age|age assurance|age verification required|government[- ]issued id|government[- ]issued identification|identity verification required)\b/.test(text)) return 'age';
	if (/\b(not available in (your|this) (country|region|location)|unavailable in (your|this) (country|region|location)|blocked in (your|this) (country|region)|due to (your|the) (country|region|location)|restricted in (your|this) (country|region)|geograph(ically|ical) restricted|geo[- ]blocked|access (is )?restricted (in|from) your (country|region)|content is not available in your region)\b/.test(text)) return 'region';
	return 'none';
}
export function routeKey(rule: SiteRule): string {return rule.domain + ':' + rule.country;}
