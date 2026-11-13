import * as assert from 'node:assert/strict';
import {buildRoutePacCases, siteRouteBypassGuard} from '../source/js/siteRouter/pac';
import {evaluateSiteSplitConflict} from '../source/js/siteRouter/splitConflict';
import {SplitTunnelingMode} from '../source/js/vpn/WebsiteFilter';
import {helperMayRoute} from '../source/js/siteRouter/consentGate';
import {countriesFromProtonLogicals} from '../source/js/siteRouter/countryCatalog';
import {classifyBlock, DEFAULT_POLICY, findRule, normalizeDomain, validatePolicy} from '../source/js/siteRouter/policy';

function test(name: string, cb: () => void) {
	try {cb(); process.stdout.write('PASS ' + name + '\n');}
	catch(err) {process.stderr.write('FAIL ' + name + ': ' + err + '\n'); process.exitCode = 1;}
}
test('exact+subdomain matching, not suffix-confused', () => {
	const rules = [{domain:'example.com', country:'NL', subdomains:true, source:'manual' as const}];
	assert.equal(findRule('example.com', rules)?.country, 'NL');
	assert.equal(findRule('cdn.example.com', rules)?.country, 'NL');
	assert.equal(findRule('example.com.evil.tld', rules), undefined);
	assert.equal(findRule('notexample.com', rules), undefined);
});
test('longest domain wins', () => {
	const p = validatePolicy({rules:[
		{domain:'example.com',country:'US',subdomains:true},
		{domain:'support.example.com',country:'CH',subdomains:true},
	]});
	assert.equal(findRule('support.example.com',p.rules)?.country, 'CH');
	assert.equal(findRule('news.example.com',p.rules)?.country, 'US');
});
test('malformed domains and unsupported schemes rejected', () => {
	for (const d of ['localhost', '127.0.0.1', 'http://hello@evil.com',
		'ftp://example.com', 'example.com:bogus', 'a b.com', 'abc.local']) {
		assert.throws(()=>normalizeDomain(d), d);
	}
	assert.equal(normalizeDomain('HTTPS://WWW.Example.COM/path'), 'www.example.com');
});
test('deterministic 451, region and age; generic 403/captcha not region', () => {
	assert.equal(classifyBlock('', 451), 'region');
	assert.equal(classifyBlock('Not available in your region', 403), 'region');
	assert.equal(classifyBlock('You must verify your age', 200), 'age');
	assert.equal(classifyBlock('Forbidden', 403), 'none');
	assert.equal(classifyBlock('Too many requests. Not available in your region', 429), 'unknown');
});
test('policy import sanitized and bounded', () => {
	const p = validatePolicy({rules:[
		{domain:'reddit.com',country:'US',source:'manual',subdomains:true},
		{domain:'reddit.com',country:'CA',source:'learned'},
		{domain:'invalid',country:'NL'}],
		candidates:['nl','NL','??','ch'],revision:7});
	assert.equal(p.rules.length,1);
	assert.deepEqual(p.candidates,['NL','CH']);
	assert.equal(p.revision,7);
});
test('PAC routes by country without fallback to DIRECT', () => {
	const p=validatePolicy({rules:[
		{domain:'example.com',country:'NL',subdomains:true},
		{domain:'sub.example.com',country:'CH',subdomains:true},
		{domain:'blocked.example.org',country:'DE',subdomains:false},
	]});
	const routes=[
		{rule:p.rules[0]!,endpoint:{host:'nl.proton.example',port:4443}},
		{rule:p.rules[1]!,endpoint:{host:'ch.proton.example',port:4443}},
		{rule:p.rules[2]!},
	];
	const code=buildRoutePacCases(routes,'https','host === "direct.example.com"');
	const f = new Function('host',code+'return "HTTPS base.proton.example:4443";') as (h:string)=>string;
	assert.equal(f('example.com'),'HTTPS nl.proton.example:4443');
	assert.equal(f('www.example.com'),'HTTPS nl.proton.example:4443');
	assert.equal(f('sub.example.com'),'HTTPS ch.proton.example:4443');
	assert.equal(f('blocked.example.org'),'HTTPS 127.0.0.1:9');
	assert.equal(f('a.blocked.example.org'),'HTTPS base.proton.example:4443');
	assert.equal(f('example.com.evil.tld'),'HTTPS base.proton.example:4443');
	assert.equal(f('direct.example.com'),'DIRECT');
});

test('privacy-sensitive page reading and automatic routing are opt-in', () => {
	assert.equal(DEFAULT_POLICY.autoDetect, false);
	assert.equal(DEFAULT_POLICY.autoRetry, false);
	assert.equal(validatePolicy({rules: []}).autoDetect, false);
	assert.equal(validatePolicy({rules: []}).autoRetry, false);
});

