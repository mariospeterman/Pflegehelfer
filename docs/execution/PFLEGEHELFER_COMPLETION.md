# Pflegehelfer — verbindlicher Abschlussauftrag

## Natürlicher Coworker, realistische Arbeitsabläufe und nachgewiesene Betriebsfähigkeit

**Datum:** 12. September 2026  
**Repository:** `mariospeterman/Pflegehelfer`  
**Branch:** `codex/genui-production-showcase`  
**Zuletzt bestätigter Ausgangsstand:** `573ff547e9f362acc79f4653240eae091921325d`

## 0. Auftrag, Quellen und Ausführungsgrenze

Führe die vorhandene Implementierung zu einem intern vollständigen, reproduzierbaren Produktabschluss. Erstelle weder einen weiteren Prototyp noch eine zweite Architektur. Behalte funktionierende Komponenten und schliesse die offenen Arbeitsketten von der Anmeldung über Datenübernahme und tatsächliche Mitarbeitendenarbeit bis zur Freigabe, Zustellung, Übergabe und Auswertung.

Dieses Dokument konsolidiert die bisherigen Analysen und die Anweisung `Pflegehelfer_Codex_Patient_Workspaces.md`. Es ergänzt die zuletzt gewünschten Anforderungen: hochwertiges, ruhiges Chat-Design mit zurückhaltendem Glasmaterial, professionelle synthetische Patientendaten, realistische Übergabe mit Vorlesemodus, Arbeitsplan, nützliche Themen/Erwähnungen und nachvollziehbare Leistungsnachweise.

**Produktzweck:** Pflegehelfer unterstützt Dokumentation, Informationsabruf, Kommunikation und Arbeitskoordination. Die Software dokumentiert vorhandene medizinische Angaben und von Menschen berichtete Arbeit; sie erfindet keine Befunde, stellt keine Diagnosen, ändert keine Medikamente und trifft keine eigenständigen Behandlungsentscheidungen. Fachlich verantwortliche Menschen beurteilen und genehmigen ihre Arbeit. Eine menschliche Freigabe allein garantiert keine Nicht-Medizinprodukt-Einstufung. Zweck und konkrete Funktionen müssen vor Echtdatenbetrieb fachlich und rechtlich bewertet werden.

**Beleglage des Ausgangsstands:** Die vorherigen Prüfungen sind Quellcodeprüfungen und vom Projekt dokumentierte lokale Tests. Sie ersetzen nicht die hier verlangte eigene Laufzeitabnahme. Reproduziere die relevanten Befunde am tatsächlichen aktuellen SHA. Bereits behobene Punkte nicht wieder als Defekt behandeln. Synthetische Beispiele in diesem Auftrag sind neue Produktspezifikationen, keine Aussagen über tatsächliche Patienten, Arbeitszeiten oder interne Regeln von Tertianum.

Es wird hier eine Codex-Ausführung angewiesen, nicht ein bereits laufender unbegrenzter Hintergrundprozess. Arbeite im verfügbaren autorisierten Entwicklungs-/Testumfeld. Keine echten Patientendaten, ungefragten Anbieteranschreiben, produktiven Konfigurationsänderungen, offenen kostenpflichtigen API-Tunnel oder destruktiven Eingriffe in fremde Daten. Fehlende Schlüssel und externe Freigaben niemals erfinden.

## 1. Ein einziger verbindlicher Produktkern

> Mitarbeitende sprechen, schreiben oder tippen natürlich. Pflegehelfer kennt den berechtigten Arbeitskontext, fragt nur nach wirklich fehlenden Angaben, zeigt die passende kleine Oberfläche, lässt die tatsächlichen Änderungen prüfen und verarbeitet die freigegebene Arbeit zuverlässig weiter.

Behalte folgende Trennung:

```text
Eine Arbeitssitzung / ein Dienst
  ├─ allgemeine private Pflegehelfer-Assistenz
  ├─ private Patientenassistenz je Patient + Encounter
  ├─ berechtigter Behandlungsteam-Thread
  └─ freigegebene Abteilungs-/Direktgespräche
                  │
          gemeinsame Chat-/GenUI-Oberfläche
                  │
       kontextgebundene Lese- und Vorschlagswerkzeuge
                  │
         Berechtigungen / Review / Befehlsannahme
           ┌──────┴────────┐
           ▼               ▼
       Medplum          PostgreSQL
   klinische FHIR-     Sitzungen, Entwürfe,
   Ressourcen         Abläufe, Freigaben,
                      Aufträge, Zustellbelege
           └──────┬────────┘
                  ▼
       adapterbasierte Provider-Integration
       WiCare / careCoach / SAP / Geräte / weitere
```

Das ist eine modulare Anwendung, nicht zwingend ein Dienst pro Kasten. Behalte React/TypeScript, die vorhandene OpenUI-Integration, Fastify, PostgreSQL und Medplum. Verwende vorhandene SDKs und Sicherheitsbibliotheken. Kein neues Kafka/NATS/Flowable/Temporal, keine Agentenflotte und keine zusätzliche Vektordatenbank ohne nachgewiesenen Bedarf und ADR.

Medplum ist der normalisierte klinische Arbeits- und Integrationsspeicher, nicht automatisch der rechtliche oder operative Master aller Providerdaten. Definiere pro Datendomäne den führenden Anbieter. PostgreSQL ist kein zweites vollständiges EHR, darf aber die notwendigen Entwürfe, genehmigten Auftragsdaten und Zustellbelege zur sicheren Verarbeitung speichern.

Markdown beschreibt Institution, Rollen und Arbeitsverfahren. Validierte Metadaten steuern die Ausführung. Live-Patientenakten und Geheimnisse gehören weder in Markdown-Dateien noch in Git. Für den Alltag müssen Mitarbeitende Medplum nicht öffnen. Expertenzugriffe sind getrennt autorisiert, auditierbar und kein Freigabe-Bypass.

## 2. Zuerst prüfen und konsolidieren

1. Ermittle Branch-HEAD und Unterschiede zum Ausgangs-SHA. Sichere einen sauberen Arbeitsstand ohne fremde Änderungen zu verwerfen.
2. Lies `AGENTS.md`, `agent.md`, aktive Architektur-/Produkt-/Workflow-Dokumente, ADR-0012, Status, Migrationen und den tatsächlich ausgeführten Code. Fehlende benannte Dokumente nicht vortäuschen; vorhandene Einstiegspunkte nutzen.
3. Verfolge Anmeldung, Threadwechsel, Entwurfsbearbeitung, Modellaufruf, Freigabe, FHIR-Zustellung, Provider-Worker, Teamnachrichten, Datenaufbewahrung und UI durch sämtliche beteiligten Implementierungen.
4. Starte App, echte Test-PostgreSQL-Instanz, Medplum und zustandsbehaftete Simulatoren. Führe Baseline-Tests aus und notiere Pflicht-Skips.
5. Prüfe die Oberfläche in einem echten Browser. Screenshots alleine sind kein Beweis für funktionierende Interaktion; Tests alleine sind kein Beweis für gute Gestaltung.
6. Lege eine kurze Abschlussmatrix an: Anforderung → Implementierung → Test → Laufzeitbeleg → Status → nächster Schritt. Ergänze keine neue grossflächige Roadmap statt zu implementieren.

Im Ausgangsstand sind insbesondere noch zu verifizieren bzw. abzuschliessen:

- dauerhaft wiederherstellbare, editierbare Vorschläge und Mehrfenster-Konflikte;
- eine atomare lokale Annahme von Freigabe, Auftrag, Audit und Versandjobs;
- nummerierte unveränderliche Migrationen sowie Encounter-Migrationen für Intake/Visite;
- Entfernung des Gesamtzustands-`Binary` aus dem normalen Betrieb;
- relationale Worker, echte Inbound-Verarbeitung und dauerhafte berechtigungsgesteuerte Ereignisse;
- eingefrorener klinischer Inhalt der Übergabe, nicht nur die Patientenliste;
- institutionelles OIDC, Mandanten-/Abteilungsisolation und RLS;
- gemeinsame ACL-Threads, tatsächliche Themenfilter, Bibliothek/Medien;
- Workflow-Veröffentlichung, Admin, Leistungsnachweise und Verbesserungszyklus;
- reale LLM-, ASR- und Vorlese-Abnahme;
- echter Restore-/Rollback-Test und nachgewiesener netzisolierter Betrieb.

Behalte bereits umgesetzte Verbesserungen: getrennte Anna-/Luca-Threads, Encounter-Bindung, Originaltexte, Status unbekannt vs. verneint, `DocumentReference` für passende generische Notizen, zustandsbehaftete Provider-Simulatoren, Quelle/Provenance, Schutz vor Vermischung unbestätigter Werte mit abgeschlossener Arbeit und transparente Modellfehler.

## 3. Autonomer Abschlussloop mit Fortschrittskontrolle

Arbeite in vertikalen, nachweisbaren Funktionsabschnitten:

```text
Nächste offene Abnahme wählen
→ Befund reproduzieren / Akzeptanztest schreiben
→ kleinste vollständige Umsetzung
→ Unit-/Integrations-/Real-Store-Tests
→ echten Browser und Datenzustand prüfen
→ unabhängiges Review der betroffenen Risiken
→ Fehler korrigieren / Regression
→ Belege und Fortschritt speichern
→ nächste offene Abnahme
```

Ein Abschnitt ist nicht erledigt, wenn nur Tabellen, Komponenten oder Mock-Endpunkte existieren. Ein Menüpunkt muss seine beworbene Funktion ausführen. Schreibe keine neuen generischen Fallbacks nur, um Prüfungen grün zu bekommen.

Führe am Ende jedes Abschnitts die gemeinsame Regression aus. Verwende Review-Subagenten, sofern verfügbar, mit klaren Prüffragen und getrennten Änderungen. Lasse nicht mehrere Agenten dieselben Dateien unkoordiniert umbauen.

Bleibt derselbe Fehler nach wiederholten Reparaturen bestehen, untersuche Ursache, Datenmodell und Kontrollfluss; nicht beliebig dieselben Tests wiederholen. Zeit-/Kontext-/Toolgrenzen lösen einen ehrlichen Übergabepunkt mit SHA, Befunden, nächsten Befehlen und offenen Abnahmen aus. Nie behaupten, im Hintergrund unbegrenzt weiterzuarbeiten.

