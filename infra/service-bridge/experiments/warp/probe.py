"""Standalone, credential-safe AWS Lambda feasibility probe for WARP Local proxy."""
import http.client
import ipaddress
import json
import os
from pathlib import Path
import plistlib
import re
import resource
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from xml.etree import ElementTree

ADDRESS = "127.0.0.1"
PORT = 40000


def https(host, path, via_proxy=False):
    target, port = (ADDRESS, PORT) if via_proxy else (host, 443)
    connection = http.client.HTTPSConnection(
        target, port, timeout=7, context=ssl.create_default_context()
    )
    if via_proxy:
        connection.set_tunnel(host, 443)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("Unexpected status")
        return response.read(4096).decode()
    finally:
        connection.close()


def public_ip(via_proxy=False):
    address = ipaddress.ip_address(https("checkip.amazonaws.com", "/", via_proxy).strip())
    if not address.is_global:
        raise ValueError("Nonpublic address")
    return str(address)


def proxy_refused():
    try:
        https("checkip.amazonaws.com", "/", True)
    except ConnectionRefusedError:
        return True
    except (OSError, ValueError, http.client.HTTPException):
        return False
    return False


def run_cli(env, *arguments):
    return subprocess.run(
        ["warp-cli", "--accept-tos", "--no-ansi", *arguments],
        env=env, text=True, capture_output=True, timeout=3, check=False,
    )


def stop(process):
    if process is None:
        return None
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)
            return "killed"
        return "terminated"
    return "exited"


def startup_diagnostics(output, logs, result):
    # Only fixed categories can leave the runtime. Never return raw WARP logs.
    data = output.read_bytes()[-131072:].lower()
    path = logs / "cfwarp_service_log.txt"
    if path.is_file():
        with path.open("rb") as stream:
            stream.seek(max(0, path.stat().st_size - 131072))
            data += stream.read().lower()
    signals = {
        "permission_denied": b"permission denied",
        "netlink": b"netlink",
        "read_only": b"read-only file system",
        "not_root": b"must be run as root",
        "dbus": b"dbus",
        "tun": b"/dev/net/tun",
        "panic": b"panicked",
        "ipc": b"ipc",
        "quic_timeout": b"quic handshake timed out",
        "masque": b"masque",
        "failed_registration": b"failed to register",
        "registration_error": b"registration error",
        "access_denied": b"access denied",
        "not_authorized": b"not authorized",
        "status_403": b"403 forbidden",
        "http2": b"http/2",
        "operation_not_permitted": b"operation not permitted",
        "tpm": b"tpm",
        "invalid_certificate": b"invalid certificate",
        "connectivity_check": b"connectivity check",
        "network_unreachable": b"network is unreachable",
        "mdm_proxy": b"proxy mode",
        "tls": b"tls error",
        "mdm_parse_error": b"couldn't parse local policy",
        "failed_to_fetch": b"failed to fetch",
        "api_timeout": b"operation timed out",
        "reg_permission": b"permissiondenied",
        "mtls": b"mtls",
        "not_registered": b"not registered",
        "failed_to_enroll": b"failed to enroll",
    }
    result["log_categories"] = [key for key, marker in signals.items() if marker in data]


def load_mdm(state, arn):
    if arn == "local-stdin":
        secret = json.load(sys.stdin)
    else:
        import boto3

        secret = json.loads(boto3.client("secretsmanager").get_secret_value(SecretId=arn)["SecretString"])
    mdm = {
        "organization": secret["organization"],
        "auth_client_id": secret["client_id"],
        "auth_client_secret": secret["client_secret"],
        "onboarding": False,
        "auto_connect": 1,
        "service_mode": "proxy",
        "proxy_port": PORT,
        "warp_tunnel_protocol": "masque",
    }
    path = state / "mdm.xml"
    with open(path, "xb", opener=lambda file, flags: os.open(file, flags, 0o600)) as stream:
        # The Linux MDM parser expects a top-level dictionary with no plist wrapper.
        config = ElementTree.fromstring(plistlib.dumps(mdm)).find("dict")
        stream.write(ElementTree.tostring(config, encoding="utf-8"))


def wait_proxy(process, env, result):
    result["proxy_listening"] = False
    deadline = time.monotonic() + 28
    while process.poll() is None and time.monotonic() < deadline:
        status = run_cli(env, "status")
        result["warp_connected"] = "status update: connected" in status.stdout.lower()
        with socket.socket() as client:
            client.settimeout(0.3)
            listening = client.connect_ex((ADDRESS, PORT)) == 0
        result["proxy_listening"] |= listening
        if result["warp_connected"] and listening:
            return True
        time.sleep(0.5)
    return False


def connect_probe(result):
    try:
        trace = dict(line.split("=", 1) for line in https(
            "www.cloudflare.com", "/cdn-cgi/trace", True
        ).splitlines() if "=" in line)
        result["trace_warp_on"] = trace.get("warp") == "on"
        result["trace_gateway_on"] = trace.get("gateway") == "on"
    except (OSError, ValueError, http.client.HTTPException) as error:
        result["trace_error"] = type(error).__name__

    try:
        result["proxied_egress_ip"] = public_ip(True)
        if "aws_egress_ip" in result:
            result["different_egress_ip"] = result["aws_egress_ip"] != result["proxied_egress_ip"]
    except (OSError, ValueError, http.client.HTTPException) as error:
        result["ip_probe_error"] = type(error).__name__


