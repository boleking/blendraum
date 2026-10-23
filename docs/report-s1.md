# Twin Test – Bericht S1 (Gelände und Bestand importieren)

Stand: 23.10.2026 · Branch `proto/twin-v01` · nicht auf `main` gemergt, kein Deploy.
Repo öffentlich: Hier liegen nur Code und Tests mit erfundenen Daten. Konfiguration, Paket,
Bilder und Messwerte des echten Laufs liegen im privaten Daten-Repo bzw. lokal unter `data/`.

## Was steht

| Bereich | Umsetzung | Dateien |
|---|---|---|
| Import-Lauf | `npm run import -- <import.json>` liest ein Photogrammetrie-OBJ (lokale cm-Koordinaten) und ein DGM-GeoTIFF, schreibt ein Paket nach `data/<paket>/`: `twin.json`, `models/terrain.glb`, `models/<zone>-bestand.glb`, `import-report.json`. Bricht ab, wenn `out` nicht unter `data/` liegt oder das Download-Budget überschritten ist. | `scripts/import/run.mjs` |
| Nullpunkt | Wird beim ersten Lauf aus der Mitte des Bestands bestimmt (E/N auf 10 m, H auf 1 m aus dem DGM), in die Konfiguration zurückgeschrieben und danach nie wieder automatisch geändert. | `scripts/import/run.mjs` |
| Gelände | Regelmäßiges Gitter aus dem DGM (Zelle und Rand aus der Konfiguration), bilinear, auf das Raster begrenzt. Gitterpunkte unter dem Bestand (plus ein Ring) werden abgesenkt, damit das Gelände nicht durch das Photogrammetrie-Mesh sticht. Glatte Normalen. | `scripts/import/terrain.mjs` |
| Bestand | OBJ-Leser (Position + UV, Nähte bleiben), Reduktion mit meshoptimizer auf eine Zieldreieckszahl, Textur mit sharp verkleinert (JPEG), Material ungeleuchtet (Licht steckt in der Fototextur). Optionaler senkrechter Versatz aus der Konfiguration. | `scripts/import/obj.mjs`, `scripts/import/glb.mjs` |
| GLB | Verschweißen, Reduzieren, Quantisieren, `EXT_meshopt_compression`. Bewusst ohne `normals()` aus gltf-transform – das löst den Index auf und verdreifachte die Dateien (Regressionstest vorhanden). | `scripts/import/glb.mjs` |
| Prüfungen im Lauf | Download-Budget; Höhenabgleich Bestand ↔ DGM in drei Streifen (West/Mitte/Ost) als häufigste Differenz aller Punkte – Dächer, Bäume, Becken verschieben den Modalwert kaum. | `scripts/import/run.mjs` |
| Viewer | Meshopt-Decoder (im Bundle, kein Fremd-Request). Sonne und Schattenbereich wachsen mit der Paketgröße; Platzhalter unverändert. Ohne Schattenboden, wenn ein Gelände da ist. Zonen-Ausschnitt folgt der Zonengröße. | `src/view/viewer.ts`, `src/view/nav.ts` |
| CSP | `script-src 'self' 'wasm-unsafe-eval'`: erlaubt nur das Übersetzen von WebAssembly (Meshopt-Decoder), kein JavaScript-`eval`. Ohne das blieb jedes komprimierte Modell im Build stecken. | `vite.config.ts` |

## Prüfschritte – was ausgeführt wurde (lokal, Windows, Node 26)

1. **Tests:** `npm test` → 8 Testdateien, **94 Tests bestanden** (S0: 82). Neu, alle mit erfundenen Daten: OBJ (Vielecke, UV-Richtung, negative Indizes, Fehler), Raster (bilinear, Klemmen), Ausschnitt, Gitter mit Normalen nach oben, Abdeckung + Ring + Absenken, glatte Normalen, komprimierte indizierte GLB, Reduktion auf Zielzahl, Modalwert/Quantil.
2. **Typprüfung** ohne Fehler; **Build** (Platzhalter) grün, `check:public` davor in Ordnung.
3. **Prüfskript mit privater Marker-Liste** über alle Dateien inkl. der neuen Import-Skripte: in Ordnung.
4. **Echter Import-Lauf** (Werte im privaten Bericht): erster Download **3,06 MB** (Grenze 5 MB; Gelände 0,51 MB, Bestand 2,38 MB, Code 0,17 MB). Bestand 400 000 → rund 154 000 Dreiecke, Textur 8192 → 2048 px. Laufzeit ~5 s.
5. **Höhenabgleich:** Ohne Korrektur lag der Boden des Bestands im Median 1,8 m unter dem DGM (das stimmt nicht mit der älteren Angabe „≈ 0 m“ in den Pipeline-Notizen überein). Eine seitliche Verschiebung verbessert die Lage kaum; deshalb ein **senkrechter Versatz als Arbeitswert in der privaten Konfiguration** (abschaltbar, Quelldateien unverändert). Danach häufigste Differenz in allen drei Streifen **innerhalb ±1,2 m** – Kriterium S1 (≤ 2 m) erfüllt.
6. **Browser:** Dev-Server und Produktions-Build (mit CSP) mit dem echten Paket – Gelände und Bestand geladen, 0 fremde Requests, 0 Konsolenfehler; Resort- und Zonenstufe gerendert (Bilder privat).
7. **Platzhalter-Screenshots + Netzwerk:** `npm run shots` (lokaler Edge) – 48 Requests, 0 fremd, **0 Konsolenfehler** (vor dem CSP-Fix: 2 Fehler durch den blockierten WebAssembly-Decoder – so wurde der Fehler gefunden), 8/8 Bedienprüfungen OK.

## Nicht geprüft / bekannte Grenzen

- **Ladezeit auf 4G und Bildrate** auf echten Geräten – S5.
- **Seitliche Lage** des Bestands gegen das DGM ist nur indirekt geprüft (Höhenstatistik); Passpunkte fehlen. Die Streuung der Bodenhöhen (MAD ~1,2 m) bleibt – Photogrammetrie mit GPS-Genauigkeit.
- **Absenkring:** Wo das Gelände unter dem Bestand abgesenkt ist, kann am ausgefransten Rand des Photogrammetrie-Meshes eine bis 2,5 m tiefe Mulde sichtbar sein. Saubere Lösung in S2 mit getrenntem Boden aus dem klassifizierten Modell.
- **Zonenumriss** liegt auf ±0 und verschwindet im Hanggelände; **Zonen-Chip** schneidet lange Namen ab – S2.
- Textur ist JPEG, nicht KTX2 (kein `toktx` installiert); für S1-Budget nicht nötig.
- Der „Ort“ des Pakets ist ein technischer Blickpunkt in der Zonenmitte, kein benannter Ort.

## Nächster Schritt

S2: Zone für den Hauptbereich mit echtem Grundriss, dichterer Bestand beim Annähern (2–5 MB), Boden aus dem klassifizierten Modell statt Absenkring, Umriss auf dem Gelände.
