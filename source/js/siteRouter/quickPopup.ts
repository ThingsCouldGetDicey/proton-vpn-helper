import {DEFAULT_POLICY, STORE_KEY, normalizeCountry, normalizeDomain, findRule,
  validatePolicy, type SiteRouterPolicy} from './policy';
import {evaluateSiteSplitConflict, type SiteSplitConflict} from './splitConflict';
import type {StoredWebsiteFilterList} from '../vpn/WebsiteFilter';
import {SPLIT_CONSENT_KEY,hasSplitConsent} from './splitConsent';
import type {HelperCountry,HelperCountryCatalog} from './countryCatalog';
import {AUTO_PROBE_KEY} from './healthPreferences';
import {connectionLabel,connectionDetail} from './connectionLabels';

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
let providerCatalog:HelperCountryCatalog|undefined;
let catalogLoading=false;
let delegated=false;
let currentIssue:SiteSplitConflict={kind:'none',canResolve:false};
let updateSequence=0;

function feedback(message:string,error=false):void {
  const target=element('feedback');
  target.textContent=message;
  target.classList.toggle('error',error);
}
function sourceLabel(message:string):void {
  element('country-source').textContent=message;
}
function updateFlag(country:string):void {
  const flag=element<HTMLImageElement>('current-country-flag');
  if(!/^[A-Z]{2}$/.test(country)){
    flag.hidden=true;
    flag.removeAttribute('src');
    return;
  }
  flag.src='img/flags/'+country.toLowerCase()+'.svg';
  flag.hidden=false;
}
function createCountryButton(country:HelperCountry):HTMLButtonElement{
  const button=document.createElement('button');
  button.type='button';
  button.role='option';
  button.disabled=!country.available || providerCatalog?.entitled!==true;
  button.setAttribute('aria-selected',countrySelect().value===country.code?'true':'false');
  const img=document.createElement('img');
  img.src='img/flags/'+country.code.toLowerCase()+'.svg';
  img.alt='';
  img.width=20;img.height=15;
  const title=document.createElement('span');
  title.className='country-title';
  title.textContent=country.name;
  const tag=document.createElement('span');
  tag.className='country-tag';
  tag.textContent=country.locked?'Upgrade':country.available?'': 'Unavailable';
  button.append(img,title,tag);
  button.addEventListener('click',()=>{
    countrySelect().value=country.code;
    updateFlag(country.code);
    const host=hostname();
    if(host && delegated && (currentIssue.kind==='none'||currentIssue.canResolve)) saveButton().disabled=false;
    drawCountryList();
    feedback('');
  });
  return button;
}
function drawCountryList():void {
  const list=element('country-list');
  list.replaceChildren();
  const catalog=providerCatalog;
  if(!catalog?.countries.length)return;
  const search=element<HTMLInputElement>('country-search').value.toLocaleLowerCase().trim();
  for(const c of catalog.countries.filter(c=>!search||
      c.name.toLocaleLowerCase().includes(search)||c.code.toLocaleLowerCase().includes(search))){
    list.append(createCountryButton(c));
  }
  if(!list.children.length)sourceLabel('No Proton countries match that search.');
}
async function refreshCountries():Promise<void> {
  if(catalogLoading)return;
  catalogLoading=true;
  try {
    const catalog=await chrome.runtime.sendMessage({type:'protonSiteRouterCountries'}) as HelperCountryCatalog;
    if(!catalog||!Array.isArray(catalog.countries))throw new Error('No catalogue response');
    providerCatalog=catalog;
    const select=countrySelect();
    const previous=select.value;
    select.replaceChildren(new Option('Use normal Proton country',''));
    const available=catalog.countries.filter(c=>c.available && catalog.entitled);
    for(const c of catalog.countries){
      const option=new Option(c.name+' ('+c.code+')'+(c.locked?' · Upgrade':!c.available?' · Unavailable':''),
        c.code);
      option.disabled=!c.available||!catalog.entitled;
      select.add(option);
    }
    const old=available.some(c=>c.code===previous)?previous:'';
    select.value=old;
    updateFlag(old);
    element<HTMLInputElement>('country-search').disabled=!catalog.authenticated||!catalog.countries.length;
    if(!catalog.authenticated){
      sourceLabel('Sign into Proton within the Helper to load account-eligible countries. Your official extension login is separate.');
    }else if(catalog.error){
      sourceLabel('Proton catalogue unavailable: '+catalog.error);
    }else if(!catalog.entitled){
      sourceLabel('Proton browser VPN subscription is not active; countries cannot be selected.');
    }else{
      sourceLabel(available.length+' eligible countries from Proton · '+
        catalog.countries.length+' shown including unavailable/upgrade locations.');
    }
    element<HTMLInputElement>('country-search').placeholder=catalog.authenticated?
      'Search Proton countries':'Sign in within Helper for country list';
    drawCountryList();
  }catch {
    providerCatalog=undefined;
    countrySelect().replaceChildren(new Option('Proton catalogue unavailable',''));
    element('country-list').replaceChildren();
    sourceLabel('Proton server catalogue could not be loaded; no countries can be verified.');
  }finally{catalogLoading=false;}
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
    ? 'Local Helper routing permission enabled. Official Proton account sign-in and connection are separate.'
    : 'Local Helper routing permission OFF. Use All website rules to enable it.';
  element<HTMLInputElement>('auto-detect').disabled=!delegated;
  element<HTMLInputElement>('auto-retry').disabled=!delegated;
}
async function refreshConnection():Promise<void> {
  const status=element('vpn-status');
  try {
    const data=await chrome.runtime.sendMessage({type:'protonSiteRouterStatus'}) as
      {connected?:boolean;proxyControl?:string;proxyMode?:string;signedIn?:boolean;
        ownsProxy?:boolean;selectedCountry?:string;selectedServer?:string};
    connectionOK=data?.connected===true;
    element('connection-details').textContent=connectionDetail(data);
    element<HTMLButtonElement>('verify-exit').disabled=!connectionOK;
    status.textContent=connectionLabel(data);
  }catch {
    connectionOK=false;
    element('connection-details').textContent='Connection diagnostics unavailable.';
    element<HTMLButtonElement>('verify-exit').disabled=true;
    status.textContent='VPN connection cannot be verified · do not rely on routing';
  }
}
async function displayExitEvidence():Promise<void>{
  try {
    const health=await chrome.runtime.sendMessage({type:'protonSiteRouterHealth'}) as
      {lastCheckedAt?:number;exit?:{status:string;expected?:string;
        observedCountry?:string;observedIP?:string;checkedAt:number}};
    const dest=element('exit-evidence');
    const exit=health?.exit;
    if(exit?.status==='country-match'){
      dest.textContent='Observed VPN default exit '+exit.observedCountry+
        ' ('+exit.observedIP+') · country matches selected location, but Proton ownership and other traffic are not independently proven.';
    }else if(exit?.status==='country-mismatch'){
      dest.textContent='Warning: observed exit '+exit.observedCountry+
        ' differs from selected '+exit.expected+'. VPN routing not verified.';
    }else if(exit?.status==='failed'){
      dest.textContent='Exit-IP verification failed. Do not assume VPN protection.';
    }else {
      dest.textContent='Exit IP not checked or evidence older than 5 minutes. Optional check sends the request IP to api.country.is. Browser proxy state is monitored automatically.';
    }
  }catch{element('exit-evidence').textContent='Exit verification status unavailable.';}
}
async function runExitCheck():Promise<void>{
  const button=element<HTMLButtonElement>('verify-exit');
  if(!connectionOK){feedback('Proton must connect before testing external exit IP.',true);return;}
  button.disabled=true;
  element('exit-evidence').textContent='Checking actual browser exit via country.is…';
  try {
    const result=await chrome.runtime.sendMessage({type:'protonSiteRouterVerifyExit'}) as
      {ok?:boolean;reason?:string};
    if(!result?.ok)feedback(result.reason||'Could not verify default VPN exit.',true);
    await displayExitEvidence();
  }catch{feedback('External exit-IP check failed.',true);}
  finally{button.disabled=!connectionOK;}
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
    if(existing?.country && ![...countrySelect().options].some(o=>o.value===existing.country)){
      const option=new Option('Saved '+existing.country+' · not verified',existing.country);
      option.disabled=true;
      countrySelect().add(option);
    }
    countrySelect().value=existing?.country||'';
    updateFlag(existing?.country||'');
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
  if(rule?.country && ![...countrySelect().options].some(o=>o.value===rule.country)){
    const option=new Option('Saved '+rule.country+' · not yet verified',rule.country);
    option.disabled=true;
    countrySelect().add(option);
  }
  countrySelect().value=rule?.country||'';
  updateFlag(rule?.country||'');
  element<HTMLInputElement>('subdomains').checked=rule?.subdomains!==false;
  element<HTMLInputElement>('auto-detect').checked=policy.autoDetect;
  element<HTMLInputElement>('auto-retry').checked=policy.autoRetry;
  removeButton().disabled=!rule;
  const hasEligibleSelection=Boolean(rule?.country) || (providerCatalog?.authenticated===true &&
    providerCatalog.entitled===true && providerCatalog.countries.some(c=>
      c.code===countrySelect().value && c.available));
  saveButton().disabled=!hasEligibleSelection;
  saveButton().textContent=!providerCatalog?.authenticated
    ? 'Sign in within Helper for country list'
    : 'Save website route';
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
  if(!providerCatalog?.authenticated)saveButton().disabled=true;
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
  element<HTMLInputElement>('auto-verify-exit').checked=
    (await chrome.storage.local.get(AUTO_PROBE_KEY))[AUTO_PROBE_KEY]===true;
  await Promise.all([refreshConnection(),refreshConsent()]);
  await refreshCountries();
  await displayExitEvidence();
  await refreshSite();
  // Read Proton's live connection state; do not claim a saved rule equals a VPN.
  setInterval(()=>{void refreshConnection();void displayExitEvidence();},3500);
  setInterval(()=>{void refreshCountries();},60000);
  hostInput().addEventListener('change',()=>{feedback('');void refreshSite();});
  hostInput().addEventListener('input',()=>{void refreshSite();});
  countrySelect().addEventListener('change',()=>{
    updateFlag(countrySelect().value);
    if(hostname()&&delegated&&countrySelect().value && (currentIssue.kind==='none'||currentIssue.canResolve)) saveButton().disabled=false;
    drawCountryList();feedback('');
  });
  element<HTMLInputElement>('country-search').addEventListener('input',drawCountryList);
  element<HTMLButtonElement>('verify-exit').addEventListener('click',()=>{void runExitCheck();});
  element<HTMLInputElement>('auto-verify-exit').addEventListener('change',event=>{
    const enabled=(event.currentTarget as HTMLInputElement).checked;
    void chrome.storage.local.set({[AUTO_PROBE_KEY]:enabled}).then(()=>
      feedback(enabled?'Periodic exit checks enabled. country.is receives a request IP every 5 minutes while connected.'
        :'Periodic external checks disabled. Local VPN health monitoring remains enabled.')
    ).catch(()=>feedback('Could not save verification preference.',true));
  });
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
