"""Private, data-only native-messaging policy store. Never touches Proton credentials."""
from __future__ import annotations
import json
import os
import re
import stat
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

HOME = Path.home()
STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", str(HOME / ".local/state"))) / "proton-site-router"
POLICY_PATH = STATE_DIR / "rules.json"
MAX_BYTES = 96 * 1024
DEFAULT = {
    "version": 1, "enabled": True, "autoDetect": False, "autoRetry": False,
    "candidates": ["NL", "CH", "US", "CA", "DE"],
    "rules": [], "revision": 0,
}

def domain(value: str) -> str:
    if not isinstance(value, str) or len(value) > 253 or re.search(r"\s|@|\\", value):
        raise ValueError("Invalid hostname")
    url = urlsplit(value if "://" in value else "https://" + value)
    if url.scheme not in ("http", "https") or url.username or url.password:
        raise ValueError("Public HTTP/HTTPS host required")
    host = (url.hostname or "").encode("idna").decode("ascii").lower().rstrip(".")
    if len(host) > 253 or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", host):
        raise ValueError("Public DNS hostname required")
    if any(len(part) > 63 or part.startswith("-") or part.endswith("-") for part in host.split(".")):
        raise ValueError("Invalid DNS label")
    if host.endswith((".local", ".localhost", ".internal", ".test", ".invalid")):
        raise ValueError("Private host forbidden")
    if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", host):
        raise ValueError("IP address forbidden")
    return host

def country(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z]{2}", value.strip()):
        raise ValueError("Two-letter country code expected")
    return value.strip().upper()

def validate(raw: object) -> dict:
    if not isinstance(raw, dict): raise ValueError("Object expected")
    rules = raw.get("rules", [])
    candidates = raw.get("candidates", list(DEFAULT["candidates"]))
    if not isinstance(rules, list) or len(rules) > 500:
        raise ValueError("Invalid rule list")
    if not isinstance(candidates, list) or len(candidates) > 15:
        raise ValueError("Invalid country list")
    clean_rules = []
    seen = set()
    for r in rules:
        if not isinstance(r, dict): raise ValueError("Invalid rule")
        host = domain(r.get("domain"))
        cc = country(r.get("country"))
        if host in seen: raise ValueError("Duplicate domain")
        seen.add(host)
        source = r.get("source")
        if source not in ("manual", "learned", "trial"): source = "manual"
        record = {"domain": host, "country": cc, "subdomains": r.get("subdomains", True) is not False,
                  "source": source}
        if isinstance(r.get("observedAt"), int) and 0 < r["observedAt"] <= 2**53:
            record["observedAt"] = r["observedAt"]
        clean_rules.append(record)
    unique = []
    for cc in candidates:
        c = country(cc)
        if c not in unique: unique.append(c)
    revision = raw.get("revision", 0)
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0 or revision > 2**53:
        raise ValueError("Invalid revision")
    return {
        "version": 1,
        "enabled": raw.get("enabled", True) is not False,
        "autoDetect": raw.get("autoDetect", False) is True,
        "autoRetry": raw.get("autoRetry", False) is True,
        "candidates": unique,
        "rules": clean_rules,
        "revision": revision,
    }

def read_policy() -> dict:
    if not POLICY_PATH.exists():
        return json.loads(json.dumps(DEFAULT))
    if POLICY_PATH.is_symlink() or not POLICY_PATH.is_file() or POLICY_PATH.stat().st_size > MAX_BYTES:
        raise ValueError("Invalid policy file")
    return validate(json.loads(POLICY_PATH.read_text(encoding="utf-8")))

def save_policy(obj: dict, *, require_newer: bool = True) -> dict:
    clean = validate(obj)
    existing = read_policy()
    if require_newer and clean["revision"] <= existing["revision"]:
        return existing
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    data = json.dumps(clean, separators=(",", ":"), ensure_ascii=True).encode()
    if len(data) > MAX_BYTES: raise ValueError("Policy too large")
    fd, temp = tempfile.mkstemp(prefix=".site-router-", dir=str(STATE_DIR))
    try:
        os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, POLICY_PATH)
    finally:
        if os.path.exists(temp): os.unlink(temp)
    return clean

def bump(obj: dict) -> dict:
    obj["revision"] = max(int(time.time() * 1000), read_policy()["revision"] + 1)
    return obj
