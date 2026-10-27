"""Message to a Microsoft Teams channel via a Workflows webhook (Adaptive Card).

Setup: in the target channel choose "Workflows" → "Post to a channel when a webhook
request is received", copy the URL and set TEAMS_WEBHOOK_URL. The buyer is named
in the card; channel members can follow up there.
"""

import httpx

from ..config import settings
from ..i18n import t
from .base import Notifier, NotifierError, Recipient, RiskMessage



def adaptive_card(m: RiskMessage) -> dict:
    return {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": [
            {
                "type": "TextBlock",
                "text": t(m.lang, "teams.title", name=m.supplier_name),
                "weight": "Bolder",
                "size": "Medium",
                "color": "attention",
                "wrap": True,
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": t(m.lang, "teams.number"), "value": m.supplier_number},
                    *([{"title": t(m.lang, "teams.plants"), "value": ", ".join(m.plants)}] if m.plants else []),
                    {"title": t(m.lang, "teams.recipients"), "value": ", ".join(r.display for r in m.recipients)},
                ],
            },
            {"type": "TextBlock", "text": m.summary, "wrap": True},
            {"type": "TextBlock", "text": f"**{t(m.lang, 'mail.recommendation')}:** {m.recommendation}", "wrap": True},
            {"type": "TextBlock", "text": "\n".join(f"- {x}" for x in m.measures), "wrap": True},
        ],
        "actions": [{"type": "Action.OpenUrl", "title": t(m.lang, "mail.open"), "url": m.link}],
    }


class TeamsNotifier(Notifier):
    id = "teams"
    name = "Microsoft Teams"

    @property
    def configured(self) -> bool:
        return bool(settings.teams_webhook_url)

    def send(self, message: RiskMessage, recipient: Recipient | None = None) -> None:
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
