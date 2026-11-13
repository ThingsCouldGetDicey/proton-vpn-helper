#!/usr/bin/env python3
"""Chrome/Brave/Vivaldi/Firefox native-messaging bridge; data operations only.

Requests: {"action":"pull"} | {"action":"push","policy":{...}} | {"action":"status"}
No command execution, network, browser history, ID collection or credential access.
"""
import json
import struct
import sys
from policy_store import MAX_BYTES, read_policy, save_policy

def receive():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4: raise EOFError()
    length = struct.unpack("<I", header)[0]
    if length > MAX_BYTES: raise ValueError("Message exceeds limit")
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length: raise ValueError("Incomplete message")
    return json.loads(payload)

def send(payload):
    data = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode()
    if len(data) > MAX_BYTES: raise ValueError("Response exceeds limit")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()

def main():
    try:
        msg = receive()
        if not isinstance(msg, dict): raise ValueError("Invalid message")
        action = msg.get("action")
        if action == "pull":
            send({"ok": True, "policy": read_policy()})
        elif action == "status":
            p = read_policy()
            send({"ok": True, "revision": p["revision"], "ruleCount": len(p["rules"])})
        elif action == "push":
            p = save_policy(msg.get("policy"))
            send({"ok": True, "policy": p})
        else:
            send({"ok": False, "error": "Unsupported action"})
    except Exception as exc:
        send({"ok": False, "error": type(exc).__name__})

if __name__ == "__main__":
    main()
