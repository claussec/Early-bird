"""Message to a Microsoft Teams channel via a Workflows webhook (Adaptive Card).

Setup: in the target channel choose "Workflows" → "Post to a channel when a webhook
request is received", copy the URL and set TEAMS_WEBHOOK_URL. The buyer is named
in the card; channel members can follow up there.
"""

import httpx

from ..config import settings
from .base import Notifier, NotifierError, RiskMessage

LIGHT_DE = {"green": "Grün", "yellow": "Gelb", "red": "Rot"}
LIGHT_STYLE = {"green": "good", "yellow": "warning", "red": "attention"}


def adaptive_card(m: RiskMessage) -> dict:
    return {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": [
            {
                "type": "TextBlock",
                "text": f"Frühwarnung {LIGHT_DE.get(m.traffic_light, m.traffic_light)}: {m.supplier_name}",
                "weight": "Bolder",
                "size": "Medium",
                "color": LIGHT_STYLE.get(m.traffic_light, "default"),
                "wrap": True,
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": "Lieferantennr.", "value": m.supplier_number},
                    {"title": "Risiko-Score", "value": f"{m.score}/100"},
                    {"title": "Einkäufer", "value": f"{m.recipient_name} ({m.recipient_email})"},
                ],
            },
            {"type": "TextBlock", "text": m.summary, "wrap": True},
            {"type": "TextBlock", "text": f"**Empfehlung:** {m.recommendation}", "wrap": True},
            {"type": "TextBlock", "text": "\n".join(f"- {x}" for x in m.measures), "wrap": True},
        ],
        "actions": [{"type": "Action.OpenUrl", "title": "Im Supplier Risk Radar öffnen", "url": m.link}],
    }


class TeamsNotifier(Notifier):
    id = "teams"
    name = "Microsoft Teams"

    @property
    def configured(self) -> bool:
        return bool(settings.teams_webhook_url)

    def send(self, message: RiskMessage) -> None:
        if not self.configured:
            raise NotifierError("Teams ist nicht konfiguriert")
        try:
            r = httpx.post(
                settings.teams_webhook_url,
                json={
                    "type": "message",
                    "attachments": [
                        {"contentType": "application/vnd.microsoft.card.adaptive", "content": adaptive_card(message)}
                    ],
                },
                timeout=20,
            )
        except httpx.HTTPError as e:
            raise NotifierError(f"Teams-Webhook nicht erreichbar: {e}") from e
        if r.status_code >= 300:
            raise NotifierError(f"Teams-Webhook antwortet mit {r.status_code}: {r.text[:300]}")
