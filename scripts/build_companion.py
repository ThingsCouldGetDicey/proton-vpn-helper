#!/usr/bin/env python3
"""Build the independent, *passive* official-Proton companion.

Never bundles the original fork's VPN background, Proton account session,
proxy-authority functions or website content-script routing. Stable key means
the existing Helper ID is preserved across an explicit browser restart.
"""
import json
import re
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'source'
COMPANION=SOURCE/'companion'
TARGET=ROOT/'distribution-companion'
legacy=json.loads((SOURCE/'manifest.json').read_text())
assert legacy['key'] and len(legacy['key'])>300
manifest={
  'manifest_version':3,
  'name':'Proton VPN Helper — Official Connection Companion (Unofficial)',
  'short_name':'Proton VPN Helper',
  'version':'1.4.1',
  'description':'Observe the official Proton VPN browser proxy and save inactive country preferences. No second Proton login or proxy control.',
  'minimum_chrome_version':'110.0',
  'key':legacy['key'],
  'background':{'service_worker':'js/background.js','type':'module'},
  'action':{
    'default_icon':legacy['action']['default_icon'],
    'default_title':'Proton VPN Helper · Official Proton companion',
    'default_popup':'popup.html'
  },
  'icons':legacy['icons'],
  'permissions':['storage','tabs','alarms','proxy','management','nativeMessaging'],
  'host_permissions':['https://api.country.is/*'],
  # Reverse-direction events can only come from Proton's official ID.
  # The currently installed official Proton extension does NOT support
  # the forward direction without Proton-side changes and explicit consent.
  'externally_connectable':{'ids':['jplgfhpmjnbigmhklmmbgecoobifkmpa']},
  'options_ui':{'page':'site-router.html','open_in_tab':True},
  'commands':{'_execute_action':{'suggested_key':{'default':'Alt+Shift+Y'},
    'description':'Open Proton VPN Helper companion'}}
}
assert 'webRequestAuthProvider' not in manifest['permissions']
assert 'identity' not in manifest['permissions']
assert manifest['externally_connectable']['ids']==['jplgfhpmjnbigmhklmmbgecoobifkmpa']
if TARGET.exists():
    assert TARGET.is_dir() and not TARGET.is_symlink()
    shutil.rmtree(TARGET)
shutil.copytree(COMPANION,TARGET)
(TARGET/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
assets=SOURCE/'img'
for size in ('16','19','24','32','38','48','64','72','96','128','256','512'):
    file=assets/f'icon-{size}.png'
    if file.exists():
        dest=TARGET/'img'/file.name
        dest.parent.mkdir(exist_ok=True,parents=True)
        shutil.copy2(file,dest)
flagdir=TARGET/'img/flags'
flagdir.mkdir(exist_ok=True,parents=True)
codes=set()
for path in sorted((assets/'flags').glob('*.svg')):
    if re.fullmatch(r'[a-z]{2}',path.stem):
        shutil.copy2(path,flagdir/path.name)
        codes.add(path.stem.upper())
assert len(codes)>=200, len(codes)
(TARGET/'countries.json').write_text(json.dumps(sorted(codes)))
# Risky original engines or auth assets cannot accidentally survive this build.
assert not (TARGET/'js/popup.js').exists()
assert not (TARGET/'js/service.js').exists()
assert not (TARGET/'js/site-router-content.js').exists()
assert not (TARGET/'js/transmit.js').exists()
for path in (TARGET/'js').glob('*.js'):
    js=path.read_text()
    for forbidden in ('chrome.identity.', 'webRequest.onAuthRequired',
        'refreshToken', 'account.proton.me', 'fetch("https://api.proton'):
        assert forbidden not in js, (path,forbidden)
    # Disallow actual calls, not descriptive comments.
    assert not re.search(r'chrome\.proxy\.settings\.(?:set|clear)\s*\(',js), path
print('COMPANION_BUILD',TARGET)
print('VERSION',manifest['version'])
print('COUNTRY_FLAG_ASSETS',len(codes))
print('NO_SEPARATE_VPN_SIGNIN_OR_PROXY_CONTROLS',True)
