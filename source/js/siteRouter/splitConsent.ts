/** User-controlled delegation, stored in this *one* Proton-derived extension.
 * Not an OAuth token, account permission, or another extension's session.
 * Off by default. Grant is user-driven from an extension-owned settings screen, never a content script or background event.
 */
export const SPLIT_CONSENT_KEY = 'protonVpnHelperManageSplitTunnelingV1';
export async function hasSplitConsent():Promise<boolean> {
  return (await chrome.storage.local.get(SPLIT_CONSENT_KEY))[SPLIT_CONSENT_KEY] === true;
}
export async function setSplitConsent(allowed:boolean):Promise<void> {
  await chrome.storage.local.set({[SPLIT_CONSENT_KEY]:allowed===true});
}

export {helperMayRoute} from './consentGate';