**Abschlussbedingung:** Alle internen Pflichtabnahmen sind bestanden. Externe Schlüssel, Verträge und institutionelle Freigaben werden getrennt als blockiert dokumentiert; sie machen interne Lücken nicht fertig. Die verbundene KI-Demo bleibt unbestanden, solange kein echter Modell-/Audiotest lief.

## 4. Dokumentation ohne konkurrierende Richtungen

Halte `AGENTS.md` als kurzen Einstieg mit Sicherheitsinvarianten, tatsächlichen Befehlen und Verweisen. Dieser ausführliche Auftrag gehört beispielsweise nach `docs/execution/PFLEGEHELFER_COMPLETION.md`, nicht als mehrere hundert Zeilen automatisch geladene Duplikate in jede Agentendatei.

Es gibt eine aktive Architektur und einen Produktvertrag. `agent.md`, historische Master-Prompts und ADRs werden auf Widersprüche geprüft. Entweder zusammenführen, auf die kanonische Fassung verweisen oder deutlich als ersetzt archivieren. Architekturentscheidungen nicht rückwirkend umschreiben, um einen Fehler zu verbergen.

Die aktuelle Entscheidung bleibt: eine zusammenhängende Arbeitssitzung, mehrere berechtigungsgesteuerte Gespräche, ein UI-/Tool-/Freigabe-System. Kein Zurück zu einer einzigen vermischten Patientenchronik und kein zweites Dashboard hinter Feature-Flags.

## 5. UX: professionelles Chat-Produkt statt Formulare mit Chatleiste

Pflegehelfer soll die Klarheit aktueller ChatGPT-Oberflächen mit eigener, hochwertiger Markenidentität verbinden. Verwende aktuelle offizielle Referenzen [S01], keine erfundene Behauptung über den neuesten Pixelstand. Unterscheide Web, Mobile und Desktop; kopiere nicht widersprüchliche Plattformmuster. Kein OpenAI-Logo und keine irreführende Produktnachahmung.

### Shell und Navigation

Desktop: ruhige einklappbare Seitenleiste, breite aber gut lesbare Gesprächsspalte, optionaler Detailinspektor. Mobile: Drawer, kleine Kopfzeile, sichtbarer relevanter Patient-/Audience-Kontext und ein stabiler Composer. Keine zweite permanente Modulnavigation.

Empfohlene Einträge:

```text
Suche
Mein Assistent
Geplant / Arbeitsplan
Team / Erwähnungen
Bibliothek
  Dokumente
  Bilder
Zugewiesene Patienten / Bewohnende
Angeheftet / Verlauf
Profil / Darstellung
Administration nur bei Berechtigung
```

`Mein Assistent` öffnet den allgemeinen privaten Thread direkt. Er sendet nicht nur „Übergabe“ in einen weiterhin aktiven Patientenchat. `Geplant` öffnet einen tatsächlichen Arbeitsplan aus Aufgaben/Terminen. `Bibliothek` durchsucht und öffnet echte autorisierte Ressourcen statt eine allgemeine SOP-Frage zu senden. Eine als Gesprächssuche beschriftete Suche muss auch berechtigte Gespräche durchsuchen; sonst korrekt als Patientensuche benennen.

Patienten öffnen einen privaten Assistenzthread **über** diese Person. Das Patientenbild ist Identitätshilfe, nicht Avatar einer imitierenden Patienten-KI. Kein „online“, „tippt“, erfundener Patientendialog, Social-Media-Ranking oder Feed. Die Arbeits-/Schichtfortschritte bleiben beim Threadwechsel bestehen.

Kontexttabs wie Chat, Profil, Verlauf, Werte, Team und Mehr benutzen dieselben Daten und Dienste. Teamtab ist ausdrücklich ein anderer Empfängerkreis. Vor Veröffentlichung privater Inhalte Audience anzeigen und prüfen lassen.

### Keine visuelle oder funktionale Verdopplung

Eine Aktion erhält einen dauerhaft auffindbaren Status, nicht gleichzeitig Toast, Banner, Chatkopie und weitere identische Karte. Vollzogene Anfragen kompakt zusammenfalten statt beim Wiederöffnen erneut abzuspielen. Referenzen auf denselben Bericht in Plan, Profil und Team sind keine mehrfach gespeicherten Berichte.

Ein Patientenwechsel stellt dessen Scrollposition, erlaubte Entwürfe und Eingabe wieder her. Ein neuer Teamhinweis springt nicht ungefragt in einen anderen Raum und reisst den Lesefokus nicht weg.

## 6. Designsystem: Pharma-Blau, Rot, Weiss/Schwarz und kontrolliertes Glas

Das Design soll handwerklich hochwertig und präsentationsstark wirken. „Awwwards-artig“ ist ein Qualitätsanspruch an Typografie, Abstände, Materialwirkung und Details, keine Verpflichtung zu Animationen oder ein behaupteter Award.

**Eine** semantische Tokenbibliothek für Light, Dark und System. Nutze Weiss/leichtes Neutral als helle Grundfläche, Near-Black als dunkle, gut kontrastierendes Blau für primäre Interaktion und zurückhaltendes Rot für Marke bzw. ausdrücklich dringende/fehlerhafte Zustände. Erfolg kann ein kleines neutrales oder grünes Signal haben; nicht jede akzeptierte Dokumentation muss grossflächig grün sein.

Glas ist jetzt ein gewünschtes Material, aber nur dort, wo es verständliche Ebenen unterstützt: beispielsweise Drawer, Composer-Rand oder kompakte Werkzeugleiste. Erzeuge eine glaubhafte subtile Wirkung durch stabile Hintergründe, feine Lichtkante, zurückhaltende Unschärfe und sparsame Schatten. Keine verzerrten Buchstaben, Flüssigkeitsanimation über Zahlen, farbigen Reflektionen unter Medikamenten oder permanent animierten Shader/WebGL-Flächen.

Klinische Inhalte, Messwerte, Tabellen, Warnhinweise und Freigaben stehen auf ruhigen ausreichend deckenden Flächen. Höchstens wenige gleichzeitige Glaslagen; mobile GPU-Kosten messen. Biete „Reduzierte Transparenz“ als Einstellung und deckenden Fallback; respektiere `prefers-reduced-motion`, erkannten Kontrastbedarf und Forced Colors. Kontrast über dem tatsächlich zusammengesetzten Hintergrund prüfen, nicht nur Tokenfarben vergleichen. WCAG 2.2 AA anstreben [S02]; funktionale Information nie nur farblich vermitteln.

Verwende eine konsistente gepflegte SVG-Icon-Bibliothek, möglichst die bereits verwendete. Keine Mischung aus Emoji, Unicode-Hamburgern und unterschiedlichen Strichstärken. Eindeutige Symbole für Suche, Mikrofon, Senden, Stop, Vorlesen, Pause, Ausklappen, Anhang, Kalender, Patient, Team, Bearbeiten, Verwerfen und Status. Icon-only-Buttons erhalten zugängliche Labels; wichtige seltene Aktionen zusätzlich Text. Praktisches Bedienziel 44–48 CSS-Pixel, ohne das fälschlich als universelle WCAG-Mindestregel zu bezeichnen.

Composer: automatische Höhe, Spracheingabe auch bei vorhandenem Text, Aufnahme-/Sendestatus, Abbrechen, kein Abschneiden mit virtueller Tastatur, safe-area und `dvh`, keine ungewollte Tastatur beim Patientenwechsel. Keine stille Kürzung langer Diktate. Kontextchips dürfen Eingabe- und Sendenflächen nicht überdecken.

### Marke

Bestehenden eigenständigen blauen Edelweiss-/Negativraum-Plus-Entwurf beibehalten und verfeinern. Eine kanonische SVG-Quelle, korrekte eindeutige Masken-IDs, Favicon und maskierbare PWA-Icons. Auf 16/24/32 Pixeln sowie in beiden Themes prüfen.

Kein rotes Kreuz auf Weiss, kein offizielles Schweizer Wappen und keine amtliche Anmutung. Rot bleibt getrennte Akzentfarbe. Auch andere Farben sind keine automatische rechtliche Freigabe; Verwechslungsgefahr prüfen und vor Veröffentlichung entsprechend bewerten [S03]. Keine offiziellen Tertianum-Markenassets ohne Erlaubnis.

## 7. Realistische synthetische Demo statt sieben voneinander isolierter Beispielsätze

Baue einen deterministisch reproduzierbaren Demodatensatz, standardmässig etwa zwölf fachlich stimmige Personen mit zunächst sechs zugeteilten Patienten in der Referenzschicht. Zusätzlich Testprofile mit null, zwei und zwölf Zuteilungen; nie eine feste Sechserzahl im Anwendungscode. Alle Daten, Mitarbeitenden, Dokumente, Anordnungen und Telefonnummern sind erfunden und als synthetisch gekennzeichnet.

**Institution:** `Tertianum Kronenhof · Demo`. Gut sichtbarer, aber nicht überall wiederholter Hinweis: keine offizielle Installation oder Empfehlung, keine echten Patientendaten eingeben. Ein zweiter unabhängiger fiktiver Standort hat andere Abteilungen, Schichten und Provider-Routen.

Nutze einen eingefrorenen Demo-Ausgangszeitpunkt und einen steuerbaren Szenariotakt. Zeige die Simulationszeit. Im Produktivmodus sind diese Steuerungen deaktiviert. Beispieldaten beim täglichen Reset nicht still als neu erhobene reale Messungen umdatieren.

### Vorgeschlagene Fallvielfalt

Die folgenden Geschichten sind Autorenvorgaben für Fixtures, keine medizinischen Empfehlungen:

| Synthetische Person | Bereits dokumentierter Ausgangskontext                                                               | Damit nachzuweisender Ablauf                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Anna Beispiel       | Rehabilitation nach versorgter Hüftfraktur; Mobilitätsziel und Hilfebedarf im bestehenden Pflegeplan | Morgendliche Unterstützung, Therapieabhängigkeit, Rückfrage, Unterbrechung        |
| Luca Demo           | Rekonvaleszenz nach Pneumonie; bereits dokumentierter Diabetes Typ 2                                 | Mahlzeit/Trinkmenge, Teilabschluss, Mengenberichtigung ohne Behandlungsvorschlag  |
| Mei Muster          | Bekannter Schlaganfall mit dokumentierten funktionellen Einschränkungen                              | Therapiekoordination und exakt übernommene Hilfsmittel-/Kommunikationshinweise    |
| Jonas Beispiel      | Dokumentiertes Parkinson-Syndrom                                                                     | Geplante Hilfe, Pausierung, spätere Fortsetzung entsprechend bestehendem Plan     |
| Eva Demo            | Bereits dokumentierte kognitive Einschränkung                                                        | Biografie/Routinen, Angehörigenfrage, keine Persönlichkeitsdiagnose durch KI      |
| Samir Muster        | Nachbehandlung bei bekannter Herzinsuffizienz                                                        | Quellengebundener Messverlauf und Medikationsabgleich, kein neues Dosieren        |
| Ruth Beispiel       | Bekannte Arthrose und dokumentierte chronische Beschwerden                                           | Schmerzbericht mit Verneinung/Zeitbezug und menschlicher Rückmeldung              |
| Paul Demo           | Rehabilitation nach Knieoperation                                                                    | Termin/Transport, vorhandener Wundbericht, freigegebene synthetische Bildreferenz |
| Aline Muster        | Französische Hauptsprache, dokumentierter Unterstützungsbedarf                                       | Mehrsprachige Oberfläche/Transkription und Therapietermin                         |
| Theo Beispiel       | Bekannte COPD                                                                                        | Bestätigte Messwerte plus gesonderter unbestätigter Testwert, keine KI-Triage     |
| Mila Demo           | Dokumentierte Seh-/Höreinschränkung                                                                  | Zugängliche Kommunikation, Service mit minimalem Kontext                          |
| Noah Beispiel       | Wiederaufnahme nach früherem abgeschlossenen Aufenthalt                                              | Derselbe Patient, neuer Encounter; alte Chats/Entwürfe nicht umhängen             |

Jedes Profil enthält plausible Stammdaten, Encounter/Standort, dokumentierte Diagnosen mit Status/Quelle, Allergiestatus, vorhandene Medikation nur lesbar, Pflege-/Rehaziele, Hilfsmittel, Kommunikationsbedürfnisse, Termine, Aufgaben, 1–2 Wochen zeitlich konsistente Ereignisse und mindestens eine relevante Quellverknüpfung. Nicht jede Person benötigt jede denkbare Diagnose.

Medikamente und pflegerische Vorgaben nur als fachlich überprüfte **vorgegebene** Fixture-Daten. Keine LLM-generierten Behandlungsempfehlungen als Ergebnis des Produkts darstellen. Kodierte Diagnosen/Assessments nur mit verifizierten, zulässigen Begriffen; nicht aus dem Gedächtnis Codes erfinden. Lizenzpflichtige interRAI-/BESA-/LEP-Inhalte nicht kopieren. Beispielschema ohne geschützte Fragebögen genügt, solange keine Zertifizierung behauptet wird.

Avatare dürfen neutrale Illustrationen/Initialen sein. Keine Fotos realer Pflegebedürftiger aus dem Web. Keine medizinischen Originalbilder manipulieren. Datensatzprüfungen müssen Referenzen, Alter, Zeitfolge, Encounter, Negation, Medikationslisten und absichtlich eingebaute Konflikte prüfen; gewollte Konflikte sind ausdrücklich markierte Testfälle.

## 8. Rollen fachlich unterscheiden, ohne ein universelles Schweizer Berufsrecht zu erfinden

Konfiguriere reale unterschiedliche Demonstrationsabläufe für Pflegehelfende SRK/Pflegeassistenz, AGS falls aktiviert, FaGe EFZ, Pflegefachpersonen HF/FH, Ärztinnen/Ärzte, Apothekerinnen/Apotheker, pharmazeutische Unterstützung, Physio/Ergo/Logopädie, Transport, Service/Reinigung, Administration/Abrechnung, Heimleitung, HR, IT sowie Qualität.

Nicht nur neue Rollenlabels über identischen Rechten anlegen. Eine Pflegefachperson kann je nach Konfiguration koordinieren/prüfen; FaGe und Pflegeassistenz haben eigene Kompetenz-/Delegationsprofile. Pharmazieprüfung und Logistik sind getrennt. Management sieht standardmässig aggregierte Betriebsinformationen; HR keine Patientenakte; IT keine automatische fachliche Schreibberechtigung. Versicherungsakteure wären eine eigene externe, minimal berechtigte Audience, nicht interne Mitarbeitende.

Berechtigung ergibt sich aus Identität, Institution, Abteilung, Funktion, Qualifikation/individueller Freigabe, Auftrag/Delegation, Behandlungsbeziehung, Zweck, Aktion und aktuellem Zustand. Titel oder Markdown erteilt keine Rechte. Schweizer konkrete Tätigkeitsgrenzen müssen institutions- und gegebenenfalls kantonsspezifisch bestätigt werden [S04]. Alle Demo-Rechte tragen den Hinweis „synthetische Organisationsregel, nicht universelle Berufsbefugnis“.

Ein nicht zugeordneter oder dienstfremder Mitarbeiter erhält eine zulässige Klärungsmöglichkeit, nicht automatisch den ersten Patienten. Pflegefreigaben benötigen keine universelle Vier-Augen-Pflicht; zusätzliche Prüfung erfolgt nur nach veröffentlichter sachgerechter Regel. Passkey/MFA bestätigt Identität bzw. Assurance, nicht die medizinische Wahrheit und nicht automatisch eine qualifizierte elektronische Signatur.

## 9. Übergabe als echter geführter Arbeitsbeginn

Nursing startet automatisch in der richtigen bestehenden/neu zugeteilten Sitzung. Kein Blank Chat, kein Marketingtext und kein fest codiertes „Schritt 1 von 10“ bei jeder Anmeldung. Falls keine Übergabe vorliegt, das ehrlich anzeigen und keinen fiktiven Nachtdienstbericht erzeugen.

Zeige zuerst eine kompakte, ausklappbare Liste der zugeteilten Patienten mit Quelle/Zeitraum und Fortschritt. Die Übersicht ist auch bei vielen Personen scanbar. Patientenzahl und Reihenfolge stammen aus Aufgaben/Zuteilung.

Pro Patient werden diese vier Bereiche angeboten, als lokale Adaption strukturierter Übergabekommunikation [S05]:

1. **Kurzprofil und Achtung:** relevante bereits dokumentierte Diagnosen/Behandlungsanlass, Hilfebedarf und aktive bestätigte Hinweise. Nicht die gesamte Anamnese.
2. **Seit der letzten Schicht:** tatsächlich dokumentierte Veränderungen, erledigte Interventionen und Ergebnisse mit Autor/Zeit/Quelle.
3. **Offen oder ungeklärt:** unbeantwortete Fragen, fehlende/nicht geprüfte Angaben, noch unbestätigte Meldungen. Nicht behaupten, die Vorschicht habe etwas übersehen, wenn das nicht dokumentiert ist.
4. **Nächste Schicht:** konkrete vorhandene/geprüfte Aufgaben mit wem, wann, warum, Abhängigkeit und der Möglichkeit zur Verantwortungsübernahme.

Hintergrund neutral, Änderungen blauer Akzent, offene Fragen amber/neutral, Aufgaben klar blau. Rot nur für ausdrücklich dokumentierte dringende Zustände, nicht für beliebige Diagnosen. Immer Überschrift/Text/Icon zusätzlich zur Farbe. Relevante ungeprüfte Meldungen dürfen nicht in geschlossenen Details unsichtbar werden.

Möglicher fiktiver Bildschirminhalt:

```text
Übergabe Nacht → Früh                 2 von 6 geprüft
Anna Beispiel · 001 · aktiver Fall

KURZPROFIL
Rehabilitation nach Hüftfraktur; Hilfe gemäss bestehendem Plan.

SEIT DER NACHT
05:50 Unterstützung beim Toilettengang dokumentiert.
Keine weiteren Ereignisse im vorliegenden Nachtbericht angegeben.

OFFEN / BEACHTEN
Angehörigenfrage zur Austrittsplanung noch unbeantwortet.
Bestehender Mobilitätshinweis: Details aus Pflegeplan öffnen.

HEUTE
07:30 Morgenpflege · Lea · gemäss Pflegeplan
08:40 vereinbarter Transport zur Physiotherapie · Transportteam

[Vorlesen] [Rückfrage] [Zur Kenntnis genommen] [Nächste Person]
```

Nicht aus fehlenden Ereignissen „stabile Nacht“ oder „keine Beschwerden“ ableiten. „Worauf achten“ enthält vorhandene von Menschen verantwortete Anweisungen, keine vom Modell neu erfundenen Überwachungs-/Behandlungsempfehlungen.

### Inhalt und Bestätigung

Baue einen unveränderlichen Übergabe-Snapshot aus Datenelementen, Versionen, Quellzeiten, ausstehenden Aufträgen und Verantwortlichkeiten. Speichere den Inhalt, nicht nur einen Hash der Roster-IDs. Eine Zusammenfassung ist eine abgeleitete Darstellung dieses Inhalts. Bei nachträglicher Änderung Addendum/neue Version und erneute passende Kenntnisnahme.

Bestätigen bedeutet Kenntnisnahme/Übernahme der benannten Version, nicht bewiesenes Verstehen oder erledigte Pflege. Rückfragen, „später prüfen“, Teilübernahme und Übergabe an zuständige Dienstrolle funktionieren. Empfangende Schicht bestätigt die reale Übergabe. Offene Verantwortung bleibt bis zur wirksamen Annahme sichtbar; unbeantwortete Übergaben haben einen freigegebenen Eskalationspfad.

## 10. Vorlesen, Sprache und kleine Rückfragen

Vorlesen ist ein eigener TTS-Pfad, nicht die ASR-Funktion. Implementiere `tts.readout` neben `asr.transcription` hinter austauschbaren Adaptern.

Vorlesen gibt den sichtbaren, versionierten Übergabetext wieder: Person, Kontext, Änderungen, offen, Aufgaben. Keine zweite generative Erzählung mit neuen Fakten. Numerische Werte, Verneinungen und Daten bleiben korrekt. Steuerung: Start, Pause, Fortsetzen, Wiederholen, nächste Person, Geschwindigkeit, Stop; markiere den aktuell gelesenen Bereich, soweit echte Audio-/Segmentinformationen vorliegen.

