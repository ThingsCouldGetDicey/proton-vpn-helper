import {DEFAULT_POLICY, STORE_KEY, validatePolicy, normalizeDomain, normalizeCountry,
	type SiteRule, type SiteRouterPolicy} from './policy';

function byId<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) throw new Error('Missing control ' + id);
	return el as T;
}
const notice = (message: string) => {byId('notice').textContent = message;};
const escape = (s: string) => s.replace(/[&<>"']/g, (c) =>
	({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
async function fetchPolicy(): Promise<SiteRouterPolicy> {
	const saved = await chrome.storage.local.get(STORE_KEY);
	return validatePolicy(saved[STORE_KEY] || DEFAULT_POLICY);
}
async function storePolicy(p: SiteRouterPolicy) {
	const latest = await fetchPolicy();
	const updated = validatePolicy({...p, revision: Math.max(Date.now(), latest.revision + 1)});
	await chrome.storage.local.set({[STORE_KEY]: updated});
	render(updated);
	notice('Saved locally. Browser routing refresh requested.');
}
function render(policy: SiteRouterPolicy): void {
	byId('rule-count').textContent = String(policy.rules.length);
	byId('learned-count').textContent = String(policy.rules.filter((r) => r.source === 'learned').length);
	(byId<HTMLInputElement>('enabled')).checked = policy.enabled;
	(byId<HTMLInputElement>('autoDetect')).checked = policy.autoDetect;
	(byId<HTMLInputElement>('autoRetry')).checked = policy.autoRetry;
	(byId<HTMLInputElement>('candidates')).value = policy.candidates.join(', ');
	byId('connection-status').textContent = policy.enabled ? 'Routing policy enabled' : 'Routing policy paused';
	const list = byId('rule-list');
	list.innerHTML = policy.rules.length ? policy.rules
		.slice().sort((a, b) => a.domain.localeCompare(b.domain))
		.map((r: SiteRule) => '<div class="rule"><div><div class="rule-name">' +
			escape(r.domain) + '</div><div class="rule-meta">' +
			(r.source === 'learned' ? 'Learned · observed accessible' : r.source === 'trial' ? 'Testing · not yet learned' : 'Manually assigned') +
			(r.subdomains ? ' · Subdomains included' : ' · Exact host') +
			'</div></div><span class="route-chip">' + escape(r.country) +
			'</span><button type="button" class="delete-button" data-remove="' +
			escape(r.domain) + '" aria-label="Remove route for ' + escape(r.domain) +
			'">Remove</button></div>').join('') :
		'<p class="empty">No website rules yet. Your normal Proton VPN connection is unchanged.</p>';
	const status = byId('blocked-count');
	status.textContent = '—';
	void chrome.runtime.sendMessage({type: 'protonSiteRouterStatus'}).then((data?: {unavailable?: number}) => {
		if (data && Number.isInteger(data.unavailable)) status.textContent = String(data.unavailable);
	}).catch(() => {status.textContent = '—';});
}
async function setup() {
	render(await fetchPolicy());
	byId<HTMLFormElement>('add-rule').addEventListener('submit', (ev) => {
		ev.preventDefault();
		void (async () => {
			try {
				const domain = normalizeDomain(byId<HTMLInputElement>('domain').value);
				const country = normalizeCountry(byId<HTMLInputElement>('country').value);
				const subdomains = byId<HTMLInputElement>('subdomains').checked;
				const p = await fetchPolicy();
				await storePolicy({...p, rules: [...p.rules.filter((r) => r.domain !== domain),
					{domain, country, subdomains, source:'manual'}]});
				byId<HTMLInputElement>('domain').value = '';
			} catch (err) {notice((err as Error).message);}
		})();
	});
	byId('rule-list').addEventListener('click', (ev) => {
		const button = (ev.target as Element).closest<HTMLButtonElement>('button[data-remove]');
		const domain = button?.dataset['remove'];
		if (!domain) return;
		void (async () => {
			const p = await fetchPolicy();
			await storePolicy({...p, rules: p.rules.filter((r) => r.domain !== domain)});
		})().catch((err) => notice(String(err)));
	});
	byId('save-preferences').addEventListener('click', () => {
		void (async () => {
			try {
				const p = await fetchPolicy();
				const rawCandidates = byId<HTMLInputElement>('candidates').value.trim();
				const candidates = rawCandidates ?
					rawCandidates.split(',').map((c) => normalizeCountry(c)) : [];
				await storePolicy({...p,
					enabled: byId<HTMLInputElement>('enabled').checked,
					autoDetect: byId<HTMLInputElement>('autoDetect').checked,
					autoRetry: byId<HTMLInputElement>('autoRetry').checked,
					candidates});
			} catch (err) {notice((err as Error).message);}
		})();
	});
	byId('reload-fork').addEventListener('click', () => {
		if (window.confirm('Reload this extension from disk? Browser VPN protection may be interrupted briefly.')) {
			chrome.runtime.reload();
		}
	});
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && changes[STORE_KEY]) {
			render(validatePolicy(changes[STORE_KEY].newValue));
		}
	});
}
void setup().catch((err) => notice(String(err)));
