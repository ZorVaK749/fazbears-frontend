"""Interactive, private RabbitMQ configuration for the approved ms-orden image.

Run from a real SSM terminal, never Run Command: the AMQP URL is read with getpass.
No secrets in arguments, stdout, API Gateway, source code, or command history.
The existing deployment engine is used only for Docker helpers and HTTP readiness.
"""

import base64
from datetime import datetime, timezone
import getpass
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import socket
import ssl
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid
import warnings


APPROVED_IMAGE = "sha256:560bcdbaa954caeb70019836c481d86a330bbcf2cabb2d85330215f827f09ed6"


def parse_amqp(value):
    try:
        url = urlsplit(value.strip())
        host = url.hostname or ""
        if url.scheme not in ("amqp", "amqps") or not re.fullmatch(r"[A-Za-z0-9.-]+", host):
            raise ValueError()
        user = unquote(url.username or "")
        password = unquote(url.password or "")
        vhost = unquote(url.path[1:]) if url.path.startswith("/") and url.path[1:] else "/"
        tls = url.scheme == "amqps"
        port = url.port or (5671 if tls else 5672)
        if not user or not password or url.query or url.fragment or not (1 <= port <= 65535):
            raise ValueError()
        if any("\x00" in text or "\n" in text or "\r" in text for text in (user, password, vhost)):
            raise ValueError()
        if host.lower().startswith("tu_host") or user.upper().startswith("TU_USUARIO"):
            raise ValueError()
        return host, port, tls, user, password, vhost
    except ValueError:
        raise RuntimeError("AMQP URL invalida o con opciones no admitidas; copiar la URL completa de CloudAMQP.") from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_broker(settings):
    host, port, tls, user, password, vhost = settings
    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    opener = build_opener(NoRedirect())

    def get(path):
        req = Request(f"https://{host}/api{path}",
                      headers={"Authorization": "Basic " + auth, "Accept": "application/json"})
        try:
            with opener.open(req, timeout=15) as response:
                return json.load(response)
        except HTTPError as error:
            raise RuntimeError(f"CloudAMQP Management HTTP {error.code}; no se modifico orden.") from None
        except (URLError, TimeoutError, OSError):
            raise RuntimeError("No se pudo validar Management por HTTPS; no se modifico orden.") from None

    identity = get("/whoami")
    if identity.get("name") != user:
        raise RuntimeError("La identidad del broker no coincide; no se modifico orden.")
    for service in ("notificaciones", "reportes"):
        name = f"pedido.creado.{service}.queue"
        q = get("/queues/" + quote(vhost, safe="") + "/" + name)
        if not q.get("durable") or (q.get("consumers") or 0) < 1:
            raise RuntimeError("El broker/vhost no tiene ambos consumidores activos; revisar arranque del laboratorio.")
    try:
        with socket.create_connection((host, port), timeout=10) as connection:
            if tls:
                with ssl.create_default_context().wrap_socket(connection, server_hostname=host):
                    pass
    except (TimeoutError, OSError):
        raise RuntimeError("Puerto AMQP o TLS inaccesible; no se modifico orden.") from None
    print("Credenciales Management, colas/consumidores y acceso TCP/TLS al puerto AMQP verificados.")


def rollback_script(name, previous, was_running):
    return """#!/bin/bash
set -eu
name=%s
previous=%s
expected=%s
actual=$(docker container inspect --format '{{.Image}}' "$previous")
[ "$actual" = "$expected" ] || exit 1
if docker container inspect "$name" >/dev/null 2>&1; then
  docker stop "$name"
  docker rename "$name" "$name-failed-$(date -u +%%Y%%m%%dT%%H%%M%%SZ)"
fi
docker rename "$previous" "$name"
docker update --restart unless-stopped "$name" >/dev/null
%s
echo "Configuracion anterior restaurada; mantiene el problema RabbitMQ original."
""" % (shlex.quote(name), shlex.quote(previous), shlex.quote(APPROVED_IMAGE),
       'docker start "$name"' if was_running else ':')


