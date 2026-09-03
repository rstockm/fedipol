"""URL- und Party-Normalisierung (Port der bisherigen Browser-Heuristiken)."""

from __future__ import annotations

import unicodedata
from urllib.parse import urlsplit, urlunsplit


def canonical_url(url: str) -> str:
    """Kanonische Account-URL: https, Host kleingeschrieben und IDNA, ohne Slash.

    Entspricht der bisherigen JS-Normalisierung (lowercase, trailing slashes
    entfernen), ergaenzt um IDNA und fehlendes Schema.
    """
    value = (url or "").strip()
    if not value:
        raise ValueError("leere URL")
    parts = urlsplit(value)
    if not parts.scheme:
        value = "https://" + value
        parts = urlsplit(value)
    host = parts.hostname or ""
    if not host:
        raise ValueError(f"URL ohne Host: {url}")
    try:
        idna_host = host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        idna_host = host.lower()
    port = f":{parts.port}" if parts.port else ""
    path = parts.path.rstrip("/")
    return urlunsplit(("https", idna_host + port, path, "", ""))


def instance_of(url: str) -> str:
    """Hostname der kanonischen URL."""
    return urlsplit(canonical_url(url)).hostname or ""


def strip_html(text: str) -> str:
    """Entfernt HTML-Tags (Port von checkForAutomationKeywords)."""
    out = []
    depth = False
    for ch in text or "":
        if ch == "<":
            depth = True
        elif ch == ">":
            depth = False
        elif not depth:
            out.append(ch)
    return "".join(out)


def is_bot_note(note: str, keywords: list[str]) -> bool:
    """Bot-Heuristik auf Account-Beschreibung, case-insensitive."""
    clean = strip_html(note).lower()
    return any(keyword in clean for keyword in keywords)


def normalize_name(name: str) -> str:
    """NFKD-Normalisierung fuer robuste Namensvergleiche."""
    return unicodedata.normalize("NFKD", name or "").strip().casefold()


PARTY_ABBREVIATION_MAP = {
    "Sozialdemokratische Partei Deutschlands": "SPD",
    "Christlich Demokratische Union Deutschlands": "CDU",
    "Christlich Demokratische Union": "CDU",
    "CDU/CSU-Bundestagsfraktion": "CDU",
    "Junge Union": "CDU",
    "Junge Union Deutschlands": "CDU",
    "Demokratischer Aufbruch": "CDU",
    "Bündnis 90/Die Grünen": "Grüne",
    "BÜNDNIS 90/DIE GRÜNEN": "Grüne",
    "Bündnis 90": "Grüne",
    "Grüne Jugend": "Grüne",
    "GRÜNE JUGEND": "Grüne",
    "Federation of Young European Greens": "Grüne",
    "Alternative für Deutschland": "AfD",
    "Freie Demokratische Partei": "FDP",
    "FDP-Bundestagsfraktion": "FDP",
    "Die Linke": "Linke",
    "Fraktion Die Linke": "Linke",
    "Partei des Demokratischen Sozialismus": "Linke",
    "Sozialistische Einheitspartei Deutschlands": "Linke",
    "PDS": "Linke",
    "Arbeit & soziale Gerechtigkeit – Die Wahlalternative": "Linke",
    "WASG": "Linke",
    "Deutsche Kommunistische Partei": "DKP",
    "Christlich-Soziale Union in Bayern": "CSU",
    "Piratenpartei Deutschland": "Piraten",
    "Ökologisch-Demokratische Partei": "ÖDP",
    "Partei für Arbeit, Rechtsstaat, Tierschutz, Elitenförderung und basisdemokratische Initiative": "Die PARTEI",
    "Volt Deutschland": "Volt",
    "Volt Europa": "Volt",
    "Bündnis Sahra Wagenknecht – Vernunft und Gerechtigkeit": "BSW",
    "Bündnis Sahra Wagenknecht": "BSW",
    "fraktionsloser Abgeordneter": "Fraktionslos",
    "fraktionslose Abgeordnete": "Fraktionslos",
    "Die Violetten – für spirituelle Politik": "Violetten",
    "Die Violetten": "Violetten",
}


def party_abbreviation(party_name: str) -> str:
    """Kuerzel einer Partei, exakt wie im bisherigen Dashboard erwartet."""
    name = (party_name or "").strip()
    return PARTY_ABBREVIATION_MAP.get(name, name)


def dashboard_category(position: str, party_name: str) -> str:
    """Kategorie im bisherigen Format 'Position (Kuerzel)' bzw. ' (Kuerzel)'."""
    abbr = party_abbreviation(party_name)
    position = (position or "").strip()
    return f"{position} ({abbr})"


# Instanz-Prioritaet (Port von getInstancePriority aus wikidataQuery.js)
def instance_priority(account_url: str) -> int:
    host = instance_of(account_url) if account_url else ""
    if host == "social.bund.de":
        return 30
    if host in {"social.hessen.de", "social.schleswig-holstein.de"}:
        return 25
    if host in {
        "gruene.social",
        "linke.social",
        "die-partei.social",
        "piraten-partei.social",
        "spd.social",
    }:
        return 20
    return 10


# Positions-Prioritaet (Port von getPositionPriority aus wikidataQuery.js)
def position_priority(position: str) -> int:
    pos = (position or "").lower()
    if "bundestag" in pos:
        return 100
    if "europäisches parlament" in pos:
        return 90
    if "landtag" in pos:
        return 80
    if "minister" in pos:
        return 70
    if "staatssekretär" in pos:
        return 60
    if "vorsitzende" in pos:
        return 50
    if "sprecher" in pos:
        return 40
    return 10
