"""Pinned CANCELADO fix for ms-pedidos. Default: precheck; --apply swaps.

Preserves runtime settings privately. H2 RAM data is NOT recoverable on restart.
"""

import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import uuid

NAME = "ms-pedidos"
COMMIT = "10c480a347a9bd31d6df5aabcbbdd0ff4a8b5044"
IMAGE = "fazbear-pedidos:ev2-10c480a"
NEW = "sha256:77e8504c1e232e78628ccc967e30651e6b060b00ef61891cd2ef21878ed8de9b"
OLD = "sha256:987f66793a9ca7cafafbe4cf0b5b221d06576471b3231317b2c638476da7276d"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Run as root")
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location(
        "deployment", Path(__file__).with_name("deploy-ev2-services.py")
    )
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    image = json.loads(engine.docker("image", "inspect", IMAGE))[0]
    if image["Id"] != NEW:
        raise RuntimeError("New image differs from approved digest")
    current = engine.inspect(NAME)
    if not current:
        raise RuntimeError("Expected ms-pedidos container")
    if current["Image"] == NEW:
        engine.ready(NAME, NEW, 8082, "pedidos")
        print("Requested version already active; no replacement")
        return
    if current["Image"] != OLD or not current["State"]["Running"]:
        raise RuntimeError("Current image/state differs from approved inventory")
    host = current["HostConfig"]
    if current.get("Mounts") or host["NetworkMode"] not in ("default", "bridge"):
        raise RuntimeError("Mounts/custom network need review")
    if host.get("AutoRemove") or host.get("ContainerIDFile"):
        raise RuntimeError("Unsupported container options")
    if not args.apply:
        print("PRECHECK OK: ms-pedidos -> 10c480a; no container modified")
        return
    suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    backup = Path("/var/lib/fazbear-backups") / ("cancel-pedidos-" + suffix)
    backup.mkdir(parents=True, mode=0o700)
    previous = NAME + "-prev-cancel-" + suffix
    rollback_image = "fazbear-pedidos:rollback-" + suffix
    engine.docker("image", "tag", OLD, rollback_image)
    (backup / "container-private.json").write_text(json.dumps(current, indent=2))
    release = {
        "container": NAME, "branch": "VP_AVANCE_EV2", "commit": COMMIT[:7],
        "git_commit": COMMIT, "new_image": IMAGE, "new_image_id": NEW,
        "previous_image": current["Config"]["Image"], "previous_image_id": OLD,
        "rollback_image": rollback_image, "previous_container_name_for_deploy": previous,
    }
    (backup / "release.json").write_text(json.dumps(release, indent=2))
    rollback = """#!/bin/bash
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
docker start "$name"
echo 'Previous container restored. H2 RAM data is NOT restored.'
""" % tuple(shlex.quote(v) for v in (NAME, previous, OLD))
    path = backup / "rollback.sh"
    path.write_text(rollback)
    path.chmod(0o700)
    subprocess.run(["bash", "-n", str(path)], check=True)
    print("Private backup: " + str(backup), flush=True)
    engine.BACKUPS = {NAME: (backup.name, 8082, "pedidos")}
    engine.main()
    print("Cancellation state deployed. No stock refund or report compensation implemented.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("ROLLOUT ERROR: " + (str(error) if isinstance(error, RuntimeError) else type(error).__name__))
        raise SystemExit(1)