def handler(event, context):
    start = time.monotonic()
    cap = next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines()
               if line.startswith("CapEff:"))
    result = {
        "uid": os.geteuid(), "capabilities": cap, "tun_present": Path("/dev/net/tun").exists(),
        "root_read_only": bool(os.statvfs("/").f_flag & os.ST_RDONLY),
        "explicit_proxy_refused_before": proxy_refused(),
    }
    stage = "direct_https"
    try:
        result["aws_egress_ip"] = public_ip()
    except (OSError, ValueError, http.client.HTTPException):
        result["direct_https_failed"] = True

    # All subprocess input, output and registration files are isolated within /tmp.
    with tempfile.TemporaryDirectory(prefix="warp-probe-", dir="/tmp") as directory:
        root = Path(directory)
        state = root / "state"
        state.mkdir(mode=0o700)
        logs = root / "log"
        logs.mkdir(mode=0o700)
        output = root / "daemon.out"
        env = {**os.environ, "HOME": directory, "STATE_DIRECTORY": str(state),
               "LOGS_DIRECTORY": str(logs), "RUNTIME_DIRECTORY": directory}
        # Do not pass the Lambda execution-role credentials to the vendor processes.
        for key in tuple(env):
            if key.startswith(("AWS_", "LAMBDA_", "_AWS_")):
                del env[key]
        daemon = bus = None
        secret_arn = os.getenv("WARP_PROBE_SECRET_ARN")
        try:
            if secret_arn:
                stage = "mdm"
                load_mdm(state, secret_arn)
            if isinstance(event, dict) and event.get("dbus"):
                stage = "dbus"
                address = f"unix:path={root / 'dbus.sock'}"
                env["DBUS_SYSTEM_BUS_ADDRESS"] = address
                bus = subprocess.Popen(
                    ["dbus-daemon", "--session", "--nofork", f"--address={address}"],
                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                deadline = time.monotonic() + 3
                while not (root / "dbus.sock").exists() and bus.poll() is None:
                    if time.monotonic() >= deadline:
                        break
                    time.sleep(0.05)
                result["private_dbus_started"] = (root / "dbus.sock").exists()
            stage = "startup"
            daemon_start = time.monotonic()
            with output.open("wb") as stream:
                daemon = subprocess.Popen(
                    ["warp-svc", "--accept-tos"], env=env, cwd=root,
                    stdout=stream, stderr=subprocess.STDOUT,
                )
            deadline = time.monotonic() + 7
            while daemon.poll() is None and time.monotonic() < deadline:
                status = run_cli(env, "status")
                if status.returncode == 0:
                    result["cli_ready_ms"] = round((time.monotonic() - daemon_start) * 1000)
                    break
                time.sleep(0.15)
            result["daemon_alive_after_startup"] = daemon.poll() is None
            result["startup_exit_code"] = daemon.poll()
            if "cli_ready_ms" in result:
                if secret_arn:
                    stage = "connect"
                    ready = wait_proxy(daemon, env, result)
                    result["mdm_active"] = "Active:" in run_cli(env, "mdm", "get-configs").stdout
                    settings = run_cli(env, "settings").stdout.lower().splitlines()
                    result["masque_setting"] = any("protocol" in line and "masque" in line for line in settings)
                    result["local_proxy_setting"] = any("mode:" in line and "proxy" in line for line in settings)
                    registration = run_cli(env, "registration", "show")
                    result["registration_visible"] = registration.returncode == 0
                    if result["registration_visible"]:
                        identifiers = re.findall(
                            r"^(?:Device|Registration) ID:\s*([0-9a-f-]{36})\s*$",
                            registration.stdout, flags=re.IGNORECASE | re.MULTILINE,
                        )
                        result["registration_ids"] = identifiers
                    if ready:
                        result["proxy_ready_ms"] = round((time.monotonic() - daemon_start) * 1000)
                        stage = "https_connect"
                        connect_probe(result)
                else:
                    stage = "configure_proxy"
                    result["proxy_mode_set"] = run_cli(env, "mode", "proxy").returncode == 0
                    result["masque_set"] = run_cli(env, "tunnel", "protocol", "set", "MASQUE").returncode == 0
            pid_status = Path(f"/proc/{daemon.pid}/status")
            if pid_status.exists():
                for line in pid_status.read_text().splitlines():
                    if line.startswith(("VmHWM:", "Threads:")):
                        key, value = line.split(":", 1)
                        result[key] = int(value.split()[0])
        except Exception as error:
            result["failure_stage"] = stage
            result["error_type"] = type(error).__name__
        finally:
            if daemon is not None and daemon.poll() is None and secret_arn:
                try:
                    run_cli(env, "disconnect")
                except (OSError, subprocess.TimeoutExpired):
                    pass
            result["daemon_cleanup"] = stop(daemon)
            result["dbus_cleanup"] = stop(bus)
            if output.exists():
                startup_diagnostics(output, logs, result)
    result["state_removed"] = not root.exists()
    result["explicit_proxy_refused_after"] = proxy_refused()
    result["child_max_rss_kib"] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    result["elapsed_ms"] = round((time.monotonic() - start) * 1000)
    return result


if __name__ == "__main__":
    print(json.dumps(handler({"dbus": "--dbus" in sys.argv}, None), indent=2))
