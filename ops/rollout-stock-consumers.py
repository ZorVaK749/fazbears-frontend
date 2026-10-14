"""Deploy only the two approved stock-compatible consumers with fresh rollback backups.

No order/product/frontend replacement. Defaults to precheck; --apply is required.
Run as root on the appropriate EC2 using the adjacent reviewed deployment engine.
"""

from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import uuid


RELEASES = {
    "ms-notificaciones": {
        "service": "notificaciones", "port": 8085, "commit": "8c806ab",
        "git_commit": "8c806ab8583d98f0328b2c34bcca461bf1c9ccb2",
        "image_id": "sha256:d8ba98669adaa44578762ed6741378206ecaa59daa7c6f62d24289617bc605b4",
        "previous_id": "sha256:efccd37595e88c361783f0644a5fa8e39ac941a89cd1d601b3c1dcc3d3f95267",
    },
    "ms-reportes": {
        "service": "reportes", "port": 8086, "commit": "141d228",
        "git_commit": "141d2289ea2344886b85b5bac167e94fbd35b6f8",
        "image_id": "sha256:5cdacfd0f7c6c36d9d2948771e0daeb9946efb0eb78b815ad5e810f9db890a63",
        "previous_id": "sha256:d45938a0028a65d873a3382922b6e587a1911c894da0467480eb607fb3eee853",
    },
}


def recovery_script(name, previous, image_id):
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
echo "Version anterior restaurada. H2 en memoria no se recupera; verificar servicio."
""" % tuple(shlex.quote(value) for value in (name, previous, image_id))


def main(apply=False):
    if os.geteuid() != 0:
        raise RuntimeError("Ejecutar como root en la EC2 correspondiente")
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location(
        "fazbear_deployment", Path(__file__).with_name("deploy-ev2-services.py")
    )
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    found = [(name, engine.inspect(name)) for name in RELEASES]
    found = [(name, state) for name, state in found if state]
    if len(found) != 1:
        raise RuntimeError("Se esperaba solo un consumidor autorizado en esta EC2")
    name, current = found[0]
    target = RELEASES[name]
    image = f"fazbear-{target['service']}:ev2-{target['commit']}"
    new_image = json.loads(engine.docker("image", "inspect", image))[0]
    if new_image["Id"] != target["image_id"]:
        raise RuntimeError("La imagen no coincide con el SHA-256 aprobado")
    if current["Image"] == target["image_id"]:
        engine.ready(name, target["image_id"], target["port"], target["service"])
        print("Version aprobada ya activa; no se reemplazo otra vez.")
        return
    if current["Image"] != target["previous_id"] or not current["State"]["Running"]:
        raise RuntimeError("La version o estado actual no coincide con el inventario aprobado")
    if current.get("Mounts") or current["HostConfig"]["NetworkMode"] not in ("default", "bridge"):
        raise RuntimeError("Montajes o red personalizados requieren revision")
    if not apply:
        print(f"PRECHECK OK: {name}, commit destino={target['commit']}. Ningun servicio modificado.")
        return
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = uuid.uuid4().hex[:8]
    backup = Path("/var/lib/fazbear-backups") / f"stock-{name}-{stamp}-{suffix}"
    backup.mkdir(parents=True, mode=0o700)
    (backup / "container-private.json").write_text(json.dumps(current, indent=2))
    previous = name + "-prev-stock-" + suffix
    rollback_image = f"fazbear-{target['service']}:rollback-stock-{stamp}-{suffix}"
    engine.docker("image", "tag", current["Image"], rollback_image)
    release = {
        "container": name, "branch": "main", "commit": target["commit"],
        "git_commit": target["git_commit"], "new_image": image,
        "new_image_id": target["image_id"], "previous_image": current["Config"]["Image"],
        "previous_image_id": current["Image"], "rollback_image": rollback_image,
        "previous_container_name_for_deploy": previous,
    }
    (backup / "release.json").write_text(json.dumps(release, indent=2))
    rollback = backup / "rollback.sh"
    rollback.write_text(recovery_script(name, previous, current["Image"]))
    rollback.chmod(0o700)
    subprocess.run(["bash", "-n", str(rollback)], check=True)
    print("Respaldo privado: " + str(backup), flush=True)
    engine.BACKUPS = {name: (backup.name, target["port"], target["service"])}
    engine.main()
    print("Consumidor compatible con eventos anteriores y v2. Productos y orden no modificados.")


def self_test():
    assert set(RELEASES) == {"ms-notificaciones", "ms-reportes"}
    for name, target in RELEASES.items():
        assert target["git_commit"].startswith(target["commit"])
        assert target["image_id"] != target["previous_id"]
        script = recovery_script(name, name + "-prev-test", target["previous_id"])
        subprocess.run(["bash", "-n"], input=script, text=True, check=True)
        assert "docker rm" not in script and "docker start" in script
    print("Self-test OK: alcance limitado a dos consumidores, versiones y sintaxis de rollback.")


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
        print("ERROR DE ROLLOUT: " + detail)
        raise SystemExit(1)
