"""Remove only the approved obsolete order binding, preserving all queues/messages.

Default: read-only check. --apply: back up the binding, then DELETE that binding.
Existing ms-notificaciones broker credentials stay in memory and are never printed.
"""

import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    if sys.argv[1:] not in ([], ["--apply"]):
        raise RuntimeError("Argumentos no permitidos")
    apply = sys.argv[1:] == ["--apply"]
    os.umask(0o077)
    result = subprocess.run(["docker", "container", "inspect", "ms-notificaciones"],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("No se encontro ms-notificaciones")
    container = json.loads(result.stdout)[0]
    env = dict(item.split("=", 1) for item in container["Config"].get("Env", []) if "=" in item)
    host = env.get("SPRING_RABBITMQ_HOST", env.get("RABBITMQ_HOST", ""))
    user = env.get("SPRING_RABBITMQ_USERNAME", env.get("RABBITMQ_USER", ""))
    password = env.get("SPRING_RABBITMQ_PASSWORD", env.get("RABBITMQ_PASS", ""))
    vhost = env.get("SPRING_RABBITMQ_VIRTUAL_HOST", env.get("RABBITMQ_VHOST", "/"))
    if not re.fullmatch(r"[A-Za-z0-9.-]+", host) or not user or not password:
        raise RuntimeError("Configuracion del broker incompleta o inesperada")
    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    opener = build_opener(NoRedirect())
    prefix = "/exchanges/" + quote(vhost, safe="") + "/pedidos.exchange/bindings/source"

    def api(path, method="GET"):
        request = Request("https://" + host + "/api" + path, method=method,
                          headers={"Authorization": "Basic " + auth, "Accept": "application/json"})
        try:
            with opener.open(request, timeout=20) as response:
                data = response.read()
                return json.loads(data) if data else None
        except HTTPError as error:
            raise RuntimeError(f"Management API HTTP {error.code}; verificar estado antes de reintentar") from None
        except (URLError, TimeoutError, OSError):
            raise RuntimeError("Fallo HTTPS; verificar estado del binding antes de reintentar") from None

    def queue(name):
        return api("/queues/" + quote(vhost, safe="") + "/" + quote(name, safe=""))

    def verify_new(bindings):
        for service in ("notificaciones", "reportes"):
            name = f"pedido.creado.{service}.queue"
            q = queue(name)
            if not q.get("durable") or (q.get("consumers") or 0) < 1:
                raise RuntimeError("Cola nueva no durable o sin consumidor: " + name)
            if not any(b.get("destination_type") == "queue" and b.get("destination") == name
                       and b.get("routing_key") == "pedido.creado" for b in bindings):
                raise RuntimeError("Falta binding de la cola nueva: " + name)

    bindings = api(prefix)
    verify_new(bindings)
    legacy = queue("pedido.creado.queue")
    if any(legacy.get(key) != 0 for key in ("consumers", "messages_ready", "messages_unacknowledged")):
        raise RuntimeError("Cola antigua no vacia, con consumidores o estadisticas incompletas; no se modifico")
    matches = [b for b in bindings if b.get("destination_type") == "queue"
               and b.get("destination") == "pedido.creado.queue"]
    if not matches:
        print("El binding antiguo ya esta ausente. Colas nuevas verificadas; cola antigua conservada.")
        return
    if len(matches) != 1 or matches[0].get("routing_key") != "pedido.creado" or matches[0].get("arguments") != {}:
        raise RuntimeError("Bindings antiguos diferentes a lo autorizado; no se modifico")
    binding = matches[0]
    properties_key = binding.get("properties_key")
    if not isinstance(properties_key, str) or not properties_key:
        raise RuntimeError("Identificador del binding no valido")
    if not apply:
        print("PRECHECK OK. Usar --apply solo con autorizacion para retirar el binding antiguo.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("/var/lib/fazbear-backups") / f"rabbit-binding-{stamp}-{uuid.uuid4().hex[:8]}"
    backup.mkdir(parents=True, mode=0o700)
    (backup / "binding.json").write_text(json.dumps({"vhost": vhost, "binding": binding}, indent=2))
    # Only this exact exchange-to-queue binding endpoint may be deleted.
    path = ("/bindings/" + quote(vhost, safe="") + "/e/pedidos.exchange/q/pedido.creado.queue/"
            + quote(properties_key, safe=""))
    api(path, method="DELETE")
    after = api(prefix)
    if any(b.get("destination_type") == "queue" and b.get("destination") == "pedido.creado.queue" for b in after):
        raise RuntimeError("El binding antiguo sigue presente; no repetir cambios sin revisar")
    verify_new(after)
    remaining = queue("pedido.creado.queue")
    print("BINDING ANTIGUO RETIRADO Y AUSENCIA VERIFICADA.")
    print("Ambas colas nuevas conservan binding y consumidor conectado.")
    print(json.dumps({"legacy_queue_preserved": remaining.get("name") == "pedido.creado.queue",
                      "ready": remaining.get("messages_ready"),
                      "unacked": remaining.get("messages_unacknowledged")}))
    print("Respaldo privado del binding: " + str(backup))
    print("No se borraron colas, no se purgaron mensajes y no se publicaron eventos.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("ERROR: " + detail)
        raise SystemExit(1)
