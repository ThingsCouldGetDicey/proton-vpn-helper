import assert from 'node:assert/strict';
import {
  BRIDGE_PROTOCOL, createBridgeClient, validateBridgeReply
} from '../source/companion/js/officialBridge.js';

const HELPER_TARGET='jplgfhpmjnbigmhklmmbgecoobifkmpa';
const NONCE='00112233445566778899aabbccddeeff';
const calls=[];
const goodState={protocol:BRIDGE_PROTOCOL,action:'hello',nonce:NONCE,ok:true,
  delegated:true,accountSignedIn:true,vpnConnected:true,defaultCountry:'CH',
  countryRoutingSupported:false,countriesAvailable:true};

function check(name,fn){return Promise.resolve().then(fn)
  .then(()=>console.log('PASS',name));}
await check('real official extension without API fails safely closed',async()=>{
  const bridge=createBridgeClient({send:async()=>{throw new Error('Not allowed')},
    random:()=>NONCE});
  const value=await bridge.hello();
  assert.equal(value.linked,false);
  assert.equal(value.accountSignedIn,false);
  assert.equal(value.vpnConnected,false);
  assert.equal(value.status,'official-extension-does-not-support-bridge');
  const reply=await bridge.listCountries();
  assert.equal(reply.ok,false);
});
await check('nonce mismatch and incomplete responses never claim sign-in',async()=>{
  for(const malformed of [
    {...goodState,nonce:'wrong'},
    {...goodState,accountSignedIn:'true'},
    {...goodState,protocol:'other'},
    {...goodState,action:'setWebsiteCountry'}
  ]){
    const bridge=createBridgeClient({
      send:async()=>malformed,random:()=>NONCE
    });
    assert.equal((await bridge.hello()).linked,false);
  }
});
await check('explicit Proton-side revocation never shares account status',async()=>{
  const bridge=createBridgeClient({random:()=>NONCE,
    send:async(target,request)=>({
      protocol:BRIDGE_PROTOCOL,action:request.action,nonce:request.nonce,
      ok:true,delegated:false,accountSignedIn:false,vpnConnected:false,
      defaultCountry:null,countryRoutingSupported:false,countriesAvailable:false
    })});
  assert.equal((await bridge.hello()).linked,false);
  assert.equal((await bridge.listCountries()).ok,false);
});
await check('consented bridge mirrors nonsecret state and locked countries',async()=>{
  const bridge=createBridgeClient({random:()=>NONCE,
    send:async(target,request)=>{
      assert.equal(target,HELPER_TARGET);
      calls.push(request);
      if(request.action==='hello')return goodState;
      if(request.action==='listCountries')return {
        protocol:BRIDGE_PROTOCOL,action:request.action,nonce:NONCE,ok:true,
        countries:[{code:'CH',name:'Switzerland',available:true,locked:false},
          {code:'US',name:'United States',available:false,locked:true}]
      };
      throw Error('unexpected action');
    }});
  const hello=await bridge.hello();
  assert.equal(hello.linked,true);
  assert.equal(hello.accountSignedIn,true);
  assert.equal(hello.defaultCountry,'CH');
  assert.equal(hello.countryRoutingSupported,false);
  const list=await bridge.listCountries();
  assert.equal(list.ok,true);
  assert.equal(list.countries[1].available,false);
  assert.equal((await bridge.setWebsiteCountry({domain:'example.com',country:'CH'})).ok,false);
  assert.deepEqual(calls.map(x=>x.action),['hello','listCountries','hello']);
  assert.equal(calls.some(x=>x.action==='setWebsiteCountry'),false);
  assert.equal(calls.every(x=>typeof x.nonce==='string'&&x.nonce.length===32),true);
  assert(!calls.some(x=>JSON.stringify(x).includes('token')));
});
await check('only authorised provider can accept validated website routing',async()=>{
  const calls=[];
  const bridge=createBridgeClient({random:()=>NONCE,send:async(target,request)=>{
    calls.push(request);
    if(request.action==='hello')
      return {...goodState,countryRoutingSupported:true};
    return {protocol:BRIDGE_PROTOCOL,action:request.action,nonce:request.nonce,
      ok:true,applied:true};
  }});
  const applied=await bridge.setWebsiteCountry({
    domain:'https://WWW.Example.org/path',country:' nl ',subdomains:true
  });
  assert.equal(applied.ok,true);
  assert.equal(applied.applied,true);
  assert.equal(calls.at(-1).domain,'www.example.org');
  assert.equal(calls.at(-1).country,'NL');
  const removed=await bridge.removeWebsiteCountry({domain:'www.example.org'});
  assert.equal(removed.applied,true);
  assert.equal(calls.at(-1).action,'removeWebsiteCountry');
});
await check('malformed country catalogue rejected rather than inventing entitlement',async()=>{
  assert.throws(()=>validateBridgeReply({
    protocol:BRIDGE_PROTOCOL,nonce:NONCE,action:'listCountries',ok:true,
    countries:[{code:'USA',name:'United States',available:true}]
  },NONCE,'listCountries'),/country/i);
  assert.throws(()=>validateBridgeReply({
    protocol:BRIDGE_PROTOCOL,nonce:NONCE,action:'listCountries',ok:true,
    countries:[{code:'US',name:'USA',available:'yes'}]
  },NONCE,'listCountries'),/country/i);
});
console.log('OFFICIAL_BRIDGE_UNIT_TESTS 6 passed');
