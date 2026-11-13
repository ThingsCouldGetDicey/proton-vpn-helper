'use background';
import {getSortedLogicals} from '../vpn/getLogicals';
import {getUser} from '../account/user/getUser';
import {getUserMaxTier} from '../account/user/getUserMaxTier';
import {getCountryNameOrCode} from '../tools/translate';
import {readSession} from '../account/readSession';
import {countriesFromProtonLogicals, type HelperCountryCatalog} from './countryCatalog';

let recent:HelperCountryCatalog|undefined;
let lastQuery=0;
let pending:Promise<HelperCountryCatalog>|undefined;

/** No separate country backend: the same Proton catalogue + tier as the
 * official server picker inside this combined extension. No credentials returned.
 */
export async function listProtonCountries():Promise<HelperCountryCatalog> {
  const session=await readSession().catch(()=>undefined);
  if(!session?.uid) {
    recent=undefined;
    return {authenticated:false,entitled:false,countries:[],generatedAt:Date.now()};
  }
  if(recent && Date.now()-lastQuery<60_000)return recent;
  if(pending)return pending;
  pending=(async()=>{
    try {
      const user=await getUser();
      if(!user?.VPN) return {authenticated:true,entitled:false,
        countries:[],generatedAt:Date.now(),error:'Subscription details unavailable'};
      const entitled=user.VPN.BrowserExtension === true;
      // This is the same catalogue code as the original picker, but requires a Helper-owned login.
      const logicals=await getSortedLogicals();
      const countries=countriesFromProtonLogicals(logicals,getUserMaxTier(user),
        c=>getCountryNameOrCode(c));
      const result:HelperCountryCatalog={authenticated:true,entitled,
        countries,generatedAt:Date.now()};
      recent=result;
      lastQuery=Date.now();
      return result;
    }catch {
      return {authenticated:true,entitled:false,countries:[],
        generatedAt:Date.now(),error:'Proton country catalogue could not be loaded'};
    }
  })();
  try{return await pending;}
  finally{pending=undefined;}
}
