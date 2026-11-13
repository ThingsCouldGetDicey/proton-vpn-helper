/** Deterministic local-only fixture for the real Chromium PAC transport test. */
import {buildRoutePacCases} from '../source/js/siteRouter/pac';
import type {SiteRule} from '../source/js/siteRouter/policy';
const [countryAPort, countryBPort, defaultPort] = process.argv.slice(2).map(Number);
if (![countryAPort,countryBPort,defaultPort].every(n => Number.isInteger(n) && n>=1024 && n<=65535)) {
  throw new Error('Three allocated local proxy ports are required');
}
const rules: {rule:SiteRule; endpoint?: {host:string;port:number}}[] = [
  {rule:{domain:'first.example.com',country:'CH',subdomains:true,source:'manual'},
    endpoint:{host:'127.0.0.1',port:countryAPort}},
  {rule:{domain:'second.example.com',country:'NL',subdomains:true,source:'manual'},
    endpoint:{host:'127.0.0.1',port:countryBPort}},
  {rule:{domain:'blocked.example.com',country:'XX',subdomains:true,source:'manual'}},
];
const cases=buildRoutePacCases(rules,'https','');
process.stdout.write(
  'function FindProxyForURL(url, host) {\n' +
  cases + '\n' +
  'return "HTTPS 127.0.0.1:' + defaultPort + '";\n' +
  '}\n'
);
