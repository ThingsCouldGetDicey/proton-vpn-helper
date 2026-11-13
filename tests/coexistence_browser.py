#!/usr/bin/env python3
"""Headless safety regression: Helper must not seize proxy from another extension."""
import json, os, requests, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
EXT_ID=(ROOT/'native/extension_id.txt').read_text().strip()
def run():
  with tempfile.TemporaryDirectory(prefix="proton-helper-coexist-") as td:
    root=Path(td); owner=root/'proxy-owner';owner.mkdir()
    (owner/'manifest.json').write_text(json.dumps({
      'manifest_version':3,'name':'Synthetic proxy owner','version':'1.0.0',
      'permissions':['proxy','storage'],'background':{'service_worker':'owner.js'}
    }))
    (owner/'owner.js').write_text("""
chrome.runtime.onInstalled.addListener(async()=>{
  await chrome.proxy.settings.set({value:{mode:'fixed_servers',
    rules:{singleProxy:{scheme:'http',host:'127.0.0.1',port:19013}}},scope:'regular'});
});
""")
    profile=root/'profile'
    driver_port=19451
    base=f'http://127.0.0.1:{driver_port}'
    driver=subprocess.Popen(['chromedriver',f'--port={driver_port}','--allowed-ips=127.0.0.1',
      '--log-level=SEVERE'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    sid=None
    try:
      for _ in range(85):
        try:
          if requests.get(base+'/status',timeout=.5).status_code==200:break
        except requests.RequestException:pass
        time.sleep(.12)
      else:raise RuntimeError('Driver unavailable')
      options={'binary':'/usr/bin/chromium','args':['--headless=new','--no-sandbox',
        '--disable-gpu','--disable-dev-shm-usage','--disable-background-networking',
        '--no-first-run','--no-default-browser-check','--user-data-dir='+str(profile),
        '--load-extension='+str(owner)+','+str(ROOT/'distribution'),
        '--disable-extensions-except='+str(owner)+','+str(ROOT/'distribution')]}
      response=requests.post(base+'/session',json={'capabilities':{'alwaysMatch':{
        'browserName':'chrome','goog:chromeOptions':options}}},timeout=35)
      response.raise_for_status()
      data=response.json()
      sid=data['value'].get('sessionId') or data.get('sessionId')
      if not sid:raise RuntimeError(str(data)[:800])
      ep=base+'/session/'+sid
      def wd(method,path,payload=None):
        r=requests.request(method,ep+path,json=payload,timeout=17)
        r.raise_for_status()
        v=r.json()['value']
        if isinstance(v,dict) and v.get('error'):raise RuntimeError(str(v))
        return v
      def js(script):
        return wd('POST','/execute/sync',{'script':script,'args':[]})
      wd('POST','/url',{'url':f'chrome-extension://{EXT_ID}/helper-popup.html'})
      for _ in range(50):
        if js("return !!document.querySelector('#vpn-status')"):break
        time.sleep(.1)
      else:raise AssertionError('Helper not loaded alongside second extension')
      time.sleep(2)
      tabs=js("return chrome.tabs.query({})")
      assert not any((x.get('url') or '').endswith('/onboarding.html') for x in tabs),tabs
      print('PASS no automatic onboarding tab when helper is installed')
      health=js("return chrome.runtime.sendMessage({type:'protonSiteRouterHealth'})")
      assert health['signedIn'] is False and health['connected'] is False,health
      state=js("return chrome.proxy.settings.get({})")
      mode=state.get('value',{}).get('mode')
      details=state.get('levelOfControl')
      assert mode=='fixed_servers',state
      single=state.get('value',{}).get('rules',{}).get('singleProxy',{})
      assert single.get('host')=='127.0.0.1' and single.get('port')==19013, state
      print('PASS installed helper preserved exact synthetic proxy endpoint 127.0.0.1:19013',details,mode)
    finally:
      if sid:
        try:requests.delete(base+'/session/'+sid,timeout=6)
        except requests.RequestException:pass
      driver.terminate()
      try:driver.wait(timeout=6)
      except subprocess.TimeoutExpired:driver.kill()
if __name__=='__main__':run()
