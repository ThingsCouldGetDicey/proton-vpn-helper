#!/usr/bin/env python3
"""Real Chromium isolated-profile integration of the unpacked extension and native bridge."""
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
import requests
import shutil

ROOT = Path(__file__).resolve().parents[1]
EXT_ID = (ROOT / "native/extension_id.txt").read_text().strip()
PORT = 19267
URL = f"http://127.0.0.1:{PORT}"
POLICY_KEY = "protonSiteRouterPolicyV1"

def main():
    with tempfile.TemporaryDirectory(prefix="proton-site-router-test-") as td:
        env = os.environ.copy()
        env["XDG_STATE_HOME"] = td + "/state"
        profile = td + "/profile"
        # Chromium resolves native hosts inside the active browser user-data-dir.
        # The test uses an isolated profile rather than the user's live profile.
        host_dir = Path(profile) / "NativeMessagingHosts"
        host_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Path.home() / ".config/chromium/NativeMessagingHosts/com.local.proton_site_router.json",
                        host_dir / "com.local.proton_site_router.json")
        out = open("/tmp/proton-site-router-chromedriver-debug.log","w")
        driver = subprocess.Popen(["chromedriver",f"--port={PORT}","--allowed-ips=127.0.0.1",
                                   "--log-level=SEVERE"],stdout=out,stderr=subprocess.STDOUT,env=env)
        session = None
        try:
            for _ in range(45):
                try:
                    if requests.get(URL + "/status",timeout=0.5).status_code == 200: break
                except requests.RequestException: pass
                time.sleep(0.2)
            else: raise RuntimeError("ChromeDriver not ready; logs: " + Path("/tmp/proton-site-router-chromedriver-debug.log").read_text()[:1000])
            caps={"capabilities":{"alwaysMatch":{"browserName":"chrome",
                "goog:chromeOptions":{"binary":"/usr/bin/chromium","args":[
                    "--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
                    "--disable-first-run","--no-first-run","--disable-background-networking",
                    "--no-default-browser-check","--window-size=1350,1060","--user-data-dir="+profile,
                    "--load-extension="+str(ROOT/"distribution"),
                    "--disable-extensions-except="+str(ROOT/"distribution"),
                ]}}}}
            resp=requests.post(URL+"/session",json=caps,timeout=30)
            resp.raise_for_status()
            body=resp.json()
            if body.get("value",{}).get("error"): raise RuntimeError(str(body))
            session=body["value"].get("sessionId") or body.get("sessionId")
            assert session
            ep=URL+"/session/"+session
            def wd(method,endpoint,payload=None):
                r=requests.request(method,ep+endpoint,json=payload,timeout=25)
                r.raise_for_status()
                val=r.json().get("value")
                if isinstance(val,dict) and val.get("error"): raise RuntimeError(str(val))
                return val
            def js(code,*args): return wd("POST","/execute/sync",{"script":code,"args":args})
            wd("POST","/url",{"url":f"chrome-extension://{EXT_ID}/site-router.html"})
            for _ in range(30):
                if js("return !!document.querySelector('#add-rule')"): break
                time.sleep(0.2)
            else: raise RuntimeError("Options page did not render")
            print("PASS isolated Chromium loaded the actual unpacked extension")
            probe=js("return new Promise(done=>chrome.runtime.sendNativeMessage('com.local.proton_site_router',{action:'status'},r=>done({reply:r||null,error:chrome.runtime.lastError?.message||null})))")
            print("NATIVE_HOST_PROBE", json.dumps(probe, sort_keys=True))
            assert js("return document.querySelector('#rule-count').textContent") == "0"
            js("""document.getElementById('domain').value = 'sample.example.com';
                  document.getElementById('country').value = 'CH';
                  document.getElementById('add-rule').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
                  return true;""")
            for _ in range(45):
                p=js("return new Promise(done => chrome.storage.local.get(arguments[0]).then(v => done(v[arguments[0]] || null)))", POLICY_KEY)
                if p and p.get("rules") and p["rules"][0]["country"]=="CH": break
                time.sleep(.3)
            else: raise RuntimeError("Browser did not store routing rule")
            assert p["rules"][0]["domain"]=="sample.example.com"
            print("PASS UI submission saves validated country rule inside Chrome storage")
            for _ in range(40):
                policy_file=Path(env["XDG_STATE_HOME"])/"proton-site-router/rules.json"
                if policy_file.exists():
                    q=json.loads(policy_file.read_text())
                    if q["rules"] and q["rules"][0]["country"]=="CH":break
                time.sleep(.3)
            else:
                raise RuntimeError("Native messaging did not push the rule into local policy")
            print("PASS native messaging sync Chrome -> isolated MCP policy file")
            screenshot_path = os.environ.get("README_SCREENSHOT_PATH")
            if screenshot_path:
                # Documentation evidence must come from the REAL loaded options page,
                # with a saved rule visibly rendered. Never substitute a mock-up.
                import base64
                displayed = js("return !!document.querySelector('.rule-name') && document.querySelector('.rule-name').textContent === 'sample.example.com'")
                assert displayed, "Options screenshot refused: rule not visible in browser UI"
                result = wd("GET", "/screenshot")
                image_bytes = base64.b64decode(result, validate=True)
                assert image_bytes[:8] == bytes([137,80,78,71,13,10,26,10]), "Not a PNG screenshot"
                destination = Path(screenshot_path)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(image_bytes)
                print("PASS documentation screenshot captured from actual Chromium options", destination)
            if os.environ.get("SHORT_QA") == "1":
                # Documentation screenshot is captured before rule removal.
                # Verify the Remove control really clears browser and native state.
                clicked = js("""const b = document.querySelector('button[data-remove="sample.example.com"]');
                    if (!b) return false;
                    b.click();
                    return true;""")
                assert clicked, "Remove button missing"
                for _ in range(40):
                    updated = js("return new Promise(done => chrome.storage.local.get(arguments[0]).then(v => done(v[arguments[0]] || null)))", POLICY_KEY)
                    if updated and not updated.get("rules"):
                        break
                    time.sleep(.2)
                else:
                    raise RuntimeError("Remove button did not clear browser policy")
                for _ in range(40):
                    current = json.loads(policy_file.read_text())
                    if not current["rules"]:
                        break
                    time.sleep(.2)
                else:
                    raise RuntimeError("Remove button did not sync removal to native host")
                print("PASS remove control clears browser rule and native policy file")
                return
            q["revision"] += 100000
            q["rules"][0]["country"] = "NL"
            policy_file.write_text(json.dumps(q))
            # Alarm sync is every 60 seconds; use explicit browser restart or wait for alarm.
            for _ in range(90):
                browser_policy=js("return new Promise(done => chrome.storage.local.get(arguments[0]).then(v => done(v[arguments[0]] || null)))", POLICY_KEY)
                if browser_policy and browser_policy["rules"][0]["country"]=="NL": break
                time.sleep(.8)
            else: raise RuntimeError("Native -> Chrome update did not propagate")
            print("PASS MCP/native policy change -> browser extension after alarm")
        finally:
            if session:
                try: requests.delete(URL+"/session/"+session,timeout=4)
                except requests.RequestException: pass
            driver.terminate()
            try:driver.wait(timeout=8)
            except subprocess.TimeoutExpired:driver.kill()
            out.close()
if __name__ == "__main__":
    main()
