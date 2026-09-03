"""Shadow-Vergleich: neuer Export gegen die eingefrorene Baseline.

Vergleicht den aktuellsten Export (var/exports/generations/...) mit der
Contract-Baseline (tests/fixtures/baseline_fedipol_data.json) und
klassifiziert Abweichungen: Aktivitaet seit Baseline-Stichtag, Bot-Korrekturen
(Overrides), Rate-Limit-Restingstaende.

Aufruf: .venv/bin/python scripts/compare_with_baseline.py
"""

import collections
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASELINE = ROOT / "tests" / "fixtures" / "baseline_fedipol_data.json"


def canon(url: str) -> str:
    return url.lower().rstrip("/")


def main() -> int:
    exports = sorted((ROOT / "var" / "exports" / "generations").glob("*/fedipol_data.json"))
    if not exports:
        print("Kein Export gefunden - erst ETL ausfuehren (make etl).")
        return 1
    new = json.loads(exports[-1].read_text())["data"]
    old = json.loads(BASELINE.read_text())["data"]
    print(f"Export: {exports[-1].parent.name}")

    old_c: dict[str, list[dict]] = {}
    for url, entry in old.items():
        old_c.setdefault(canon(url), []).append(entry)
    new_c = {canon(u): e for u, e in new.items()}

    both = set(old_c) & set(new_c)
    only_old = set(old_c) - set(new_c)
    only_new = set(new_c) - set(old_c)
    print(f"Baseline: {len(old_c)} | Neu: {len(new_c)} | Ueberschneidung: {len(both)} | "
          f"nur alt: {len(only_old)} | nur neu: {len(only_new)}")

    ident = collections.Counter()
    diff_posts_big: list[tuple] = []
    diff_bot: list[tuple] = []
    for url in sorted(both):
        o = max((a.get("posts_count", 0) or 0) for a in old_c[url])
        n = new_c[url].get("posts_count", 0) or 0
        ro = max((a.get("recent_posts_count", 0) or 0) for a in old_c[url])
        rn = new_c[url].get("recent_posts_count", 0) or 0
        ob = any(a.get("is_bot") for a in old_c[url])
        nb = new_c[url].get("is_bot", False)
        oc = next((a.get("created_at") for a in old_c[url] if a.get("created_at")), "")
        nc = new_c[url].get("created_at") or ""
        ident["posts_same"] += o == n
        if abs(n - o) > 50:
            diff_posts_big.append((url, o, n))
        ident["recent_same"] += (ro == rn) or (ro >= 120 and rn >= 120)
        ident["bot_same"] += ob == nb
        if ob != nb:
            diff_bot.append((url, "neu als Bot" if nb else "Bot-Flag entfallen"))
        ident["created_same"] += (oc[:10] == nc[:10])

    n = len(both)
    if n:
        print(f"\nUeberschneidungsmenge ({n}):")
        for label, key in [
            ("posts_count identisch", "posts_same"),
            ("recent identisch/120-cap", "recent_same"),
            ("is_bot identisch", "bot_same"),
            ("created_at (Datum) gleich", "created_same"),
        ]:
            print(f"  {label:26s} {ident[key]:4d}/{n} ({ident[key] / n:.0%})")
        print(f"  posts um >50 abweichend    {len(diff_posts_big):4d} (Aktivitaet seit Baseline-Stichtag)")
        print(f"  Bot-Status-Unterschiede    {len(diff_bot):4d}")
        for url, what in diff_bot[:10]:
            print(f"    {url}: {what}")

    hosts = collections.Counter(canon(u).split("//")[-1].split("/")[0] for u in only_old)
    print("\nFehlende Alt-Accounts nach Host:", hosts.most_common(6))
    print("(Haeufung auf grossen Instanzen = Rate-Limit-Restingaende; der")
    print(" naechste Lauf uebernimmt sie per Last-known-good und versucht es erneut.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
