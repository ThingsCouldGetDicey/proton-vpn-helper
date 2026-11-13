#!/usr/bin/env python3
"""Register the strictly-scoped native messaging helper for user browsers.
Does not install/enable/modify any VPN extension or browser profile.
"""
import json
import os
import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT_ID = (ROOT / "native/extension_id.txt").read_text().strip()
HOST_FILE = (ROOT / "native/host.py").resolve()
HOST_NAME = "com.local.proton_site_router"
if len(EXT_ID) != 32 or any(c not in "abcdefghijklmnop" for c in EXT_ID):
    raise SystemExit("Invalid fork extension ID")
os.chmod(HOST_FILE, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
browser_dirs = [
    Path.home() / ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    Path.home() / ".config/vivaldi/NativeMessagingHosts",
    Path.home() / ".config/chromium/NativeMessagingHosts",
]
manifest = {
    "name": HOST_NAME, "description": "Data-only local policy bridge for personal Proton site router",
    "path": str(HOST_FILE), "type": "stdio",
    "allowed_origins": ["chrome-extension://" + EXT_ID + "/"],
}
for dirname in browser_dirs:
    if not dirname.parent.exists(): continue
    dirname.mkdir(mode=0o700, exist_ok=True)
    path = dirname / (HOST_NAME + ".json")
    if path.exists():
        existing = json.loads(path.read_text())
        if existing == manifest:
            print("UNCHANGED", path)
            continue
        # Rename migration is permitted only for this exact, user-owned native host.
        # Never overwrite an unrelated native messaging registration.
        if not (existing.get("name") == HOST_NAME
                and existing.get("allowed_origins") == manifest["allowed_origins"]
                and existing.get("type") == "stdio"
                and str(existing.get("path", "")).endswith("/native/host.py")):
            raise SystemExit("Refusing to replace unrelated native messaging host: " + str(path))
        replacement = path.with_name(path.name + ".new")
        fd = os.open(replacement, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")
        os.replace(replacement, path)
        print("MIGRATED_OWN_HOST", path)
        continue
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print("REGISTERED", path)
print("FORK_EXTENSION_ID", EXT_ID)
print("Existing Proton browser extensions untouched.")
