"""Deploy the approved publisher v2 on ms-orden, preserving its RabbitMQ config.

No secret input: the existing RabbitMQ environment is read locally from the
current container and never printed. Default mode is a read-only precheck of
the exact inventory and broker topology; --apply performs a private backup,
candidate creation, swap with automatic rollback, HTTP readiness and a final
verification that all three consumer queues still have live consumers and
empty DLQs. Run as root on ec2-orden; Run Command is acceptable.
"""

import base64
import copy
from datetime import datetime, timezone
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
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener


NAME = "ms-orden"
PORT = 8084
SERVICE = "orden"
CURRENT_IMAGE = "sha256:560bcdbaa954caeb70019836c481d86a330bbcf2cabb2d85330215f827f09ed6"
NEW_IMAGE = "sha256:99c0fd02d5d06538477bb83d7a4fc34891f8a0e81cf15103fcb4e4a0770a5749"
NEW_TAG = "fazbear-orden:ev2-1ace4a6"
APP_COMMIT = "1ace4a6"
GIT_COMMIT = "1ace4a678f014cdf9b0c0211d80b5703d2114c62"
PREVIOUS_COMMIT = "241dd42"
EXPECTED_CONFIG_REVISION = "20261014T114223Z-f0ce42f7"
EXPECTED_ENV = {
    "JAVA_HOME", "JAVA_VERSION", "LANG", "LANGUAGE", "LC_ALL", "PATH",
    "RABBITMQ_HOST", "RABBITMQ_PASS", "RABBITMQ_PORT", "RABBITMQ_USER", "RABBITMQ_VHOST",
    "SPRING_RABBITMQ_HOST", "SPRING_RABBITMQ_PASSWORD", "SPRING_RABBITMQ_PORT",
    "SPRING_RABBITMQ_SSL_ENABLED", "SPRING_RABBITMQ_USERNAME", "SPRING_RABBITMQ_VIRTUAL_HOST",
}
EXPECTED_LABELS = {
    "fazbear.config.revision": EXPECTED_CONFIG_REVISION,
    "fazbear.release.commit": PREVIOUS_COMMIT,
    "fazbear.release.image": "fazbear-orden:ev2-" + PREVIOUS_COMMIT,
}
EXPECTED_PORTS = {"8084/tcp": [{"HostIp": "", "HostPort": "8084"}]}
EXCHANGE = "pedidos.exchange"
DLX = "pedidos.dlx"
ROUTING_KEY = "pedido.creado"
QUEUE_PREFIX = "pedido.creado."
SERVICES = ("notificaciones", "reportes", "productos")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def settings_from_env(env_items):
    """Read broker settings locally; callers must never print the result."""
    env = dict(item.split("=", 1) for item in env_items if "=" in item)
    required = ("RABBITMQ_HOST", "RABBITMQ_PORT", "RABBITMQ_USER", "RABBITMQ_PASS")
    missing = [key for key in required if not env.get(key)]
    if missing:
        raise RuntimeError("Faltan variables RabbitMQ requeridas: " + ", ".join(missing))
    host = env["RABBITMQ_HOST"]
    if not re.fullmatch(r"[A-Za-z0-9.-]+", host) or host.lower().startswith("tu_host"):
        raise RuntimeError("El host RabbitMQ del contenedor no es valido.")
    user = env["RABBITMQ_USER"]
    if user.upper().startswith("TU_USUARIO"):
        raise RuntimeError("El usuario RabbitMQ del contenedor parece un ejemplo.")
    try:
        port = int(env["RABBITMQ_PORT"])
    except ValueError:
        raise RuntimeError("El puerto RabbitMQ del contenedor no es numerico.") from None
    if not 1 <= port <= 65535:
        raise RuntimeError("El puerto RabbitMQ del contenedor esta fuera de rango.")
    vhost = env.get("RABBITMQ_VHOST") or "/"
    for value in (host, user, vhost):
        if any(ch in value for ch in "\x00\n\r"):
            raise RuntimeError("El entorno RabbitMQ contiene caracteres invalidos.")
    tls = env.get("SPRING_RABBITMQ_SSL_ENABLED", "false").lower() == "true"
    return host, port, tls, user, env["RABBITMQ_PASS"], vhost


