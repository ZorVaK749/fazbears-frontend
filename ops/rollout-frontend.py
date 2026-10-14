"""Prepare a fresh versioned frontend backup and invoke the reviewed deployment engine.

Requires exact desired/current image IDs. Defaults to verification only; --apply
authorizes replacement. Keeps every old container and never touches a backend.
"""

import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", required=True)
    parser.add_argument("--image-id", required=True)
    parser.add_argument("--previous-image-id", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise RuntimeError("Expected a full Git commit")
    for image in (args.image_id, args.previous_image_id):
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
            raise RuntimeError("Expected an exact Docker image SHA-256")
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location(
        "fazbear_deployment", Path(__file__).with_name("deploy-ev2-services.py")
    )
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    name = "fz-frontend"
    image_tag = "fazbear-frontend:ev2-" + args.commit[:7]
    new_image = json.loads(engine.docker("image", "inspect", image_tag))[0]
    if new_image["Id"] != args.image_id:
        raise RuntimeError("Desired image does not match approved SHA-256")
    current = engine.inspect(name)
    if current is None:
        raise RuntimeError("Expected existing frontend container")
    if current["Image"] == args.image_id:
        engine.frontend_ready(name, args.image_id, 80)
        print("Version solicitada ya activa; no se reemplazo otra vez.")
        return
    if current["Image"] != args.previous_image_id:
        raise RuntimeError("Current frontend differs from the approved previous image")
    if not current["State"]["Running"]:
        raise RuntimeError("Current frontend is not running; review before replacing")
    if not args.apply:
        print("PRECHECK OK. Ningun contenedor modificado; falta --apply.")
        return
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = uuid.uuid4().hex[:8]
    backup = Path("/var/lib/fazbear-backups") / f"frontend-{args.commit[:7]}-{stamp}-{suffix}"
    backup.mkdir(parents=True, mode=0o700)
    (backup / "container-private.json").write_text(json.dumps(current, indent=2))
    previous = name + "-prev-" + suffix
    rollback_image = "fazbear-frontend:rollback-" + stamp + "-" + suffix
    engine.docker("image", "tag", current["Image"], rollback_image)
    release = {
        "container": name, "branch": "VP_AVANCE_EV2", "commit": args.commit[:7],
        "git_commit": args.commit, "new_image": image_tag, "new_image_id": args.image_id,
        "previous_image": current["Config"]["Image"], "previous_image_id": current["Image"],
        "rollback_image": rollback_image, "previous_container_name_for_deploy": previous,
    }
    (backup / "release.json").write_text(json.dumps(release, indent=2))
    rollback = """#!/bin/bash
set -eu
name=%s
previous=%s
expected=%s
actual=$(docker container inspect --format '{{.Image}}' "$previous")
[ "$actual" = "$expected" ] || { echo "ERROR: version anterior no coincide"; exit 1; }
if docker container inspect "$name" >/dev/null 2>&1; then
  docker stop "$name"
  docker rename "$name" "$name-failed-$(date -u +%%Y%%m%%dT%%H%%M%%SZ)"
fi
docker rename "$previous" "$name"
docker update --restart unless-stopped "$name" >/dev/null
docker start "$name"
echo "Version frontend anterior restaurada; verificar acceso publico."
""" % tuple(shlex.quote(value) for value in (name, previous, current["Image"]))
    rollback_path = backup / "rollback.sh"
    rollback_path.write_text(rollback)
    rollback_path.chmod(0o700)
    subprocess.run(["bash", "-n", str(rollback_path)], check=True)
    print("Respaldo privado de esta version: " + str(backup), flush=True)
    engine.FRONTEND_BACKUP = {name: (backup.name, 80, "frontend")}
    engine.main(frontend=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("ERROR DE ROLLOUT: " + detail)
        raise SystemExit(1)
