import type {SiteRule} from './policy';

export interface PacRoute {
	rule: SiteRule;
	endpoint?: {host: string; port: number};
}
export function buildRoutePacCases(routes: readonly PacRoute[],
	scheme: 'http' | 'https', exclusion: string): string {
	if (!routes.length) return '';
	const code: string[] = [];
	if (exclusion) code.push('if (' + exclusion + ') return "DIRECT";');
	for (const {rule, endpoint} of [...routes].sort((a,b) => b.rule.domain.length - a.rule.domain.length)) {
		const domain = JSON.stringify(rule.domain);
		const suffix = JSON.stringify('.' + rule.domain);
		const match = rule.subdomains
			? '(host === ' + domain + ' || host.endsWith(' + suffix + '))'
			: '(host === ' + domain + ')';
		const valid = !!endpoint && /^[a-z0-9.-]+$/i.test(endpoint.host) &&
			Number.isInteger(endpoint.port) && endpoint.port > 0 && endpoint.port <= 65535;
		const chosen = valid ? endpoint : {host: '127.0.0.1', port: 9};
		code.push('if (' + match + ') return ' +
			JSON.stringify(scheme.toUpperCase() + ' ' + chosen!.host + ':' + chosen!.port) + ';');
	}
	return code.join('\n');
}
