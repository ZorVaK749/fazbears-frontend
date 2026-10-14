"""SSM deployment of approved EV2 images; never prints credentials.

Run as root on the service EC2. Requires the approved pre-deployment backup.
Default: three services. --frontend: only frontend. Does not delete containers.
HTTP checks do not certify authentication, RabbitMQ, or the checkout flow.
"""

import copy
import http.client
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import urlopen


BACKUPS = {
    "ms-orden": ("pre-ev2-20261014T063647Z-072ebd2c", 8084, "orden"),
    "ms-notificaciones": ("pre-ev2-20261014T063647Z-f85824a5", 8085, "notificaciones"),
    "ms-reportes": ("pre-ev2-20261014T063647Z-e8622e65", 8086, "reportes"),
}
FRONTEND_BACKUP = {
    "fz-frontend": ("pre-ev2-20261014T063648Z-ed98d845", 80, "frontend"),
}


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.urls.append(attrs["src"])
        if tag == "link" and attrs.get("rel") == "stylesheet" and attrs.get("href"):
            self.urls.append(attrs["href"])


def frontend_http_check(port):
    base = f"http://127.0.0.1:{port}/"
    for path in ("", "catalogo", "checkout", "reportes"):
        with urlopen(base + path, timeout=3) as response:
            html = response.read(2_000_000).decode("utf-8")
            if response.status != 200 or "<app-root" not in html:
                raise RuntimeError("Frontend did not serve the Angular HTML shell")
        if not path:
            parser = Assets()
            parser.feed(html)
            assets = set()
            for source in parser.urls:
                url = urljoin(base, source)
                if urlsplit(url).netloc == urlsplit(base).netloc:
                    assets.add(url)
            if not any(urlsplit(url).path.endswith(".js") for url in assets):
                raise RuntimeError("Angular JavaScript asset missing from index")
            if not any(urlsplit(url).path.endswith(".css") for url in assets):
                raise RuntimeError("Angular CSS asset missing from index")
            for url in sorted(assets):
                with urlopen(url, timeout=3) as asset:
                    content_type = asset.headers.get("Content-Type", "").lower()
                    suffix = urlsplit(url).path
                    if asset.status != 200 or not asset.read(1):
                        raise RuntimeError("Frontend asset unavailable or empty")
                    if suffix.endswith(".css") and "text/css" not in content_type:
                        raise RuntimeError("Unexpected CSS content type")
                    if suffix.endswith(".js") and not any(t in content_type for t in ("javascript", "ecmascript")):
                        raise RuntimeError("Unexpected JavaScript content type")


def frontend_ready(name, image_id, port):
    for _ in range(60):
        state = inspect(name)
        if state is None or state["Image"] != image_id or state.get("RestartCount", 0):
            raise RuntimeError("Unexpected frontend image or container restart")
        if state["State"]["Status"] in ("dead", "exited"):
            raise RuntimeError("Frontend exited")
        try:
            frontend_http_check(port)
        except (HTTPError, URLError, TimeoutError, OSError, RuntimeError):
            time.sleep(2)
            continue
        time.sleep(10)
        stable = inspect(name)
        if not stable or not stable["State"]["Running"] or stable.get("RestartCount", 0):
            raise RuntimeError("Frontend did not remain running")
        frontend_http_check(port)
        print("HTTP local 200: Angular, rutas SPA y archivos JS/CSS comprobados.")
        print("Imagen frontend verificada y proceso estable; login/compra aun no comprobados.")
        return
    raise RuntimeError("Frontend HTML/assets startup verification timed out")


class DockerSocket(http.client.HTTPConnection):
    def __init__(self):
        super().__init__("localhost", timeout=60)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/var/run/docker.sock")


