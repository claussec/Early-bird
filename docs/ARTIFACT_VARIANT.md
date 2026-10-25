# Artefakt-Variante vs. Server-Version

Das Frontend lässt sich für zwei Ziele bauen:

| | Server-Version | Artefakt-Variante |
|---|---|---|
| Build | `npm run build` (bzw. Docker) | `npm run build:artifact` → `frontend/dist-artifact/early-bird.html` |
| Läuft | lokal / auf eigenem Server mit FastAPI-Backend | als private Webseite auf claude.ai, ohne Installation |
| Code-Weiche | `src/backend/http.ts` | `src/backend/artifact.ts` |

Die Oberfläche spricht in beiden Fällen nur mit dem gemeinsamen Interface `src/backend/types.ts`. Funktionen, die es nur in einer Variante gibt, sind dort als optionale Gruppen definiert (`automode`, `webResearch`, `agents`, `storage`). Die UI blendet sie nur ein, wenn die Gruppe vorhanden ist.

## Was gleich ist

- **3D-Cockpit**, Suche nach Name und Lieferantennummer, alle Filter, Detailansicht, Charts, Indikator-Matrix
- **Lieferanten anlegen und löschen** mit demselben Formular und denselben Pflichtfeldern
- **Bewertungslogik nach dem Paper:** KPIs, Schwellen, „Risk?“, Indikator-Matrix, Cross-Referencing, Argumentation, „Escalation?“, ohne Score. In `src/engine/` als TypeScript-Port der Python-Module, gegen das Backend geprüft: Für 16/16 Demo-Lieferanten stimmen Risk?, Escalation?, Kombinationen und Empfehlung überein.
- **Prompts der KI-Agenten** (Internal Data: Risk?, Decision Maker: Argumentation und Escalation?)

## Unterschiede

| Bereich | Server-Version (GitHub `main`) | Artefakt-Variante | Später angleichen? |
|---|---|---|---|
| **Agenten-Logik läuft** | im Python-Backend (`backend/app/`) | im Browser (`frontend/src/engine/`) | Doppelte Logik. Änderungen an Schwellen, Regeln oder Prompts **in beiden** machen, oder das Backend als einzige Quelle nutzen. |
| **LLM** | `LLM_PROVIDER`: Claude-API (eigener API-Key), Ollama (offline) oder regelbasiert | Claude über das claude.ai-Konto des Betrachters (`sample`) oder regelbasiert, umschaltbar oben rechts | – |
| **Speicher** | SQLite (`risk.db`) | Datenbank des Artefakts (`db`: `suppliers`, `results`, `notifications`), geteilt zwischen allen mit Zugriff; ohne Anmeldung nur im Speicher bis zum Neuladen | Export/Import zwischen beiden fehlt noch |
| **Web-Signale (External Module)** | Live-Crawling von Website + News (`CRAWLER_ENABLED=true`), Klassifikation durch das LLM | **Prompt-Workflow:** Recherche-Prompt kopieren → in Claude-Chat mit Websuche ausführen → Antwort einfügen → Vorschau → übernehmen. Auch als Sammel-Recherche für bis zu 15 Lieferanten. Einzelne Signale löschbar. | Den Prompt-Workflow auch in der Server-Version anbieten (manuelle Signale + Endpunkt zum Speichern) |
| **Quellsysteme (SAP, ERP)** | `backend/app/connectors/` + `/api/sources/*`, Import per Lieferantennummer | nicht vorhanden | – (braucht Server) |
| **Benachrichtigungen** | Cockpit + Outlook (Microsoft Graph) + Teams (Webhook), Zustellprotokoll | nur Cockpit (Glocke) | – (braucht Server) |
| **Automode** | Hintergrund-Zeitplan für alle Lieferantennummern inkl. Mails | nicht vorhanden; stattdessen Button **„Alle prüfen“** (regelbasiert, damit ein Klick kein Claude-Kontingent für alle Lieferanten verbraucht) | – (braucht Server) |
| **„Quartalslauf“ / „Alle prüfen“** | mit dem konfigurierten LLM | immer regelbasiert | ggf. Option „mit Claude“ |
| **Analyse eines Lieferanten** | mit dem konfigurierten LLM | im gewählten Agenten-Modus (Claude oder regelbasiert) | – |
| **Lieferant bearbeiten** | API `PUT /api/suppliers/{id}` vorhanden (kein UI) | nicht vorhanden | UI für beide ergänzen |
| **Demo-Daten** | `SEED_DEMO_DATA=true` beim ersten Start | einmalig in die Artefakt-Datenbank geschrieben; Button **„Demo-Daten entfernen“** | Button auch in der Server-Version |
| **Deep-Link** `?supplier=…` | aus Mails/Teams-Karten | nicht nutzbar (claude.ai reicht Query-Parameter nicht weiter) | – |
| **Lieferanten-IDs** | fortlaufend `S1000, S1001, …` | `S` + Zeitstempel (mehrere Personen können gleichzeitig anlegen) | – |
| **Rechte** | wer die App erreicht, darf alles | Lesen: alle mit Zugriff; Ändern: wer im Artefakt mindestens „Contributor“ ist | – |

## Ergebnisse aus der ersten Artefakt-Version

Die erste veröffentlichte Version hatte noch einen numerischen Score. Dort gespeicherte Ergebnisse erkennt das Artefakt am fehlenden `risk_check` und bewertet sie regelbasiert neu, bis eine neue Analyse gespeichert wird.

## Wo im Code

- `frontend/src/backend/types.ts`: gemeinsames Interface, optionale Gruppen je Variante
- `frontend/src/backend/http.ts`: Server-Variante (REST + Server-Sent Events)
- `frontend/src/backend/artifact.ts`: Artefakt-Variante (claude.ai `db` + `sample`, Speicher-Fallback)
- `frontend/src/engine/`: TypeScript-Port von Internal/Decision-Modul, Pipeline, Prompt-Workflow
- `frontend/src/components/WebResearch.tsx`: Recherche-Prompt, Einfügen, Vorschau (nur Artefakt)
- `frontend/src/components/AgentModeControl.tsx`: Umschalter Claude/Regelbasiert (nur Artefakt)
- `frontend/scripts/artifact-page.mjs`: macht aus dem Single-File-Build die Artefakt-Seite
