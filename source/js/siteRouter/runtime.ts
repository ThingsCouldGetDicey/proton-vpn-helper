'use background';
import {getSortedLogicals} from '../vpn/getLogicals';
import {getUser} from '../account/user/getUser';
import {getUserMaxTier} from '../account/user/getUserMaxTier';
import {isServerUp} from '../vpn/isServerUp';
import {Feature} from '../vpn/Feature';
import {proxyHost, proxyPort, scheme, singleProxyPort} from '../config';
import type {ProxyServer} from '../vpn/ConnectionState';
import {buildRoutePacCases} from './pac';
import {helperMayRoute} from './splitConsent';
import {DEFAULT_POLICY, STORE_KEY, type SiteRule, type SiteRouterPolicy,
	findRule, normalizeCountry, normalizeDomain, validatePolicy} from './policy';

export type SiteEndpoint = {host: string; port: number; country: string; server: string};
export type ActiveRoute = {rule: SiteRule; endpoint?: SiteEndpoint};

let policy: SiteRouterPolicy = {...DEFAULT_POLICY, candidates: [...DEFAULT_POLICY.candidates], rules: []};
let active: ActiveRoute[] = [];
let knownHosts = new Set<string>();
let refreshId = 0;
// Deny by default until the Proton settings consent has been loaded.
let delegated = false;
export function hasActiveSplitDelegation():boolean {return delegated;}
export function updateSplitDelegation(allowed:boolean):void {delegated=allowed===true;}
const unavailable = {host: '127.0.0.1', port: 9, country: '--', server: 'Unavailable (blocked)'};

/** One Chrome/Firefox extension controls one browser-wide proxy. PAC selects multiple secure Proton endpoints. */
export function isSiteRouterProxyHost(host: string): boolean {return knownHosts.has(host.toLowerCase());}
export function getRouterPolicy(): SiteRouterPolicy {return policy;}
export function getActiveRoutes(): ActiveRoute[] {return [...active];}
export function getRouteForHostname(hostname: string): ActiveRoute | undefined {
	if (!helperMayRoute(delegated,policy.enabled)) return undefined;
	const rule = findRule(hostname, policy.rules);
	return rule && active.find((r) => r.rule.domain === rule.domain);
}
export function getRouterProxyForHost(hostname: string): SiteEndpoint | undefined {
	const route = getRouteForHostname(hostname);
	return route ? route.endpoint || unavailable : undefined;
}
export async function loadRouterPolicy(): Promise<SiteRouterPolicy> {
	const data = await chrome.storage.local.get(STORE_KEY);
	return validatePolicy(data[STORE_KEY]);
}
export async function saveRouterPolicy(input: unknown): Promise<SiteRouterPolicy> {
	const next = validatePolicy(input);
	next.revision = Math.max(Date.now(), policy.revision + 1, next.revision + 1);
	await chrome.storage.local.set({[STORE_KEY]: next});
	return next;
}
async function resolveEndpoints(countries: string[]): Promise<Map<string, SiteEndpoint>> {
	const endpoints = new Map<string, SiteEndpoint>();
	if (!countries.length) return endpoints;
	const [logicals, user] = await Promise.all([getSortedLogicals(), getUser()]);
	if (!user) return endpoints;
	const tier = getUserMaxTier(user);
	const sorted = logicals
		.filter((l) => l.Tier <= tier && (l.Features & (Feature.SECURE_CORE | Feature.TOR | Feature.RESTRICTED)) === 0)
		.sort((a, b) => (a.Load ?? 100) - (b.Load ?? 100) || String(a.Name).localeCompare(String(b.Name)));
	for (const l of sorted) {
		const country = l.ExitCountry?.toUpperCase();
		if (!countries.includes(country) || endpoints.has(country)) continue;
		const srv = (l.Servers || []).filter((s) => s.Domain && isServerUp(s))
			.sort((a, b) => a.Domain.localeCompare(b.Domain))[0];
		if (!srv) continue;
		const label = srv.Label || '';
		const port = proxyPort + (!singleProxyPort && /^\d+$/.test(label) ? parseInt(label, 10) : 0);
		const host = proxyHost || srv.Domain;
		if (!/^[a-z0-9.-]+$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
		endpoints.set(country, {host, port, country, server: l.Name});
	}
	return endpoints;
}
export async function refreshSiteRouter(base: ProxyServer): Promise<void> {
	const id = ++refreshId;
	const p = await loadRouterPolicy();
	const countries = [...new Set(p.rules.map((r) => normalizeCountry(r.country)))];
	let endpoints = new Map<string, SiteEndpoint>();
	try {endpoints = await resolveEndpoints(countries);}
	catch (error) {console.warn('[site-router] Could not resolve country endpoints; blocked routes fail closed', error);}
	if (id !== refreshId) return;
	policy = p;
	active = p.rules.map((r) => ({rule: r, endpoint: endpoints.get(r.country)}));
	knownHosts = new Set([base.proxyHost.toLowerCase(), ...[...endpoints.values()].map((e) => e.host.toLowerCase())]);
}
export function firefoxSiteProxy(host: string, credentials?: {username: string; password: string}):
	{type: 'http' | 'https'; host: string; port: number; username?: string; password?: string} | undefined {
	const endpoint = getRouterProxyForHost(host);
	if (!endpoint) return undefined;
	if (endpoint === unavailable) return {type: scheme, host: unavailable.host, port: unavailable.port};
	return {
		type: scheme, host: endpoint.host, port: endpoint.port,
		...(credentials ? credentials : {}),
	};
}
/** PAC syntax is deliberately constructed only from validated host/country data, never arbitrary URLs. */
export function pacSiteRouteCode(excludeCondition: string): string {
	return helperMayRoute(delegated,policy.enabled) ? buildRoutePacCases(active,scheme,excludeCondition) : '';
}
export async function updateManualRule(domainInput: string, countryInput: string, subdomains = true): Promise<void> {
	const domain = normalizeDomain(domainInput);
	const country = normalizeCountry(countryInput);
	const prev = await loadRouterPolicy();
	await saveRouterPolicy({...prev, rules: [...prev.rules.filter((r) => r.domain !== domain),
		{domain, country, subdomains, source: 'manual'}]});
}
export async function removeSiteRule(domainInput: string): Promise<void> {
	const domain = normalizeDomain(domainInput);
	const prev = await loadRouterPolicy();
	await saveRouterPolicy({...prev, rules: prev.rules.filter((r) => r.domain !== domain)});
}
export function hasAnySiteRoutes(): boolean {return helperMayRoute(delegated,policy.enabled) && active.length > 0;}
