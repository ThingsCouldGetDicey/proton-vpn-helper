#!/usr/bin/env python3
"""Real headless Chromium tests of an *authorised synthetic bridge endpoint*.

This uses temporary test extensions with ephemeral public keys and NO Proton
account, network credentials, or actual VPN access. The installed official
Proton extension, user profile and browser tabs are NEVER touched.
"""
import base64
import hashlib
import json
import requests
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ROOT=Path(__file__).resolve().parents[1]
HELPER_ID=(ROOT/'native/extension_id.txt').read_text().strip()
PORT=19519
BASE=f'http://127.0.0.1:{PORT}'
PROTOCOL='proton-vpn-helper/1'

def test():
    with tempfile.TemporaryDirectory(prefix='proton-authorised-bridge-mock-') as work:
        root=Path(work);mock=root/'synthetic-provider';mock.mkdir()
        public=rsa.generate_private_key(public_exponent=65537,key_size=2048).public_key()
        key=public.public_bytes(serialization.Encoding.DER,
          serialization.PublicFormat.SubjectPublicKeyInfo)
        mock_id=''.join('abcdefghijklmnop'[x] for b in hashlib.sha256(key).digest()[:16]
          for x in (b>>4,b&15))
        (mock/'manifest.json').write_text(json.dumps({
          'manifest_version':3,'name':'SYNTHETIC TEST ONLY - not Proton',
          'version':'0.0.1','key':base64.b64encode(key).decode(),
          'permissions':['storage'],
          'background':{'service_worker':'worker.js'},
          'externally_connectable':{'ids':[HELPER_ID]}
        }))
        (mock/'control.html').write_text('<!doctype html><title>TEST PROVIDER ONLY</title>')
        (mock/'worker.js').write_text("""
const HELPER='""" + HELPER_ID + """',PROTO='proton-vpn-helper/1';
chrome.runtime.onMessageExternal.addListener((request,sender,reply)=>{
  if(sender.id!==HELPER||request?.protocol!==PROTO||
    !/^[0-9a-f]{32}$/.test(request.nonce)||typeof request.action!=='string')return false;
  void (async()=>{
    const settings=await chrome.storage.local.get(['grant','signedIn','routing','routes']);
    const grant=settings.grant===true, signedIn=settings.signedIn===true,
      routing=settings.routing===true;
    const base={protocol:PROTO,action:request.action,nonce:request.nonce};
    switch(request.action){
      case 'hello': return {...base,ok:true,delegated:grant,
        accountSignedIn:grant&&signedIn,vpnConnected:grant&&signedIn,
        defaultCountry:grant&&signedIn?'CH':null,
        countryRoutingSupported:grant&&signedIn&&routing,
        countriesAvailable:grant&&signedIn};
      case 'listCountries':
        if(!grant||!signedIn)return {...base,ok:false,reason:'Consent absent'};
        return {...base,ok:true,countries:[
          {code:'CH',name:'Switzerland',available:true,locked:false},
          {code:'US',name:'United States',available:false,locked:true}]};
      case 'setWebsiteCountry':
        if(!grant||!signedIn||!routing)return {...base,ok:false,reason:'Not authorised'};
        if(request.domain!=='example.com'||request.country!=='CH')
          return {...base,ok:false,reason:'Invalid test target'};
        await chrome.storage.local.set({routes:{[request.domain]:request.country}});
        return {...base,ok:true,applied:true};
      case 'removeWebsiteCountry':
        if(!grant||!signedIn||!routing)return {...base,ok:false,reason:'Not authorised'};
        await chrome.storage.local.remove('routes');
        return {...base,ok:true,applied:true};
      default:return {...base,ok:false,reason:'Unsupported'};
    }
  })().then(reply).catch(()=>reply({protocol:PROTO,action:request.action,
    nonce:request.nonce,ok:false,reason:'Test error'}));
  return true;
});
""")
        companion=root/'helper-test-build'
        shutil.copytree(ROOT/'distribution-companion',companion)
        shared=companion/'js/shared.js'
        text=shared.read_text()
        assert "'jplgfhpmjnbigmhklmmbgecoobifkmpa'" in text
        shared.write_text(text.replace("'jplgfhpmjnbigmhklmmbgecoobifkmpa'",
          "'"+mock_id+"'"))
        manifest=json.loads((companion/'manifest.json').read_text())
        manifest['externally_connectable']['ids']=[mock_id]
        (companion/'manifest.json').write_text(json.dumps(manifest))
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
            args=['--headless=new','--no-sandbox','--disable-gpu',
              '--disable-dev-shm-usage','--disable-background-networking',
              '--no-first-run','--no-default-browser-check',
              '--user-data-dir='+str(root/'profile'),
              '--load-extension='+str(mock)+','+str(companion),
              '--disable-extensions-except='+str(mock)+','+str(companion)]
            session=requests.post(BASE+'/session',json={'capabilities':{
              'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{
                'binary':'/usr/bin/chromium','args':args}}}},timeout=35)
            session.raise_for_status();data=session.json()['value']
            sid=data.get('sessionId')
            if not sid:raise RuntimeError(str(data)[:500])
            ep=BASE+'/session/'+sid
            def wd(method,path,value=None):
                result=requests.request(method,ep+path,json=value,timeout=28)
                result.raise_for_status()
                result=result.json()['value']
                if isinstance(result,dict) and result.get('error'):
                    raise RuntimeError(str(result))
                return result
            def go(url):
                wd('POST','/url',{'url':url})
            def js(script,*args):
                return wd('POST','/execute/sync',{'script':script,'args':list(args)})
            helper_url=f'chrome-extension://{HELPER_ID}/popup.html'
            mock_url=f'chrome-extension://{mock_id}/control.html'
            go(mock_url)
            assert js("return document.title")=='TEST PROVIDER ONLY'
            go(helper_url)
            for _ in range(50):
                if js("return !!document.querySelector('#bridge-state')"):break
                time.sleep(.15)
            else:raise AssertionError('Companion UI did not load')
            before=js("return chrome.runtime.sendMessage({action:'refresh'})")
            assert before['bridge']['linked'] is False,before
            assert before['bridge']['accountSignedIn'] is False
            assert before['countryRoutingSupported'] is False
            print('PASS unconsented synthetic provider cannot make Helper claim signed-in')

            go(mock_url)
            js("return chrome.storage.local.set({grant:true,signedIn:true,routing:false})")
            go(helper_url)
            connected=js("return chrome.runtime.sendMessage({action:'refresh'})")
            assert connected['bridge']['linked'] is True,connected
            assert connected['bridge']['accountSignedIn'] is True
            assert connected['bridge']['defaultCountry']=='CH'
            assert connected['countryRoutingSupported'] is False
            catalogue=js("return chrome.runtime.sendMessage({action:'countries'})")
            assert catalogue['ok'] is True
            assert len(catalogue['countries'])==2
            assert catalogue['countries'][1]['available'] is False
            go(helper_url)
            for _ in range(50):
                if js("return document.querySelector('#country').options.length")==3:break
                time.sleep(.12)
            else:raise AssertionError('UI did not display mock provider catalogue')
            assert 'bridge authorised' in js("return document.querySelector('#bridge-state').textContent").lower()
            assert js("return document.querySelector('#apply').disabled") is True
            reject=js("return chrome.runtime.sendMessage({action:'apply',domain:'example.com',country:'CH'})")
            assert reject['ok'] is False,reject
            print('PASS consenting to session sync mirrors nonsecret provider state and locked countries')
            print('PASS no country-routing operation without provider feature support')

            go(mock_url)
            js("return chrome.storage.local.set({routing:true})")
            js("return chrome.runtime.sendMessage(arguments[0],{protocol:'proton-vpn-helper/1',action:'statusChanged'})",HELPER_ID)
            go(helper_url)
            updated=js("return chrome.runtime.sendMessage({action:'refresh'})")
            assert updated['bridge']['linked'] and updated['countryRoutingSupported']
            js("""document.querySelector('#domain').value='example.com';
               document.querySelector('#country').value='CH';
               document.querySelector('#country').dispatchEvent(new Event('change',{bubbles:true}));
               return true;""")
            for _ in range(40):
                if js("return document.querySelector('#apply').disabled") is False:break
                time.sleep(.15)
            else:raise AssertionError('Authorised synthetic routing button did not activate')
            js("document.querySelector('#apply').click();return true;")
            for _ in range(35):
                if 'accepted' in js("return document.querySelector('#feedback').textContent").lower():break
                time.sleep(.15)
            else:raise AssertionError('Authorised mock routing acknowledgement not shown')
            go(mock_url)
            routes=js("return chrome.storage.local.get('routes').then(v=>v.routes)")
            assert routes=={'example.com':'CH'},routes
            print('PASS synthetic provider receives authorised site-country route via two-way extension messaging')

            js("return chrome.storage.local.set({grant:false})")
            js("return chrome.runtime.sendMessage(arguments[0],{protocol:'proton-vpn-helper/1',action:'statusChanged'})",HELPER_ID)
            go(helper_url)
            after=js("return chrome.runtime.sendMessage({action:'refresh'})")
            assert after['bridge']['linked'] is False,after
            assert after['bridge']['accountSignedIn'] is False
            assert after['countryRoutingSupported'] is False
            assert js("return document.querySelector('#apply').disabled") is True
            refused=js("return chrome.runtime.sendMessage({action:'apply',domain:'example.com',country:'CH'})")
            assert refused['ok'] is False
            print('PASS Proton-side revocation immediately prevents future helper operations')
            print('SYNTHETIC_BRIDGE_TEST_COMPLETE: NO PROTON NETWORK OR ACCOUNT INVOLVED')
        finally:
            if sid:
                try:requests.delete(ep,timeout=5)
                except requests.RequestException:pass
            driver.terminate()
            try:driver.wait(timeout=6)
            except subprocess.TimeoutExpired:driver.kill()

if __name__=='__main__':
    test()