test('include-only split tunnelling takes precedence over country routes', () => {
	const p=validatePolicy({rules:[
		{domain:'included.example.org',country:'CH',subdomains:true},
		{domain:'excluded.example.org',country:'NL',subdomains:true},
	]});
	const routes=[
		{rule:p.rules[0]!,endpoint:{host:'ch.proton.example',port:4443}},
		{rule:p.rules[1]!,endpoint:{host:'nl.proton.example',port:4443}},
	];
	const only='host === "included.example.org" || host.endsWith(".included.example.org")';
	const pac=buildRoutePacCases(routes,'https',siteRouteBypassGuard(only));
	const evaluate=new Function('host',pac+'\nreturn "DIRECT";') as (host:string)=>string;
	assert.equal(evaluate('included.example.org'),'HTTPS ch.proton.example:4443');
	assert.equal(evaluate('sub.included.example.org'),'HTTPS ch.proton.example:4443');
	assert.equal(evaluate('excluded.example.org'),'DIRECT');
	assert.equal(siteRouteBypassGuard('true'),'');
	assert.equal(siteRouteBypassGuard('false'),'!(false)');
});

test('toolbar warns for an exact Proton exclusion and never removes a parent exclusion', () => {
  const exact={enabled:true,mode:SplitTunnelingMode.Exclude,value:[
    {domain:'example.org',withSubDomains:true,mode:SplitTunnelingMode.Exclude},
  ]};
  const direct=evaluateSiteSplitConflict('example.org',exact);
  assert.equal(direct.kind,'excluded');
  assert.equal(direct.canResolve,true);
  const child=evaluateSiteSplitConflict('shop.example.org',exact);
  assert.equal(child.kind,'excluded');
  assert.equal(child.canResolve,false);
  assert.equal(child.matchedDomain,'example.org');
  assert.equal(evaluateSiteSplitConflict('other.example.org', {...exact, enabled:false}).kind,'none');
});
test('toolbar identifies include-only sites and leaves included sites unchanged', () => {
  const list={enabled:true,mode:SplitTunnelingMode.Include,value:[
    {domain:'example.org',withSubDomains:true,mode:SplitTunnelingMode.Include},
  ]};
  assert.equal(evaluateSiteSplitConflict('sub.example.org',list).kind,'none');
  const candidate=evaluateSiteSplitConflict('other.example.net',list);
  assert.equal(candidate.kind,'include-only');
  assert.equal(candidate.canResolve,true);
});

test('Helper delegation denies routing until explicitly enabled in Proton settings', () => {
  assert.equal(helperMayRoute(false,true),false);
  assert.equal(helperMayRoute(true,false),false);
  assert.equal(helperMayRoute(false,false),false);
  assert.equal(helperMayRoute(true,true),true);
});

test('Proton-derived catalog mirrors country availability and upgrade locks',()=>{
  const sample=[
    {ExitCountry:'CH',Name:'CH#1',Tier:2,Servers:[
      {Domain:'ch.protonvpn.net',Enabled:true,Status:1}]},
    {ExitCountry:'CH',Name:'CH#2',Tier:2,Servers:[
      {Domain:'ch2.protonvpn.net',Enabled:true,Status:1}]},
    {ExitCountry:'NL',Name:'NL-FREE#1',Tier:0,Servers:[
      {Domain:'nl.protonvpn.net',Enabled:true,Status:1}]},
    {ExitCountry:'US',Name:'US#1',Tier:2,Servers:[
      {Domain:'us.protonvpn.net',Enabled:true,Status:1}]},
    {ExitCountry:'UK',Name:'GB#1',Tier:2,Servers:[
      {Domain:'gb.protonvpn.net',Enabled:true,Status:1}]},
  ] as any;
  const name=(code:string)=>({CH:'Switzerland',NL:'Netherlands',US:'United States',GB:'United Kingdom'} as Record<string,string>)[code]||code;
  const free=countriesFromProtonLogicals(sample,0,name);
  assert.equal(free.length,4);
  assert.deepEqual(free.filter(c=>c.available).map(c=>c.code),['NL']);
  assert.equal(free.find(c=>c.code==='CH')?.locked,true);
  const plus=countriesFromProtonLogicals(sample,2,name);
  assert.equal(plus.find(c=>c.code==='CH')?.serverCount,2);
  assert.equal(plus.find(c=>c.code==='GB')?.name,'United Kingdom');
  assert.equal(plus.filter(c=>c.available).length,4);
});
