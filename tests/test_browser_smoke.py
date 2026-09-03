"""Browser-Smoke-Test des unveraenderten Dashboards.

Laeuft nur mit installiertem Playwright (pip install playwright && playwright
install chromium): pytest -m playwright. Ohne Playwright wird der Test
uebersprungen; die Matrix kann ihn spaeter ergaenzen.
"""

import pytest

pytest.importorskip("playwright", reason="Playwright nicht installiert")

pytestmark = [pytest.mark.playwright, pytest.mark.django_db]


@pytest.fixture()
def published_generation(data_paths, permissive_limits):
    from fedipol.ops.recorder import DjangoRunRecorder

    from .test_pipeline_offline import make_pipeline, seed_checkpoint

    recorder = DjangoRunRecorder()
    seed_checkpoint(data_paths, "RUN-PW")
    result = make_pipeline(data_paths, recorder, "RUN-PW").run()
    assert result.published, result.error


def test_dashboard_renders_with_export(live_server, published_generation, settings):
    from playwright.sync_api import expect, sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(f"{live_server.url}/")
        expect(page.locator("h1")).to_contain_text("Fedipol")

        # Partei-Verteilung und Tabellen vorhanden
        expect(page.locator(".party-distribution-legend")).to_be_visible()
        expect(page.locator("#accountsTableBody tr").first).to_be_visible()

        # Parteifilter klicken und Zuruecksetzen pruefen
        page.locator(".party-legend-item").first.click()
        expect(page.locator("#resetFilter")).to_be_visible()

        assert not errors, f"JavaScript-Fehler im Dashboard: {errors}"
        browser.close()
