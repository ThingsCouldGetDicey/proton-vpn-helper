/** A helper-owned Proton session is NOT the session of the official
 * Proton VPN extension. Browser extension storage is isolated.
 * Another proxy owner cannot be identified or treated as authenticated.
 */
export interface HelperConnectionView {
  connected?: boolean;
  signedIn?: boolean;
  ownsProxy?: boolean;
  proxyControl?: string;
  proxyMode?: string;
  selectedCountry?: string;
}

export function connectionLabel(state?: HelperConnectionView): string {
  if (!state) return 'Helper connection status unavailable · VPN protection not verified';
  if (state.connected) {
    return 'Helper Proton connection reported active'+
      (state.selectedCountry ? ' · '+state.selectedCountry : '')+
      ' · external exit IP not verified';
  }
  if (state.proxyControl === 'controlled_by_other_extensions') {
    return 'Another extension controls Brave’s proxy. Helper cannot read that extension’s Proton login.';
  }
  if (state.signedIn) {
    return 'Helper has its own Proton session, but its VPN connection is not active.';
  }
  return 'Helper has no Proton session. Your official Proton login is separate.';
}

export function connectionDetail(state?: HelperConnectionView): string {
  if (!state) return 'Helper connection diagnostics unavailable.';
  const owner = state.ownsProxy ? 'Helper' :
    state.proxyControl === 'controlled_by_other_extensions' ? 'another extension' : 'unverified';
  return 'Helper account: '+(state.signedIn?'session present':'not linked')+
    ' · Browser proxy: '+owner+
    ' · Mode: '+(state.proxyMode || 'unknown')+
    '. Official Proton credentials are not shared.';
}
