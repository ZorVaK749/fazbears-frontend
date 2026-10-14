"""Read-only RabbitMQ Management audit using existing notification container credentials.

No publish, consume, purge, declaration, or configuration operations are performed.
Only an HTTPS endpoint with valid certificate on the configured broker host is used.
"""

import base64
import json
import re
import subprocess
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    result = subprocess.run(
        ["docker", "container", "inspect", "ms-notificaciones"],
        capture_output=True, text=True,
    )
    if result.returncode:
        raise RuntimeError("No se encontro el contenedor ms-notificaciones.")
    container = json.loads(result.stdout)[0]
    env = dict(item.split("=", 1) for item in container["Config"].get("Env", []) if "=" in item)
    host = env.get("SPRING_RABBITMQ_HOST", env.get("RABBITMQ_HOST", ""))
    user = env.get("SPRING_RABBITMQ_USERNAME", env.get("RABBITMQ_USER", ""))
    password = env.get("SPRING_RABBITMQ_PASSWORD", env.get("RABBITMQ_PASS", ""))
    vhost = env.get("SPRING_RABBITMQ_VIRTUAL_HOST", env.get("RABBITMQ_VHOST", "/"))
    if not host or not user or not password:
        raise RuntimeError("Faltan variables del broker esperadas; revisar configuracion sin publicar secretos.")
    if not re.fullmatch(r"[A-Za-z0-9.-]+", host):
        raise RuntimeError("El host no tiene el formato DNS esperado; requiere revision.")
    base = f"https://{host}/api"
    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    opener = build_opener(NoRedirect())

    def get(path):
        request = Request(base + path, headers={"Authorization": "Basic " + auth, "Accept": "application/json"})
        try:
            with opener.open(request, timeout=20) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code == 404:
                return None
            raise RuntimeError(f"Management API respondio HTTP {error.code}; no se modifico el broker.") from None
        except (URLError, TimeoutError, OSError):
            raise RuntimeError("No se pudo acceder por HTTPS al Management API del host configurado. Usar RabbitMQ Manager para revisar; no se intento HTTP ni se desactivo TLS.") from None

    identity = get("/whoami")
    if not isinstance(identity, dict) or "name" not in identity:
        raise RuntimeError("El host no expone el Management API esperado; revisar desde RabbitMQ Manager.")
    vh = quote(vhost, safe="")
    issues = []
    for exchange_name in ("pedidos.exchange", "pedidos.dlx"):
        exchange = get(f"/exchanges/{vh}/{quote(exchange_name, safe='')}")
        if exchange is None:
            issues.append(f"No existe exchange {exchange_name}")
            continue
        print(json.dumps({"exchange": exchange_name, "type": exchange.get("type"),
                          "durable": exchange.get("durable")}, ensure_ascii=False))
        if exchange.get("type") != "direct" or not exchange.get("durable"):
            issues.append(f"Tipo o durabilidad incorrectos: {exchange_name}")

    bindings = {}
    for exchange_name in ("pedidos.exchange", "pedidos.dlx"):
        bindings[exchange_name] = get(f"/exchanges/{vh}/{quote(exchange_name, safe='')}/bindings/source") or []

    for service in ("notificaciones", "reportes"):
        name = f"pedido.creado.{service}.queue"
        for queue_name in (name, name + ".dlq"):
            queue = get(f"/queues/{vh}/{quote(queue_name, safe='')}")
            if queue is None:
                issues.append(f"No existe cola {queue_name}")
                continue
            print(json.dumps({"queue": queue_name, "durable": queue.get("durable"),
                              "consumers": queue.get("consumers"),
                              "ready": queue.get("messages_ready"),
                              "unacked": queue.get("messages_unacknowledged")}, ensure_ascii=False))
            if not queue.get("durable"):
                issues.append(f"Cola no durable: {queue_name}")
            is_main = queue_name == name
            exchange_name = "pedidos.exchange" if is_main else "pedidos.dlx"
            routing_key = "pedido.creado" if is_main else name
            if not any(b.get("destination_type") == "queue" and b.get("destination") == queue_name
                       and b.get("routing_key") == routing_key for b in bindings[exchange_name]):
                issues.append(f"Binding incorrecto o faltante: {queue_name}")
            if is_main:
                if (queue.get("consumers") or 0) < 1:
                    issues.append(f"Sin consumidor conectado: {queue_name}")
                args = queue.get("arguments") or {}
                if args.get("x-dead-letter-exchange") != "pedidos.dlx" or args.get("x-dead-letter-routing-key") != name:
                    issues.append(f"Configuracion DLQ incorrecta: {queue_name}")
            elif (queue.get("messages_ready") or 0) + (queue.get("messages_unacknowledged") or 0) > 0:
                issues.append(f"Hay mensajes en DLQ: {queue_name}; requieren investigacion, no purga")

    legacy = get(f"/queues/{vh}/pedido.creado.queue")
    if legacy is not None:
        bound = any(b.get("destination") == "pedido.creado.queue" and b.get("destination_type") == "queue"
                    for b in bindings["pedidos.exchange"])
        print(json.dumps({"legacy_queue": "pedido.creado.queue", "consumers": legacy.get("consumers"),
                          "ready": legacy.get("messages_ready"),
                          "unacked": legacy.get("messages_unacknowledged"),
                          "binding_still_present": bound}, ensure_ascii=False))
        if bound:
            print("AVISO: binding antiguo conservado; acumulara copias. Revisar su retiro en un paso autorizado, sin purgar mensajes.")
        if (legacy.get("consumers") or 0) > 0:
            issues.append("Quedan consumidores en la cola antigua; revisar antes de comprar")
    print("AUDITORIA SOLO LECTURA: no se publicaron ni consumieron mensajes.")
    if issues:
        for issue in issues:
            print("PENDIENTE: " + issue)
        raise SystemExit(2)
    print("TOPOLOGIA Y CONSUMIDORES: OK. Entrega E2E pendiente de compra autenticada.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("ERROR DE AUDITORIA: " + detail)
        raise SystemExit(1)
