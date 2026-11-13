'use background';
import {setupHandleProxyRequest} from './tools/setupHandleProxyRequest';
import {fetchTranslations} from './tools/translate';
import {triggerPromise} from './tools/triggerPromise';
import {initPostInstallationHook} from './vpn/initPostInstallationHook';
import {initMessaging} from './vpn/initMessaging';
import {initState} from './vpn/initState';
import {initFocusWatcher} from './vpn/initFocusWatcher';
import {initProxySettingsWatcher} from './vpn/initProxySettingsWatcher';
import {initIdleWatcher} from './vpn/initIdleWatcher';
import {initAuthInterceptor} from './vpn/initAuthInterceptor';
import {initSentry} from './tools/sentry';
import {setProxyToWaiterHost} from './tools/proxy';
import {readSession} from './account/readSession';
import {connectedServer} from './vpn/connectedServer';
import {installSiteRouterDetector} from './siteRouter/detector';
import {installSiteRouterToolbarBadge} from './siteRouter/toolbarBadge';
import {installConnectionHealthMonitor} from './siteRouter/connectionHealth';
import {installOfficialHelperBridgeNotifications} from './siteRouter/officialHelperBridgeProvider';
import {installSiteRouterNativeSync} from './siteRouter/nativeSync';

// Do not claim Chromium's global proxy when this unofficial fork is merely
// installed alongside the official Proton VPN extension.  The upstream
// unconditional localhost:9 proxy otherwise wins and breaks connectivity.
async function installWaiterForExistingHelperSession(): Promise<void> {
  const session=await readSession().catch(()=>undefined);
  const connection=await connectedServer.get().catch(()=>undefined);
  if(!session?.uid || !connection?.value?.proxyHost) return;
  const ownership=await new Promise<string>(resolve=>
    chrome.proxy.settings.get({},details=>
      resolve(details?.levelOfControl || 'unknown')));
  if(ownership==='controlled_by_other_extensions' ||
    ownership==='not_controllable') return;
  await setProxyToWaiterHost();
}
triggerPromise(installWaiterForExistingHelperSession());
initSentry();
installSiteRouterDetector();
installSiteRouterToolbarBadge();
installConnectionHealthMonitor();
installOfficialHelperBridgeNotifications();
installSiteRouterNativeSync();
initAuthInterceptor();
initMessaging();
setTimeout(initState, 1);
setupHandleProxyRequest();
triggerPromise(fetchTranslations());
initPostInstallationHook();
initFocusWatcher();
initProxySettingsWatcher();
initIdleWatcher();
