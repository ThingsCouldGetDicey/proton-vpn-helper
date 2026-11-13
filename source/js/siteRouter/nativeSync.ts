'use background';
import {STORE_KEY, validatePolicy, type SiteRouterPolicy} from './policy';
import {loadRouterPolicy} from './runtime';

const NATIVE_HOST = 'com.local.proton_site_router';
const ALARM = 'protonSiteRouterPolicyPull';
let applying = false;
let synchronizing = false;
type NativeReply = {ok?: boolean; policy?: SiteRouterPolicy};
async function nativeRequest(payload: Record<string, unknown>): Promise<NativeReply | null> {
	try {return await chrome.runtime.sendNativeMessage(NATIVE_HOST, payload) as NativeReply;}
	catch {return null;} // Optional bridge. Extension works standalone.
}
async function pull(): Promise<void> {
	if (synchronizing) return;
	synchronizing = true;
	try {
		const incoming = await nativeRequest({action:'pull'});
		if (!incoming?.ok || !incoming.policy) return;
		const external = validatePolicy(incoming.policy);
		const local = await loadRouterPolicy();
		if (external.revision > local.revision) {
			applying = true;
			try {await chrome.storage.local.set({[STORE_KEY]: external});}
			finally {applying = false;}
		} else if (local.revision > external.revision) {
			await nativeRequest({action:'push', policy: local});
		}
	} finally {synchronizing = false;}
}
export function installSiteRouterNativeSync() {
	chrome.alarms.create(ALARM, {periodInMinutes: 1});
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === ALARM) void pull();
	});
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local' || !changes[STORE_KEY] || applying) return;
		void (async () => {
			const policy = await loadRouterPolicy();
			await nativeRequest({action:'push', policy});
		})();
	});
	void pull();
}
