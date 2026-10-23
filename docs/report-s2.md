# Twin Test – Bericht S2 (Zonen, Detail beim Annähern)

Stand: 23.10.2026 · Branch `proto/twin-v01` · nicht auf `main` gemergt, kein Deploy.
Repo öffentlich: nur Code und Tests mit erfundenen Daten. Konfiguration, Paket, Bilder und Messwerte liegen privat.

## Was steht

| Bereich | Umsetzung | Dateien |
|---|---|---|
| Schema | `detail` je Variante (dichtere Fassung, wird beim ersten Hineinzoomen geladen), `short` je Zone (Kurzname für den Zonen-Knopf, ≤ 14 Zeichen), `base` je Zone (±0 der Zone in Web-Metern; Ebenen und Orte beziehen sich darauf – nötig am Hang). | `src/model/types.ts`, `src/model/validate.ts` |
| Import: Zonen | Bestand wird nach Dreiecksmittelpunkt auf Zonen verteilt (Polygon-Zonen, eine Rest-Zone). Jede Zone wird **relativ zu ihrer Mitte** geschrieben, Reduktion mit gesperrten Rändern, damit benachbarte Stücke dicht bleiben. | `scripts/import/zones.mjs`, `scripts/import/run.mjs` |
| Import: Detail | Aus einem dichteren Quellmodell nur Flächen im Grundriss (Filter schon beim Lesen, spart Speicher), eigene Zieldreieckszahl und größere Textur. Budget je Detail. | `scripts/import/obj.mjs`, `scripts/import/run.mjs` |
| Import: Gelände | Absenkring jetzt einstellbar (`dilate`); ohne Ring liegen Löcher im Photogrammetrie-Modell flach auf dem Gelände statt als Gruben. | `scripts/import/run.mjs` |
| Viewer: Detail | Beim ersten Wechsel in Zone/Ort/Schritt wird die Detailfassung geladen und ohne Wachs-Animation getauscht; eine später eintreffende leichte Fassung überschreibt sie nicht. | `src/view/viewer.ts` |
| Viewer: Umriss | Je Zone eine Linie entlang des Grundrisses; mit Gelände alle 4 m auf dessen Höhe gelegt (Höhenraster aus den Gelände-Vertices). | `src/view/viewer.ts` |
| Viewer: Kamera | Zonen-Ziel auf dem ±0 der Zone; Zonen-Knopf mit Kurzname, Spaltenzahl folgt der Zonenzahl, lange Namen werden gekürzt. | `src/view/nav.ts`, `src/main.ts`, `src/style.css` |

## Behobene Fehler

- **Zonenmodelle saßen versetzt (S1):** Der Viewer setzt Zonenmodelle an die Zonenmitte, der Import schrieb sie absolut. Versatz im S1-Paket knapp 5 m. Jetzt schreibt der Import relativ zur Mitte.
- **Umriss blockierte den Browser 4,4 s:** erste Fassung legte den Umriss per Raycast auf 113 000 Gelände-Dreiecke. Ersetzt durch ein Höhenraster; längste Blockade danach 159 ms.

## Prüfschritte – was ausgeführt wurde (lokal, Windows, Node 26)

1. **Tests:** 8 Dateien, **103 Tests bestanden** (S1: 94). Neu: Filter beim OBJ-Lesen, Zonen-Aufteilung/Verdichten/Grundriss, Schema für `detail`/`short`/`base`, Kamera für große Zonen und Zonen-±0.
2. **Typprüfung** ohne Fehler; Platzhalter-Build grün; `check:public` mit privater Marker-Liste in Ordnung.
3. **Echter Import** (~13 s): erster Download **4,00 MB** (Grenze 5), Nachladen beim Zoom in die Zone **3,74 MB** (Grenze 5).
4. **Produktions-Build mit CSP, headless Edge 1440 × 900:** Laden → Zone → Ort → zurück zur Übersicht; Detailfassung wird beim Zoom geladen (3,8 MB), 0 Konsolenfehler, keine fremden Ursprünge (nur `blob:` derselben Seite für Texturen), längste Blockade 159 ms.
5. **Gegenprobe Absenkung** (6 m statt 2,5 m): sandfarbene Flecken im Grün bleiben → es sind Löcher im Photogrammetrie-Modell, kein durchstechendes Gelände. Daraufhin `dilate` 0.
6. **Platzhalter-Screenshots + Netzwerk:** 48 Requests, 0 fremd, 0 Konsolenfehler, 8/8 Bedienprüfungen OK. Bilder ändern sich leicht (Umriss liegt jetzt genau auf dem Grundriss statt 0,5 m außen; Zonen-Knöpfe mit Innenabstand).

## Nicht geprüft / bekannte Grenzen

- **Zonengrenze ist vorläufig** (vom Umsetzer gesetzt, im Paket als „vorläufig“ beschriftet) – die echte Grenze legt der Projektverantwortliche fest.
- **Ortsstufe (≈ 13 m Ausschnitt):** Drohnen-Photogrammetrie hält das nicht – weich und klumpig. Für diese Stufe braucht es eigene Aufnahmen (Splat/360°), wie in der Strategie vorgesehen.
- **Löcher im Photogrammetrie-Modell** zeigen das Gelände (sandfarben).
- **Naht** zwischen Detailfassung (dichteres Quellmodell) und Nachbarzone (leichtes Modell): Ränder stammen aus zwei verschiedenen Meshes; nicht vermessen.
- **Textur doppelt:** Jede Zone trägt eine eigene Kopie des Atlas (~1 MB je Zone). Bei mehr Zonen: gemeinsame Textur oder KTX2.
- Ladezeit 4G und Bildrate auf Geräten – S5.

## Nächster Schritt

Echte Zonengrenze eintragen, Import neu laufen lassen. Danach S3 („Neu“ aus der C4D-Szene), sobald die maßgebliche Szene benannt ist.