def mq_get(settings, path, missing_ok=False):
    host, port, tls, user, password, vhost = settings
    auth = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
    opener = build_opener(NoRedirect())
    request = Request(f"https://{host}/api{path}",
                      headers={"Authorization": auth, "Accept": "application/json"})
    try:
        with opener.open(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        raise RuntimeError(f"CloudAMQP Management HTTP {error.code}.") from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("No se pudo validar Management por HTTPS.") from None


def check_topology(settings):
    host, port, tls, user, password, vhost = settings
    encoded = quote(vhost, safe="")
    identity = mq_get(settings, "/whoami")
    if identity.get("name") != user:
        raise RuntimeError("La identidad del broker no coincide.")
    bindings = mq_get(settings, f"/exchanges/{encoded}/{EXCHANGE}/bindings/source") or []
    for service in SERVICES:
        name = QUEUE_PREFIX + service + ".queue"
        queue = mq_get(settings, f"/queues/{encoded}/{name}")
        if queue is None or not queue.get("durable") or (queue.get("consumers") or 0) < 1:
            raise RuntimeError(f"La cola de {service} no tiene consumidor durable activo.")
        if not any(item.get("destination") == name and item.get("routing_key") == ROUTING_KEY
                   for item in bindings):
            raise RuntimeError(f"Falta el binding de {service} a {EXCHANGE}.")
        dlq = mq_get(settings, f"/queues/{encoded}/{name}.dlq")
        if dlq is None or not dlq.get("durable"):
            raise RuntimeError(f"La DLQ de {service} no existe o no es durable.")
        if (dlq.get("messages") or 0) > 0:
            raise RuntimeError(f"La DLQ de {service} tiene mensajes; revision manual, no purgar.")
    for exchange_name in (EXCHANGE, DLX):
        exchange = mq_get(settings, f"/exchanges/{encoded}/{exchange_name}", missing_ok=True)
        if exchange is None or exchange.get("type") != "direct":
            raise RuntimeError(f"El exchange {exchange_name} direct no existe.")
    try:
        with socket.create_connection((host, port), timeout=10) as connection:
            if tls:
                with ssl.create_default_context().wrap_socket(connection, server_hostname=host):
                    pass
    except (TimeoutError, OSError):
        raise RuntimeError("Puerto AMQP o TLS inaccesible.") from None


def precheck_current(current):
    config = current["Config"]
    if current["Image"] != CURRENT_IMAGE or config.get("Image") != CURRENT_IMAGE:
        raise RuntimeError("La imagen actual no coincide con el inventario aprobado 241dd42.")
    state = current.get("State", {})
    if not state.get("Running") or current.get("RestartCount"):
        raise RuntimeError("El contenedor actual no esta estable y en ejecucion.")
    env_keys = {item.split("=", 1)[0] for item in config.get("Env") or [] if "=" in item}
    if env_keys != EXPECTED_ENV:
        raise RuntimeError("El entorno actual difiere del inventario aprobado; revision privada requerida.")
    if (config.get("Labels") or {}) != EXPECTED_LABELS:
        raise RuntimeError("Las etiquetas actuales no coinciden con la revision de configuracion aprobada.")
    host_config = current["HostConfig"]
    if host_config.get("PortBindings") != EXPECTED_PORTS:
        raise RuntimeError("Los puertos publicados difieren del inventario aprobado.")
    if host_config.get("NetworkMode") not in ("default", "bridge") or current.get("Mounts"):
        raise RuntimeError("Montajes o red personalizados requieren revision.")
    if host_config.get("AutoRemove") or host_config.get("ContainerIDFile"):
        raise RuntimeError("Remocion automatica o container ID file no soportados.")
    policy = host_config.get("RestartPolicy") or {}
    if policy.get("Name") != "unless-stopped" or policy.get("MaximumRetryCount"):
        raise RuntimeError("La politica de reinicio difiere de unless-stopped.")
    if config.get("Cmd") is not None or config.get("User"):
        raise RuntimeError("Cmd o User personalizados requieren revision.")
    if config.get("Entrypoint") != ["java", "-jar", "app.jar"]:
        raise RuntimeError("El entrypoint actual no es java -jar app.jar.")


def rollback_script(name, previous, expected):
    return """#!/bin/bash
set -eu
name=%s
previous=%s
expected=%s
actual=$(docker container inspect --format '{{.Image}}' "$previous")
[ "$actual" = "$expected" ] || { echo "ERROR: imagen anterior inesperada"; exit 1; }
if docker container inspect "$name" >/dev/null 2>&1; then
  docker stop "$name"
  docker rename "$name" "$name-failed-$(date -u +%%Y%%m%%dT%%H%%M%%SZ)"
fi
docker rename "$previous" "$name"
docker update --restart unless-stopped "$name" >/dev/null
docker start "$name"
echo "Version anterior restaurada; verificar el servicio."
""" % (shlex.quote(name), shlex.quote(previous), shlex.quote(expected))


def main(apply=False):
    if os.geteuid() != 0:
        raise RuntimeError("Ejecutar como root en ec2-orden.")
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location(
        "fazbear_deployment", Path(__file__).with_name("deploy-ev2-services.py")
    )
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    current = engine.inspect(NAME)
    if current is None:
        raise RuntimeError("No se encontro el contenedor ms-orden en esta EC2.")
    already = current["Image"] == NEW_IMAGE
    new_image = None
    if not already:
        precheck_current(current)
        new_image = json.loads(engine.docker("image", "inspect", NEW_TAG))[0]
        if new_image["Id"] != NEW_IMAGE:
            raise RuntimeError("La imagen nueva no coincide con el SHA-256 aprobado.")
        if not (new_image["Config"].get("Entrypoint") or new_image["Config"].get("Cmd")):
            raise RuntimeError("La imagen nueva no declara punto de entrada.")
    settings = settings_from_env(current["Config"].get("Env") or [])
    check_topology(settings)
    if already:
        engine.ready(NAME, NEW_IMAGE, PORT, SERVICE)
        print("Version aprobada ya activa; nada fue modificado.")
        print("Topologia verificada: 3 colas con consumidor, DLQs en 0, bindings y AMQP correctos.")
        return
    print(f"PLAN: {PREVIOUS_COMMIT} -> {APP_COMMIT} ({NEW_TAG}), puerto {PORT}, "
          "entorno RabbitMQ preservado, respaldo privado y rollback automatico.")
    if not apply:
        print("PRECHECK OK. Ningun servicio fue modificado; repetir con --apply para desplegar.")
        return
    host, port, tls, user, password, vhost = settings
    revision = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    backup = Path("/var/lib/fazbear-backups") / ("v2-" + NAME + "-" + revision)
    backup.mkdir(parents=True, mode=0o700)
    (backup / "container-private.json").write_text(json.dumps(current, indent=2))
    previous = NAME + "-prev-v2-" + revision
    candidate = NAME + "-v2-next-" + revision
    if engine.inspect(previous) or engine.inspect(candidate):
        raise RuntimeError("Hay artefactos de un despliegue anterior; revision manual requerida.")
    rollback_tag = "fazbear-orden:rollback-v2-" + revision
    engine.docker("image", "tag", current["Image"], rollback_tag)
    original_image = json.loads(engine.docker("image", "inspect", current["Image"]))[0]
    release = {"container": NAME, "branch": "main", "commit": APP_COMMIT,
               "git_commit": GIT_COMMIT, "new_image": NEW_TAG, "new_image_id": NEW_IMAGE,
               "port": PORT}
    payload = engine.creation_payload(current, original_image, new_image, release)
    # El entorno actual, incluida la configuracion RabbitMQ corregida, se preserva tal cual.
    payload["Env"] = copy.deepcopy(current["Config"].get("Env") or [])
    (backup / "release.json").write_text(json.dumps(release, indent=2))
    rollback_path = backup / "rollback.sh"
    rollback_path.write_text(rollback_script(NAME, previous, CURRENT_IMAGE))
    rollback_path.chmod(0o700)
    subprocess.run(["bash", "-n", str(rollback_path)], check=True)
    print("Respaldo privado: " + str(backup), flush=True)
    client = engine.DockerSocket()
    api_version = engine.docker("version", "--format", "{{.Server.APIVersion}}")
    try:
        client.request("POST", f"/v{api_version}/containers/create?name={quote(candidate)}",
                       body=json.dumps(payload), headers={"Content-Type": "application/json"})
        response = client.getresponse()
        body = response.read().decode()
        if response.status != 201:
            (backup / "create-error-private.txt").write_text(body)
            raise RuntimeError("No se pudo crear candidato; contenedor original intacto.")
    finally:
        client.close()
    renamed = False
    try:
        engine.docker("stop", "--time", "30", NAME)
        engine.docker("rename", NAME, previous)
        renamed = True
        engine.docker("update", "--restart", "no", previous)
        engine.docker("rename", candidate, NAME)
        engine.docker("start", NAME)
        engine.ready(NAME, NEW_IMAGE, PORT, SERVICE)
        check_topology(settings)
    except Exception:
        if renamed:
            result = subprocess.run(["bash", str(rollback_path)], capture_output=True, text=True)
            (backup / "rollback-result-private.txt").write_text(result.stdout + result.stderr)
            print("Rollback ejecutado." if result.returncode == 0 else
                  "ATENCION: rollback incompleto; revisar antes de continuar.")
        elif current["State"]["Running"]:
            engine.docker("start", NAME)
        raise
    receipt = {"container": NAME, "app_commit": APP_COMMIT, "image_id": NEW_IMAGE,
               "config_revision": revision, "previous_container": previous,
               "amqp_tls": tls, "amqp_port": port,
               "previous_config_revision": EXPECTED_CONFIG_REVISION}
    (backup / "deployed.json").write_text(json.dumps(receipt, indent=2))
    print(f"DESPLEGADO: {NAME}, commit={APP_COMMIT}, imagen={NEW_TAG}")
    print("Revision de despliegue: " + revision)
    print("Respaldo privado: " + str(backup))
    print("Anterior conservado y sin autoarranque: " + previous)
    print("Topologia verificada tras el cambio: 3 colas con consumidor, DLQs en 0, bindings y AMQP correctos.")
    print("Siguiente paso: compra controlada (stock 20 -> 19) y verificacion de correo, reporte y DLQs.")


def self_test():
    assert NEW_TAG.endswith(APP_COMMIT) and GIT_COMMIT.startswith(APP_COMMIT)
    assert NEW_IMAGE.startswith("sha256:") and len(NEW_IMAGE) == 71
    assert CURRENT_IMAGE != NEW_IMAGE
    env = ["JAVA_HOME=/x", "RABBITMQ_HOST=broker.example.com", "RABBITMQ_PORT=5671",
           "RABBITMQ_USER=user", "RABBITMQ_PASS=secret", "RABBITMQ_VHOST=vh",
           "SPRING_RABBITMQ_SSL_ENABLED=true"]
    host, port, tls, user, password, vhost = settings_from_env(env)
    assert (host, port, tls, user, password, vhost) == (
        "broker.example.com", 5671, True, "user", "secret", "vh")
    assert settings_from_env(
        ["RABBITMQ_HOST=broker.example.com", "RABBITMQ_PORT=5672", "RABBITMQ_USER=u",
         "RABBITMQ_PASS=p", "RABBITMQ_VHOST="])[5] == "/"
    assert settings_from_env(
        ["RABBITMQ_HOST=broker.example.com", "RABBITMQ_PORT=5672", "RABBITMQ_USER=u",
         "RABBITMQ_PASS=p"])[5] == "/"
    broken = [
        ["RABBITMQ_HOST=TU_HOST.cloudamqp.com", "RABBITMQ_PORT=5672",
         "RABBITMQ_USER=u", "RABBITMQ_PASS=p", "RABBITMQ_VHOST=/"],
        ["RABBITMQ_HOST=broker.example.com", "RABBITMQ_USER=TU_USUARIO", "RABBITMQ_PORT=5672",
         "RABBITMQ_PASS=p", "RABBITMQ_VHOST=/"],
        ["RABBITMQ_HOST=broker.example.com", "RABBITMQ_PORT=abc",
         "RABBITMQ_USER=u", "RABBITMQ_PASS=p", "RABBITMQ_VHOST=/"],
        ["RABBITMQ_HOST=broker.example.com", "RABBITMQ_PORT=70000",
         "RABBITMQ_USER=u", "RABBITMQ_PASS=p", "RABBITMQ_VHOST=/"],
        ["RABBITMQ_HOST=broker example.com", "RABBITMQ_PORT=5672",
         "RABBITMQ_USER=u", "RABBITMQ_PASS=p", "RABBITMQ_VHOST=/"],
        ["RABBITMQ_HOST=broker.example.com", "RABBITMQ_PORT=5672",
         "RABBITMQ_USER=u", "RABBITMQ_VHOST=/"],
    ]
    for invalid in broken:
        try:
            settings_from_env(invalid)
        except RuntimeError:
            continue
        raise AssertionError("Entorno invalido aceptado: " + repr(invalid))
    assert EXPECTED_LABELS["fazbear.release.commit"] == PREVIOUS_COMMIT
    assert EXPECTED_LABELS["fazbear.config.revision"] == EXPECTED_CONFIG_REVISION
    assert set(SERVICES) == {"notificaciones", "reportes", "productos"}
    script = rollback_script(NAME, NAME + "-prev-test", CURRENT_IMAGE)
    subprocess.run(["bash", "-n"], input=script, text=True, check=True)
    assert "docker rm" not in script and 'docker start "$name"' in script
    print("Self-test OK: imagenes, entorno RabbitMQ local, etiquetas, colas y rollback.")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif sys.argv[1:] in ([], ["--apply"]):
            main(apply=sys.argv[1:] == ["--apply"])
        else:
            raise RuntimeError("Argumentos no permitidos")
    except Exception as error:
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("ERROR DE DESPLIEGO DE ORDEN: " + detail)
        raise SystemExit(1)
