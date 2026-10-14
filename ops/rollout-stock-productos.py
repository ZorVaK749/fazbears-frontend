"""Configure and deploy the approved stock consumer on ms-productos.

Interactive only: run with sudo from a real SSM terminal, never Run Command.
The CloudAMQP URL is read with getpass; no secrets reach Git, chat, arguments
or stdout. Verifies the exact current container inventory and broker topology,
backs up the container, deploys fazbear-productos:ev2-60bbd62 with RabbitMQ
settings, swaps with automatic rollback, then requires HTTP readiness AND a
live consumer bound to pedido.creado.productos.queue before reporting success.
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
import time
import uuid
import warnings
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


NAME = "ms-productos"
PORT = 8081
SERVICE = "productos"
CURRENT_IMAGE = "sha256:8ff33dfcf74d3ae1d43f30f3dc685512433221a0bfb958c95e56ba616859d764"
CURRENT_TAG = "fazbear-productos:2.0"
NEW_IMAGE = "sha256:aa6b615fe5871feaa9bd690b1f6989e41d460d8b197b97ad8585606d3114fe23"
NEW_TAG = "fazbear-productos:ev2-60bbd62"
GIT_COMMIT = "60bbd6297a0c8c69d76301a7fce5d983f6d60a9e"
APP_COMMIT = "60bbd62"
EXPECTED_ENV = {"JAVA_HOME", "JAVA_VERSION", "LANG", "LANGUAGE", "LC_ALL", "PATH"}
EXPECTED_PORTS = {"8081/tcp": [{"HostIp": "", "HostPort": "8081"}]}
STOCK_QUEUE = "pedido.creado.productos.queue"
DLQ = STOCK_QUEUE + ".dlq"
EXCHANGE = "pedidos.exchange"
DLX = "pedidos.dlx"
ROUTING_KEY = "pedido.creado"


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


def queue_path(settings, name):
    return "/queues/" + quote(settings[5], safe="") + "/" + name


def mq_get(settings, path, missing_ok=False):
    host, port, tls, user, password, vhost = settings
    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    opener = build_opener(NoRedirect())
    request = Request(f"https://{host}/api{path}",
                      headers={"Authorization": "Basic " + auth, "Accept": "application/json"})
    try:
        with opener.open(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        raise RuntimeError(f"CloudAMQP Management HTTP {error.code}; no se modifico el servicio.") from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("No se pudo validar Management por HTTPS; no se modifico el servicio.") from None


def validate_broker(settings):
    host, port, tls, user, password, vhost = settings
    identity = mq_get(settings, "/whoami")
    if identity.get("name") != user:
        raise RuntimeError("La identidad del broker no coincide; no se modifico el servicio.")
    for service in ("notificaciones", "reportes"):
        queue = mq_get(settings, queue_path(settings, f"pedido.creado.{service}.queue"))
        if queue is None or not queue.get("durable") or (queue.get("consumers") or 0) < 1:
            raise RuntimeError("El broker/vhost no tiene los consumidores activos; revisar arranque del laboratorio.")
    encoded = quote(vhost, safe="")
    for exchange_name in (EXCHANGE, DLX):
        exchange = mq_get(settings, f"/exchanges/{encoded}/{exchange_name}", missing_ok=True)
        if exchange is None or exchange.get("type") != "direct":
            raise RuntimeError(f"El exchange {exchange_name} direct no existe; revisar topologia.")
    try:
        with socket.create_connection((host, port), timeout=10) as connection:
            if tls:
                with ssl.create_default_context().wrap_socket(connection, server_hostname=host):
                    pass
    except (TimeoutError, OSError):
        raise RuntimeError("Puerto AMQP o TLS inaccesible; no se modifico el servicio.") from None
    print("Identidad, consumidores, exchanges y acceso TCP/TLS al puerto AMQP verificados.")


def stock_queue_verdict(stock, dlq):
    """Problems that require manual review; an absent queue is expected pre-deploy."""
    problems = []
    if stock is not None:
        if (stock.get("consumers") or 0) > 0:
            problems.append("la cola ya tiene consumidores")
        if (stock.get("messages") or 0) > 0:
            problems.append("la cola tiene mensajes pendientes")
    if dlq is not None and (dlq.get("messages") or 0) > 0:
        problems.append("la DLQ tiene mensajes pendientes (no purgar)")
    return problems


def wait_for_stock_consumer(settings, timeout=60):
    deadline = time.time() + timeout
    last = "cola, consumidor o binding pendiente"
    while time.time() < deadline:
        stock = mq_get(settings, queue_path(settings, STOCK_QUEUE), missing_ok=True)
        dlq = mq_get(settings, queue_path(settings, DLQ), missing_ok=True)
        if (stock and stock.get("durable") and (stock.get("consumers") or 0) >= 1
                and dlq and dlq.get("durable") and (dlq.get("messages") or 0) == 0):
            encoded = quote(settings[5], safe="")
            bindings = mq_get(settings, f"/exchanges/{encoded}/{EXCHANGE}/bindings/source") or []
            bound = any(item.get("destination") == STOCK_QUEUE
                        and item.get("routing_key") == ROUTING_KEY for item in bindings)
            if bound:
                return (f"consumidores={stock.get('consumers')}, "
                        f"mensajes={stock.get('messages')}, DLQ=0, binding={ROUTING_KEY}")
            last = "binding del exchange pendiente"
        else:
            last = "cola durable, consumidor o DLQ pendiente"
        time.sleep(3)
    raise RuntimeError(f"El consumidor de stock no quedo activo en {timeout}s ({last}).")


def precheck_current(current):
    config = current["Config"]
    if config.get("Image") != CURRENT_TAG or current["Image"] != CURRENT_IMAGE:
        raise RuntimeError("La imagen actual no coincide con el inventario aprobado 2.0.")
    state = current.get("State", {})
    if not state.get("Running") or current.get("RestartCount"):
        raise RuntimeError("El contenedor actual no esta estable y en ejecucion.")
    env_keys = {item.split("=", 1)[0] for item in config.get("Env") or [] if "=" in item}
    if env_keys != EXPECTED_ENV:
        raise RuntimeError("El entorno actual difiere del inventario aprobado; revision privada requerida.")
    if any(key.startswith("fazbear.") for key in config.get("Labels") or {}):
        raise RuntimeError("El contenedor tiene etiquetas de una version gestionada previamente.")
    host_config = current["HostConfig"]
    if host_config.get("PortBindings") != EXPECTED_PORTS:
        raise RuntimeError("Los puertos publicados difieren del inventario aprobado.")
    if host_config.get("NetworkMode") not in ("default", "bridge"):
        raise RuntimeError("Montajes o red personalizados requieren revision.")
    if current.get("Mounts"):
        raise RuntimeError("Montajes personalizados requieren revision.")
    if host_config.get("AutoRemove") or host_config.get("ContainerIDFile"):
        raise RuntimeError("Remocion automatica o container ID file no soportados.")
    policy = host_config.get("RestartPolicy") or {}
    if policy.get("Name") != "unless-stopped" or policy.get("MaximumRetryCount"):
        raise RuntimeError("La politica de reinicio difiere de unless-stopped.")
    if config.get("Cmd") is not None or config.get("User"):
        raise RuntimeError("Cmd o User personalizados requieren revision.")
    if config.get("Entrypoint") != ["java", "-jar", "app.jar"]:
        raise RuntimeError("El entrypoint actual no es java -jar app.jar.")
    print("Inventario ms-productos verificado: imagen 2.0, entorno base, puerto 8081, estable.")


def build_env(current_env, settings):
    host, port, tls, user, password, vhost = settings
    env = dict(item.split("=", 1) for item in current_env if "=" in item)
    env.update({
        "RABBITMQ_HOST": host, "RABBITMQ_PORT": str(port), "RABBITMQ_USER": user,
        "RABBITMQ_PASS": password, "RABBITMQ_VHOST": vhost,
        "RABBITMQ_SSL_ENABLED": "true" if tls else "false",
        "SPRING_RABBITMQ_HOST": host, "SPRING_RABBITMQ_PORT": str(port),
        "SPRING_RABBITMQ_USERNAME": user, "SPRING_RABBITMQ_PASSWORD": password,
        "SPRING_RABBITMQ_VIRTUAL_HOST": vhost,
        "SPRING_RABBITMQ_SSL_ENABLED": "true" if tls else "false",
    })
    return [key + "=" + value for key, value in env.items()]


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


def main():
    if os.geteuid() != 0 or not sys.stdin.isatty():
        raise RuntimeError("Ejecutar con sudo desde la terminal SSM interactiva, no Run Command ni una tuberia.")
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location(
        "fazbear_deployment", Path(__file__).with_name("deploy-ev2-services.py")
    )
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    current = engine.inspect(NAME)
    if current is None:
        raise RuntimeError("No se encontro el contenedor ms-productos en esta EC2.")
    already = current["Image"] == NEW_IMAGE
    if not already:
        precheck_current(current)
        new_image = json.loads(engine.docker("image", "inspect", NEW_TAG))[0]
        if new_image["Id"] != NEW_IMAGE:
            raise RuntimeError("La imagen nueva no coincide con el SHA-256 aprobado.")
        if not (new_image["Config"].get("Entrypoint") or new_image["Config"].get("Cmd")):
            raise RuntimeError("La imagen nueva no declara punto de entrada.")
    warnings.simplefilter("error", getpass.GetPassWarning)
    settings = parse_amqp(getpass.getpass("Pega la AMQP URL completa de CloudAMQP (entrada oculta): "))
    validate_broker(settings)
    if already:
        summary = wait_for_stock_consumer(settings)
        print("Version aprobada ya activa; consumidor verificado. Nada fue modificado.")
        print("Verificacion: " + summary)
        return
    problems = stock_queue_verdict(
        mq_get(settings, queue_path(settings, STOCK_QUEUE), missing_ok=True),
        mq_get(settings, queue_path(settings, DLQ), missing_ok=True),
    )
    if problems:
        raise RuntimeError("La cola de stock requiere revision manual: " + "; ".join(problems) + ". No purgar.")
    print(f"PLAN: {CURRENT_TAG} -> {NEW_TAG} ({APP_COMMIT}), puerto {PORT}, "
          "respaldo privado y rollback automatico.")
    host, port, tls, user, password, vhost = settings
    revision = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    backup = Path("/var/lib/fazbear-backups") / ("stock-" + NAME + "-" + revision)
    backup.mkdir(parents=True, mode=0o700)
    (backup / "container-private.json").write_text(json.dumps(current, indent=2))
    previous = NAME + "-prev-stock-" + revision
    candidate = NAME + "-stock-next-" + revision
    if engine.inspect(previous) or engine.inspect(candidate):
        raise RuntimeError("Hay artefactos de un despliegue anterior; revision manual requerida.")
    rollback_tag = "fazbear-productos:rollback-stock-" + revision
    engine.docker("image", "tag", current["Image"], rollback_tag)
    original_image = json.loads(engine.docker("image", "inspect", current["Image"]))[0]
    release = {"container": NAME, "branch": "VP_AVANCE_EV2", "commit": APP_COMMIT,
               "git_commit": GIT_COMMIT, "new_image": NEW_TAG, "new_image_id": NEW_IMAGE,
               "port": PORT}
    payload = engine.creation_payload(current, original_image, new_image, release)
    payload["Env"] = build_env(current["Config"].get("Env", []), settings)
    payload["Labels"]["fazbear.config.revision"] = revision
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
        summary = wait_for_stock_consumer(settings)
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
               "amqp_tls": tls, "amqp_port": port, "stock_consumer": summary}
    (backup / "config-change.json").write_text(json.dumps(receipt, indent=2))
    print("MS-PRODUCTOS DESPLEGADO CON STOCK: commit=" + APP_COMMIT + ", imagen=" + NEW_TAG)
    print("Revision de configuracion: " + revision)
    print("Respaldo privado: " + str(backup))
    print("Consumidor verificado: " + summary)
    print("Anterior conservado y sin autoarranque: " + previous)
    print("Sin compras aun: orden sigue en 241dd42; un evento v1 caeria a la DLQ sin descontar.")


def self_test():
    assert parse_amqp("amqps://user:p%40ss@example.com/vh%2Ftest") == (
        "example.com", 5671, True, "user", "p@ss", "vh/test")
    assert parse_amqp("amqp://user:pass@example.com/%2F") == (
        "example.com", 5672, False, "user", "pass", "/")
    for invalid in ("https://example.com", "amqp://example.com",
                    "amqp://example.com", "amqp://user:pass@TU_HOST.cloudamqp.com/vh",
                    "amqps://user:pass@example.com/vh?opt=1"):
        try:
            parse_amqp(invalid)
        except RuntimeError:
            continue
        raise AssertionError("Invalid URL accepted: " + invalid)
    assert NEW_TAG.endswith(APP_COMMIT) and GIT_COMMIT.startswith(APP_COMMIT)
    assert NEW_IMAGE.startswith("sha256:") and len(NEW_IMAGE) == 71
    assert CURRENT_IMAGE != NEW_IMAGE
    env = build_env(["JAVA_HOME=/x", "PATH=/p"],
                    ("broker.example.com", 5671, True, "user", "secret", "vh"))
    keys = {item.split("=", 1)[0] for item in env}
    for key in ("JAVA_HOME", "PATH", "RABBITMQ_HOST", "RABBITMQ_PASS",
                "RABBITMQ_SSL_ENABLED", "SPRING_RABBITMQ_PASSWORD",
                "SPRING_RABBITMQ_SSL_ENABLED"):
        assert key in keys
    assert len(env) == 14
    assert stock_queue_verdict(None, None) == []
    assert stock_queue_verdict({"durable": True, "consumers": 0, "messages": 0},
                               {"messages": 0}) == []
    assert stock_queue_verdict({"consumers": 1}, None)
    assert stock_queue_verdict({"messages": 3}, None)
    assert stock_queue_verdict(None, {"messages": 1})
    script = rollback_script(NAME, NAME + "-prev-test", CURRENT_IMAGE)
    subprocess.run(["bash", "-n"], input=script, text=True, check=True)
    assert "docker rm" not in script and 'docker start "$name"' in script
    print("Self-test OK: URL/TLS, inventario, veredicto de cola, entorno y rollback.")


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
        print("ERROR DE DESPLIEGO DE PRODUCTOS: " + detail)
        raise SystemExit(1)
