'use background';
import {classifyBlock, type BlockSignal, type SiteRule, STORE_KEY, findRule} from './policy';
import {loadRouterPolicy, saveRouterPolicy, getActiveRoutes,
	updateSplitDelegation, hasActiveSplitDelegation} from './runtime';
import {SPLIT_CONSENT_KEY, hasSplitConsent} from './splitConsent';
import {getCurrentStateIfDefined} from '../state';
import {readSession} from '../account/readSession';

interface Attempt {
	host: string;
	url: string;
	started: number;
	tried: string[];
	signal: BlockSignal;
	previous?: SiteRule;
	inFlight?: boolean;
}
const attempts = new Map<number, Attempt>();
const ownerByHost = new Map<string, number>();
const lastHttpStatus = new Map<number, {host: string; url: string; status: number; time: number}>();
const exhausted = new Map<string, number>();
const MAX_TRIALS = 3;
const COOLDOWN_MS = 30 * 60 * 1000;
let reconfigureQueue = Promise.resolve();
let internalPolicyUpdateDepth = 0;
function reconfigure(): Promise<void> {
	reconfigureQueue = reconfigureQueue.catch(() => {}).then(async () => {
		const state = getCurrentStateIfDefined();
		if (state?.name === 'on') await state.connectCurrentServer?.();
	});
	return reconfigureQueue;
}
async function changePolicyForHost(host: string, newRule?: SiteRule): Promise<void> {
	const p = await loadRouterPolicy();
	internalPolicyUpdateDepth++;
	try {
		await saveRouterPolicy({
			...p,
			rules: [...p.rules.filter((r) => r.domain !== host), ...(newRule ? [newRule] : [])],
		});
		await reconfigure();
	} finally {
		internalPolicyUpdateDepth--;
	}
}
async function tryNextCountry(tabId: number, attempt: Attempt): Promise<void> {
	const p = await loadRouterPolicy();
	const candidates = p.candidates.filter((c) => !attempt.tried.includes(c));
	for (const candidate of candidates) {
		if (attempt.tried.length >= MAX_TRIALS) break;
		attempt.tried.push(candidate);
		attempt.started = Date.now();
		await changePolicyForHost(attempt.host, {domain: attempt.host, country: candidate,
			subdomains: true, source: 'trial'});
		// Never reload through a country whose server could not be resolved.
		const configured = getActiveRoutes().find((r) => r.rule.domain === attempt.host);
		if (!configured?.endpoint) continue;
		try {
			await chrome.tabs.reload(tabId, {bypassCache: true});
			return;
		} catch { /* Tab closed or navigated away. Do not persist trial as success. */ }
	}
	attempts.delete(tabId);
	ownerByHost.delete(attempt.host);
	exhausted.set(attempt.host, Date.now() + COOLDOWN_MS);
	await changePolicyForHost(attempt.host, attempt.previous);
}
async function handleSignal(tabId: number, host: string, pageUrl: string,
	signal: BlockSignal, contentLength: number): Promise<void> {
	const p = await loadRouterPolicy();
	const vpnState = getCurrentStateIfDefined();
	// Never run auto retries while the VPN is disconnected. Otherwise a saved
	// trial could appear valid even though the browser is not using Proton.
	if (!hasActiveSplitDelegation() || vpnState?.name !== 'on' || !vpnState.proxyEnabled || !p.enabled || !p.autoDetect) return;
	const status = lastHttpStatus.get(tabId);
	const attempt = attempts.get(tabId);
	if (attempt?.host === host) {
		if (attempt.inFlight || !status || status.host !== host ||
			status.time < attempt.started || Date.now() - attempt.started > 30000) return;
		if (signal === 'region' || signal === 'age') {
			attempt.inFlight = true;
			try {await tryNextCountry(tabId, attempt);}
			finally {attempt.inFlight = false;}
			return;
		}
		// A deterministic, limited operational definition of "worked":
		// same hostname, HTTP success, nonempty page, and no detected restriction.
		const pathMatches = new URL(status.url).pathname === new URL(attempt.url).pathname;
		if (signal === 'none' && status?.host === host && pathMatches &&
			Date.now() - status.time < 12000 && status.status >= 200 &&
			status.status < 300 && contentLength >= 180) {
			const trial = findRule(host, p.rules);
			if (trial?.source === 'trial') {
				await changePolicyForHost(host, {...trial, source: 'learned', observedAt: Date.now()});
			}
			attempts.delete(tabId);
			ownerByHost.delete(host);
		}
		return;
	}
	if (signal !== 'region' && signal !== 'age') return;
	if (!p.autoRetry || exhausted.get(host)! > Date.now()) return;
	if (findRule(host, p.rules)?.source === 'manual') return;
	const owner = ownerByHost.get(host);
	if (owner !== undefined && attempts.has(owner) &&
		Date.now() - attempts.get(owner)!.started < 120000) return;
	if (attempts.size >= 30) {
		attempts.clear();
		ownerByHost.clear();
	}
	const existing = findRule(host, p.rules);
	const next: Attempt = {host, url: pageUrl, started: Date.now(),
		tried: existing ? [existing.country] : [], signal,
		previous: existing?.source === 'learned' ? existing : undefined,
		inFlight: true};
	attempts.set(tabId, next);
	ownerByHost.set(host, tabId);
	try {await tryNextCountry(tabId, next);}
	finally {next.inFlight = false;}
}
/** Internal status handler, called by Proton's existing single message dispatcher.
 * A stored rule is not proof that the browser currently uses Proton.
 */