Der Mikrofonknopf darf für eine Rückfrage unterbrechen. Danach gezielt zur Stelle zurückkehren. TTS-Playback darf nicht als neue Mitarbeitendenaussage aufgenommen oder als „verstanden“ ausgeführt werden. Vorlesen bestätigt nichts automatisch; Sprachbestätigungen müssen klar auf den sichtbaren Schritt gebunden sein und dürfen kritische Signaturen nicht nebenbei auslösen.

Produktiv nur geprüfte lokale/zugelassene TTS-/ASR-Datenwege; eine Browserstimme ist nicht automatisch lokal. Patientendaten nicht über beliebige Systemstimmen oder externe Speech-Dienste leiten. Lautsprecherausgabe braucht bewussten Start und Privatsphäre-Hinweis; keine Namen auf einem öffentlichen Sperrbildschirm. Roh-Audio standardmässig transient. Aufnahme/Playback bei Sperre, Kontextwechsel und Berechtigungsentzug sicher stoppen bzw. dem ursprünglichen Kontext zuordnen.

## 11. Übergabe → Arbeitsplan → laufender Dienst

Nach der Übergabe öffnet Pflegehelfer den echten heutigen Plan. Zeilen enthalten Patient/Zimmer, Zeit oder Zeitfenster, Tätigkeit, Grund/Quellauftrag, zuständige Person/Rolle, notwendige zweite Person/Hilfsmittel, Abhängigkeit und Status. Zimmerwechsel verändern nicht die Patientenidentität.

Planquellen sind bestehende Pflege-/Therapieaufträge, Termine, übernommene Restaufgaben und explizite spontane Aufträge. Nicht sämtliche Krankheiten in Aktivitäten umwandeln. Keine Pflicht, jede Person vor einer pauschalen Frühstückszeit abzufertigen.

Eine Reihenfolgehilfe darf eindeutige operative Einschränkungen benutzen: vereinbarte Termine, Personalverfügbarkeit, gegebene Hilfebedarfe, Wünsche und die vom Team festgelegte Priorität. Zeige „Vorgeschlagene Reihenfolge“ mit kurzer Begründung. Bei unmöglichem Plan Konflikt sichtbar machen, nicht überbuchen oder Ziele/Behandlung eigenständig ändern. Fachliche Priorität wird nicht vom allgemeinen LLM aus Vitalwerten erfunden.

Ein Tap auf eine Aufgabe öffnet den passenden Patiententhread/Encounter und eine Arbeitsepisode. Start/Pause/Fortsetzen/Abschluss erzeugen nachvollziehbare Zeitsegmente. Jede durchgeführte Teilaktivität hat ihren tatsächlichen Status. Stopp allein dokumentiert keine Leistung. Vorzeitiges Schichtende ist mit begründetem Übergeben möglich; niemand muss Tätigkeiten fälschlich als abgeschlossen markieren.

Unterbrechung: Entwurf speichern, Episode pausieren, neuen Kontext bewusst bestätigen; dann Rückkehrkarte mit noch offenen Punkten. Ein reiner Blick in eine andere Akte startet/stoppt keinen Timer. Auch nach Abschluss der geplanten Runde bleibt der Dienst für Klingeln, Angehörige, Lagerung, Transport und andere ungeplante Arbeit offen.

## 12. Natürlich erfassen, sinnvoll prüfen, einmal freigeben

Ein frei formulierter Bericht kann mehrere passende Vorschläge erzeugen. Der Nutzer sieht Bedeutung und Ziel, keine `CareEventProposal`-Felder. Kleine Abweichungen inline bearbeiten; „Ändern“ darf nicht das Dialogfenster schliessen und vollständiges Neuschreiben verlangen.

Beispiel:

```text
„Luca beim Waschen geholfen, zum Frühstück begleitet.
Fast alles gegessen und etwa 200 ml getrunken.
Gewicht machen wir später. Nora bitte informieren.“
```

Pflegehelfer nutzt aktuelle Aufgaben und berechtigte Empfänger, trennt erledigte Arbeit von geplanter Arbeit und fragt nur nach nicht bestimmbarer Information. Es erfindet weder Gewicht noch Medikamentengabe noch medizinischen Grund. „Etwa“ bleibt erhalten. Flüssigkeitsmengen werden nur dann strukturiert gebucht, wenn der entsprechende Workflow/das Mapping umgesetzt ist; andernfalls ehrlich als berichtete Information dokumentieren.

Ein gemeinsamer Review darf Dokumentation, zulässige Beobachtung, benannte Task-Änderung und eine ausdrücklich gewünschte Kommunikation umfassen. Jeder Effekt ist sichtbar, einzeln abwählbar, inhaltlich editierbar und mit lokalen/externen Zuständen versehen. Keine zweite Freigabe nur wegen technisch getrennter Dienste.

Ein sofort gemeldeter extremer Wert bleibt sichtbar als berichtet/ungeprüft; er wird nicht zu „normal“ korrigiert, nicht durch einen älteren bestätigten Wert verdeckt und nicht als abschliessend validierte Leistungsevidenz verwendet. Bestehende Notfallkommunikation ist unabhängig von digitaler Gegenzeichnung. Ein sensibler berichteter Inhalt darf nicht deshalb aus der Dokumentation verschwinden, weil das System keine Diagnose stellen darf.

## 13. #Themen mit wirklichem Nutzen, aber ohne verdeckte Diagnostik

Erweitere die vorhandene Standort-Taxonomie, statt eine neue klinische Ontologie zu bauen. Beispiele: `#Mobilisation`, `#Sturzprävention`, `#Schmerz`, `#Flüssigkeit`, `#Ernährung`, `#Wunde`, `#Ausscheidung`, `#Schlaf`, `#Angehörige`, `#Transport`, `#Austritt`.

Stable IDs, lokalisierte Labels, Synonyme, Beschreibung, Sensitivität und zugelassene Verwendung. Das System kann „schtuzgefahr“ als möglichen Begriffsvorschlag **Sturzgefahr** anbieten; die klinische Aussage wird nicht allein anhand einer Schreibkorrektur erzeugt.

Beim Bericht schlägt Pflegehelfer maximal wenige passende Themen vor und erklärt bei Bedarf die Fundstelle. Mitarbeitende können übernehmen, entfernen oder ändern. Freigegebene Themen ordnen Beiträge, Aufgaben und Dokumente und ermöglichen gespeicherte Filter. Daraus entstehen dynamische Ansichten wie „offene Mobilisationsfragen“ oder „Beiträge zur Sturzprävention“, nicht zusätzliche Kopien der Patientendaten.

**Drei Ebenen strikt trennen:**

- Thema/Kategorie: „Dieser Beitrag handelt von Mobilisation/Sturzprävention“.
- Klinische Aussage: „Eine Fachperson hat am Zeitpunkt X ein Risiko dokumentiert“.
- Aktiver Hinweis: geprüfter, verantworteter Hinweis mit Status, Quelle, Gültigkeit/Review und gegebenenfalls passendem FHIR `Flag` [S06].

„Sturzgefahr erkannt → Patient automatisch als Risikopatient markieren“ ist nicht zulässig als neue autonome Schlussfolgerung. Ist das Risiko bereits vom Provider oder einer berechtigten Person bestätigt, darf eine abgeleitete Kategorie auf diese Quelle verweisen. Andernfalls bleibt es ein Themen-/Reviewvorschlag. Unbekannt, verneint, historisch, fraglich, bestätigt und erledigt unterscheiden.

Pflichttests: „keine Sturzgefahr festgestellt“, „Sturz vor fünf Jahren“, „Sturzgefahr bitte fachlich prüfen“, „keine akuten Schmerzen“, „Suizidgedanken verneint“, „historischer Eintrag“, „neue Verneinung bei noch aktivem bestätigtem Hinweis“. Keine falsche positive Markierung, keine automatische Löschung eines bestehenden Warnhinweises, keine blockierte Dokumentation ausdrücklich berichteter Sorge.

Ein Tag erzeugt weder eine Rechnung noch eine Diagnose, Aufgabe oder Alarmmeldung. Solche Effekte müssen als separate zulässige Vorschläge sichtbar genehmigt werden. Topic-Zahlen sind keine Patientenprävalenz und keine Teamleistungskennzahl.

## 14. @Erwähnungen, Berichte, Team und Benachrichtigungen

Ersetze Freitext-Routing durch berechtigte Verzeichnisauflösung: `@Nora` und `@Pflegefachperson-Spätdienst` ergeben eine sichtbare konkrete Person oder Dienstwarteschlange. Bei Mehrdeutigkeit Auswahl; niemals ersten Treffer still verwenden. Ein Name/Hashtag erweitert keine Rechte.

Private Assistenz, Patiententeam, Abteilung und DM haben unterschiedliche Audiences. Vor dem Teilen: Empfänger/Kreis und zu veröffentlichender Inhalt sichtbar. Private Diktate und Entwürfe werden nicht ungefragt in die Patientenakte oder Teamchronik kopiert. Eine normale selbst geschriebene Nachricht kann mit bewusstem „Senden“ genehmigt werden; keine unnötige zweite Bestätigung für jedes Wort.

Mehrteilige Kommentare, Antworten, Übernehmen, Rückfrage, Auflösen und Reassignments sind dauerhaft gespeichert. Ein Kommentar auf einen freigegebenen Bericht ist eine verknüpfte Ergänzung, keine unsichtbare Änderung des signierten Originals. Klinisch relevante Entscheidungen aus dem Teamchat werden über den normalen Review in eine passende dokumentierte Aktion übernommen. Keine automatisch medizinisch verbindliche Anordnung aus einem Chat ableiten.

Zustände unterscheiden: im Server gespeichert, zugestellt, gesehen soweit tatsächlich gemessen, verantwortlich angenommen, beantwortet, gelöst. Off-duty-Personen müssen durch autorisierte Dienstzuständigkeit vertretbar sein. Duplikatsuche berücksichtigt nur zugängliche Inhalte und verrät keine geschützte Thread-Existenz.

