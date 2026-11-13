import {classifyBlock} from './policy';
/* Runs locally in each top-level page; emits only classification, never text/IDs/history. */
(() => {
	if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
	let lastMessage = '';
	const report = async () => {
		// An opt-in local scan: no page text is read until the user enables detection.
		try {
			const saved = await chrome.storage.local.get([
				'protonSiteRouterPolicyV1','protonVpnHelperManageSplitTunnelingV1']);
			const policy = saved['protonSiteRouterPolicyV1'] as {enabled?: boolean; autoDetect?: boolean} | undefined;
			if (saved['protonVpnHelperManageSplitTunnelingV1'] !== true ||
				!policy || policy.enabled === false || policy.autoDetect !== true) return;
		} catch { return; }
		const visible = document.body?.innerText || '';
		// Limit classification to visible introductory copy and prominent error overlays.
		// An ordinary discussion mentioning a region lock should not cause a country change.
		const prominent = Array.from(document.querySelectorAll(
			'h1, h2, [role="alert"], [role="dialog"], dialog'))
			.slice(0, 10).map((e) => (e.textContent || '').slice(0, 400)).join(' ');
		const intro = (document.title + ' ' + visible.slice(0, 1600));
		const text = (prominent + ' ' + intro).slice(0, 5500);
		const signal = classifyBlock(text);
		const contentLength = Math.min(22000, visible.length);
		const signature = signal + ':' + Math.floor(contentLength / 180);
		if (signature === lastMessage) return;
		lastMessage = signature;
		try {chrome.runtime.sendMessage({type: 'protonSiteRouterSignal', signal, contentLength});}
		catch { /* extension reloaded */ }
	};
	setTimeout(report, 1500);
	setTimeout(report, 5000);
})();
