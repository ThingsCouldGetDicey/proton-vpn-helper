#!/usr/bin/env python3
"""Headless Chromium real-browser test for a fully passive Proton companion.

Uses an isolated synthetic proxy owner; never loads or touches the user's
authenticated Proton session or active Brave profile.
"""
import base64
import io
import json
import os
import requests
import subprocess
import tempfile
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EXT=(ROOT/'native/extension_id.txt').read_text().strip()
PORT=19514
BASE=f'http://127.0.0.1:{PORT}'

def main():
    with tempfile.TemporaryDirectory(prefix='proton-official-companion-') as folder:
        scratch=Path(folder)
        owner=scratch/'synthetic-proxy-owner';owner.mkdir()
        (owner/'manifest.json').write_text(json.dumps({
            'manifest_version':3,'name':'Synthetic other proxy owner',
            'version':'1.0.0','permissions':['proxy','storage'],
            'background':{'service_worker':'worker.js'}}))
        (owner/'worker.js').write_text("""
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.proxy.settings.set({value:{mode:'fixed_servers',
    rules:{singleProxy:{scheme:'http',host:'127.0.0.1',port:19013}}},
    scope:'regular'});
});
""")
        driver=subprocess.Popen(['chromedriver',f'--port={PORT}',
            '--allowed-ips=127.0.0.1','--log-level=SEVERE'],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        sid=None
        try:
            for _ in range(75):
                try:
                    if requests.get(BASE+'/status',timeout=.5).status_code==200:break
                except requests.RequestException:pass
                time.sleep(.15)
            else:raise RuntimeError('ChromeDriver not ready')
            ext_path=ROOT/'distribution-companion'
            opts={'binary':'/usr/bin/chromium','args':[
                '--headless=new','--no-sandbox','--disable-gpu',
                '--disable-dev-shm-usage','--disable-first-run','--no-default-browser-check',
                '--disable-background-networking','--window-size=700,860',
                '--user-data-dir='+str(scratch/'profile'),
                '--load-extension='+str(owner)+','+str(ext_path),
                '--disable-extensions-except='+str(owner)+','+str(ext_path)]}
            response=requests.post(BASE+'/session',json={'capabilities':{
                'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':opts}}},timeout=35)
            response.raise_for_status();payload=response.json()
            if payload.get('value',{}).get('error'):raise RuntimeError(str(payload))
            sid=payload['value'].get('sessionId') or payload.get('sessionId')
            assert sid
            ep=BASE+'/session/'+sid
            def wd(method,path,value=None):
                r=requests.request(method,ep+path,json=value,timeout=25)
                r.raise_for_status();data=r.json()['value']
                if isinstance(data,dict) and data.get('error'):raise RuntimeError(str(data))
                return data
            def js(script,*args):
                return wd('POST','/execute/sync',{'script':script,'args':list(args)})
            wd('POST','/url',{'url':f'chrome-extension://{EXT}/popup.html'})
            for _ in range(50):
                if js("return !!document.querySelector('#official-state')"):break
                time.sleep(.15)
            else:raise AssertionError('Companion popup not loaded under the expected stable ID')
            assert js("return document.querySelector('header strong').textContent")=='Proton VPN Helper'
            print('PASS loaded official-only companion under existing Helper extension ID')
            for _ in range(65):
                value=js("return chrome.proxy.settings.get({})")
                single=value.get('value',{}).get('rules',{}).get('singleProxy',{})
                if single.get('host')=='127.0.0.1' and single.get('port')==19013:break
                time.sleep(.2)
            else:raise AssertionError('Synthetic proxy owner did not configure test browser')
            initial=js("return chrome.proxy.settings.get({})")
            print('PASS real browser synthetic proxy configuration established')
            # Chrome-level precedence may call this controllable by this extension
            # even while another extension's proxy is configured. Do not infer owner.
            for _ in range(40):
                status=js("return chrome.runtime.sendMessage({action:'health'})")
                if status.get('proxyConfigured') and status.get('proxyMode')=='fixed_servers':break
                time.sleep(.15)
            else:raise AssertionError('Read-only proxy observation not working: '+str(status))
            assert status['providerConfirmed'] is False
            assert status['accountConfirmed'] is False
            assert status['countryRoutingSupported'] is False
            assert status['officialInstalled'] is False
            print('PASS read-only health monitoring never claims a verified Proton account or provider')
            for _ in range(45):
                countries=js("return document.querySelector('#country').options.length")
                if countries>=200:break
                time.sleep(.1)
            else:raise AssertionError('Original 2-letter flag-based desired country list missing')
            assert 'proxy observed' in js("return document.querySelector('#proxy-state').textContent").lower()
            assert js("return document.querySelector('#exit-check').disabled") is True
            print('PASS flags offered as unverified preferences, external probe disabled without official Proton')
            screenshot=os.environ.get('COMPANION_SCREENSHOT_PATH')
            if screenshot:
                from PIL import Image
                image=Image.open(io.BytesIO(base64.b64decode(wd('GET','/screenshot'),validate=True)))
                path=Path(screenshot);path.parent.mkdir(exist_ok=True,parents=True)
                image.crop((0,0,min(530,image.width),min(840,image.height))).save(path)
                print('PASS actual headless companion screenshot',path)
            js("""document.querySelector('#domain').value='sample.example.com';
                const select=document.querySelector('#country');select.value='CH';
                select.dispatchEvent(new Event('change',{bubbles:true}));
                document.querySelector('#save').click();return true;""")
            for _ in range(45):
                pol=js("return chrome.runtime.sendMessage({action:'policy'})")
                if any(r.get('domain')=='sample.example.com' and r.get('country')=='CH' for r in pol['rules']):break
                time.sleep(.15)
            else:raise AssertionError('Did not save desired preference')
            assert pol['enabled'] is False and pol['autoDetect'] is False and pol['autoRetry'] is False
            assert 'not applied' in js("return document.querySelector('#feedback').textContent").lower() or 'not changed' in js("return document.querySelector('#feedback').textContent").lower()
            assert js("return chrome.proxy.settings.get({})")['value']==initial['value']
            print('PASS saving a CH site preference cannot change existing proxy routing')
            # The earlier fork may have auto-routing saved as enabled.
            # Deliberately attempt to restore that dangerous legacy configuration.
            js("""return chrome.storage.local.set({protonSiteRouterPolicyV1:
                {version:1,enabled:true,autoDetect:true,autoRetry:true,
                 revision:9000000000000,candidates:['NL','CH'],rules:[
                 {domain:'example.com',country:'US',subdomains:true,source:'manual'}]}})""")
            pol=js("return chrome.runtime.sendMessage({action:'policy'})")
            assert not pol['enabled'] and not pol['autoDetect'] and not pol['autoRetry']
            assert js("return chrome.proxy.settings.get({})")['value']==initial['value']
            print('PASS unsafe legacy auto-routing flags cannot be activated')
            # Mutations cannot reach Proton's split tunnelling, private session or
            # proxy settings because no such implementation ships in this build.
            m=json.loads((ext_path/'manifest.json').read_text())
            assert m['background']['service_worker']=='js/background.js'
            assert m['background']['type']=='module'
            assert 'webRequestAuthProvider' not in m['permissions']
            assert 'scripting' not in m['permissions']
            assert m['externally_connectable']=={'ids':['jplgfhpmjnbigmhklmmbgecoobifkmpa']}
            tabs=js("return chrome.tabs.query({})")
            assert not any('onboarding' in (x.get('url') or '') for x in tabs)
            print('PASS no authentication UI, no second VPN proxy engine and no opened onboarding tabs')
            wd('POST','/url',{'url':f'chrome-extension://{EXT}/site-router.html'})
            for _ in range(40):
                if js("return !!document.querySelector('#saved-list')"):break
                time.sleep(.15)
            else:raise AssertionError('Advanced preferences page missing')
            assert 'preference' in js("return document.querySelector('h2').textContent").lower()
            assert 'not applied' in js("return document.querySelector('#saved-list').textContent").lower()
            assert js("return chrome.proxy.settings.get({})")['value']==initial['value']
            print('PASS advanced settings also describe saved rules as inactive')
        finally:
            if sid:
                try:requests.delete(BASE+'/session/'+sid,timeout=5)
                except requests.RequestException:pass
            driver.terminate()
            try:driver.wait(timeout=6)
            except subprocess.TimeoutExpired:driver.kill()

if __name__=='__main__':
    main()
