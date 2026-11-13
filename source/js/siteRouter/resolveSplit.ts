'use background';
import {normalizeDomain} from './policy';
import {hasSplitConsent} from './splitConsent';
import {evaluateSiteSplitConflict} from './splitConflict';
import {storedSplitTunneling} from '../vpn/storedSplitTunneling';
import {SplitTunnelingDomainManager} from '../vpn/SplitTunnelingDomainManager';
import {SplitTunnelingMode} from '../vpn/WebsiteFilter';
import {getSplitTunnelingConfig} from '../vpn/getSplitTunnelingConfig';
import {getCurrentStateIfDefined} from '../state';
import {getUser} from '../account/user/getUser';
import {getUserMaxTier} from '../account/user/getUserMaxTier';
import {SettingChange} from '../messaging/MessageType';

/** One explicitly clicked action, never an automatic alteration of Proton split tunnelling.
 * Only exact exclusions can be removed. Broad parent-domain exclusions remain protected.
 */
export async function resolveSiteSplitConflict(domainInput: string): Promise<
  {ok: boolean; reason?: string; changed?: boolean}
> {
  if(!await hasSplitConsent())return {ok:false,reason:'Grant Helper management in Proton VPN > Split tunnelling first'};
  let host: string;
  try { host = normalizeDomain(domainInput); }
  catch { return {ok:false,reason:'Invalid website domain'}; }
  const original = await storedSplitTunneling.get();
  if (!original || !Array.isArray(original.value)) return {ok:true,changed:false};
  const issue = evaluateSiteSplitConflict(host,original);
  if (issue.kind === 'none') return {ok:true,changed:false};
  if (!issue.canResolve) return {ok:false,
    reason:'A parent-domain exclusion also affects other websites. Change it manually in Proton split tunnelling.'};
  const manager = new SplitTunnelingDomainManager(original);
  if (issue.kind === 'excluded') {
    if (manager.getCurrentMode() !== SplitTunnelingMode.Exclude || !manager.removeDomain(host)) {
      return {ok:false,reason:'The exact exclusion could not be removed'};
    }
  } else if (manager.getCurrentMode() === SplitTunnelingMode.Include) {
    manager.addDomain(host,true);
  } else return {ok:false,reason:'Split tunnelling state changed'};
  const updated = manager.getRawList();
  const state = getCurrentStateIfDefined();
  const connected = state?.name === 'on' && state.proxyEnabled === true;
  // Do not alter a live proxy unless current Proton account entitlements can be confirmed.
  const user = connected ? await getUser() : undefined;
  if (connected && (!user || !state?.setOption)) return {ok:false,
    reason:'Cannot verify Proton VPN session; split tunnelling left unchanged'};
  // A concurrent revocation wins even if the connection check was slow.
  if(!await hasSplitConsent())return {ok:false,
    reason:'Helper management was revoked before the change was applied'};
  await storedSplitTunneling.setValue(updated.value, {
    enabled: updated.enabled, mode: updated.mode,
  });
  if (connected && user) {
    try {
      await state!.setOption!(SettingChange.BYPASS_LIST,
        getSplitTunnelingConfig(getUserMaxTier(user),updated));
    } catch {
      await storedSplitTunneling.setValue(original.value,{
        enabled:original.enabled,mode:original.mode,
      });
      return {ok:false,reason:'Unable to apply split-tunnelling update; restored prior setting'};
    }
  }
  return {ok:true,changed:true};
}