In-App-Benachrichtigungen und dauerhafte SSE-Ereignisse: audience-gefiltert, wiederaufnehmbar, mit dedupliziertem Unread-Status. Zeige einen ruhigen Neuigkeitenhinweis statt automatischen Kontextwechsel. Dringlichkeit kommt aus expliziter Eingabe/veröffentlichter Regel, nicht nur aus `#`.

Für normale mobile Push-Zustellung ist ein gesondert freigegebener Kanal nötig; Browserhintergrundbetrieb ist keine Garantie. Im Air-Gap weder Apple/Google Push noch öffentliche Dienste heimlich voraussetzen. Auf Sperrbildschirmen standardmässig keine Patientendetails. Primäre Klingel-/Notrufsysteme bleiben unabhängig; Pflegehelfer spiegelt nur autorisierte Ereignisse. Für dringende reale Hilfe muss der etablierte Kanal zugänglich bleiben.

## 15. Profil, Berichte, Werte und Bibliothek

Profilbereiche: Kurzüberblick, Persönliches/Bedürfnisse, bestätigte Diagnosen, Medikation lesend, Werte, Pflege-/Therapieziele, Aufgaben, Verlauf, Dokumente/Bilder. Eine professionelle Biografie beruht auf vorgegebenen/zugelassenen Informationen, nicht auf Modellfantasie.

Unbekannt, nicht geliefert, nicht berechtigt, veraltet, widersprüchlich und ausdrücklich verneint unterscheiden. Fehlende Allergieliste bedeutet nicht Allergiefreiheit. Klinische Zusammenfassungen verlinken Autor, effektive Zeit, Erfassungszeit, Status und Quelle. Unsichere Werte bleiben sichtbar getrennt.

Vitalgrafik mit **echter Zeitachse**, konsistenter Einheit, Legende und zugänglicher Tabelle. Nicht gleiche Abstände für 07:00, 07:05 und 13:00 suggerieren. Keine erfundenen Zwischenwerte, Trendpfeile oder Normalitätsurteile. Ein einzelner Wert bleibt ein einzelner Wert. Zeitformat der Institution und DST prüfen.

Eine Bibliothek für Dokumente und Bilder, mit Ansichten je Patient, Thema, Typ und Zeitraum. Backend-ACL auf Bytes, Metadaten, Suchtreffer und Thumbnails. Upload → Scope/Dateityp/Grösse prüfen → gegebenenfalls Quarantäne/Scan → explizite Zuordnung → Review → Speicherung/Referenz. Keine öffentlichen Patientenbild-URLs. Unnötige EXIF-Ortsdaten aus Derivaten entfernen, Originale gemäss dokumentierter Policy behandeln. Kein Versprechen, Betriebssystem-Screenshots technisch vollständig verhindern zu können.

Institutionswissen hat Besitzer, Version, Audience, Freigabe, Gültigkeit, Ablauf und Widerruf. Interne News sind keine klinische SOP. Optionaler Loop/Staffbase-Connector bleibt ein autorisierter Leseadapter; fehlende Authentifizierung nicht mit Scraping umgehen. Websuche nur getrennt freigegeben ohne Patientendaten. Standardbetrieb benötigt keine Vektordatenbank.

## 16. Austauschbare LLMs ohne wachsenden deutschen Regelcompiler

Eine kontextreiche Interpretation plus passende Werkzeuge ist der Normalfall, keine Agentenflotte. Deterministische Logik sichert Referenzen, Berechtigungen, Versionen, Einheiten, explizite Aktion, zulässige Zustandswechsel und Ausführung. Versuche nicht, jede deutsche Formulierung als Regex zu implementieren.

Behalte den generischen Vorschlag mit typisierten ausführbaren Unterarten. Entferne willkürliche Voraussetzungen, dass erlaubte Nachrichten genau vorgegebenen deutschen Texten entsprechen. Originalaussage als Provenance erhalten; optionale Umformulierung sichtbar. Gültiges JSON beweist keine Wahrheit.

Kontextbuilder liefert berechtigte relevante Tools, aktuelle Aufgabe, Episode, Sitzung, jüngste passende User-/Assistententurns und den konkret ausstehenden Vorschlag. Quellen können frühere Nachrichten und Provider-Versionen sein. Ein späteres „statt 200 nur 150 ml“ darf keine fingierte aktuelle Quellspanne brauchen. Der letzte ausdrückliche Änderungswunsch erzeugt eine neue Revision, ersetzt aber keine anderen Quellen/Fakten heimlich.

Zustand und Inhalt eines Vorschlags sind serverseitig dauerhaft, thread-/patient-/encountergebunden und gegen parallele Bearbeitung geschützt. UI zeigt die neue Fassung; alte Freigabetokens werden ungültig. Beim Wiederöffnen keine aktive Schreibberechtigung aus der Chat-Historie rekonstruieren ohne erneute Prüfung.

Keine fixe globale Patientenauswahl, kein ungefiltertes Roh-FHIR für das Modell, kein direkter SQL-/Shell-/beliebiger HTTP-/FHIR-Schreibzugriff. Die Backendtools verwenden Medplum und Adapter. Ein Modellwechsel ändert nicht Rollen oder erlaubte Effekte.

Strikte Modell-Transport-DTOs getrennt von Domänenvalidierung: unterstützte Schemaformen, Pflichtfelder/nullable Werte, zusätzliche Eigenschaften verboten, Verweigerungen, unvollständige Ausgabe, Output-Budgets und Limits prüfen [S07]. Eine bestandene HTTP-Healthprobe ist keine Modellabnahme. Keine stille Kürzung bei 1.200 Zeichen. Gemeinsame Limits für Editor, ASR, Kontext und Vorschlag sichtbar behandeln.

Nutzung eines bereits verfügbaren SDKs ist einem neuen eigenen Agentenframework vorzuziehen. Halte Provider-/Modell-IDs konfigurierbar; am Umsetzungstag offizielle Modelle und tatsächliche Accountfähigkeit prüfen, nicht historische Namen blind übernehmen. Eine stärkere KI darf besser verstehen und formulieren, aber keine zusätzliche Schreibmacht bekommen.

## 17. Verbundene Modell-, ASR- und TTS-Demo

Implementiere einen echten Setup-/Testpfad für: Modell, Mikrofontranskription und Vorlesen. Keine Schlüssel im Browser, Repository, Screenshot oder Chat. Hosted-Modus nur ausdrücklich synthetisch freigegeben; Produktion lokal ohne heimlichen Cloud-Fallback. `store:false` und Buffer-Löschung ersetzen nicht die Datenschutzprüfung des externen Dienstes.

Zustände: nicht konfiguriert, konfiguriert, Test bereit, Smoke-Test bestanden, Szenarioabnahme bestanden, produktiv freigegeben. Auf Token-/Refusal-/429-/Timeout-/Schemafehler nicht „AI erfolgreich“ mit einem unerwähnten Ersatzparser melden.

Mit vorhandenen Schlüsseln oder autorisiertem lokalen Runtime: tatsächliche Aufnahme → ASR → editierter Text → mehrstufiger Dialog → Vorschlag → Review → Speicherung testen [S08]. Keine erfundenen Transkriptstrings als einzigen Audiotest. Bei fehlendem Key internen Integrationscode fertigstellen, exakten Testbefehl bereitstellen und die externe Abnahme offen lassen.

Öffentliche Demo mit bezahltem Modell nur hinter geeignetem Testzugang, Raten-/Parallelitäts-/Upload-/Budgetlimits. Keine beliebigen fremden API-Ziele oder vom Client gesetzte „synthetic“-Flags akzeptieren. Minimales Audit ohne Inhaltsleak.

## 18. Verlässliche Freigabe: lokale Atomizität, externe Zustellbelege

Nicht „eine vollständig atomare Transaktion über alle Provider“ versprechen. Implementiere **eine lokale PostgreSQL-Transaktion** für:

- endgültige aktuelle Autorisierung und Verbrauch der gebundenen Freigabe;
- unveränderliche Vorschlagsrevision, Inhalts-/Audience-Hash, ausgewählte Aktionen;
- angenommener Auftrag und Idempotency-/Receipt-Datensatz;
- unmittelbar passende operative Zustandsänderungen;
- Audit-/Domain-Event sowie FHIR-/Provider-Zustelljobs.

Keine Modell-/Provider-/Netzwerkaufrufe innerhalb langer DB-Transaktionen. Netzwerkverarbeitung danach durch Worker. Bei Lost Response wiederholte genehmigte Anfrage mit demselben Payload erhält denselben Receipt. Ein anderer Payload unter gleicher ID wird abgewiesen. Nicht auf „Token verbraucht“ stoppen, wenn der Nutzer lediglich die verlorene Antwort erneut abfragt.

Freigabe bindet Actor/Rolle/Zweck, Institution/Abteilung, Thread, Patient/Encounter, Kontextrevision, Workflow-/Policyversion, Vorschlagsversion, Quellen-Readset, gewählten Empfängerkreis und absolute Zeitparameter. Klinische Priorität und Frist bei der Ausführung nicht aus einem verspäteten `Date.now()` neu erzeugen. Explizit konfigurierte relative Fristen haben einen sichtbaren Bezugszeitpunkt.

Ein getrennter Qualitätsstatus darf ein extremes berichtetes Datum nicht löschen. Der ausführbare Review schützt Authentizität und Arbeitswahrheit, ist aber keine Behauptung der medizinischen Richtigkeit. Vorhandene autorisierte Provideränderungen können automatisch als Quellprojektion eingelesen werden; sie brauchen nicht erneut eine manuelle Pflegehelfer-Bestätigung für jeden Sync.

Jedes relevante Item zeigt klar: Entwurf → freigegeben/lokal angenommen → Medplum übernommen → extern bestätigt bzw. ausstehend/abgelehnt/Konflikt. Staff-Labels kompakt, technische Details optional. Kein globales grünes „alles synchron“, wenn einzelne passende Änderungen warten.

## 19. Datenmigration, Medplum und Providerabschluss

Löse das ganze Anwendungscheckpoint-`Binary` als normale Betriebsquelle ab. Erhalte das bestehende FHIR-/ClinicalDataPort-Fundament. Baue ressourcenspezifische Reads/Projektionen und versionierte operative Zustände; keine zweite universelle Zustandsmaschine.

