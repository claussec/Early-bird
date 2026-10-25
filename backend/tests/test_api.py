import pytest
from fastapi.testclient import TestClient

from app import config


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "db_path", tmp_path / "api.db")
    monkeypatch.setattr(config.settings, "seed_demo_data", False)
    monkeypatch.setattr(config.settings, "llm_provider", "demo")
    from app.main import app

    with TestClient(app) as c:
        yield c


SUPPLIER = {
    "number": "70012345",
    "name": "Muster Drehteile GmbH",
    "commodity": "Metall & Umformung",
    "city": "Pforzheim",
    "country": "de",
    "buyer_name": "Erika Muster",
    "buyer_email": "erika.muster@example.com",
}


def test_create_supplier_with_master_data_only(client):
    r = client.post("/api/suppliers", json=SUPPLIER)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["country"] == "DE"
    assert s["source"] == "manual"
    assert s["status"] == "none"
    assert len(s["missing_sources"]) == 4

    assert client.post("/api/suppliers", json=SUPPLIER).status_code == 409


def test_create_supplier_with_figures_is_assessed(client):
    figures = {
        "years": [
            {"year": 2023, "revenue": 30, "purchase": 12},
            {"year": 2024, "revenue": 29, "purchase": 15},
            {"year": 2025, "revenue": 27, "purchase": 16},
        ],
        "plan_next_year": 12.5,
        "pd_previous": 0.8,
        "pd_previous_date": "2024-06-01",
        "pd_current": 2.4,
        "pd_current_date": "2025-09-01",
        "ppm_current": 60,
        "ppm_previous": 55,
        "otd": 96,
    }
    r = client.post("/api/suppliers", json={**SUPPLIER, "figures": figures})
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["customer_share"] == pytest.approx(59.3, abs=0.1)
    assert s["status"] == "escalated"
    assert s["escalate"] is True
    assert "score" not in s
    assert s["missing_sources"] == []

    detail = client.get(f"/api/suppliers/{s['id']}").json()
    ids = {k["id"] for k in detail["report"]["kpis"]}
    assert {"customer_share", "revenue_forecast", "plan_change", "pd_latest", "pd_trend", "ppm", "otd"} <= ids


def test_search_by_name_and_number(client):
    client.post("/api/suppliers", json=SUPPLIER)
    client.post("/api/suppliers", json={**SUPPLIER, "number": "70099999", "name": "Andere Firma AG"})
    assert [s["name"] for s in client.get("/api/suppliers", params={"q": "drehteile"}).json()] == ["Muster Drehteile GmbH"]
    assert [s["number"] for s in client.get("/api/suppliers", params={"q": "7009"}).json()] == ["70099999"]


def test_delete_supplier(client):
    sid = client.post("/api/suppliers", json=SUPPLIER).json()["id"]
    assert client.delete(f"/api/suppliers/{sid}").status_code == 204
    assert client.get(f"/api/suppliers/{sid}").status_code == 404


def test_source_systems_are_registered(client):
    sources = {s["id"]: s for s in client.get("/api/sources").json()}
    assert sources["local"]["configured"] is True
    assert sources["sap"]["configured"] is False
    assert sources["erp"]["configured"] is False

    client.post("/api/suppliers", json=SUPPLIER)
    r = client.get("/api/sources/search", params={"q": "7001", "source": ["local", "sap"]}).json()
    assert [x["number"] for x in r["results"]] == ["70012345"]
    assert "nicht konfiguriert" in r["errors"]["sap"]
    assert client.get("/api/sources/search", params={"q": "x", "source": "oracle"}).status_code == 400


def test_import_from_unconfigured_sap_fails_cleanly(client):
    r = client.post("/api/suppliers/import", json={"source": "sap", "number": "100200"})
    assert r.status_code == 502
    assert "nicht konfiguriert" in r.json()["detail"]


def test_automode_settings_and_run(client, monkeypatch):
    from app import automode
    from app.notifiers.teams import TeamsNotifier

    state = client.put("/api/automode", json={"enabled": False, "interval_minutes": 60, "channels": ["outlook", "teams"]}).json()
    assert state["interval_minutes"] == 60

    client.post("/api/suppliers", json={**SUPPLIER, "figures": {"pd_current": 4.5, "pd_previous": 1.0}})
    sent = []
    monkeypatch.setattr(TeamsNotifier, "configured", property(lambda self: True))
    monkeypatch.setattr(TeamsNotifier, "send", lambda self, m: sent.append(m))

    summary = automode.run_once()
    assert summary["suppliers"] == 1
    assert summary["escalations"] == 1
    assert summary["sent"] == 1  # Teams
    assert summary["failed"] == 1  # Outlook not configured
    assert sent[0].recipient_email == SUPPLIER["buyer_email"]

    channels = {n["channel"]: n["status"] for n in client.get("/api/notifications").json()}
    assert channels == {"inapp": "sent", "teams": "sent", "outlook": "failed"}
    assert client.get("/api/automode").json()["last_result"]["escalations"] == 1


def test_outlook_uses_graph_send_mail(monkeypatch):
    from app.notifiers import outlook
    from app.notifiers.base import RiskMessage

    for key, value in {
        "ms_tenant_id": "tenant",
        "ms_client_id": "client",
        "ms_client_secret": "secret",
        "outlook_sender": "risk-radar@example.com",
    }.items():
        monkeypatch.setattr(config.settings, key, value)
    outlook._token.update(value="", expires=0)
    calls = []

    class Resp:
        def __init__(self, status, payload=None):
            self.status_code, self._payload, self.text = status, payload or {}, ""

        def raise_for_status(self):
            pass

        def json(self):
            return self._payload

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        if "oauth2" in url:
            return Resp(200, {"access_token": "tok", "expires_in": 3600})
        return Resp(202)

    monkeypatch.setattr(outlook.httpx, "post", fake_post)
    outlook.OutlookNotifier().send(
        RiskMessage(
            supplier_id="S1", supplier_name="X GmbH", supplier_number="1", recipient_name="Erika",
            recipient_email="erika@example.com", traffic_light="red", score=80, subject="Test",
            summary="s", recommendation="r", measures=["m"], link="http://x",
        )
    )
    assert calls[0][0] == "https://login.microsoftonline.com/tenant/oauth2/v2.0/token"
    url, kwargs = calls[1]
    assert url == "https://graph.microsoft.com/v1.0/users/risk-radar@example.com/sendMail"
    assert kwargs["headers"]["Authorization"] == "Bearer tok"
    assert kwargs["json"]["message"]["toRecipients"][0]["emailAddress"]["address"] == "erika@example.com"
