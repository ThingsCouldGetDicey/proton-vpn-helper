#!/usr/bin/env python3
"""Headless Chromium profile migration from old Helper ID to passive companion.

Legacy phase is a synthetic no-network extension with same public signing key.
Never starts the actual old Proton fork or touches a real browser profile.
"""
import json
import requests
import subprocess
import tempfile
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ID=(ROOT/'native/extension_id.txt').read_text().strip()
PORT=19517
BASE=f'http://127.0.0.1:{PORT}'
def main():
  with tempfile.TemporaryDirectory(prefix='proton-helper-profile-upgrade-') as folder:
    path=Path(folder)
    old=path/'old-helper';old.mkdir()
    previous=json.loads((ROOT/'source/manifest.json').read_text())
    (old/'manifest.json').write_text(json.dumps({
      'manifest_version':3,'name':'Legacy Helper Simulation','version':'1.3.6.9',
      'key':previous['key'],'permissions':['storage'],
      'action':{'default_popup':'popup.html'}}))
    (old/'popup.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body>Old Helper</body></html>')
    profile=path/'profile'
    driver=subprocess.Popen(['chromedriver',f'--port={PORT}','--allowed-ips=127.0.0.1',
      '--log-level=SEVERE'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    sid=None
    def wd(method,path,payload=None):
      response=requests.request(method,BASE+path,json=payload,timeout=35)
      response.raise_for_status()
      data=response.json()['value']
      if isinstance(data,dict) and data.get('error'):raise RuntimeError(str(data))
      return data
    def session(ext):
      data=wd('POST','/session',{'capabilities':{'alwaysMatch':{
        'browserName':'chrome','goog:chromeOptions':{
          'binary':'/usr/bin/chromium','args':[
            '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
            '--disable-first-run','--no-default-browser-check','--disable-background-networking',
            '--user-data-dir='+str(profile),
            '--load-extension='+str(ext),'--disable-extensions-except='+str(ext)]
        }}}})
      return data.get('sessionId')
    def execute(sid,script):
      return wd('POST','/session/'+sid+'/execute/sync',
        {'script':script,'args':[]})
    try:
      for _ in range(75):
        try:
          if requests.get(BASE+'/status',timeout=.5).status_code==200:break
        except requests.RequestException:pass
        time.sleep(.15)
      else:raise RuntimeError('Driver unavailable')
      sid=session(old)
      assert sid
      wd('POST','/session/'+sid+'/url',{'url':f'chrome-extension://{ID}/popup.html'})
      assert execute(sid,'return document.body.textContent.includes("Old Helper")')
      execute(sid,"""return chrome.storage.local.set({
        session:{uid:'FAKE_LEGACY_UID',refreshToken:'FAKE_LEGACY_TOKEN'},
        oldProxyCredentials:{Username:'FAKE_USER',Password:'FAKE_PASS'},
        cachedAccessToken:'FAKE_SECRET',
        protonSiteRouterPolicyV1:{version:1,enabled:true,autoDetect:true,autoRetry:true,
          revision:7,candidates:['NL'],rules:[{
            domain:'example.com',country:'CH',subdomains:true,source:'manual'}]}
        })""")
      assert execute(sid,"return chrome.storage.local.get('session').then(x=>Boolean(x.session))")
      print('PASS synthetic legacy Helper created with the exact existing extension ID and local saved state')
      wd('DELETE','/session/'+sid);sid=None
      # Same persistent Chrome profile; only the path to the Helper changes.
      sid=session(ROOT/'distribution-companion')
      assert sid
      wd('POST','/session/'+sid+'/url',{'url':f'chrome-extension://{ID}/popup.html'})
      for _ in range(70):
        result=execute(sid,"return document.querySelector('header strong')?.textContent")
        if result=='Proton VPN Helper':break
        time.sleep(.15)
      else:raise AssertionError('Passive companion not loaded under legacy extension ID: '+str(result))
      for _ in range(45):
        x=execute(sid,"""return chrome.storage.local.get(['session','protonSiteRouterPolicyV1'])""")
        value=x.get('protonSiteRouterPolicyV1',{})
        if not x.get('session') and value and value.get('enabled') is False:break
        time.sleep(.15)
      else:raise AssertionError('Sensitive legacy session or enabled policy remains: '+str(x))
      assert value['autoRetry'] is False and value['autoDetect'] is False
      assert any(r['domain']=='example.com' and r['country']=='CH' for r in value['rules'])
      keys=execute(sid,'return chrome.storage.local.get(null).then(x=>Object.keys(x))')
      assert 'oldProxyCredentials' not in keys and 'cachedAccessToken' not in keys,keys
      assert 'officialProtonCompanionMigrationV1' in keys
      print('PASS legacy Helper-only cached credentials and tokens securely removed from extension storage')
      print('PASS reused the existing profile and extension ID without any new account login')
      print('PASS old Helper-only Proton session deleted; saved country preferences retained')
      print('PASS legacy auto-routing and automatic retries permanently switched off in storage')
      manifest=execute(sid,"return chrome.runtime.getManifest()")
      assert manifest['version']=='1.4.1'
      assert 'webRequestAuthProvider' not in manifest['permissions']
      assert manifest['externally_connectable']=={'ids':['jplgfhpmjnbigmhklmmbgecoobifkmpa']}
      print('PASS installed companion manifest lacks the second Proton VPN engine')
    finally:
      if sid:
        try:wd('DELETE','/session/'+sid)
        except requests.RequestException:pass
      driver.terminate()
      try:driver.wait(timeout=6)
      except subprocess.TimeoutExpired:driver.kill()
if __name__=='__main__':
  main()