Migrationen sind neue nummerierte Dateien mit Prüfsumme und Schema-Version. Bereits ausgeführte Migrationen nicht weiter verändern. Übernimm historische Fixture-Versionen aus dem Repository in Tests. Insbesondere: fehlende Encounter bei Intake/Visite, Thread-Scope und `QuestionnaireResponse`→`DocumentReference` mit Quellidentität, Migrations-Provenance und sicheren Konfliktzuständen behandeln. Kein `now()`-Encounter oder first-patient default zur stillen Reparatur. Unklar zuordenbare Altdaten quarantänisieren/reviewen.

Medplum-Projektionen verwenden geeignete FHIR-Ressourcen und festgelegte Schweizer Profile. Eine generische Notiz ist nicht automatisch ein QuestionnaireResponse. Keine gesamte Patientenakte in einer generischen JSON/Binary-Ressource. Prüfe die konfigurierte Medplum-Transaktionsfunktion durch absichtlich fehlschlagende Bundles [S09]. Das beweist nur die Medplum-Transaktion, nicht globale Atomizität.

Provideradapter bleiben operationsweise aktiviert. Quellen-/Zieldomänen, Mappingversion, Initialimport, Cursor, Nachrichtenversion, Konfliktstrategie, Tombstones/Korrekturen wo unterstützt, Freigabe und Zustellbelege dokumentieren. Kein unkontrolliertes Last-write-wins bei klinischen Konflikten.

Relationale Inbox/Outbox, kurze Leases, `FOR UPDATE SKIP LOCKED` wo passend, Backoff, poison/manual state und Recovery. Remote Side Effects sind nicht magisch exactly-once: mit Provider-Idempotenz bzw. geeigneten eindeutigen Referenzen/Read-back sichern. Bei unklarer externer Wirkung nicht blind erneut nicht-idempotent senden.

Zustandsbehafteter externer Fake-Provider muss Wiederanlauf, aktuelle Versionen und echte Konfliktvergleiche können, nicht nur einen Status-Schalter. Nachweis ab leerem Medplum: Initialdaten kommen **vom** Provider; Pflegehelfer liest sie; Mensch schreibt; Provider übernimmt; Read-back bestätigt; spätere externe Änderung erscheint über Inbound wieder im richtigen Profil. Kein direkter Seed des Pflegehelferzustands als Ersatz dieses Tests.

WiCare/careCoach/SAP/Geräte nur anhand echter Verträge aktivieren. Produktwebseiten sind keine vollständigen API-Spezifikationen. Ohne WSDL/API-Doku, Mapping, Auth, Sandbox und Abnahme bleibt die einzelne reale Operation gesperrt. Fertige generische Worker und Fake-Provider sind intern lieferbar. Bestehende Systeme nicht per Screen-Scraping oder direkten DB-Schreibzugriff umgehen.

## 20. Identität, Isolation und Konfigurierbarkeit vollständig anschliessen

Implementiere generische OIDC-Anmeldung mit realem Test-IdP im isolierten Integrationsprofil. Institutionelle Endpoint-/Claim-/Zertifikatseinstellungen sind Deployment-Inputs; der OIDC-Code selbst ist interne Arbeit. Nutze bewährte Bibliotheken, sichere BFF-Sitzungen, HttpOnly-/SameSite-Cookies, passende CSRF-/State-/Nonce-/PKCE-Kontrollen, Rotation, Logout und Session-Widerruf. Produktion akzeptiert keine Demo-Header. Den Test-IdP nicht mit offenen Demopasswörtern im öffentlichen Tunnel anbieten.

Mandant/Standort/Abteilung/Audience in Repositoryabfragen, zusammengesetzten Referenzen und Constraints sowie RLS als zweite Schutzebene. RLS nicht mit Superuser-/BYPASSRLS-Verbindungen „testen“. Connection-Pooling darf keinen Tenantkontext vererben. Kein Zugriff auf fremde Nachrichten, FHIR-Projektionen, Fotos, Zähler, Suche, Tags, Benachrichtigungen oder exportierte Dateien.

Medplum AccessPolicies ergänzen die fachliche Gateway-Prüfung [S10]. Operativer Admin ist nicht automatisch klinischer Superuser. Expertenlinks nur bei entsprechender separater Berechtigung; kein eingebetteter FHIR-Editor, der normale Reviews aushebelt.

Site-Pack erweitern statt neues Konkurrenzformat: Institution → mehrere Standorte/Abteilungen → Rollen/Kompetenzen → Schichten/Workflow → Providerinstanzen → Topics/UI. Runtime-Zuteilungen gehören in DB/Planungsprovider; keine Produktivpatienten in Git. Ein Pack referenziert bekannte implementierte Aktionen und zentral genehmigte Rechte; neue berufliche Befugnisse brauchen verantwortete Freigabe, nicht beliebigen YAML-Text.

Adminfläche: Standort/Abteilung, Verzeichnis-/Rollenmapping, veröffentlichte Workflowversionen, Provideroperationen/Quellenrouting, Topicverwaltung, Bibliotheksfreigaben, Modelsetup, Betriebsstatus, aggregierte Auswertung. Einfacher Workfloweditor mit Vorschau genügt. Draft → validieren → simulieren → verantwortet freigeben → unveränderlich publizieren → aktivieren. Laufende Dienste bleiben gepinnt, Rollback ist nachvollziehbar.

## 21. Leistungsnachweise: berechtigte Erlöse sichern, niemals Arbeit erfinden

„Abrechnungspotenzial maximieren“ wird ausschliesslich als **vollständige, korrekte und zulässige Abbildung wirklich erbrachter Leistungen** umgesetzt. Keine Hochstufung, fiktiven Minuten, suggestiven Schweregradformulierungen oder automatischen Gebühren aus Diagnosen/Hashtags.

Speichere aus derselben genehmigten Arbeit einen referenzierten Leistungsnachweis: Patient/Encounter/Setting, tatsächliche Aktivität, durchführende Person(en) und Rolle, effektiver Zeitpunkt, Erfassungs-/Freigabezeit, Zeitsegmente/Unterbrechungen soweit erfasst, Status durchgeführt/teilweise/nicht durchgeführt, Menge/Einheit/Material falls relevant, Auftrag/Pflegeplanreferenz, Freigabe, Nachtrag/Korrekturgrund, Quell-/Providerbelege.

Geplante Zeit ≠ tatsächlich erfasste Zeit. Zeit in einem Zimmer ≠ Pflegeleistung. Zwei Mitarbeitende können an einer Aktivität beteiligt sein; Attribution getrennt halten, nicht automatisch doppelte Patientenminuten berechnen. Mehrere Tags, ein Bericht und eine Taskreferenz dürfen nicht mehrfach verrechnet werden. Rückdatierungen als Nachtrag kenntlich machen. Pausen/Unterbrechungen und nicht geleistete Arbeit nicht als durchgeführte Leistung buchen.

**Setting ist entscheidend:** Pflegeheim, Spitex, stationäre Rehabilitation und ärztliche/therapeutische Leistungen haben unterschiedliche Regeln. Das BAG beschreibt Pflegeleistungen und Voraussetzungen, nicht eine universelle „Timer × Tarif“-Abrechnung [S11]. Bestehende Bedarfsermittlung, Zulassung, erforderlicher Auftrag und geltende Regeln bleiben beim verantwortlichen Prozess.

Implementiere eine übersichtliche Reviewansicht: belegt; Pflichtangabe fehlt; möglicher Doppelbeleg; Auftrag/Zuordnung zu prüfen; für freigegebenen Abrechnungsweg vorbereitet; übertragen/bestätigt. Zeige niemals „abrechenbar“, wenn nur eine Zeit gemessen wurde. Tariffunktionen sind separat versionierte, verifizierte Adapter/Regeln mit Gültigkeitsdatum und Setting. Solange kein echter Tarifvertrag vorliegt, nur ein deutlich fiktives Demotarifprofil bzw. Dokumentationsvollständigkeit zeigen; keine reale CHF-Umsatzprognose vortäuschen.

Menschliche Prüfung der geleisteten Arbeit vor regulärem Dokumentations-/Leistungs-Write-back; Rechnungsfreigabe, wo nötig, durch Abrechnung. Es dürfen nicht bei jedem Export alle bereits signierten Leistungen neu geschrieben werden. Korrekturen, Ablehnungen und gegebenenfalls Storno laufen referenziert und nachvollziehbar.

## 22. Auswertungen und Verbesserungen für Kader

Nutze bestehende PostgreSQL-Domain-Events und wenige definierte Views, keine neue Analytics-Plattform ohne Skalierungsgrund. Ereignisse entstehen nach Commit; bestätigte Aktionen, Fehler, Modellvorschläge und tatsächliche Providerzustellung nicht vermischen. Event-/Patient-/Auftragsreferenzen deduplizieren.

Definiere ein Datenwörterbuch mit Nenner und Messfenster. Zunächst: Zeit bis Dokumentation/Freigabe, wiederholte Erfassung, Bearbeitungsschritte pro abgeschlossener Aktivität, offene Übergabepunkte, Antwort-/Übernahmezeiten, Queuealter, Konfliktrate, Entwurfsänderung/Akzeptanz, Modell-/ASR-Latenz und Kosten. Task abgeschlossen ist kein unabhängiger Qualitätsbeweis. Modellgrader nicht allein über fachliche Korrektheit entscheiden lassen.

Baseline vor Einführung und gleichartig erhobene Pilotwerte dokumentieren; Fallmix, Schichten, Auslastung und Messmethode berücksichtigen. Zeitgewinn, nutzbare Kapazität, vermiedene Überstunden und tatsächlicher Geldnutzen getrennt. Keine Kausalität oder garantierte Einsparung aus einem kurzen Vorher/Nachher-Vergleich behaupten.

Heimleitung/CEO erhält betriebliche Übersicht, CFO prüfbare finanzielle Sicht, Qualitätsrolle fachlich notwendige Fälle und HR Personal-/Schulungsprozesse ohne Patientenakten. Gruppenminimum und zulässige Filter gegen Rückidentifikation; Aggregate mit kleinen Fallzahlen begrenzen. Kein Ranking langsamer Mitarbeitender, keine versteckte Aktivitätserfassung, Sprach-/Emotions-/Persönlichkeitsbewertung [S12]. Kultur/Teamwork nur durch geeignete transparente freiwillige Rückmeldungen und moderierte Prozesse, nicht heimlich aus Chats schätzen.

