#!/usr/bin/env python3
"""Rune MCP entry point: deterministic policy changes, no browser token access."""
import argparse
import json
from policy_store import bump, country, domain, read_policy, save_policy

parser = argparse.ArgumentParser(description="Edit user-owned per-site VPN routing rules")
sub = parser.add_subparsers(dest="action", required=True)
sub.add_parser("show")
set_cmd = sub.add_parser("set")
set_cmd.add_argument("domain")
set_cmd.add_argument("country")
set_cmd.add_argument("--exact", action="store_true")
remove_cmd = sub.add_parser("remove")
remove_cmd.add_argument("domain")
prefs = sub.add_parser("preferences")
prefs.add_argument("--candidates", help="Comma separated country codes")
prefs.add_argument("--enabled", choices=["on", "off"])
prefs.add_argument("--detect", choices=["on", "off"])
prefs.add_argument("--retry", choices=["on", "off"])
args = parser.parse_args()
p = read_policy()
if args.action == "set":
    d = domain(args.domain)
    c = country(args.country)
    p["rules"] = [r for r in p["rules"] if r["domain"] != d] + [
        {"domain":d, "country":c, "subdomains":not args.exact, "source":"manual"}]
elif args.action == "remove":
    d = domain(args.domain)
    p["rules"] = [r for r in p["rules"] if r["domain"] != d]
elif args.action == "preferences":
    for opt, key in (("enabled", "enabled"), ("detect", "autoDetect"), ("retry", "autoRetry")):
        raw = getattr(args, opt)
        if raw is not None: p[key] = raw == "on"
    if args.candidates is not None:
        p["candidates"] = list(dict.fromkeys(country(s) for s in args.candidates.split(",")))
if args.action != "show":
    p = save_policy(bump(p))
print(json.dumps(p, indent=2, sort_keys=True))
