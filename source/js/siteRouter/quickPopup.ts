import {DEFAULT_POLICY, STORE_KEY, normalizeCountry, normalizeDomain, findRule,
  validatePolicy, type SiteRouterPolicy} from './policy';
import {evaluateSiteSplitConflict, type SiteSplitConflict} from './splitConflict';
import type {StoredWebsiteFilterList} from '../vpn/WebsiteFilter';
import {SPLIT_CONSENT_KEY,hasSplitConsent} from './splitConsent';

function element<T extends HTMLElement>(id:string):T {
  const found=document.getElementById(id);
  if (!found) throw new Error('Missing control '+id);
  return found as T;
}
const hostInput=()=>element<HTMLInputElement>('site-host');
const countrySelect=()=>element<HTMLSelectElement>('country');
const saveButton=()=>element<HTMLButtonElement>('save-route');
const removeButton=()=>element<HTMLButtonElement>('remove-route');
const splitNotice=()=>element<HTMLParagraphElement>('split-notice');
let connectionOK=false;
let delegated=false;
let currentIssue:SiteSplitConflict={kind:'none',canResolve:false};
let updateSequence=0;

function feedback(message:string,error=false):void {
  const target=element('feedback');
  target.textContent=message;
  target.classList.toggle('error',error);
}
async function readPolicy():Promise<SiteRouterPolicy> {
  const raw=(await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
  return validatePolicy(raw || DEFAULT_POLICY);
}
async function writePolicy(edit:(policy:SiteRouterPolicy)=>SiteRouterPolicy):Promise<void> {
  const latest=await readPolicy();
  const next=validatePolicy({...edit(latest),revision:Math.max(Date.now(),latest.revision+1)});
  await chrome.storage.local.set({[STORE_KEY]:next});
}
async function splitConfig():Promise<StoredWebsiteFilterList|undefined> {
  const raw=(await chrome.storage.local.get('bex-split-tunneling'))['bex-split-tunneling'];
  return raw && typeof raw==='object' ? raw as StoredWebsiteFilterList : undefined;
}
function hostname():string|undefined {
  try{return normalizeDomain(hostInput().value);}
  catch{return undefined;}
}
async function getActiveTabHost():Promise<string|undefined> {
  const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  try {
    const url=new URL(tabs[0]?.url || '');
    if (!['http:','https:'].includes(url.protocol)) return undefined;
    return normalizeDomain(url.hostname);
  }catch{return undefined;}
}
async function refreshConsent():Promise<void> {
  delegated=await hasSplitConsent().catch(()=>false);
  element('helper-authority').textContent=delegated
    ? 'Helper management allowed by Proton settings. Country rules may be applied when the VPN is connected.'
    : 'Helper management OFF. Open Proton VPN controls → Split tunnelling to give permission.';
  element<HTMLInputElement>('auto-detect').disabled=!delegated;
  element<HTMLInputElement>('auto-retry').disabled=!delegated;
}
async function refreshConnection():Promise<void> {
  const status=element('vpn-status');
  try {
    const data=await chrome.runtime.sendMessage({type:'protonSiteRouterStatus'}) as
      {connected?:boolean;proxyControl?:string;signedIn?:boolean;selectedCountry?:string;selectedServer?:string};
    connectionOK=data?.connected===true;
    status.textContent=connectionOK
      ? 'Proton connected'+(data.selectedCountry ? ' · '+data.selectedCountry : '')+' · exit IP not verified'
      : data?.proxyControl==='controlled_by_other_extensions'
        ? 'Another extension controls the proxy · routes unavailable'
        : data?.signedIn ? 'Proton account signed in · VPN disconnected · saved routes inactive'
          : 'VPN disconnected · sign in through Proton VPN controls to activate routing';
  }catch {
    connectionOK=false;
    status.textContent='VPN connection cannot be verified · do not rely on routing';
  }
}
async function refreshSite():Promise<void> {
  const seq=++updateSequence;
  const host=hostname();
  const policy=await readPolicy();
  const split=host ? await splitConfig() : undefined;
  if (seq!==updateSequence) return;
  const notice=splitNotice();
  notice.classList.add('hidden');
  currentIssue={kind:'none',canResolve:false};
  if (!delegated && host) {
    const existing=findRule(host,policy.rules);
    countrySelect().value=existing?.country||'';
    element<HTMLInputElement>('subdomains').checked=existing?.subdomains!==false;
    element<HTMLInputElement>('auto-detect').checked=policy.autoDetect;
    element<HTMLInputElement>('auto-retry').checked=policy.autoRetry;
    saveButton().disabled=true;
    saveButton().textContent='Enable Helper in Proton settings first';
    removeButton().disabled=!existing;
    return;
  }
  if (!host) {
    saveButton().disabled=true;
    saveButton().textContent='Enter a valid public website';
    removeButton().disabled=true;
    return;
  }
  currentIssue=evaluateSiteSplitConflict(host,split);
  const rule=findRule(host,policy.rules);
  countrySelect().value=rule?.country||'';
  element<HTMLInputElement>('subdomains').checked=rule?.subdomains!==false;
  element<HTMLInputElement>('auto-detect').checked=policy.autoDetect;
  element<HTMLInputElement>('auto-retry').checked=policy.autoRetry;
  removeButton().disabled=!rule;
  saveButton().disabled=false;
  saveButton().textContent='Save website route';
  if (currentIssue.kind==='excluded') {
    notice.classList.remove('hidden');
    if (currentIssue.canResolve) {
      notice.textContent='Proton currently excludes this site from the VPN. Saving a country alone would not help. The action below will also remove this exact exclusion.';
      saveButton().textContent='Move excluded site into VPN routing';
    } else {
      notice.textContent='Proton excludes this site through a broader parent-domain rule ('+
        currentIssue.matchedDomain+'). Edit that broader rule in Proton controls first.';
      saveButton().disabled=true;
      saveButton().textContent='Parent exclusion needs review';
    }
  } else if (currentIssue.kind==='include-only') {
    notice.classList.remove('hidden');
    notice.textContent='Proton is in Include-only split tunnelling mode. Saving this route will also add the exact website to the VPN include list.';
    saveButton().textContent='Include site and save country';
  }
}
async function save():Promise<void> {
  const host=hostname();
  if (!host) {feedback('Enter a public website such as example.com',true);return;}
  const country=countrySelect().value;
  if (!country) {
    await remove();
    return;
  }
  // Re-evaluate the exact hostname at click time. Manual edits must not reuse
  // the split-tunnelling assessment from a previously selected website.
  const issue = evaluateSiteSplitConflict(host,await splitConfig());
  if (!await hasSplitConsent()) {
    feedback('First enable “Allow Proton VPN Helper to manage split tunnelling” in Proton controls → Split tunnelling.',true);
    return;
  }
  if (issue.kind!=='none'&&!issue.canResolve){
    feedback('Edit the parent-domain exclusion in Proton controls first.',true);
    return;
  }
  saveButton().disabled=true;
  try {
    const normalized=normalizeCountry(country);
    if (issue.kind!=='none') {
      const result=await chrome.runtime.sendMessage({
        type:'protonSiteRouterResolveSplit',domain:host
      }) as {ok?:boolean;reason?:string};
      if (!result?.ok) throw new Error(result?.reason || 'Proton split tunnelling could not be updated');
    }
    await writePolicy(p=>({...p,rules:[...p.rules.filter(r=>r.domain!==host),{
      domain:host,country:normalized,source:'manual',subdomains:
        element<HTMLInputElement>('subdomains').checked
    }]}));
    feedback(connectionOK
      ? 'Preference saved. Proton routing refresh requested; exit IP not yet verified.'
      : 'Country preference saved. Connect Proton to activate routing.');
    await refreshSite();
  }catch(error){
    feedback((error as Error).message,true);
    await refreshSite();
  }finally {
    // Never re-enable a button disabled by a broad parent exclusion.
    await refreshSite();
  }
}
async function remove():Promise<void> {
  const host=hostname();
  if (!host) return;
  try {
    await writePolicy(p=>({...p,rules:p.rules.filter(r=>r.domain!==host)}));
    feedback('Country preference removed. Proton split tunnelling is unchanged.');
    await refreshSite();
  }catch(error){feedback((error as Error).message,true);}
}
async function updateAutomation(what:'autoDetect'|'autoRetry',enabled:boolean):Promise<void>{
  try {
    await writePolicy(p=>{
      if (what==='autoRetry') return {...p,autoRetry:enabled,autoDetect:enabled?true:p.autoDetect};
      return {...p,autoDetect:enabled,autoRetry:enabled?p.autoRetry:false};
    });
    feedback('Automation preference saved locally.');
    await refreshSite();
  }catch(error){feedback((error as Error).message,true);}
}
async function init():Promise<void>{
  const current=await getActiveTabHost();
  if (current) hostInput().value=current;
  await Promise.all([refreshConnection(),refreshConsent()]);
  await refreshSite();
  // Read Proton's live connection state; do not claim a saved rule equals a VPN.
  setInterval(()=>{void refreshConnection();},3500);
  hostInput().addEventListener('change',()=>{feedback('');void refreshSite();});
  hostInput().addEventListener('input',()=>{void refreshSite();});
  countrySelect().addEventListener('change',()=>{feedback('');});
  saveButton().addEventListener('click',()=>{void save();});
  removeButton().addEventListener('click',()=>{void remove();});
  element<HTMLInputElement>('auto-detect').addEventListener('change',ev=>
    {void updateAutomation('autoDetect',(ev.target as HTMLInputElement).checked);});
  element<HTMLInputElement>('auto-retry').addEventListener('change',ev=>
    {void updateAutomation('autoRetry',(ev.target as HTMLInputElement).checked);});
  element('open-proton').addEventListener('click',()=>{
    void chrome.windows.create({
      url:chrome.runtime.getURL('popup.html'),type:'popup',width:420,height:670
    }).catch(e=>feedback(String(e),true));
  });
  element('open-settings').addEventListener('click',()=>{
    void chrome.tabs.create({url:chrome.runtime.getURL('site-router.html')})
      .catch(e=>feedback(String(e),true));
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes[SPLIT_CONSENT_KEY]){
      void refreshConsent().then(refreshSite);
    } else if(area==='local'&&(changes[STORE_KEY]||changes['bex-split-tunneling'])) void refreshSite();
  });
}
void init().catch(error=>feedback('Could not load shortcut: '+String(error),true));
