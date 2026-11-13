'use background';
import {readSession} from '../account/readSession';
import {getCurrentStateIfDefined} from '../state';
import {getSortedLogicals} from '../vpn/getLogicals';
import {getUser} from '../account/user/getUser';
import {getUserMaxTier} from '../account/user/getUserMaxTier';
import {getCountryNameOrCode} from '../tools/translate';
import {hasSplitConsent, SPLIT_CONSENT_KEY} from './splitConsent';
import {countriesFromProtonLogicals} from './countryCatalog';

const HELPER_ID='iggbajbkjippblegfmngbedfpfdkfcgd';
const PROTOCOL='proton-vpn-helper/1';
type Request={
  protocol?:unknown; action?:unknown; nonce?:unknown;
  domain?:unknown;country?:unknown;subdomains?:unknown;
};
type Sender={id?:string;url?:string};

/** Reference implementation for a *Proton-reviewed* provider endpoint.
 * This is part of our unofficial source fork, NOT the installed official
 * Proton extension. Proton must consent to and review this code.
 *
 * No credentials, tokens, browser cookies, DNS entries, proxy hostnames,
 * individual server identifiers or account IDs cross this boundary.
 */
export async function handleOfficialHelperBridge(request:Request,sender:Sender){
  // Mandatory defense in depth beyond manifest.externally_connectable.
  if(sender.id!==HELPER_ID ||
    request?.protocol!==PROTOCOL ||
    typeof request.nonce!=='string' ||
    !/^[a-f0-9]{32}$/.test(request.nonce) ||
    typeof request.action!=='string') return undefined;

  const action=request.action;
  const base={protocol:PROTOCOL,action,nonce:request.nonce};
  if(!['hello','listCountries','setWebsiteCountry','removeWebsiteCountry']
    .includes(action)) return {...base,ok:false,reason:'Unsupported operation'};

  const delegated=await hasSplitConsent().catch(()=>false);
  if(!delegated){
    // Don't reveal the Proton session or subscription before explicit consent.
    return {...base,ok:action==='hello',
      delegated:false,accountSignedIn:false,vpnConnected:false,
      countryRoutingSupported:false,countriesAvailable:false,
      defaultCountry:null,reason:'Consent not granted in Proton settings'};
  }

  const session=await readSession().catch(()=>undefined);
  const accountSignedIn=Boolean(session?.uid);
  const state=getCurrentStateIfDefined();
  const vpnConnected=accountSignedIn && state?.name==='on' && state?.proxyEnabled===true;
  const code=vpnConnected?state?.data?.server?.exitCountry:null;
  const defaultCountry=typeof code==='string' && /^[A-Z]{2}$/.test(code)?code:null;

  if(action==='hello')return {...base,ok:true,
    delegated:true,accountSignedIn,vpnConnected,defaultCountry,
    // Do not claim per-host country routing until Proton's own proxy engine
    // actually implements and independently verifies the facility.
    countryRoutingSupported:false,countriesAvailable:accountSignedIn};

  if(!accountSignedIn)return {...base,ok:false,reason:'Not signed in to Proton'};

  if(action==='listCountries'){
    try{
      const user=await getUser();
      if(!user?.VPN || user.VPN.BrowserExtension!==true)
        return {...base,ok:false,reason:'Browser VPN entitlement unavailable'};
      const logicals=await getSortedLogicals();
      const countries=countriesFromProtonLogicals(logicals,getUserMaxTier(user),
        c=>getCountryNameOrCode(c)).map(({code,name,available,locked})=>
        ({code,name,available,locked}));
      return {...base,ok:true,countries:countries.slice(0,300)};
    }catch {
      return {...base,ok:false,reason:'Unable to load Proton country catalogue'};
    }
  }

  // No fallback to ordinary global-country connect() or direct proxy changes.
  // Those would disrupt the existing connection or misroute unrelated tabs.
  return {...base,ok:false,reason:'Per-website routing requires Proton engine support'};
}


/** Two-way state invalidation, *only* after Proton approves this integration.
 * The notification conveys no account/session or routing data; the Helper
 * must perform a new consent-checked hello to obtain updated state.
 */
export function installOfficialHelperBridgeNotifications():void {
  let pending=false;
  const notify=()=>{
    if(pending)return;
    pending=true;
    void Promise.resolve().then(async()=>{
      try {
        await chrome.runtime.sendMessage(HELPER_ID,{
          protocol:PROTOCOL,action:'statusChanged'
        });
      }catch { /* Helper not installed or messaging not permitted. */ }
      finally{pending=false;}
    });
  };
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local'&&area!=='session')return;
    if(changes[SPLIT_CONSENT_KEY]||changes['session']){
      // Even revocation sends an event; no secret state is included.
      notify();
    }
  });
  chrome.proxy.settings.onChange.addListener(()=>{void hasSplitConsent().then(
    delegated=>{if(delegated)notify();}).catch(()=>undefined);
  });
}
