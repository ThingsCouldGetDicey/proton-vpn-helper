'use popup';
import {SPLIT_CONSENT_KEY,hasSplitConsent,setSplitConsent} from './splitConsent';
import {STORE_KEY} from './policy';

/** Shares precisely the same permission with the Helper toolbar.
 * Delegation can also be granted from the extension's advanced settings page
 * when the account sign-in view prevents access to Proton's normal controls.
 */
export function installProtonSplitConsentUi(root:ParentNode=document):void {
  const toggle=root.querySelector<HTMLInputElement>('#helper-manage-split');
  const status=root.querySelector<HTMLElement>('#helper-delegation-status');
  const splitPage=root.querySelector<HTMLElement>('[data-page="split-tunneling"]');
  const open=root.querySelector<HTMLButtonElement>('#helper-manage-open');
  root.querySelector<HTMLButtonElement>('#helper-open-signedout-settings')?.addEventListener('click',()=>{
    void chrome.tabs.create({url:chrome.runtime.getURL('site-router.html')});
  });
  if (!toggle || !status) return;
  let updating=false;
  let allowedNow=false;
  // When delegated, prevent the old editor from silently racing the Helper.
  // Capture-phase protection also covers dynamically recreated Proton buttons.
  splitPage?.addEventListener('click',event=>{
    if(!allowedNow)return;
    const clicked=event.target;
    if(!(clicked instanceof Element))return;
    if(clicked.closest('[data-st-action],[data-st-delete-index],.split-tunneling-mode-switch')){
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },true);
  let summarySequence=0;
  const paint=(allowed:boolean):void=>{
    allowedNow=allowed;
    toggle.checked=allowed;
    status.textContent=allowed
      ? 'Helper management permitted. Proton still controls the VPN connection; the Helper may manage website exceptions and country rules. Switch off to revoke permission.'
      : 'Helper management disabled. Existing preferences are kept but not applied. Proton split tunnelling remains under your control.';
    splitPage?.classList.toggle('helper-split-delegated',allowed);
    if (open) open.hidden=!allowed;
    // Shared state is two-way: a new rule saved from the Helper also updates
    // the original Proton Split tunnelling page without copying any secrets.
    const seq=++summarySequence;
    void chrome.storage.local.get(STORE_KEY).then(data=>{
      if(seq!==summarySequence||!allowedNow)return;
      const saved=data[STORE_KEY] as {rules?:unknown}|undefined;
      const count=Array.isArray(saved?.rules) ? saved.rules.length : 0;
      status.textContent='Helper management permitted · '+count+' website country '+
        (count===1?'rule':'rules')+' saved. Proton controls VPN connections. Switch off to revoke permission.';
    }).catch(()=>undefined);
  };
  void hasSplitConsent().then(paint).catch(()=>{
    toggle.checked=false;
    status.textContent='Permission could not be checked; Helper management is inactive.';
  });
  toggle.addEventListener('change',()=>{
    if(updating)return;
    updating=true;
    const requested=toggle.checked;
    toggle.disabled=true;
    void setSplitConsent(requested).then(()=>{
      paint(requested);
    }).catch(()=>{
      paint(!requested);
      status.textContent='Permission could not be changed. No additional access granted.';
    }).finally(()=>{updating=false;toggle.disabled=false;});
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes[SPLIT_CONSENT_KEY] && !updating){
      paint(changes[SPLIT_CONSENT_KEY].newValue === true);
    }else if(changes[STORE_KEY]){
      paint(allowedNow);
    }
  });
  open?.addEventListener('click',()=>{
    void chrome.tabs.create({url:chrome.runtime.getURL('site-router.html')});
  });
}
