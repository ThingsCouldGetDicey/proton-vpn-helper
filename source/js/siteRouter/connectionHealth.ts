'use background';
import {readSiteRouterStatus} from './detector';
import {storedSplitTunneling} from '../vpn/storedSplitTunneling';
import {evaluateSiteSplitConflict} from './splitConflict';
import {loadRouterPolicy} from './runtime';
import {findRule} from './policy';

const ALARM='protonVpnHelperConnectionHealth';
import {AUTO_PROBE_KEY} from './healthPreferences';
const EVIDENCE_TTL_MS=5*60*1000;
let lastAutomaticAttempt=0;
let checkingExit:Promise<Awaited<ReturnType<typeof verifyDefaultExit>>>|undefined;
const PROBE_HOST='api.country.is';
export interface ExitEvidence {
  checkedAt:number;
  status:'not-checked'|'country-match'|'country-mismatch'|'failed'|'unsafe-to-probe';
  expected?:string;
  observedCountry?:string;
  observedIP?:string;
  reason?:string;
}
let latestCheck=0;
let lastStatus:Awaited<ReturnType<typeof readSiteRouterStatus>>|undefined;
let lastEvidence:ExitEvidence={checkedAt:0,status:'not-checked'};
let current:ReturnType<typeof readSiteRouterStatus>|undefined;

export async function updateConnectionHealth(){
  if(current)return current;
  current=readSiteRouterStatus();
  try {
    const next=await current;
    const prior=lastStatus;
    lastStatus=next;
    latestCheck=Date.now();
    // A changed state or default server invalidates previous egress evidence.
    if(!next.connected || next.selectedCountry!==prior?.selectedCountry ||
      next.selectedServer!==prior?.selectedServer ||
      !prior?.connected){
      lastEvidence={checkedAt:0,status:'not-checked'};
    }
    return next;
  }finally{current=undefined;}
}
export async function getConnectionHealth(){
  // Always re-read the local state on a user request, even between alarms.
  const state=await updateConnectionHealth();
  const evidence=state.connected && lastEvidence.checkedAt>0 &&
    Date.now()-lastEvidence.checkedAt<=EVIDENCE_TTL_MS ? lastEvidence :
      {checkedAt:0,status:'not-checked'};
  return {...state,lastCheckedAt:latestCheck,exit:evidence};
}

/** Explicit user-initiated external check. Never sends a request unless
 * Proton owns the active browser proxy, sign-in is present, and this probe
 * hostname is not excluded/direct or explicitly routed to another country.
 * The echo service sees the request's public exit IP; no credentials sent.
 */
export async function verifyDefaultExit(){
  const vpn=await updateConnectionHealth();
  if(!vpn.connected||!vpn.signedIn||!vpn.selectedCountry){
    return {ok:false,reason:'Proton sign-in and an active browser proxy are required'};
  }
  try {
    const split=await storedSplitTunneling.get();
    if(evaluateSiteSplitConflict(PROBE_HOST,split).kind!=='none')return {
      ok:false,reason:'Proton split tunnelling could bypass this verification host; no request was sent'
    };
    const policy=await loadRouterPolicy();
    if(findRule(PROBE_HOST,policy.rules))return {
      ok:false,reason:'A saved website rule changes the verification host route; no request was sent'
    };
    const controller=new AbortController();
    const abort=setTimeout(()=>controller.abort(),8000);
    let response:Response;
    try {
      response=await fetch('https://api.country.is/',{
        method:'GET',cache:'no-store',credentials:'omit',
        referrerPolicy:'no-referrer',signal:controller.signal,
      });
    }finally{clearTimeout(abort);}
    if(!response.ok) throw new Error('IP echo service returned an error');
    const value=await response.json() as {ip?:unknown;country?:unknown};
    if(typeof value.ip!=='string'||value.ip.length>64||
      typeof value.country!=='string'||!/^[A-Z]{2}$/.test(value.country)){
      throw new Error('IP echo service returned an invalid result');
    }
    // Reject if the connection changed while the external request was made.
    const after=await updateConnectionHealth();
    if(!after.connected||after.selectedCountry!==vpn.selectedCountry||
      after.selectedServer!==vpn.selectedServer){
      lastEvidence={checkedAt:Date.now(),status:'failed',
        reason:'VPN connection changed during the test'};
      return {ok:false,reason:lastEvidence.reason};
    }
    lastEvidence={checkedAt:Date.now(),
      status:value.country===vpn.selectedCountry?'country-match':'country-mismatch',
      expected:vpn.selectedCountry,observedCountry:value.country,observedIP:value.ip};
    return {ok:true,exit:lastEvidence};
  }catch {
    lastEvidence={checkedAt:Date.now(),status:'failed',
      reason:'Public exit-IP check failed; tunnel not verified'};
    return {ok:false,reason:lastEvidence.reason};
  }
}

export function installConnectionHealthMonitor(){
  chrome.alarms.create(ALARM,{periodInMinutes:1});
  chrome.alarms.onAlarm.addListener(alarm=>{
    if(alarm.name!==ALARM)return;
    void updateConnectionHealth().then(async status=>{
      if(!status.connected)return;
      const data=await chrome.storage.local.get(AUTO_PROBE_KEY);
      if(data[AUTO_PROBE_KEY]!==true)return;
      // Explicit opt-in external IP echo; no network request when signed out.
      if(Date.now()-lastAutomaticAttempt<5*60*1000||checkingExit)return;
      lastAutomaticAttempt=Date.now();
      checkingExit=verifyDefaultExit();
      try{await checkingExit;}finally{checkingExit=undefined;}
    }).catch(()=>undefined);
  });
  chrome.proxy.settings.onChange.addListener(()=>{
    void updateConnectionHealth().catch(()=>undefined);
  });
  // Track the browser connection state continuously while Chromium is running.
  void updateConnectionHealth().catch(()=>undefined);
}
