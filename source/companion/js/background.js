import {
  OFFICIAL_PROTON_ID, POLICY_KEY, HEALTH_ALARM,
  validatedPolicy, domainFrom, countryCode
} from './shared.js';
import {createBridgeClient, BRIDGE_PROTOCOL} from './officialBridge.js';

// Companion-only background. There is intentionally NO chrome.proxy.settings.set,
// no proxy clear, no Proton login, no webRequestAuthProvider and no auth token reads.
const NATIVE_HOST = 'com.local.proton_site_router';
const IP_ECHO = 'https://api.country.is/';
const protonBridge=createBridgeClient();
let currentHealth = null;
let lastHealthAt = 0;
let lastExit = null;
let synchronizing = false;
let policyFromBridge = false;

function getProxy() {
  return new Promise(resolve => {
    chrome.proxy.settings.get({incognito:false}, result => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(result || null);
    });
  });
}
function getOfficialInstallation() {
  return new Promise(resolve => {
    chrome.management.get(OFFICIAL_PROTON_ID, result => {
      if (chrome.runtime.lastError || !result) {
        resolve({installed:false, enabled:false});
        return;
      }
      resolve({installed:true, enabled:result.enabled===true,
        name:result.name==='Proton VPN: Fast & Secure' ? 'Proton VPN' : 'Proton VPN extension'});
    });
  });
}
async function health() {
  const [official, proxy, bridge] = await Promise.all([
    getOfficialInstallation(),getProxy(),protonBridge.hello()
  ]);
  const mode = proxy?.value?.mode || 'unknown';
  const configured = mode==='pac_script' || mode==='fixed_servers';
  const ownership = proxy?.levelOfControl || 'unknown';
  const changed = !currentHealth || currentHealth.proxyMode!==mode ||
    currentHealth.proxyControl!==ownership ||
    currentHealth.officialInstalled!==official.installed ||
    currentHealth.officialEnabled!==official.enabled ||
    currentHealth.bridge?.status!==bridge.status ||
    currentHealth.bridge?.vpnConnected!==bridge.vpnConnected ||
    currentHealth.bridge?.defaultCountry!==bridge.defaultCountry;
  currentHealth={
    officialInstalled: official.installed, officialEnabled: official.enabled,
    proxyMode: mode, proxyControl:ownership,
    proxyConfigured:configured,
    // Chrome's settings API cannot establish which provider owns a proxy,
    // that the user is logged in, or what exit IP is in use.
    // A verified Proton-endpoint handshake proves only account and connection
    // states. Even this cannot prove VPN exit IP or DNS/WebRTC isolation.
    providerConfirmed:false,
    accountConfirmed:bridge.linked===true && bridge.accountSignedIn===true,
    countryRoutingSupported:bridge.countryRoutingSupported===true,
    bridge,checkedAt:Date.now()
  };
  lastHealthAt=currentHealth.checkedAt;
  if(changed)lastExit=null;
  return {...currentHealth, exit: recentExit()};
}
function recentExit() {
  return lastExit && lastExit.checkedAt+5*60*1000>Date.now() ? {...lastExit} : null;
}
async function state() {
  if(!currentHealth || Date.now()-lastHealthAt>10_000) return health();
  return {...currentHealth,exit:recentExit()};
}
async function policy() {
  const stored=await chrome.storage.local.get(POLICY_KEY);
  return validatedPolicy(stored[POLICY_KEY]);
}
async function putPolicy(next) {
  const saved=await policy();
  const value=validatedPolicy(next);
  value.revision=Math.max(Date.now(),saved.revision+1);
  await chrome.storage.local.set({[POLICY_KEY]:value});
  return value;
}
async function savePreference(message) {
  const domain=domainFrom(message.domain), country=countryCode(message.country);
  const old=await policy();
  return putPolicy({...old,rules:[...old.rules.filter(r=>r.domain!==domain),
    {domain,country,source:'manual',subdomains:message.subdomains!==false}]});
}
async function removePreference(message) {
  const domain=domainFrom(message.domain), old=await policy();
  return putPolicy({...old,rules:old.rules.filter(r=>r.domain!==domain)});
}
async function exitCheck() {
  const before=await health();
  if(!before.officialInstalled||!before.officialEnabled ||
     !before.proxyConfigured||before.proxyControl==='controlled_by_this_extension') {
    return {ok:false,reason:'A configured browser proxy and enabled official Proton extension are required; no request sent.'};
  }
  // The user explicitly clicked the verify button. The echo provider will
  // see the source IP. This is NOT proof of Proton-owned routing.
  const controller=new AbortController();
  const abort=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(IP_ECHO,{method:'GET',credentials:'omit',
      cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
    if(!response.ok)throw new Error('IP verification service unavailable');
    const parsed=await response.json();
    if(typeof parsed.ip!=='string' || parsed.ip.length>64 ||
       typeof parsed.country!=='string'||!/^[A-Z]{2}$/.test(parsed.country))
      throw new Error('Invalid public-IP response');
    const after=await health();
    if(after.proxyMode!==before.proxyMode || after.proxyControl!==before.proxyControl ||
       !after.officialEnabled || !after.proxyConfigured)
      throw new Error('Browser proxy changed during verification');
    lastExit={checkedAt:Date.now(),country:parsed.country,ip:parsed.ip};
    return {ok:true,exit:recentExit(),note:'Observed browser request only; provider ownership and DNS/WebRTC isolation unverified'};
  }catch(e){
    lastExit=null;
    return {ok:false,reason:String(e?.message||'Verification failed')};
  }finally{clearTimeout(abort);}
}
async function nativeMessage(request) {
  try{return await chrome.runtime.sendNativeMessage(NATIVE_HOST,request);}
  catch{return null;}
}
async function syncNative(){
  if(synchronizing)return;
  synchronizing=true;
  try{
    const incoming=await nativeMessage({action:'pull'});
    if(!incoming?.ok||!incoming.policy)return;
    const remote=validatedPolicy(incoming.policy);
    const local=await policy();
    if(remote.revision>local.revision){
      policyFromBridge=true;
      try {await chrome.storage.local.set({[POLICY_KEY]:remote});}
      finally{policyFromBridge=false;}
    }else if(local.revision>remote.revision){
      await nativeMessage({action:'push',policy:local});
    }
  }finally{synchronizing=false;}
}
const allowedPages=new Set(['popup.html','site-router.html']);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  let valid=false;
  try {
    if(sender.id===chrome.runtime.id && typeof sender.url==='string'){
      const url=new URL(sender.url);
      valid=url.protocol==='chrome-extension:'&&url.host===chrome.runtime.id &&
        allowedPages.has(url.pathname.slice(1));
    }
  }catch {/* deny */}
  if(!valid)return false;
  void (async()=>{
    switch(message?.action){
      case 'health': return state();
      case 'policy': return policy();
      case 'save': return savePreference(message);
      case 'remove':return removePreference(message);
      case 'exit-check':return exitCheck();
      case 'refresh':protonBridge.invalidate();return health();
      case 'countries':return protonBridge.listCountries();
      case 'apply':return protonBridge.setWebsiteCountry(message);
      case 'unapply':return protonBridge.removeWebsiteCountry(message);
      default:throw new Error('Unsupported companion action');
    }
  })().then(respond).catch(err=>respond({error:String(err?.message||err)}));
  return true;
});
// Reverse direction: only the specifically allowlisted Proton extension may
// announce a state change. Never trust event payloads as credentials or status.
chrome.runtime.onMessageExternal.addListener((request,sender,respond)=>{
  if(sender.id!==OFFICIAL_PROTON_ID || request?.protocol!==BRIDGE_PROTOCOL ||
    request.action!=='statusChanged')return false;
  protonBridge.invalidate();
  void health().then(()=>respond({ok:true})).catch(()=>respond({ok:false}));
  return true;
});
chrome.proxy.settings.onChange.addListener(()=>{
  protonBridge.invalidate();
  void health().catch(()=>undefined);
});
chrome.alarms.create(HEALTH_ALARM,{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name===HEALTH_ALARM) {
    void health().catch(()=>undefined);
    void syncNative().catch(()=>undefined);
  }
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local'||!changes[POLICY_KEY]||policyFromBridge)return;
  void policy().then(value=>nativeMessage({action:'push',policy:value})).catch(()=>undefined);
});
// Remove any account session that the earlier fork may have saved in this
// Helper extension ID. Official Proton storage belongs to a different ID and
// is never touched. Preserve country preferences but force auto routing OFF.
async function migrateLegacyHelperStorage(){
  // One-time migration: erase *all* legacy Helper-owned account caches and
  // credentials, never the separately installed official Proton storage.
  const marker='officialProtonCompanionMigrationV1';
  const data=await chrome.storage.local.get([POLICY_KEY,marker]);
  if(data[marker]===true)return;
  const safe=validatedPolicy(data[POLICY_KEY]);
  safe.revision=Math.max(Date.now(),safe.revision+1);
  if(chrome.storage.session)await chrome.storage.session.clear();
  await chrome.storage.local.clear();
  await chrome.storage.local.set({[POLICY_KEY]:safe,[marker]:true});
}
// No sign-in and no automatic user-visible tabs or windows.
void health().catch(()=>undefined);
void migrateLegacyHelperStorage().then(syncNative).catch(()=>undefined);
