# Release notes: Mitgliedsbeiträge monatlich / jährlich

## Implementiert
- Beitragsarten mit monatlichem und jährlichem Zahlungsrhythmus.
- Mitgliederanlage und Bearbeitung mit dem korrekten Periodenbetrag.
- Monatsraten in der Beitragsübersicht und Finanzbuchung sowie in SEPA-Verwendungszwecken und Erinnerungen.
- SEPA-Export nur bis zum gewählten Einzugsdatum fälliger Beiträge.
- Digitaler Beitritt, digitale Antragsübernahme und druckbare Beitrittserklärung.
- CSV-Mitgliederimport/-export sowie Gesamtexport einschließlich Zahlungsrhythmus.
- Bestehende Jahresbeiträge behalten Beitragsmonat 0. Monatsraten tragen 1 bis 12.
- Bei Eintritt im Beitragsjahr entstehen nur Beiträge ab dem Eintrittsmonat.
- Bereits bezahlte oder zum Einzug vorbereitete Raten bleiben geschützt.

## Überprüft
- Alle betroffenen Browser-JavaScript-Dateien bestehen die Syntaxprüfung.
- Datenbanktests in Transaktionen, vollständig zurückgerollt: Monatsratenanlage, Beitragshöhe bei Bearbeitung, Erstjahrsmonat, Jahresbeitrag, Sperre nach Bezahlung.
- Die Supabase Edge Function `membership-join-public` wurde auf Version 10 aktualisiert.

## Rollout
- Auf der produktiven Datenbank sind die neuen Schemafelder und Trigger bereits vorhanden.
- Die alte Jahres-Unique-Constraint `contributions_member_id_contribution_year_key` wurde in Supabase entfernt; stattdessen gilt `contributions_member_year_month_key`.
- Browserdateien müssen auf dem STRATO-Webspace veröffentlicht werden, wenn kein automatischer Deploy aktiv ist.
- Ein authentifizierter CSV-Importtest war ohne bestehende Vereinsanmeldung nicht möglich (`ACCESS_BLOCKED`); die SQL- und Frontendänderungen sind dennoch implementiert.
- Nach der Veröffentlichung die drei Endnutzerwege testen: Monatsbeitragsart -> Mitglied anlegen -> Beiträge; Beitrittslink; SEPA-Auszug.
