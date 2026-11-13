import {OFFICIAL_PROTON_ID, domainFrom, countryCode} from './shared.js';

export const BRIDGE_PROTOCOL = 'proton-vpn-helper/1';
export const BRIDGE_TIMEOUT_MS = 2300;
const FRESH_MS = 9000;

export function unlinkedBridge(reason='unsupported') {
  return {
    status:reason, linked:false, delegated:false, accountSignedIn:false,
    vpnConnected:false, defaultCountry:null, countryRoutingSupported:false,
    countriesAvailable:false, checkedAt:Date.now()
  };
}

export function validateBridgeReply(reply,nonce,action='hello'){
  if(!reply||reply.protocol!==BRIDGE_PROTOCOL||
    reply.nonce!==nonce||reply.action!==action) throw new Error('Invalid Proton bridge response');
  if(reply.ok!==true) {
    return {ok:false,reason:typeof reply.reason==='string'?
      reply.reason.slice(0,160):'Rejected by Proton'};
  }
  if(action==='hello'){
    for(const k of ['delegated','accountSignedIn','vpnConnected','countryRoutingSupported']){
      if(typeof reply[k]!=='boolean')throw new Error('Invalid Proton status field');
    }
    const region=reply.defaultCountry===null||reply.defaultCountry===undefined?null:
      countryCode(reply.defaultCountry);
    const delegated=reply.delegated===true;
    return {ok:true,linked:delegated,delegated,
      accountSignedIn:delegated&&reply.accountSignedIn===true,
      vpnConnected:delegated&&reply.vpnConnected===true,
      defaultCountry:delegated?region:null,
      countryRoutingSupported:delegated&&reply.countryRoutingSupported===true,
      countriesAvailable:delegated&&reply.countriesAvailable===true,
      checkedAt:Date.now()};
  }
  if(action==='listCountries'){
    if(!Array.isArray(reply.countries)||reply.countries.length>300)
      throw new Error('Invalid country catalogue');
    const seen=new Set();
    const countries=[];
    for(const c of reply.countries){
      if(!c||typeof c.name!=='string'||c.name.length>80||
        typeof c.available!=='boolean')throw new Error('Invalid country');
      const code=countryCode(c.code);
      if(seen.has(code))continue;
      seen.add(code);
      countries.push({code,name:c.name,available:c.available,
        locked:c.locked===true});
    }
    return {ok:true,countries,checkedAt:Date.now()};
  }
  if(action==='setWebsiteCountry'||action==='removeWebsiteCountry'){
    if(typeof reply.applied!=='boolean')throw new Error('Invalid route acknowledgement');
    return {ok:true,applied:reply.applied,
      reason:typeof reply.reason==='string'?reply.reason.slice(0,160):undefined};
  }
  throw new Error('Invalid Proton bridge action');
}

function nonce(){
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function transport(targetId,message){
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Official Proton bridge timed out')),BRIDGE_TIMEOUT_MS);
    try{
      chrome.runtime.sendMessage(targetId,message,response=>{
        clearTimeout(timeout);
        if(chrome.runtime.lastError)reject(new Error('Official Proton bridge unavailable'));
        else resolve(response);
      });
    }catch{
      clearTimeout(timeout);
      reject(new Error('Official Proton bridge unavailable'));
    }
  });
}

/** No secrets cross the boundary. Chrome validates extension identities.
 * A successful hello requires an explicit Proton-side delegation switch.
 * The current store extension does not support this protocol.
 */
export function createBridgeClient({
  send=transport,targetId=OFFICIAL_PROTON_ID,random=nonce
}={}){
  let last=null,at=0,pending=null;
  const exchange=async(action,payload={})=>{
    const requestNonce=random();
    const raw=await send(targetId,{
      protocol:BRIDGE_PROTOCOL,action,nonce:requestNonce,...payload
    });
    return validateBridgeReply(raw,requestNonce,action);
  };
  const hello=async(force=false)=>{
    if(!force && last && Date.now()-at<FRESH_MS)return last;
    if(pending)return pending;
    pending=(async()=>{
      try{
        const response=await exchange('hello');
        last=response.ok && response.linked ? {
          status:'linked',...response
        } : unlinkedBridge(response.reason||'consent-required');
      }catch{
        last=unlinkedBridge('official-extension-does-not-support-bridge');
      }
      at=Date.now();
      return last;
    })();
    try{return await pending;}
    finally{pending=null;}
  };
  const listCountries=async()=>{
    const state=await hello();
    if(!state.linked||!state.countriesAvailable)return {ok:false,reason:'Proton has not enabled country sharing'};
    return exchange('listCountries');
  };
  const setWebsiteCountry=async({domain,country,subdomains=true})=>{
    const state=await hello(true);
    if(!state.linked||!state.countryRoutingSupported||!state.vpnConnected||
      !state.accountSignedIn) return {ok:false,reason:'Official Proton has not authorised website-country routing'};
    return exchange('setWebsiteCountry',{
      domain:domainFrom(domain),country:countryCode(country),
      subdomains:subdomains===true
    });
  };
  const removeWebsiteCountry=async({domain})=>{
    const state=await hello(true);
    if(!state.linked||!state.countryRoutingSupported)return {
      ok:false,reason:'Official Proton has not authorised website-country routing'
    };
    return exchange('removeWebsiteCountry',{domain:domainFrom(domain)});
  };
  return {hello,listCountries,setWebsiteCountry,removeWebsiteCountry,
    invalidate(){at=0;last=null;}};
}
