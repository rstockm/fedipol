"""Aktualisiert den GitHub-Branch service-app via Git-Data-API.

Basiert auf dem main-Baum (GitRPC-Schraenke bei API-erstellten Baeumen),
laedt alle Projektdateien als Blobs hoch, entfernt Legacy-Pfade der
Browser-Pipeline und setzt den Branch-Head auf einen neuen Commit.

Aufruf: .venv/bin/python scripts/push_service_app.py
Voraussetzung: eingeloggt via gh (Token mit repo-Scope).
"""

import base64
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

REPO = "rstockm/fedipol"
BRANCH = "service-app"
ROOT = pathlib.Path(__file__).resolve().parent.parent

EXCLUDE_DIRS = {".venv", "var", ".git", ".pytest_cache", ".ruff_cache", ".specstory", ".idea", ".vscode"}
EXCLUDE_NAMES = {".DS_Store", ".cursorindexingignore"}
EXCLUDE_SUFFIX = {".pyc"}
# ci.yml: Pushen erfordert Token mit workflow-Scope (einmalig gh auth refresh -s workflow)
EXCLUDE_PATHS = {"tests/.test-data", "db.sqlite3", ".github/workflows/ci.yml"}


def api(method: str, path: str, payload: dict | None = None) -> dict:
    token = os.popen("gh auth token").read().strip()
    if not token:
        sys.exit("kein gh-Token")
    req = urllib.request.Request(
        f"https://api.github.com/{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "FediPol-ETL/2.0",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code} bei {method} {path}: {exc.read().decode(errors='replace')[:300]}", file=sys.stderr)
        raise


def main() -> int:
    main_commit = api("GET", f"repos/{REPO}/git/ref/heads/main")["object"]["sha"]
    main_tree = api("GET", f"repos/{REPO}/git/commits/{main_commit}")["tree"]["sha"]
    print(f"base tree (main): {main_tree}")

    parent = main_commit
    try:
        parent = api("GET", f"repos/{REPO}/git/ref/heads/{BRANCH}")["object"]["sha"]
        print(f"parent: {BRANCH}-Head {parent}")
    except urllib.error.HTTPError:
        print("parent: main")

    # base_tree: main-Baum; Loesch-Einträge für Pfade, die im base_tree fehlen,
    # liefern GitRPC::BadObjectState - deshalb keine REMOVE-Liste mehr (die
    # Legacy-Pfade sind seit dem Pages-Update nicht mehr im main-Baum).
    entries = []

    count = 0
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        if any(part in EXCLUDE_DIRS for part in rel.split("/")):
            continue
        if path.name in EXCLUDE_NAMES or path.suffix in EXCLUDE_SUFFIX:
            continue
        if rel in EXCLUDE_PATHS:
            continue
        blob = api("POST", f"repos/{REPO}/git/blobs",
                   {"content": base64.b64encode(path.read_bytes()).decode(), "encoding": "base64"})
        entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        count += 1
    print(f"{count} Dateien hochgeladen")

    tree = api("POST", f"repos/{REPO}/git/trees", {"base_tree": main_tree, "tree": entries})
    commit = api("POST", f"repos/{REPO}/git/commits", {
        "message": "update: service-app Stand (" + parent[:8] + ")",
        "tree": tree["sha"],
        "parents": [parent],
    })
    try:
        api("POST", f"repos/{REPO}/git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]})
    except urllib.error.HTTPError as exc:
        if exc.code == 422:
            api("PATCH", f"repos/{REPO}/git/refs/heads/{BRANCH}", {"sha": commit["sha"]})
        else:
            raise
    print(f"branch {BRANCH} = {commit['sha']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