def docker(*args):
    result = subprocess.run(["docker", *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Docker operation failed: " + args[0])
    return result.stdout.strip()


def inspect(name):
    result = subprocess.run(
        ["docker", "container", "inspect", name], capture_output=True, text=True
    )
    return json.loads(result.stdout)[0] if result.returncode == 0 else None


def creation_payload(current, original_image, new_image, release):
    config = copy.deepcopy(new_image["Config"])
    config["Env"] = current["Config"].get("Env", [])
    # Preserve intentional runtime overrides, not defaults from the old image.
    for key in ("Cmd", "Entrypoint", "User", "WorkingDir", "Healthcheck", "StopSignal"):
        if current["Config"].get(key) != original_image["Config"].get(key):
            config[key] = current["Config"].get(key)
    for key in ("Tty", "OpenStdin", "StdinOnce", "Domainname"):
        config[key] = current["Config"].get(key)
    hostname = current["Config"].get("Hostname", "")
    if hostname and hostname != current["Id"][:12]:
        config["Hostname"] = hostname
    config["Labels"] = {
        **(config.get("Labels") or {}),
        **(current["Config"].get("Labels") or {}),
        "fazbear.release.commit": release["commit"],
        "fazbear.release.image": release["new_image"],
    }
    config["Image"] = release["new_image_id"]
    config["HostConfig"] = copy.deepcopy(current["HostConfig"])
    config["HostConfig"]["RestartPolicy"] = {
        "Name": "unless-stopped", "MaximumRetryCount": 0
    }
    return config


def ready(name, image_id, port, service):
    if service == "frontend":
        return frontend_ready(name, image_id, port)
    url = f"http://127.0.0.1:{port}/api/{service}/health"
    for _ in range(90):
        state = inspect(name)
        if state is None or state["Image"] != image_id:
            raise RuntimeError("Unexpected container or image during verification")
        if state.get("RestartCount", 0) or state["State"]["Status"] in ("dead", "exited"):
            raise RuntimeError("New container exited or restarted")
        code = None
        try:
            with urlopen(url, timeout=2) as response:
                code = response.status
        except HTTPError as error:
            code = error.code
        except (URLError, TimeoutError, OSError):
            pass
        if code in (200, 401):
            time.sleep(10)
            stable = inspect(name)
            if stable and stable["State"]["Running"] and not stable.get("RestartCount", 0):
                print(f"HTTP local={code}; proceso estable, imagen verificada.")
                return
            raise RuntimeError("New container did not remain running")
        time.sleep(2)
    raise RuntimeError("Application HTTP startup timed out")


def main(frontend=False):
    os.umask(0o077)
    backups = FRONTEND_BACKUP if frontend else BACKUPS
    found = [(name, inspect(name)) for name in backups]
    found = [(name, state) for name, state in found if state]
    if len(found) != 1:
        raise RuntimeError("Expected exactly one supported service on this EC2")
    name, current = found[0]
    folder, port, service = backups[name]
    backup = Path("/var/lib/fazbear-backups") / folder
    release = json.loads((backup / "release.json").read_text())
    saved = json.loads((backup / "container-private.json").read_text())
    if release["container"] != name:
        raise RuntimeError("Backup belongs to a different service")
    new_image = json.loads(docker("image", "inspect", release["new_image"]))[0]
    if new_image["Id"] != release["new_image_id"]:
        raise RuntimeError("New image digest does not match the approved release")
    if current["Image"] == release["new_image_id"]:
        ready(name, release["new_image_id"], port, service)
        print("La version aprobada ya estaba desplegada; no se reemplazo otra vez.")
        return
    if current["Id"] != saved["Id"] or current["Image"] != release["previous_image_id"]:
        raise RuntimeError("Current container differs from the approved backup")
    if current["Config"].get("Env") != saved["Config"].get("Env"):
        raise RuntimeError("Runtime environment changed since backup; review required")
    if current.get("Mounts") or current["HostConfig"]["NetworkMode"] not in ("default", "bridge"):
        raise RuntimeError("Mounts or custom networking require a reviewed deployment")
    if current["HostConfig"].get("AutoRemove") or current["HostConfig"].get("ContainerIDFile"):
        raise RuntimeError("Unsupported automatic removal or container ID file")
    previous = release["previous_container_name_for_deploy"]
    candidate = previous + "-candidate"
    if inspect(previous) or inspect(candidate):
        raise RuntimeError("Previous deployment artifacts exist; review before continuing")
    original_image = json.loads(docker("image", "inspect", current["Image"]))[0]
    payload = creation_payload(current, original_image, new_image, release)
    api_version = docker("version", "--format", "{{.Server.APIVersion}}")
    connection = DockerSocket()
    try:
        connection.request("POST", f"/v{api_version}/containers/create?name={quote(candidate)}",
                           body=json.dumps(payload), headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        body = response.read().decode()
        if response.status != 201:
            (backup / "create-error-private.txt").write_text(body)
            raise RuntimeError("Candidate creation failed; current service was not stopped")
    finally:
        connection.close()
    renamed = False
    stopped = False
    try:
        docker("stop", "--time", "30", name)
        stopped = True
        docker("rename", name, previous)
        renamed = True
        # Prevent both versions from starting after a daemon/instance restart.
        docker("update", "--restart", "no", previous)
        docker("rename", candidate, name)
        docker("start", name)
        ready(name, release["new_image_id"], port, service)
    except Exception:
        if renamed:
            result = subprocess.run(["bash", str(backup / "rollback.sh")], capture_output=True, text=True)
            (backup / "rollback-result-private.txt").write_text(result.stdout + result.stderr)
            print("Rollback ejecutado." if result.returncode == 0 else
                  "ATENCION: rollback incompleto; requiere revision antes de continuar.")
        elif stopped:
            docker("start", name)
            print("Contenedor anterior arrancado de nuevo.")
        raise
    (backup / "deployed.json").write_text(json.dumps({
        "container": name, "commit": release["commit"],
        "image_id": release["new_image_id"], "previous_container": previous,
        "deployed_at_epoch": int(time.time()),
    }, indent=2))
    print(f"DESPLEGADO: {name}, commit={release['commit']}, imagen={release['new_image']}")
    print(f"Anterior conservado y sin autoarranque: {previous}")
    print("Entrega E2E: requiere compra autenticada y comprobaciones posteriores.")


def self_test():
    current = {
        "Id": "a" * 64,
        "Config": {"Env": ["EXAMPLE_SECRET=test"], "Cmd": ["old"],
                   "Hostname": "a" * 12, "Labels": None},
        "HostConfig": {"PortBindings": {"8085/tcp": [{"HostIp": "", "HostPort": "8085"}]},
                       "RestartPolicy": {"Name": "no"}},
    }
    original = {"Config": copy.deepcopy(current["Config"])}
    new = {"Config": {"Cmd": ["new"], "Labels": {"example": "label"}}}
    release = {"commit": "test", "new_image": "example:test", "new_image_id": "sha256:test"}
    before = copy.deepcopy(current)
    payload = creation_payload(current, original, new, release)
    assert current == before
    assert payload["Env"] == current["Config"]["Env"]
    assert payload["Cmd"] == ["new"]
    assert payload["HostConfig"]["PortBindings"] == current["HostConfig"]["PortBindings"]
    assert payload["HostConfig"]["RestartPolicy"]["Name"] == "unless-stopped"
    assert payload["Image"] == "sha256:test"
    assert "Hostname" not in payload
    current["Config"]["Cmd"] = ["custom"]
    assert creation_payload(current, original, new, release)["Cmd"] == ["custom"]
    parser = Assets()
    parser.feed('<app-root></app-root><script src="main.js"></script><link rel="stylesheet" href="styles.css">')
    assert parser.urls == ["main.js", "styles.css"]
    print("Self-test OK: entorno, puertos, version y overrides preservados. Docker no ejecutado.")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif not sys.argv[1:]:
            main()
        elif sys.argv[1:] == ["--frontend"]:
            main(frontend=True)
        else:
            raise RuntimeError("Unsupported arguments")
    except Exception as error:
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(f"ERROR: {detail}. No continuar con compras ni otra tarea.")
        raise SystemExit(1)
