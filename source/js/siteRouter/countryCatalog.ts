import type {Logical} from '../vpn/Logical';
import {getCountryCode} from '../tools/getCountryCode';

/** The only country catalogue is Proton's own logical-server feed.
 * Preserve locked countries for parity with Proton's own upgrade list.
 * Never fabricate entitlements or an available country while signed out.
 */
export interface HelperCountry {
  code: string;
  name: string;
  available: boolean;
  locked: boolean;
  online: boolean;
  serverCount: number;
}
export interface HelperCountryCatalog {
  authenticated: boolean;
  entitled: boolean;
  countries: HelperCountry[];
  generatedAt: number;
  error?: string;
}
export function countriesFromProtonLogicals(
  logicals: Pick<Logical,'ExitCountry'|'Tier'|'Name'|'Servers'|'Enabled'|'Visible'|'AutoConnectable'|'ServerCapacity'>[],
  maxTier: number,
  localizedName: (code:string)=>string,
):HelperCountry[] {
  const byCode = new Map<string,{count:number,allowed:boolean,online:boolean}>();
  for(const server of logicals) {
    if(!server.ExitCountry)continue;
    const code=getCountryCode(server.ExitCountry).toUpperCase();
    if(!code || !/^[A-Z]{2}$/.test(code)) continue;
    const current=byCode.get(code)||{count:0,allowed:false,online:false};
    // The original UI includes upgrade-locked countries, but they cannot
    // be selected for a site route without an eligible browser HTTPS server.
    const accessible=server.Tier<=maxTier;
    const active=server.Enabled!==false && server.Visible!==false &&
      server.AutoConnectable!==false && (
        (server.Servers||[]).some(s=>Boolean(s.Domain) && Boolean(s.Enabled) && s.Status>0) ||
        ((server.ServerCapacity||0)>0));
    current.count++;
    current.allowed ||= accessible;
    current.online ||= accessible && active;
    byCode.set(code,current);
  }
  return [...byCode].map(([code,info])=>({
    code,
    name:localizedName(code)||code,
    available:info.allowed&&info.online,
    locked:!info.allowed,
    online:info.online,
    serverCount:info.count
  })).sort((a,b)=>a.name.localeCompare(b.name)||a.code.localeCompare(b.code));
}
