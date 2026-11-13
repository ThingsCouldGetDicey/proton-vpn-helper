'use background';
import {loadRouterPolicy} from './runtime';
import {findRule} from './policy';
import {storedSplitTunneling} from '../vpn/storedSplitTunneling';
import {evaluateSiteSplitConflict} from './splitConflict';

/** Toolbar badges are intentionally NOT green: saved country != verified exit IP. */
async function updateTabBadge(tabId:number):Promise<void> {
  if (!chrome.action) return;
  try {
    const tab=await chrome.tabs.get(tabId);
    const url=new URL(tab.url || '');
    const host=['http:','https:'].includes(url.protocol) ? url.hostname : '';
    const policy=await loadRouterPolicy();
    const rule=policy.enabled && host ? findRule(host,policy.rules) : undefined;
    const conflict=rule ? evaluateSiteSplitConflict(host,await storedSplitTunneling.get()) : undefined;
    const blocked=conflict?.kind !== undefined && conflict.kind !== 'none';
    const text=blocked ? '!' : rule?.country || '';
    const title=blocked
      ? 'Proton VPN Helper: saved '+rule?.country+' rule blocked by Proton split tunnelling'
      : rule
        ? 'Proton VPN Helper: '+rule.country+' preference saved (exit IP not verified)'
        : 'Proton VPN Helper: choose a country for this website';
    await Promise.all([
      chrome.action.setBadgeText({tabId,text}),
      chrome.action.setTitle({tabId,title}),
      chrome.action.setBadgeBackgroundColor({
        tabId,color:blocked ? '#967221' : '#665E78'
      }),
    ]);
  } catch { /* closed tab or unsupported browser state */ }
}
function updateActiveTabs():void {
  void chrome.tabs.query({active:true}).then(tabs=>{
    for(const tab of tabs) if(tab.id!==undefined)void updateTabBadge(tab.id);
  }).catch(()=>undefined);
}
export function installSiteRouterToolbarBadge():void {
  chrome.tabs.onActivated.addListener(info=>{void updateTabBadge(info.tabId);});
  chrome.tabs.onUpdated.addListener((tabId,change)=>{
    if(change.url!==undefined || change.status==='complete')void updateTabBadge(tabId);
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&(changes['protonSiteRouterPolicyV1']||changes['bex-split-tunneling'])){
      updateActiveTabs();
    }
  });
  updateActiveTabs();
}