Verbesserungszyklus tatsächlich implementieren: beobachtetes Problem + Belege → Änderungshypothese → Vorschau eines Workflow-/Text-/Routingdiffs → synthetische Tests → zuständige menschliche Freigabe → begrenzter Pilot → definierte Messung → Beibehalten/Rollback. Der Agent veröffentlicht nicht selbst und ändert niemals Berechtigungen, klinische Fakten oder Belege zur Verschönerung der Kennzahlen.

## 23. Betrieb, Aufbewahrung und Smartphone

Repräsentative Profile: lokale synthetische Entwicklung, zugangsbeschränkte verbundene Demo, institutioneller Read-only-Pilot, kontrollierter Write-Pilot. Kein gemeinsamer unsicherer „Demo“-Schalter für Echtdaten. Datenklasse serverseitig, saubere Trennung der Datenbanken, Schlüssel, Endpoints und Modellrechte.

Production-on-prem kann Internetfreiheit haben; externe Provider-/Intranetverbindungen erfolgen nur freigegeben über DMZ/Connector. Teste tatsächlich blockierten Egress. Modelle, Bibliotheken, Icons und Schriften kommen aus freigegebenen lokalen Assets; keine unbemerkten CDNs. Lizenz- und Herkunftsnachweise, lockfiles, SBOM, Signaturen, Scans, Upgradeplan.

Getrennte Retention für klinische Records, Audit, Chat, Entwürfe, Audio, Medien und Analytics. Sweeper mit Legal-Hold-/Archivregeln; Chatlöschen löscht keine bereits genehmigte Patientenakte. Logs/Metriken keine Freitexte/Patientennamen/Labels; Datenminimierung auch bei Fehlermeldungen.

Echte Backups und Wiederherstellung der operativen DB, Medplum, Dokumentinhalte und benötigten Schlüssel in isolierter Umgebung. Danach prüfe Patientenreferenzen, freigegebene Berichte, Übergaben, akzeptierte Aufträge, offene Jobs und Belege. Prüfsumme einer JSON-Datei ist nur Smoke-Test. Restore darf ausgelieferte Aktionen nicht erneut senden; Recovery-/Reconciliation-Szenario notwendig. RPO/RTO messen statt behaupten. Destruktiver Schema-Rollback ist nicht immer sicher; getesteten Restore/Forward-Fix vorsehen.

PWA auf freigegebenen Geräten; BYOD nur mit lokaler Policy. Minimaler Offlineumfang, klar veraltete Daten, keine breite Akte im Browser. Offline-Entwürfe nur nach konfigurierte Schutz-/Retentionsregeln; ohne sichere Offline-Freigabe nur Entwürfe, keine falsche Synchronisation. Keine pauschalen Remote-Wipe-/Attestation-Versprechen für reine PWA. Native Hülle nur bei tatsächlich geforderter Gerätesicherheit/Funktion.

`pfhctl` muss echte Ergebnisse liefern: preflight, site validate/activate, identity test, provider capabilities/test, model test, asr test, tts test, migrations status, status, backup/restore-test und demo scenario/reset. Vorhandene Befehle erweitern, keine dekorativen Platzhalter.

## 24. Ausführungsreihenfolge und messbare Abschluss-Gates

Sicherheitsinvarianten gelten in jedem Abschnitt. Implementiere nicht zuerst sämtliche Oberflächen über unzuverlässigen Schreibwegen.

| Gate                            | Vollständig zu liefern                                                                                  | Beleg                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| G0 — gemeinsamer Iststand       | Quellenprüfung, konsolidierter Vertrag, lauffähige Baseline, offene Matrix                              | aktueller SHA, genaue Befehle, echte Skips                               |
| G1 — zuverlässiger Kern         | lokale Annahme, Migrationen, Receipt-/Outbox-/Inbox-Worker, ressourcenbasierte Rekonstruktion           | Real-DB-/Medplum-Crash-, Parallelitäts- und Migrationstests              |
| G2 — kompletter Arbeitstag      | realistische Fixtures, Rollen, genaue Übergabe, Vorlesen, Plan, Episode, Unterbrechung, Review, Empfang | Browser + Datenzustand, zwei aufeinanderfolgende Dienste                 |
| G3 — Kommunikation/Organisation | private/gemeinsame Threads, @, #, echte Filter, Benachrichtigungen, Bibliothek/Bilder                   | Drei-Nutzer-/Zwei-Site-ACL- und Replaytests                              |
| G4 — natürliche verbundene KI   | kompatibler Modelladapter, dauerhafte Korrekturen, ASR/TTS, begrenzte GenUI                             | echte synthetische Modell-/Audiocalls oder ausdrücklich extern blockiert |
| G5 — Standort/Betrieb           | Test-IdP/OIDC, Isolation/RLS, Admin/Workflows, zweite Institution, Retention, Restore, Egress           | same binary, zwei Sites, zwei Replikas/Worker, Restore-Abnahme           |
| G6 — Nutzen/Leistungsnachweise  | geprüfte Evidenz, richtige Zustellreferenzen, Baseline/Analytics, freigegebener Verbesserungszyklus     | prüfbarer Demoprozess ohne Doppelleistung/Umsatzfantasie                 |
| G7 — UI-/Gesamtabnahme          | finale konsistente Glass/Light/Dark-Oberfläche, belastbare Performance, Clean-Checkout, CI              | Screenshots/Traces, Checkliste, CI am finalen Implementierungs-SHA       |

Gates dürfen technisch sinnvoll überlappen, aber nicht durch neue Featurebezeichnungen als abgeschlossen erscheinen. UI-Abnahme begleitet jede Produktänderung; G7 ist keine erste visuelle Prüfung am Projektende.

## 25. Pflicht-Regressionen

Führe die bisherigen relevanten Tests weiter und ergänze mindestens diese Verhaltensbelege. Nicht überlappende Suites addieren, um eine grössere Gesamtzahl zu behaupten.

### Arbeitstag und Datenwahrheit

- Allgemein → Anna → Luca → allgemein: separater Verlauf, Entwurf und gleiche Dienstkontinuität; „Mein Assistent“ löst keinen Patientenprompt aus.
- Gleicher Patient mit neuem Encounter: alte Entwürfe bleiben im alten Aufenthalt, nicht still übertragen.
- Zwei Browserfenster bearbeiten unterschiedliche Patienten/Vorschläge: klare Konflikt-/Scopebehandlung, kein falsches Ziel.
- Nach Kontextwechsel treffen ASR/Modellantworten ein: ursprünglicher Scope, kein Schreiben auf neuen Patienten.
- „Nur Morgenpflege erledigt; Mobilisation später“: Teilabschluss, richtige offene Aufgabe.
- „Arzt nicht informieren, keine weitere Kontrolle“: keine positive Kommunikation/Folgeaufgabe.
- „Gestern 200 ml, heute ungefähr 150 ml“: Zeit und Unsicherheit getrennt; kein doppelt finaler aktueller Messwert.
- „Nicht 200, sondern 150 ml; Nora statt Arzt“: richtige neue Vorschlagsrevision und Empfängerprüfung.
- Originaltext zu Medikamenten, ausdrücklich berichtete bereits ausgeführte Tätigkeit: als erlaubter Bericht behandelbar; kein fiktiver Auftrag/keine Dosisänderung.
- Gemischte Notiz mit ausstehendem extremem Wert: sichtbar berichteter Wert, nicht in validierte Arbeitsevidenz eingeschleust; neuer unbestätigter Wert nicht vom alten normalen versteckt.
- Klick auf „Ausgeführt“/„Gespeichert“ nach Refresh: klare lokale und externe Einzelzustände, keine Verdopplung.

### Übergabe, Plan und Sprache

- Sechs Patienten, aber auch null/zwei/zwölf korrekt; keine erfundenen Übergaben.
- Exakte klinische Übergabeversion, nachträgliches Addendum und Kenntnisnahme auf empfangender Seite.
- „Kein neuer Eintrag“ nicht als „keine Symptome“ ausgeben.
- Vorlesen korrekt, Pause/Rückfrage/Fortsetzung; Playback kann keine Freigabe auslösen.
- Plan mit unmöglicher Doppelbesetzung/Termin: Konflikt statt erfundener Kapazität; Patientenvorlieben bleiben erhalten.
- Klingelunterbrechung und Rückkehr ohne verlorene Evidenz/überlappende falsche Zeitbuchung.
- Schichtabschluss mit rechtmässiger begründeter Übertragung, ohne falsches Komplettieren und ohne erneuten Export bestehender Dokumentation.

### #, @ und Bibliothek

- Thema vorgeschlagen/übernommen/entfernt; dynamischer Filter zeigt wirklich verknüpfte Beiträge.
- Verneinte/historische Sturz-/Schmerz-/Suizidbezüge erzeugen keine neue aktive Risikozuschreibung.
- Existierender bestätigter Hinweis ist nur im passenden fachlich berechtigten Review änderbar.
- Mehrdeutiger @Name, off-duty-Empfänger und Duty Queue; kein stiller erster Treffer.
- Privater Entwurf bleibt privat; bewusste Publikation zeigt Audience; Zuschauer ohne Recht sieht weder Inhalt noch Existenz/Zähler.
- Berichtskommentar wird Addendum/Referenz, nicht stille Änderung des Originals.
- Bild/Thumbnail/Download nach Rollenentzug nicht neu abrufbar; Bibliothek entspricht nicht nur einem Promptshortcut.

### Verarbeitung und Betrieb

- Zweifache Freigabe mit gleichem Command/Payload, verlorene Antwort, API-Crash: gleicher Beleg und keine doppelte wirksame Aktion.
- Token geprüft, Prozess stirbt vor/nach Commit: vollständig wiederaufnehmbar; keine halb akzeptierte Arbeit.
- Zwei relationale Worker, abgelaufene Lease, verzögerte externe Bestätigung, Konflikt, Poison Record.
- Leeres Medplum → Provider-Import → App → Write → Read-back → externe Änderung → Inbound.
- Echte Medplum-Fail-Transaction, nicht nur gemockte Antworten.
- Historische Datenmigration aus voriger Release-Fixture, Encounter-Unsicherheit und Legacy-Notizmigration mit Provenance.
- Zwei Appinstanzen/Standorte/Abteilungen, OIDC statt Demoheader, echte RLS mit App-DB-Rolle.
- SSE-Replay nach Restart und nach Audienceentzug; wiederholtes Event erzeugt keinen zweiten Hinweis/Auftrag.
- Echte DB-/Dokument-Restoration und Resume offener Jobs ohne doppeltes Remote-Schreiben.
- Geblockter Internetzugriff: lokale Kernfunktionen weiter nutzbar; externe Funktionen korrekt nicht verfügbar.

