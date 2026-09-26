#!/usr/bin/env python3
"""Set up the `covered` named Cloudflare Tunnel + DNS for covered.kawuc.uk via the API.

Requires the API token in ~/.config/covered/cloudflare.env to have `Cloudflare Tunnel:Edit`
(account) and `DNS:Edit` (zone kawuc.uk). Idempotent. Prints status codes and ids only.
On 401/403 from cfd_tunnel it prints PATH=quick and scripts/tunnel.sh falls back to a quick tunnel.
Stores CLOUDFLARE_TUNNEL_TOKEN into ~/.config/covered/cloudflare.env (never printed)."""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV = Path.home() / ".config" / "covered" / "cloudflare.env"
env: dict[str, str] = {}
for line in ENV.read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

TOKEN = env["CLOUDFLARE_API_TOKEN"]
ACCOUNT = env["CLOUDFLARE_ACCOUNT_ID"]
ZONE = env["CLOUDFLARE_ZONE_ID"]
BASE = "https://api.cloudflare.com/client/v4"
HOST = "covered.kawuc.uk"
SERVICE = "http://localhost:3000"
NAME = "covered"


def call(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read() or b"{}")
        except json.JSONDecodeError:
            payload = {}
        return e.code, payload


def log(label: str, status: int, payload=None):
    errs = ""
    if payload and not payload.get("success", True):
        errs = " errors=" + json.dumps([{"code": x.get("code"), "message": x.get("message")} for x in payload.get("errors", [])])
    print(f"{label}: {status}{errs}")


# 1. Find or create tunnel
st, res = call("GET", f"/accounts/{ACCOUNT}/cfd_tunnel?name={NAME}&is_deleted=false")
log("GET cfd_tunnel", st, res)
if st == 403 or st == 401:
    print("PATH=quick")
    sys.exit(0)
if st != 200:
    print("PATH=fail")
    sys.exit(1)

tunnels = res.get("result") or []
if tunnels:
    tunnel = tunnels[0]
    print(f"tunnel exists id={tunnel['id']}")
else:
    st, res = call("POST", f"/accounts/{ACCOUNT}/cfd_tunnel", {"name": NAME, "config_src": "cloudflare"})
    log("POST cfd_tunnel", st, res)
    if st == 403:
        print("PATH=quick")
        sys.exit(0)
    if st != 200:
        print("PATH=fail")
        sys.exit(1)
    tunnel = res["result"]
    print(f"tunnel created id={tunnel['id']}")
TID = tunnel["id"]

# 2. Ingress config
st, res = call(
    "PUT",
    f"/accounts/{ACCOUNT}/cfd_tunnel/{TID}/configurations",
    {"config": {"ingress": [{"hostname": HOST, "service": SERVICE}, {"service": "http_status:404"}]}},
)
log("PUT configurations", st, res)
if st != 200:
    print("PATH=fail")
    sys.exit(1)

# 3. DNS record (only covered.kawuc.uk; never touch anything else)
target = f"{TID}.cfargotunnel.com"
st, res = call("GET", f"/zones/{ZONE}/dns_records?name={HOST}")
log("GET dns_records", st, res)
if st != 200:
    print("PATH=fail")
    sys.exit(1)
records = res.get("result") or []
body = {"type": "CNAME", "name": HOST, "content": target, "proxied": True, "ttl": 1, "comment": "Covered hackathon tunnel"}
if records:
    rec = records[0]
    if rec.get("type") == "CNAME" and rec.get("content") == target and rec.get("proxied"):
        print("dns record already correct")
    else:
        st, res = call("PUT", f"/zones/{ZONE}/dns_records/{rec['id']}", body)
        log("PUT dns_record", st, res)
        if st != 200:
            print("PATH=fail")
            sys.exit(1)
else:
    st, res = call("POST", f"/zones/{ZONE}/dns_records", body)
    log("POST dns_record", st, res)
    if st != 200:
        print("PATH=fail")
        sys.exit(1)
print(f"dns: CNAME {HOST} -> {target} (proxied)")

# 4. Run token -> env file (never printed)
st, res = call("GET", f"/accounts/{ACCOUNT}/cfd_tunnel/{TID}/token")
log("GET token", st, res)
if st != 200:
    print("PATH=fail")
    sys.exit(1)
run_token = res["result"]
env["CLOUDFLARE_TUNNEL_ID"] = TID
env["CLOUDFLARE_TUNNEL_TOKEN"] = run_token
content = "# Covered: Cloudflare credentials for kawuc.uk. Never copy into the repo.\n" + "".join(f"{k}={v}\n" for k, v in env.items())
fd = os.open(ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as fh:
    fh.write(content)
os.chmod(ENV, 0o600)
print("tunnel token written to env file")
print("PATH=named")
