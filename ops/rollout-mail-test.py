"""Pinned SMTP-test release; reuse the reviewed consumer backup/swap engine.

Default is read-only precheck. No secrets are printed or entered in Run Command.
"""

import importlib.util
from pathlib import Path
import sys


def main():
    if sys.argv[1:] not in ([], ["--apply"]):
        raise RuntimeError("Only --apply is supported; default is precheck")
    spec = importlib.util.spec_from_file_location(
        "consumer_rollout", Path(__file__).with_name("rollout-stock-consumers.py")
    )
    rollout = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rollout)
    rollout.RELEASES = {
        "ms-notificaciones": {
            "service": "notificaciones", "port": 8085, "commit": "efab12d",
            "git_commit": "efab12de91e3a3e9610ac2423e657b6fe13fb309",
            "image_id": "sha256:4e2c4e4923ed03a2c2fd9a739fc9c67c5bec75f614b2b212e71ef1b8177ec5a3",
            "previous_id": "sha256:d8ba98669adaa44578762ed6741378206ecaa59daa7c6f62d24289617bc605b4",
        }
    }
    rollout.main(apply=sys.argv[1:] == ["--apply"])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("ERROR DE ROLLOUT: " + detail)
        raise SystemExit(1)
