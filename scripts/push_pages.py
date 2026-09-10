"""Aktualisiert den GitHub-Pages-Branch main aus dem dashboard/-Ordner.

Pages baut von Branch main (Root): dashboard/-Dateien landen an der Wurzel,
Legacy-Reste der Browser-Pipeline werden entfernt. Die Daten laedt das
Dashboard dort live aus der Cloudron-App (siehe ADR-0002, Variante B1).

Aufruf: .venv/bin/python scripts/push_pages.py
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
BRANCH = "main"
ROOT = pathlib.Path(__file__).resolve().parent.parent

UPLOAD = [
    ("dashboard/index.html", "index.html"),
    ("dashboard/info.html", "info.html"),
    ("dashboard/css/styles.css", "css/styles.css"),
    ("dashboard/js/ui.js", "js/ui.js"),
]

REMOVE = [
    "enhancement.html",
    "wikidata.html",
    "fedipol_data.json",
    "exclude.json",
    "politiker-und-institutionen-im-fediverse.md",
    "js/enhancement.js",
    "js/mastodonApi.js",
    "js/wikidataQuery.js",
    ".cursorindexingignore",
    ".specstory/.gitignore",
    ".specstory/history/2025-02-08_09-00Z-repository-analysis-request.md",
    ".specstory/history/2025-02-08_09-01Z-überprüfung-des-fedipol-repositories.md",
    ".specstory/history/2025-02-08_23-37Z-integration-eines-wikidata-moduls-für-politische-entitäten.md",
    ".specstory/history/2025-10-21_22-58Z-starte-lokalen-python-webserver-auf-macos.md",
]

PAGES_README = """# Fedipol - Fediverse Activity Tracker

Interaktives Dashboard zur Analyse der Fediverse-Aktivitaeten deutscher
Politiker:innen und politischer Institutionen:

https://rstockm.github.io/fedipol/

Die Seiten sind rein statisch; die Daten werden live aus der Service-App
geladen (taeglicher ETL, aktive Generation):

- Daten: https://fedipol.wolkenbar.de/fedipol_data.json (CORS-Freigabe
  fuer diese Pages-Origin)
- Status: https://fedipol.wolkenbar.de/healthz und /health/data

Der App- und Pipeline-Code (ETL, Django-App, Dokumentation inkl. ADRs)
liegt auf dem Branch [`service-app`](https://github.com/rstockm/fedipol/tree/service-app).
Hosting-Entscheidung: docs/adr/ADR-0002-dashboard-hosting.md (Variante B1).

Lizenz: MIT; Datenbasis Wikidata (CC BY-SA 4.0).
"""


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
            "User-Agent": "FediPol-Pages/2.0",
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
    head = api("GET", f"repos/{REPO}/git/ref/heads/{BRANCH}")["object"]["sha"]
    parent_tree = api("GET", f"repos/{REPO}/git/commits/{head}")["tree"]["sha"]
    print(f"parent: {BRANCH}-Head {head}")

    entries = [{"path": p, "mode": "100644", "type": "blob", "sha": None} for p in REMOVE]

    uploads = dict(UPLOAD)
    for rel, target in uploads.items():
        content = (ROOT / rel).read_bytes()
        blob = api("POST", f"repos/{REPO}/git/blobs",
                   {"content": base64.b64encode(content).decode(), "encoding": "base64"})
        entries.append({"path": target, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    entries.append({"path": ".nojekyll", "mode": "100644", "type": "blob",
                    "sha": api("POST", f"repos/{REPO}/git/blobs",
                               {"content": "", "encoding": "utf-8"})["sha"]})
    entries.append({"path": "README.md", "mode": "100644", "type": "blob",
                    "sha": api("POST", f"repos/{REPO}/git/blobs",
                               {"content": PAGES_README, "encoding": "utf-8"})["sha"]})
    print(f"{len(uploads) + 2} Blobs hochgeladen, {len(REMOVE)} Legacy-Pfade entfernt")

    tree = api("POST", f"repos/{REPO}/git/trees", {"base_tree": parent_tree, "tree": entries})
    commit = api("POST", f"repos/{REPO}/git/commits", {
        "message": "Pages: aktuelles Dashboard, Daten live aus der Service-App",
        "tree": tree["sha"],
        "parents": [head],
    })
    api("PATCH", f"repos/{REPO}/git/refs/heads/{BRANCH}", {"sha": commit["sha"]})
    print(f"branch {BRANCH} = {commit['sha']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
