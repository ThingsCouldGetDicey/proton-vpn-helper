import assert from 'node:assert/strict';
import {
  validatedPolicy,domainFrom,countryCode,preferenceFor,OFFICIAL_PROTON_ID
} from '../source/companion/js/shared.js';
const tests = [];
function test(title, body) {
  body(); tests.push(title);
  process.stdout.write('PASS '+title+'\n');
}
test('the official Proton extension ID is fixed and distinct',()=>{
  assert.equal(OFFICIAL_PROTON_ID,'jplgfhpmjnbigmhklmmbgecoobifkmpa');
});
test('prior fork settings cannot reenable another proxy or automatic retries',()=>{
  const state=validatedPolicy({
    enabled:true,autoDetect:true,autoRetry:true,
    candidates:['US','NL'],revision:100,rules:[
      {domain:'example.org',country:'CH',source:'manual',subdomains:true}
    ]
  });
  assert.equal(state.enabled,false);
  assert.equal(state.autoDetect,false);
  assert.equal(state.autoRetry,false);
  assert.deepEqual(state.candidates,[]);
  assert.equal(state.rules.length,1);
  assert.equal(state.rules[0].country,'CH');
});
test('invalid or private hosts are not accepted as routing preferences',()=>{
  for(const value of ['127.0.0.1','localhost','example.local','https://bad.com@evil.org',
    'notadomain','foo.test']){
    assert.throws(()=>domainFrom(value), undefined, value);
  }
  assert.equal(domainFrom('https://Example.org/something'),'example.org');
  assert.equal(countryCode(' ch '),'CH');
});
test('the most specific stored website intent wins',()=>{
  const rules=[
    {domain:'example.org',country:'NL',subdomains:true},
    {domain:'shop.example.org',country:'CH',subdomains:true}
  ];
  assert.equal(preferenceFor('shop.example.org',{rules}).country,'CH');
  assert.equal(preferenceFor('foo.example.org',{rules}).country,'NL');
  assert.equal(preferenceFor('myexample.org',{rules}),null);
});
test('old forged or duplicate rules are sanitized',()=>{
  const pol=validatedPolicy({rules:[
    {domain:'EXAMPLE.org',country:'US'},
    {domain:'example.org',country:'CH'},
    {domain:'localhost',country:'NL'},
    {domain:'example.com',country:'USA'}
  ]});
  assert.equal(pol.rules.length,1);
  assert.equal(pol.rules[0].country,'US');
});
console.log('COMPANION_POLICY_TESTS',tests.length,'passed');