def main():
    if os.geteuid() != 0 or not sys.stdin.isatty():
        raise RuntimeError("Ejecutar con sudo desde la terminal SSM interactiva, no Run Command ni una tuberia.")
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location(
        "fazbear_deployment", Path(__file__).with_name("deploy-ev2-services.py")
    )
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    name = "ms-orden"
    current = engine.inspect(name)
    if current is None or current["Image"] != APPROVED_IMAGE:
        raise RuntimeError("No se encontro el contenedor orden con la imagen aprobada 241dd42.")
    if current.get("Mounts") or current["HostConfig"]["NetworkMode"] not in ("default", "bridge"):
        raise RuntimeError("Montajes o red personalizados requieren revision previa.")
    env = dict(item.split("=", 1) for item in current["Config"].get("Env", []) if "=" in item)
    if env.get("SPRING_RABBITMQ_ADDRESSES") or env.get("SPRING_APPLICATION_JSON"):
        raise RuntimeError("Hay configuracion avanzada que requiere revision privada.")
    if any("spring.rabbitmq" in env.get(key, "") for key in
           ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS")):
        raise RuntimeError("Hay overrides RabbitMQ por opciones Java; requieren revision privada.")
    if any("spring.rabbitmq" in item for item in
           (current["Config"].get("Cmd") or []) + (current["Config"].get("Entrypoint") or [])):
        raise RuntimeError("Hay overrides RabbitMQ por argumentos; requieren revision privada.")
    warnings.simplefilter("error", getpass.GetPassWarning)
    settings = parse_amqp(getpass.getpass("Pega la AMQP URL completa de CloudAMQP (entrada oculta): "))
    validate_broker(settings)
    host, port, tls, user, password, vhost = settings
    revision = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    backup = Path("/var/lib/fazbear-backups") / ("orden-rabbit-" + revision)
    backup.mkdir(parents=True, mode=0o700)
    (backup / "container-private.json").write_text(json.dumps(current, indent=2))
    previous = name + "-rabbit-prev-" + revision
    candidate = name + "-rabbit-next-" + revision
    rollback_tag = "fazbear-orden:rollback-rabbit-" + revision
    engine.docker("image", "tag", current["Image"], rollback_tag)
    image = json.loads(engine.docker("image", "inspect", APPROVED_IMAGE))[0]
    release = {"commit": "241dd42", "new_image": "fazbear-orden:ev2-241dd42", "new_image_id": APPROVED_IMAGE}
    config = engine.creation_payload(current, image, image, release)
    env.update({
        "RABBITMQ_HOST": host, "RABBITMQ_PORT": str(port), "RABBITMQ_USER": user,
        "RABBITMQ_PASS": password, "RABBITMQ_VHOST": vhost,
        "SPRING_RABBITMQ_HOST": host, "SPRING_RABBITMQ_PORT": str(port),
        "SPRING_RABBITMQ_USERNAME": user, "SPRING_RABBITMQ_PASSWORD": password,
        "SPRING_RABBITMQ_VIRTUAL_HOST": vhost,
        "SPRING_RABBITMQ_SSL_ENABLED": "true" if tls else "false",
    })
    config["Env"] = [key + "=" + value for key, value in env.items()]
    config["Labels"]["fazbear.config.revision"] = revision
    rollback = rollback_script(name, previous, current["State"]["Running"])
    rollback_path = backup / "rollback.sh"
    rollback_path.write_text(rollback)
    rollback_path.chmod(0o700)
    subprocess.run(["bash", "-n", str(rollback_path)], check=True)
    client = engine.DockerSocket()
    api_version = engine.docker("version", "--format", "{{.Server.APIVersion}}")
    try:
        client.request("POST", f"/v{api_version}/containers/create?name={quote(candidate)}",
                       body=json.dumps(config), headers={"Content-Type": "application/json"})
        response = client.getresponse()
        body = response.read().decode()
        if response.status != 201:
            (backup / "create-error-private.txt").write_text(body)
            raise RuntimeError("No se pudo crear candidato; contenedor original intacto.")
    finally:
        client.close()
    renamed = False
    try:
        engine.docker("stop", "--time", "30", name)
        engine.docker("rename", name, previous)
        renamed = True
        engine.docker("update", "--restart", "no", previous)
        engine.docker("rename", candidate, name)
        engine.docker("start", name)
        engine.ready(name, APPROVED_IMAGE, 8084, "orden")
    except Exception:
        if renamed:
            result = subprocess.run(["bash", str(rollback_path)], capture_output=True, text=True)
            (backup / "rollback-result-private.txt").write_text(result.stdout + result.stderr)
            print("Rollback ejecutado." if result.returncode == 0 else "ATENCION: rollback incompleto; revisar antes de continuar.")
        elif current["State"]["Running"]:
            engine.docker("start", name)
        raise
    receipt = {"container": name, "app_commit": "241dd42", "image_id": APPROVED_IMAGE,
               "config_revision": revision, "previous_container": previous,
               "amqp_tls": tls, "amqp_port": port}
    (backup / "config-change.json").write_text(json.dumps(receipt, indent=2))
    print("CONFIGURACION RABBITMQ DE ORDEN ACTUALIZADA. Imagen 241dd42 conservada.")
    print("Revision de configuracion: " + revision)
    print("Respaldo privado: " + str(backup))
    print("No se crearon pedidos ni se publicaron eventos. No repetir aun el pago anterior.")


def self_test():
    assert parse_amqp("amqps://user:p%40ss@example.com/vh%2Ftest") == (
        "example.com", 5671, True, "user", "p@ss", "vh/test")
    assert parse_amqp("amqp://user:pass@example.com/%2F")[5] == "/"
    for invalid in ("https://example.com", "amqp://example.com", "amqp://user:pass@TU_HOST.cloudamqp.com/vh"):
        try:
            parse_amqp(invalid)
        except RuntimeError:
            continue
        raise AssertionError("Invalid URL accepted")
    for running in (True, False):
        script = rollback_script("ms-orden", "ms-orden-prev-test", running)
        subprocess.run(["bash", "-n"], input=script, text=True, check=True)
        assert ('docker start "$name"' in script) == running
    print("Self-test OK: URL/TLS, valores de ejemplo y sintaxis de rollback.")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif not sys.argv[1:]:
            main()
        else:
            raise RuntimeError("Argumentos no permitidos")
    except Exception as error:
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("ERROR DE CONFIGURACION: " + detail)
        raise SystemExit(1)
