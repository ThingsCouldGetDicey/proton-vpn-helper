#!/usr/bin/env python3
"""Real isolated Chromium test of the toolbar popup and split-tunnel conversion."""
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
EXT_ID=(ROOT/'native/extension_id.txt').read_text().strip()
PORT=19289
BASE=f'http://127.0.0.1:{PORT}'
POLICY_KEY='protonSiteRouterPolicyV1'

def main():
    with tempfile.TemporaryDirectory(prefix='helper-toolbar-') as folder:
        td=Path(folder)
        env=os.environ.copy()
        env['XDG_STATE_HOME']=str(td/'state')
        profile=td/'profile'
        hosts=profile/'NativeMessagingHosts'
        hosts.mkdir(parents=True)
        system_host=Path.home()/'.config/chromium/NativeMessagingHosts/com.local.proton_site_router.json'
        if system_host.is_file():
            shutil.copyfile(system_host,hosts/system_host.name)
        driver=subprocess.Popen(['chromedriver',f'--port={PORT}','--allowed-ips=127.0.0.1',
            '--log-level=SEVERE'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env)
        sid=None
        try:
            for _ in range(70):
                try:
                    if requests.get(BASE+'/status',timeout=.5).status_code==200: break
                except requests.RequestException: pass
                time.sleep(.15)
            else: raise RuntimeError('ChromeDriver not ready')
            opts={'binary':'/usr/bin/chromium','args':[
                '--headless=new','--no-sandbox','--disable-gpu',
                '--disable-dev-shm-usage','--disable-first-run','--no-default-browser-check',
                '--disable-background-networking','--window-size=900,640',
                '--host-resolver-rules=MAP sample.example.com ~NOTFOUND',
                '--user-data-dir='+str(profile),
                '--load-extension='+str(ROOT/'distribution'),
                '--disable-extensions-except='+str(ROOT/'distribution')]}
            resp=requests.post(BASE+'/session',json={'capabilities':{'alwaysMatch':{
                'browserName':'chrome','goog:chromeOptions':opts}}},timeout=35)
            resp.raise_for_status()
            payload=resp.json()
            if payload.get('value',{}).get('error'): raise RuntimeError(str(payload))
            sid=payload['value'].get('sessionId') or payload.get('sessionId')
            assert sid
            ep=BASE+'/session/'+sid
            def wd(method,path,value=None):
                r=requests.request(method,ep+path,json=value,timeout=25)
                r.raise_for_status()
                data=r.json()['value']
                if isinstance(data,dict) and data.get('error'): raise RuntimeError(str(data))
                return data
            def js(script,*args):
                return wd('POST','/execute/sync',{'script':script,'args':args})
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/helper-popup.html'})
            for _ in range(55):
                if js("return !!document.querySelector('#save-route')"): break
                time.sleep(.12)
            else: raise RuntimeError('Shortcut popup failed to render')
            m=json.loads((ROOT/'distribution/manifest.json').read_text())
            assert m['action']['default_popup']=='helper-popup.html'
            assert m['commands']['_execute_action']['suggested_key']['default']=='Alt+Shift+Y'
            print('PASS actual Chromium loaded toolbar popup with action icon and keyboard shortcut')
            commands=js("return chrome.commands.getAll()")
            assert any(x.get('name')=='_execute_action' and
                       x.get('shortcut')=='Alt+Shift+Y' for x in commands),commands
            print('PASS registered keyboard shortcut actually exposed by Chromium')

            for _ in range(40):
                state=js("return document.querySelector('#vpn-status')?.textContent")
                if state and 'VPN disconnected' in state: break
                time.sleep(.15)
            else:
                diagnostic=js("return Promise.race([chrome.runtime.sendMessage({type:'protonSiteRouterStatus'}).then(v=>({ok:v})).catch(e=>({error:String(e)})),new Promise(ok=>setTimeout(()=>ok({timeout:true}),1800))])")
                details=js("return {feedback:document.querySelector('#feedback')?.textContent,catalog:document.querySelector('#country-source')?.textContent,ready:document.readyState}")
                raise AssertionError('VPN status never settled: '+str(state)+' msg='+str(diagnostic)+' details='+str(details))
            assert js("return document.querySelector('#auto-detect').checked") is False
            assert js("return document.querySelector('#auto-retry').checked") is False
            assert js("return document.querySelector('#verify-exit').disabled") is True
            assert js("return document.querySelector('#auto-verify-exit').checked") is False
            js("document.querySelector('#auto-verify-exit').click();return true;")
            for _ in range(30):
                consent=js("return chrome.storage.local.get('protonVpnHelperAutoExitVerifyV1').then(v=>v.protonVpnHelperAutoExitVerifyV1)")
                if consent is True:break
                time.sleep(.15)
            else:raise AssertionError('Explicit periodic IP check consent not saved')
            js("document.querySelector('#auto-verify-exit').click();return true;")
            for _ in range(30):
                consent=js("return chrome.storage.local.get('protonVpnHelperAutoExitVerifyV1').then(v=>v.protonVpnHelperAutoExitVerifyV1)")
                if consent is False:break
                time.sleep(.15)
            else:raise AssertionError('Periodic IP check consent not revoked')
            print('PASS external IP monitoring is explicitly opt-in and revocable')
            assert js("return document.querySelector('#country-list').children.length") == 0
            assert js("return document.querySelector('#current-country-flag').hidden") is True
            # The country picker reuses Proton's bundled flags; these are
            # assets, not proof of an available Proton subscription.
            assert len(list((ROOT/'distribution/img/flags').glob('*.svg'))) >= 200
            print('PASS bundled original Proton country SVG flags, no fabricated signed-out country list')
            catalog=js("return chrome.runtime.sendMessage({type:'protonSiteRouterCountries'})")
            assert catalog['authenticated'] is False and catalog['countries']==[], catalog
            assert 'Sign into Proton' in js("return document.querySelector('#country-source').textContent")
            alarm=js("return chrome.alarms.get('protonVpnHelperConnectionHealth')")
            assert alarm and alarm['periodInMinutes']>=1,alarm
            health=js("return chrome.runtime.sendMessage({type:'protonSiteRouterHealth'})")
            assert health['connected'] is False and health['signedIn'] is False,health
            check=js("return chrome.runtime.sendMessage({type:'protonSiteRouterVerifyExit'})")
            assert check['ok'] is False and 'required' in check['reason'],check
            print('PASS no fabricated countries, always-on health alarm, no disconnected IP probe')
            screenshot=os.environ.get('SIGNEDOUT_SCREENSHOT_PATH')
            if screenshot:
                import io
                from PIL import Image
                raw=base64.b64decode(wd('GET','/screenshot'),validate=True)
                im=Image.open(io.BytesIO(raw))
                dest=Path(screenshot)
                dest.parent.mkdir(parents=True,exist_ok=True)
                im.crop((0,0,390,min(640,im.height))).save(dest)
                print('PASS captured actual signed-out Proton catalogue and connection health UI')
            print('PASS truthful disconnected state and automatic switching off by default')
            # Delegation is OFF by default. The Helper must not be able to
            # modify split tunnelling or activate a country route yet.
            assert 'management OFF' in js("return document.querySelector('#helper-authority').textContent")
            assert js("return document.querySelector('#save-route').disabled") is True
            consent_key='protonVpnHelperManageSplitTunnelingV1'
            assert js("return chrome.storage.local.get(arguments[0]).then(v=>v[arguments[0]]===true)",consent_key) is False
            print('PASS without explicit Proton consent, the Helper cannot save a new country route')
            denied=js("return chrome.runtime.sendMessage({type:'protonSiteRouterResolveSplit',domain:'sample.example.com'})")
            assert denied['ok'] is False and 'Grant Helper management' in denied['reason'],denied
            print('PASS backend rejects direct split-list mutation messages without consent')
            # The fork's original controls require account sign-in; local
            # Helper permission must remain discoverable *without* it.
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/popup.html'})
            for _ in range(55):
                if js("return !!document.querySelector('#helper-open-signedout-settings')"):break
                time.sleep(.15)
            else:raise AssertionError('Signed-out Proton view omitted Helper settings link')
            js("document.querySelector('#helper-open-signedout-settings').click();return true;")
            for _ in range(40):
                tabs=js("return chrome.tabs.query({})")
                if any(tab.get('url','').endswith('/site-router.html') for tab in tabs):break
                time.sleep(.15)
            else:raise AssertionError('Signed-out settings link did not open Helper options')
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/site-router.html'})
            for _ in range(40):
                if js("return !!document.querySelector('#helper-consent-switch')"):break
                time.sleep(.15)
            else:raise AssertionError('Consent control not visible in unauthenticated Helper settings')
            assert js("return document.querySelector('#helper-consent-switch').checked") is False
            js("document.querySelector('#helper-consent-switch').click();return true;")
            for _ in range(40):
                flag=js("return chrome.storage.local.get(arguments[0]).then(v=>v[arguments[0]])",consent_key)
                if flag is True:break
                time.sleep(.15)
            else:raise AssertionError('Explicit settings-page consent did not persist')
            assert 'management allowed' in js("return document.querySelector('#delegation-status').textContent").lower()
            js("document.querySelector('#helper-consent-switch').click();return true;")
            for _ in range(40):
                flag=js("return chrome.storage.local.get(arguments[0]).then(v=>v[arguments[0]])",consent_key)
                if flag is False:break
                time.sleep(.15)
            else:raise AssertionError('Advanced settings consent revocation failed')
            print('PASS signed-out Proton account screen links to independently configurable Helper permission')
            # The original Proton-style Split tunnelling panel also supports the same switch.
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/popup.html'})
            for _ in range(60):
                if js("return !!document.querySelector('#helper-manage-split')"):break
                time.sleep(.15)
            else:raise AssertionError('No consent switch in original Proton Split tunnelling panel')
            assert js("return document.querySelector('#helper-manage-split').checked") is False
            js("document.querySelector('#helper-manage-split').click();return true;")
            for _ in range(45):
                active=js("return chrome.storage.local.get(arguments[0]).then(v=>v[arguments[0]]===true)",consent_key)
                if active:break
                time.sleep(.15)
            else:raise AssertionError('Original Proton toggle did not grant consent')
            assert js("return document.querySelector('[data-page=\"split-tunneling\"]').classList.contains('helper-split-delegated')") is True
            print('PASS original Proton split-tunnelling settings grants explicit Helper delegation')
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/helper-popup.html'})
            for _ in range(45):
                state=js("return document.querySelector('#helper-authority')?.textContent")
                if state and 'management allowed' in state:break
                time.sleep(.15)
            else:raise AssertionError('Helper did not mirror original Proton delegation toggle: '+str(state))
            print('PASS Helper instantly mirrors permission from original Proton controls')
            def enter(host,country='CH'):
                js("""const host=document.querySelector('#site-host');
                    host.value=arguments[0];
                    host.dispatchEvent(new Event('input',{bubbles:true}));
                    host.dispatchEvent(new Event('change',{bubbles:true}));
                    return true;""",host)
                time.sleep(.55)
                js("""const select=document.querySelector('#country');
                    if(![...select.options].some(o=>o.value===arguments[0]))
                        select.add(new Option('SIMULATED '+arguments[0],arguments[0]));
                    select.value=arguments[0];
                    select.dispatchEvent(new Event('change',{bubbles:true}));return true;""",country)
            def get_rules():
                return js("""return chrome.storage.local.get(arguments[0])
                    .then(v=>v[arguments[0]]?.rules||[])""",POLICY_KEY)
            def await_rule(host,country):
                for _ in range(50):
                    rows=get_rules()
                    if any(r['domain']==host and r['country']==country for r in rows):
                        return
                    time.sleep(.18)
                raise AssertionError('Saved route missing for '+host)
            enter('sample.example.com','CH')
            js("document.querySelector('#save-route').click();return true;")
            await_rule('sample.example.com','CH')
            print('PASS toolbar shortcut saves a Swiss country preference for a website')
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/popup.html'})
            for _ in range(50):
                text=js("return document.querySelector('#helper-delegation-status')?.textContent")
                if text and '1 website country rule saved' in text: break
                time.sleep(.15)
            else:raise AssertionError('Original Proton split page did not mirror saved Helper country rule: '+str(text))
            assert js("return document.querySelector('#helper-manage-split').checked") is True
            print('PASS original Proton split settings mirror newly saved Helper website rules')
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/helper-popup.html'})
            for _ in range(30):
                if js("return !!document.querySelector('#save-route')"):break
                time.sleep(.15)
            target=js("return chrome.tabs.create({url:'https://sample.example.com/badge-test'})")
            assert target.get('id'),target
            for _ in range(45):
                badge=js("return chrome.action.getBadgeText({tabId:arguments[0]})",target['id'])
                if badge=='CH':break
                time.sleep(.2)
            else:raise AssertionError('Current-tab toolbar badge failed to show CH: '+str(badge))
            title=js("return chrome.action.getTitle({tabId:arguments[0]})",target['id'])
            assert 'not verified' in title.lower(),title
            print('PASS toolbar action badge marks the saved country without claiming VPN protection')

            screenshot=os.environ.get('TOOLBAR_SCREENSHOT_PATH')
            if screenshot:
                # Screenshot is a REAL rendered browser screenshot, not a
                # generated UI mock-up or evidence of actual VPN exit country.
                time.sleep(.5)
                encoded=wd('GET','/screenshot')
                from PIL import Image
                import io
                image=Image.open(io.BytesIO(base64.b64decode(encoded,validate=True)))
                dest=Path(screenshot);dest.parent.mkdir(parents=True,exist_ok=True)
                image.crop((0,0,390,min(image.height,630))).save(dest)
                print('PASS actual toolbar screenshot captured',dest)
            # Exact Proton exclusion is safely moved to VPN country routing.
            raw={'enabled':True,'mode':'exclude',
                 'value':[{'domain':'excluded.example.org',
                           'withSubDomains':True,'mode':'exclude'}]}
            js("""return chrome.storage.local.set({'bex-split-tunneling':arguments[0]})""",raw)
            enter('excluded.example.org','NL')
            for _ in range(40):
                t=js("return document.querySelector('#split-notice').textContent")
                if 'excludes this site' in t: break
                time.sleep(.15)
            else:raise AssertionError('Excluded-site warning missing')
            assert js("return document.querySelector('#save-route').disabled") is False
            js("document.querySelector('#save-route').click();return true;")
            await_rule('excluded.example.org','NL')
            for _ in range(40):
                state=js("""return chrome.storage.local.get('bex-split-tunneling')
                    .then(v=>v['bex-split-tunneling'])""")
                if state and not state.get('value'): break
                time.sleep(.2)
            else:raise AssertionError('Exact exclusion was not removed')
            print('PASS explicit click moves exact Proton exclusion to NL country rule')
            # Parent exclusion affects more sites: never silently delete it.
            raw={'enabled':True,'mode':'exclude',
                 'value':[{'domain':'parent.example.org',
                           'withSubDomains':True,'mode':'exclude'}]}
            js("""return chrome.storage.local.set({'bex-split-tunneling':arguments[0]})""",raw)
            enter('shop.parent.example.org','DE')
            for _ in range(40):
                blocked=js("return document.querySelector('#save-route').disabled")
                if blocked:break
                time.sleep(.15)
            else:raise AssertionError('Broad parent exclusion not blocked')
            assert 'parent-domain' in js("return document.querySelector('#split-notice').textContent")
            current=js("""return chrome.storage.local.get('bex-split-tunneling')
                .then(v=>v['bex-split-tunneling'])""")
            assert len(current['value'])==1 and current['value'][0]['domain']=='parent.example.org'
            print('PASS broad parent-domain exclusion requires explicit manual review')
            # Include-only rule automatically includes an exact new website
            # in response to the user clicking the route button.
            js("""return chrome.storage.local.set({'bex-split-tunneling':
                {enabled:true,mode:'include',value:[]}})""")
            enter('include.example.net','CA')
            assert 'Include site' in js("return document.querySelector('#save-route').textContent")
            js("document.querySelector('#save-route').click();return true;")
            await_rule('include.example.net','CA')
            state=js("""return chrome.storage.local.get('bex-split-tunneling')
                .then(v=>v['bex-split-tunneling'])""")
            assert any(x['domain']=='include.example.net' and x['mode']=='include' for x in state['value']),state
            print('PASS explicit click includes site in Proton include-only rules')
            # Removing a country preference leaves split tunnelling untouched.
            js("document.querySelector('#remove-route').click();return true;")
            for _ in range(30):
                if not any(x['domain']=='include.example.net' for x in get_rules()):break
                time.sleep(.18)
            else:raise AssertionError('Remove preference did not work')
            state=js("""return chrome.storage.local.get('bex-split-tunneling')
                .then(v=>v['bex-split-tunneling'])""")
            assert any(x['domain']=='include.example.net' for x in state['value'])
            print('PASS removing a country preference preserves Proton include-only rule')
            js("document.querySelector('#auto-retry').click();return true;")
            for _ in range(45):
                prefs=js("return chrome.storage.local.get(arguments[0]).then(v=>v[arguments[0]])",POLICY_KEY)
                if prefs and prefs['autoRetry'] and prefs['autoDetect']: break
                time.sleep(.15)
            else: raise AssertionError('Automatic retry opt-in did not also enable detection')
            js("document.querySelector('#auto-detect').click();return true;")
            for _ in range(45):
                prefs=js("return chrome.storage.local.get(arguments[0]).then(v=>v[arguments[0]])",POLICY_KEY)
                if prefs and not prefs['autoRetry'] and not prefs['autoDetect']: break
                time.sleep(.15)
            else: raise AssertionError('Disabling detection did not also stop automatic retries')
            print('PASS automatic country attempts require explicit detection consent')
            js("document.querySelector('#open-proton').click();return true;")
            for _ in range(30):
                windows=js("return chrome.windows.getAll({populate:true})")
                if any(any('/popup.html' in (tab.get('url') or '') for tab in w.get('tabs',[])) for w in windows):break
                time.sleep(.15)
            else: raise AssertionError('Original Proton control popup not opened')
            print('PASS original Proton VPN connection controls open from shortcut')
            # Revocation happens on the original Proton settings page. Any
            # previously saved preference persists but cannot route traffic.
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/popup.html'})
            for _ in range(35):
                if js("return !!document.querySelector('#helper-manage-split')"):break
                time.sleep(.15)
            assert js("return document.querySelector('#helper-manage-split').checked") is True
            js("document.querySelector('#helper-manage-split').click();return true;")
            for _ in range(45):
                value=js("return chrome.storage.local.get(arguments[0]).then(v=>v[arguments[0]])",consent_key)
                if value is False:break
                time.sleep(.15)
            else:raise AssertionError('Revocation did not persist')
            assert js("return document.querySelector('[data-page=\"split-tunneling\"]').classList.contains('helper-split-delegated')") is False
            wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/helper-popup.html'})
            for _ in range(45):
                state=js("return document.querySelector('#helper-authority')?.textContent")
                if state and 'management OFF' in state:break
                time.sleep(.15)
            else:raise AssertionError('Helper did not reflect revoked consent')
            status=js("return chrome.runtime.sendMessage({type:'protonSiteRouterStatus'})")
            assert status['delegated'] is False and status['configured']==0,status
            assert js("return document.querySelector('#auto-detect').disabled") is True
            await_badge=None
            for _ in range(35):
                await_badge=js("return chrome.action.getBadgeText({tabId:arguments[0]})",target['id'])
                if await_badge=='!':break
                time.sleep(.18)
            else:raise AssertionError('Revoked Helper country preference not marked inactive: '+str(await_badge))
            print('PASS revoking delegation marks saved toolbar country badges inactive')
            print('PASS revoking delegation restores Proton rules and prevents Helper routing/automation')
        finally:
            if sid:
                try:requests.delete(BASE+'/session/'+sid,timeout=6)
                except requests.RequestException:pass
            driver.terminate()
            try:driver.wait(timeout=6)
            except subprocess.TimeoutExpired:driver.kill()

if __name__=='__main__':
    main()
