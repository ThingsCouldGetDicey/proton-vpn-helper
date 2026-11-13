import {domainFrom,preferenceFor} from './shared.js';

const $=id=>document.getElementById(id);
let countries=[];
let fallbackCountries=[];
let providerCatalogueAt=0;
let saved={rules:[]};
let currentHealth=null;
const labels=typeof Intl.DisplayNames==='function' ?
  new Intl.DisplayNames([navigator.language||'en'],{type:'region'}) : null;
function tell(value){$('feedback').textContent=value;}
function request(action,fields={}) {
  return chrome.runtime.sendMessage({action,...fields}).then(value=>{
    if(!value||value.error)throw new Error(value?.error||'Helper background unavailable');
    return value;
  });
}
function activeHost(){
  return chrome.tabs.query({active:true,lastFocusedWindow:true}).then(tabs=>{
    try {
      const url=new URL(tabs[0]?.url||'');
      if(!['https:','http:'].includes(url.protocol))return '';
      return domainFrom(url.hostname);
    }catch{return '';}
  });
}
function displayName(code){
  if(!labels)return code;
  const result=labels.of(code);
  return result&&result!==code?result:code;
}
function flag(code){
  const tag=$('flag');
  const found=countries.find(c=>c.code===code);
  if(!found){tag.hidden=true;tag.removeAttribute('src');return;}
  tag.src='img/flags/'+code.toLowerCase()+'.svg';
  tag.hidden=false;
}
function displayCountries(){
  const select=$('country');
  const old=select.value;
  const filter=$('search').value.trim().toLowerCase();
  select.replaceChildren(new Option('Select desired country',''));
  for(const c of countries){
    if(filter && !c.name.toLowerCase().includes(filter) &&
      !c.code.toLowerCase().includes(filter))continue;
    const integrated=currentHealth?.bridge?.linked===true &&
      currentHealth?.bridge?.countriesAvailable===true;
    const option=new Option(c.name+' ('+c.code+')'+
      (integrated&&!c.available?' · Unavailable':''),
      c.code);
    select.add(option);
  }
  if(old&&[...select.options].some(o=>o.value===old))select.value=old;
  flag(select.value);
}
async function initCountries(){
  const codes=await fetch(chrome.runtime.getURL('countries.json')).then(r=>r.json());
  fallbackCountries=codes.filter(code=>/^[A-Z]{2}$/.test(code))
    .map(code=>({code,name:displayName(code),available:false}))
    .sort((a,b)=>a.name.localeCompare(b.name));
  countries=fallbackCountries;
  displayCountries();
}
function canApply(){
  const bridge=currentHealth?.bridge;
  return !!(bridge?.linked&&bridge?.delegated&&bridge?.accountSignedIn&&
    bridge?.vpnConnected&&bridge?.countryRoutingSupported&&
    countries.some(c=>c.code===$('country').value&&c.available));
}
function updateApply(){$('apply').disabled=!canApply();}
function bridgeText(bridge){
  if(bridge?.linked){
    return bridge.accountSignedIn?
      ('Proton bridge authorised · signed in'+
      (bridge.defaultCountry?' · default country '+bridge.defaultCountry:'')+
      (bridge.countryRoutingSupported?' · website routing supported':
        ' · website-country switching not supported')):
      'Proton bridge authorised, but official account is signed out.';
  }
  return bridge?.status==='consent-required'?
    'Proton has not granted Helper consent. Authorise it inside Proton settings.':
    'Installed official Proton does not offer the Helper bridge yet. Account sign-in is private.';
}
async function refreshProviderCatalogue(){
  const bridge=currentHealth?.bridge;
  if(!(bridge?.linked&&bridge?.countriesAvailable)){
    countries=fallbackCountries;providerCatalogueAt=0;
    displayCountries();updateApply();return;
  }
  if(Date.now()-providerCatalogueAt<60_000)return;
  providerCatalogueAt=Date.now();
  try{
    const data=await request('countries');
    if(data.ok!==true||!Array.isArray(data.countries))throw new Error('Not available');
    const old=$('country').value;
    countries=data.countries.map(c=>({
      code:c.code,name:c.name,available:c.available===true,locked:c.locked===true
    })).sort((a,b)=>a.name.localeCompare(b.name));
    displayCountries();
    if(old&&countries.some(c=>c.code===old))$('country').value=old;
    flag($('country').value);
  }catch{
    countries=fallbackCountries;providerCatalogueAt=0;displayCountries();
  }
  updateApply();
}
async function applyViaProton(){
  if(!canApply()){tell('Official Proton has not authorised site-country routing. Preferences remain inactive.');return;}
  $('apply').disabled=true;
  try{
    const result=await request('apply',{
      domain:domainFrom($('domain').value),
      country:$('country').value,subdomains:$('subdomains').checked
    });
    if(!result.ok||!result.applied)throw new Error(result.reason||'Proton did not accept the route');
    tell('Official Proton bridge accepted the route. Exit-IP and leak verification remain necessary.');
  }catch(e){tell('Proton route not applied: '+String(e.message));}
  finally{updateApply();}
}
function healthText(health){
  $('official-state').textContent=health.officialInstalled ?
    (health.officialEnabled
      ? 'Official Proton VPN extension detected and enabled'
      : 'Official Proton VPN is installed but disabled')
    : 'Official Proton VPN extension not detected';
  $('bridge-state').textContent=bridgeText(health.bridge);
  updateApply();
  const mode=health.proxyMode||'unknown';
  $('proxy-state').textContent=health.proxyConfigured ?
    'Browser proxy observed ('+mode+'). Owner, Proton sign-in and subscription cannot be verified.'
    : 'No configured browser proxy observed ('+mode+'). Proton session status is private.';
  $('exit-check').disabled=!(health.officialInstalled && health.officialEnabled &&
    health.proxyConfigured && health.proxyControl!=='controlled_by_this_extension');
  if(health.exit){
    $('exit-result').textContent='Observed browser IP: '+health.exit.ip+
      ', country: '+health.exit.country+
      '. This does not prove Proton owns the proxy or protect other traffic.';
  }
}
async function refreshHealth(){
  try {
    currentHealth=await request('health');
    healthText(currentHealth);
    await refreshProviderCatalogue();
  }catch{
    $('official-state').textContent='Official Proton observation unavailable';
    $('proxy-state').textContent='VPN connection not verified';
    $('exit-check').disabled=true;
  }
}
async function loadPolicy(){
  saved=await request('policy');
  renderRules();
  chooseExisting();
}
function chooseExisting(){
  let host;
  try{host=domainFrom($('domain').value);}
  catch{flag('');return;}
  const pref=preferenceFor(host,saved);
  if(pref){
    // Keep an existing saved preference selectable even if the search is active.
    $('search').value='';
    displayCountries();
    $('country').value=pref.country;
    $('subdomains').checked=pref.subdomains;
  }else{$('country').value='';}
  flag($('country').value);
}
function renderRules(){
  const list=$('saved-list');
  if(!list)return;
  list.replaceChildren();
  if(!saved.rules.length){
    const li=document.createElement('li');
    li.textContent='No preferred countries saved.';
    list.append(li);return;
  }
  for(const rule of saved.rules){
    const li=document.createElement('li');
    const img=document.createElement('img');
    img.src='img/flags/'+rule.country.toLowerCase()+'.svg';img.alt='';
    const label=document.createElement('span');
    label.textContent=rule.domain+' · '+displayName(rule.country);
    const desc=document.createElement('small');
    desc.textContent='Preference only · Not applied to Proton traffic';
    label.append(desc);
    const btn=document.createElement('button');
    btn.textContent='Remove';btn.type='button';
    btn.addEventListener('click',()=>{
      void request('remove',{domain:rule.domain}).then(loadPolicy)
        .then(()=>tell('Preference removed; official Proton unchanged.'))
        .catch(err=>tell(String(err.message)));
    });
    li.append(img,label,btn);list.append(li);
  }
}
async function save(){
  try {
    const domain=domainFrom($('domain').value);
    const country=$('country').value;
    if(!countries.some(item=>item.code===country))
      throw new Error('Select a country from the list');
    await request('save',{domain,country,subdomains:$('subdomains').checked});
    await loadPolicy();
    tell('Saved locally as a preference only. Official Proton routing was not changed.');
  }catch(e){tell(String(e.message));}
}
async function remove(){
  try{
    const domain=domainFrom($('domain').value);
    await request('remove',{domain});
    await loadPolicy();
    tell('Preference removed; official Proton connection unchanged.');
  }catch(e){tell(String(e.message));}
}
async function verifyExit(){
  const button=$('exit-check');button.disabled=true;
  $('exit-result').textContent='Checking observed browser public IP via country.is…';
  try {
    const result=await request('exit-check');
    if(!result.ok)throw new Error(result.reason||'Not verified');
    $('exit-result').textContent='Observed browser IP: '+result.exit.ip+
      ' · country '+result.exit.country+
      '. Provider ownership and leak protection not established.';
  }catch(e){$('exit-result').textContent='Exit check unavailable: '+String(e.message);}
  finally{await refreshHealth();}
}
async function init(){
  await initCountries();
  $('domain').value=await activeHost();
  $('search').addEventListener('input',displayCountries);
  $('country').addEventListener('change',()=>{flag($('country').value);updateApply();});
  $('domain').addEventListener('change',chooseExisting);
  $('save').addEventListener('click',()=>void save());
  $('apply').addEventListener('click',()=>void applyViaProton());
  $('remove').addEventListener('click',()=>void remove());
  $('exit-check').addEventListener('click',()=>void verifyExit());
  const open=$('open-settings');
  if(open)open.addEventListener('click',()=>void chrome.runtime.openOptionsPage());
  await Promise.all([loadPolicy(),refreshHealth()]);
  // Browser health is local-only; the background also observes proxy changes.
  setInterval(()=>void refreshHealth(),15_000);
}
void init().catch(err=>tell('Could not initialise Helper: '+String(err.message)));