### KI, Evidenz und Gestaltung

- Tatsächliches strikt emittiertes Schema, Refusal/incomplete/429/Timeout, langer Text ohne stille Kürzung.
- Mindestens zwei Modelladapter gegen gleiche Held-out-Szenarien; Fixturebeleg und echter Modellbeleg getrennt.
- Echte Mikrofonaufnahme, editierter Text und echtes TTS; keine gefälschte Audiobestätigung.
- Eine Tätigkeit mit zwei Tags/mehreren Dokumentreferenzen bleibt ein Leistungsevent.
- Gruppenleistung/zwei Mitarbeitende, Unterbrechung, Nachtrag, Storno und unvollständiger Beleg ohne Erlösaufblähung.
- Baselinevergleich und menschlich freigegebene Workflowänderung mit Rollback; keine automatische Berechtigungserweiterung.
- UI unter 360/390 px, Tablet hoch/quer, 1024/1440 px, 200 % Zoom, Light/Dark/System, reduzierter Bewegung/Transparenz und virtueller Tastatur.
- Zeitachsen mit stark unregelmässigen Abständen, keine visuell erfundene zeitliche Gleichmässigkeit.

## 26. Visuelle Abnahme als Teil der Implementierung

Nutze Playwright oder das bereits verfügbare Browserwerkzeug, echte Screenshots, Tastaturbedienung, DOM-/Accessibility-Tests und beobachtete Netzwerk-/DB-Zustände. Prüfe mindestens: Login, Drawer, Übergabeübersicht/-detail, Vorlesen, Plan, aktiver/pausierter Patient, Mehrfachreview, Korrektur, Teamantwort/@, #Filter, Werte, Bibliothek/Bild, Adminpublikation, Syncfehler und Schichtabschluss.

Prüfraster: keine horizontalen Überläufe; klarer Primärknopf; korrektes Icon; keine falsche Patientenkontextanzeige; lesbare klinische Inhalte ohne Glass-Störung; Kontrast/Fokus; keine doppelten Cards; keine leeren Versprechen; gleiche Komponenten in beiden Themes. Desktop-Politur ersetzt keine tatsächliche Mobilprüfung.

Modell-/ASR-Latenz darf nicht andere Mitarbeitende blockieren. Messe mittlere/hohe Latenz, schnelle erste Rückmeldung, Kosten pro korrekt abgeschlossener Aktivität, Queuealter und mobile Renderingkosten. Zielwerte mit Testhardware und erwarteter Parallelität festlegen, nicht ohne Messung mit „instant“ werben. Ersetze auffällige Effekte durch eine sparsamere Ausführung, wenn Bedienung oder Akku darunter leiden.

## 27. Letzte Abnahme und wahrheitsgemässer Abschluss

Führe aus einem sauberen Checkout die dokumentierte Installation aus; keine versteckte Abhängigkeit von der Entwicklerdatenbank. Reale Testdienste starten, Migrationen einmal und erneut ausführen, synthetische Daten importieren, gesamten Referenzdienst durchspielen, Neustart/Restore/Rollback testen. CI auf Branch/PR auslösen und Ergebnis am tatsächlich getesteten Implementierungs-SHA festhalten. Ein nachträglicher reiner Dokumentationscommit wird ausdrücklich als solcher benannt.

Für jedes Ergebnis: Test-ID, Befehl, Commit, Runtime/Versionen, Fixture oder echter Dienst, Datum, Ergebnis, übersprungene Voraussetzungen. „80 gezielte Tests“ sind nicht zusätzlich 80 neue Tests, wenn sie Teil der 298er Suite sind. Keine Selbstaussage „kein P1“ als Produktgesamtfreigabe behandeln, wenn die offene Matrix widerspricht.

Vier getrennte Ausgänge:

1. **Synthetischer Produktabschluss:** alle internen Module und End-to-End-Demo mit echten eigenen Datenspeichern und klar simulierten Providern bestehen.
2. **Verbundene KI-/Sprachdemo:** tatsächlicher konfigurierter Modell-, ASR- und TTS-Pfad erfolgreich; ohne Zugang bleibt diese Abnahme offen.
3. **Institutioneller Read-only-Pilot:** generische Identität/Isolation intern fertig; reale Provider-Lesefreigabe, Daten-/Geräte-/Betriebsfreigaben nachgewiesen.
4. **Kontrollierter Write-Pilot:** reale Operationen/Mapping, menschlicher Review, Zustellung/Read-back, Konflikt-/Ausfallprozess und institutionelle Abnahme nachgewiesen.

Fertigmeldung enthält implementierte und entfernte/vereinfachte Teile, unverändert offene Matrix, Modell-/Audiobelege, Provider-Roundtrip, Migration/Restore, visuelle Belege, Messmethodik und Kommandos zum Wiederholen. Private Verträge, Produktionsbewilligungen und fachliche Sprachvalidierung nicht durch Codekommentare oder Tests mit erfundenen Daten ersetzen.

### Letzte praktische Frage

Kann eine Mitarbeitende die Übergabe verstehen, ihre Arbeit planen, unterbrochen werden, natürlich berichten, genau einmal sinnvoll freigeben, Antworten im Team erhalten und eine korrekte Übergabe vorbereiten, ohne dieselben Daten mehrfach zu tippen oder die zuständige Software suchen zu müssen?

Kann die Leitung anschliessend nachvollziehen, welche reale Arbeit dokumentiert und zugestellt wurde und ob der Prozess besser geworden ist — ohne Mitarbeitende auszuspionieren oder Einnahmen aus erfundenen Leistungen abzuleiten?

Ist eine Antwort nein, schliesse die betreffende Arbeitskette; füge nicht nur einen neuen Button hinzu.

## 28. Quellenregister und Anwendung der Quellen

Die Quellen stützen die jeweils genannten Grundlagen, nicht eine automatische rechtliche Freigabe, Patientensicherheitszertifizierung oder Wirksamkeitsbehauptung. Prüfe am Umsetzungstag Aktualität/Version, protokolliere Zugriff und verwende tatsächliche Anbieter-Spezifikationen. Keine Änderungen aufgrund eines Such-Snippets allein.

### Repository-/Analysegrundlage

- R01: `docs/IMPLEMENTATION_STATUS.md` am SHA `573ff547e9f362acc79f4653240eae091921325d` — eigene Statusangaben und offene P1; nicht unabhängig ausgeführte Tests.
- R02: `docs/architecture-decisions/ADR-0012-scoped-patient-workspaces.md` — eine Sitzung, mehrere explizite Gesprächsscopes.
- R03: `src/pwa/App.tsx`, `src/pwa/assistant/clinical-library.tsx`, `src/ai/model-gateway.ts`, `src/infrastructure/operational-store.ts`, `src/core/fhir-resource-set.ts`, `src/server/app.ts`, aktive Migrationen und Tests — konkrete Implementierung vor Änderungen neu lesen.
- R04: vorherige beigefügte Anweisung `Pflegehelfer_Codex_Patient_Workspaces.md`, 11.09.2026 — durch diesen konsolidierten Abschlussauftrag fortgeführt; bereits umgesetzte Anforderungen nicht erneut bauen.

### Offizielle Grundlagen, am 12.09.2026 konsultiert

- S01 ChatGPT-UI-Weiterentwicklung und verifizierbare Releasehinweise: https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- S02 W3C WCAG: https://www.w3.org/TR/WCAG22/ und https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- S03 Schweizerisches Rotes Kreuz, Schutz der Embleme: https://www.redcross.ch/de/ueber-uns/internationale-rotkreuz-und-rothalbmond-bewegung/die-embleme-der-rotkreuz-und-rothalbmond-bewegung
- S04 BAG, Gesundheitsberufe/Verantwortung/Kompetenzgrenzen: https://www.bag.admin.ch/de/haeufige-fragen-faq-zum-gesundheitsberufegesetz-gesbg
- S05 AHRQ TeamSTEPPS, SBAR und verlinkte Handoff-/Closed-Loop-Werkzeuge: https://www.ahrq.gov/teamstepps-program/curriculum/communication/tools/sbar.html — Kommunikationsgrundlage, kein Schweizer Rollenrecht.
- S06 HL7 FHIR R4 Flag: https://hl7.org/fhir/R4/flag.html — Hinweise sind nicht gleich Nachrichten oder Diagnosen.
- S07 OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- S08 OpenAI Transkription: https://developers.openai.com/api/docs/guides/speech-to-text — konkretes Modell, Codec und Accountzugriff vor Echtaufruf prüfen.
- S09 Medplum Project Settings: https://www.medplum.com/docs/self-hosting/project-settings
- S10 Medplum Access Policies: https://www.medplum.com/docs/access/access-policies
- S11 BAG Pflegeleistungen: https://www.bag.admin.ch/de/krankenversicherung-pflegeleistungen — Voraussetzungen und settingspezifische Unterschiede, keine universelle automatische Tarifermittlung.
- S12 EDÖB Mitarbeiterüberwachung: https://www.edoeb.admin.ch/de/technische-mittel-zur-uberwachung-am-arbeitsplatz
- S13 EDÖB Patientendatenweitergabe: https://www.edoeb.admin.ch/de/bekanntgabe-von-patientendaten
- S14 Codex AGENTS.md: https://developers.openai.com/codex/guides/agents-md — kurze Repository-Einstiegspunkte und eindeutig referenzierte Detailaufträge.

Weitere verbindlich vor betroffener Implementierung zu verifizieren: aktuelle OpenUI-APIs, FHIR-/CH-Profile, OpenAI-/lokale Modell- und TTS-Datenschutz/Lizenzen, installierte WiCare-/careCoach-/SAP-Versionen, aktuelle Swissmedic-Abgrenzung, institutionell geltende Arbeits-/Pflege-/Abrechnungsregeln. Ein Versionsname oder Produktfeature in früheren Analysen gilt nicht als dauerhaft verifiziert.
