"""E-mail to the responsible buyer via Microsoft Graph (Outlook / Exchange Online).

Setup (Microsoft Entra ID):
  1. Register an app, create a client secret.
  2. Grant the application permission `Mail.Send` and give admin consent.
     Recommended: restrict the app to the sender mailbox with an
     Exchange application access policy / RBAC for Applications.
  3. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and OUTLOOK_SENDER
     (the mailbox the warnings are sent from, e.g. risk-radar@company.com).
"""

import time
from html import escape

import httpx

from ..config import settings
from ..i18n import t
from .base import Notifier, NotifierError, Recipient, RiskMessage

GRAPH = "https://graph.microsoft.com/v1.0"

_token: dict = {"value": "", "expires": 0.0}


def graph_token() -> str:
    """App-only access token (client credentials flow), cached until shortly before expiry."""
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    try:
        r = httpx.post(
            f"https://login.microsoftonline.com/{settings.ms_tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": settings.ms_client_id,
                "client_secret": settings.ms_client_secret,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
            timeout=20,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise NotifierError(f"Anmeldung bei Microsoft Entra ID fehlgeschlagen: {e}") from e
    _token.update(value=payload["access_token"], expires=time.time() + int(payload.get("expires_in", 3600)))
    return _token["value"]


def render_html(m: RiskMessage, recipient: Recipient) -> str:
    lang = m.lang
    measures = "".join(f"<li>{escape(x)}</li>" for x in m.measures)
    plants = f"<p>{escape(t(lang, 'mail.plants', plants=', '.join(m.plants)))}</p>" if m.plants else ""
    intro = t(lang, "mail.intro", name=escape(m.supplier_name), number=escape(m.supplier_number))
    return f"""
<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1b1b1b">
  <p>{escape(t(lang, "mail.greeting", name=recipient.name or recipient.email))}</p>
  <p>{intro}</p>
  {plants}
  <p>{escape(m.summary)}</p>
  <p><b>{t(lang, "mail.recommendation")}:</b> {escape(m.recommendation)}</p>
  <p><b>{t(lang, "mail.measures")}:</b></p><ul>{measures}</ul>
  <p><a href="{escape(m.link)}">{t(lang, "mail.open")}</a></p>
</div>"""


class OutlookNotifier(Notifier):
    id = "outlook"
    name = "Outlook (Microsoft Graph)"
    per_recipient = True

    @property
    def configured(self) -> bool:
        return bool(settings.ms_tenant_id and settings.ms_client_id and settings.ms_client_secret and settings.outlook_sender)

    def send(self, message: RiskMessage, recipient: Recipient | None = None) -> None:
        if not self.configured:
            raise NotifierError("Outlook ist nicht konfiguriert")
        if recipient is None or not recipient.email:
            raise NotifierError("Keine E-Mail-Adresse hinterlegt")
        try:
            r = httpx.post(
                f"{GRAPH}/users/{settings.outlook_sender}/sendMail",
                headers={"Authorization": f"Bearer {graph_token()}"},
                json={
                    "message": {
                        "subject": message.subject,
                        "body": {"contentType": "HTML", "content": render_html(message, recipient)},
                        "toRecipients": [{"emailAddress": {"address": recipient.email, "name": recipient.name}}],
                        "importance": "high",
                    },
                    "saveToSentItems": True,
                },
                timeout=20,
            )
        except httpx.HTTPError as e:
            raise NotifierError(f"Microsoft Graph nicht erreichbar: {e}") from e
        if r.status_code != 202:
            raise NotifierError(f"Microsoft Graph sendMail antwortet mit {r.status_code}: {r.text[:300]}")