export async function readSiteRouterStatus(): Promise<{
	connected: boolean; ownsProxy: boolean; proxyControl: string; delegated: boolean;
	signedIn: boolean;
	selectedCountry?: string; selectedServer?: string;
	unavailable: number; configured: number;
}> {
	const routes = getActiveRoutes();
	// Only a yes/no account state is mirrored, never Proton tokens or UIDs.
	const signedIn = Boolean((await readSession().catch(()=>undefined))?.uid);
	try {
		const settings = await new Promise<{levelOfControl?: string}>(
			(resolve) => chrome.proxy.settings.get({incognito: false}, resolve));
		const proxyControl = settings?.levelOfControl || 'unknown';
		const ownsProxy = proxyControl === 'controlled_by_this_extension';
		const vpn = getCurrentStateIfDefined();
		const connected = ownsProxy && vpn?.name === 'on' && vpn.proxyEnabled === true;
		return {connected, ownsProxy, proxyControl, signedIn, delegated:hasActiveSplitDelegation(),
			...(connected&&vpn?.data?.server?{selectedCountry:vpn.data.server.exitCountry,
				selectedServer:vpn.data.server.name}:{}),
			unavailable: routes.filter((r) => !r.endpoint).length,
			configured: connected && hasActiveSplitDelegation() ? routes.filter((r) => !!r.endpoint).length : 0};
	} catch {
		return {connected: false, ownsProxy: false, signedIn, proxyControl: 'unknown',
			delegated:hasActiveSplitDelegation(),
			unavailable: routes.length, configured: 0};
	}
}

/** Called exclusively from the main internal message listener.
 * Never trust hostnames sent by a content script; use the sender's URL.
 */
export function receiveSiteRouterSignal(message: any, sender: browser.runtime.MessageSender): void {
	if (sender.frameId !== 0 || sender.tab?.id === undefined ||
		typeof sender.url !== 'string') return;
	let url: URL;
	try {url = new URL(sender.url);} catch {return;}
	if (!['http:', 'https:'].includes(url.protocol)) return;
	const signal: BlockSignal =
		message.signal === 'region' || message.signal === 'age'
			? message.signal : message.signal === 'none' ? 'none' : 'unknown';
	const len = Number.isInteger(message.contentLength)
		? Math.max(0, Math.min(message.contentLength, 22000)) : 0;
	void handleSignal(sender.tab.id, url.hostname.toLowerCase(), sender.url, signal, len)
		.catch((e) => console.warn('[site-router] detection failure', e));
}

export function installSiteRouterDetector(): void {
	// Permission is stored in extension-local settings and always starts off.
	void hasSplitConsent().then(allowed=>{
		updateSplitDelegation(allowed);
		if(allowed) void reconfigure().catch(()=>undefined);
	}).catch(()=>updateSplitDelegation(false));
	chrome.storage.onChanged.addListener((changes, area) => {
		if(area==='local'&&changes[SPLIT_CONSENT_KEY]){
			updateSplitDelegation(changes[SPLIT_CONSENT_KEY].newValue===true);
			// Rebuild Proton's proxy settings with or without Helper routing.
			void reconfigure().catch(e=>console.warn('[site-router] delegation refresh failed',e));
		}
		if (area === 'local' && changes[STORE_KEY] && internalPolicyUpdateDepth === 0) {
			void reconfigure().catch((e) => console.warn('[site-router] proxy reconfigure error', e));
		}
	});
	chrome.webRequest.onCompleted.addListener((details) => {
		if (details.type !== 'main_frame' || details.tabId < 0) return;
		try {
			const host = new URL(details.url).hostname.toLowerCase();
			lastHttpStatus.set(details.tabId, {host, url: details.url, status: details.statusCode, time: Date.now()});
			// A 451 response is direct protocol evidence of a legal/geographic refusal.
			if (details.statusCode === 451) {
				void handleSignal(details.tabId, host, details.url, classifyBlock('', 451), 0);
			}
		} catch { /* invalid URL */ }
	}, {urls: ['http://*/*', 'https://*/*'], types: ['main_frame']});
	chrome.tabs.onRemoved.addListener((tabId) => {
		const attempt = attempts.get(tabId);
		if (attempt) ownerByHost.delete(attempt.host);
		attempts.delete(tabId);
		lastHttpStatus.delete(tabId);
	});
	// Incomplete trials from a previous browser lifetime are never trusted as learned rules.
	void loadRouterPolicy().then(async (p) => {
		if (p.rules.some((r) => r.source === 'trial')) {
			await saveRouterPolicy({...p, rules: p.rules.filter((r) => r.source !== 'trial')});
		}
	});
}
