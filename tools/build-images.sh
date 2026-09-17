#!/bin/bash
#
# Erzeugt aus jedem Original-JPEG in assets/img/ mehrere AVIF-Varianten.
#
# Warum überhaupt:
#   Die Originale sind bis 1600 px breit. Ein Telefon zeigt dieselben Bilder
#   in 300 bis 450 px. Ohne srcset lädt es trotzdem die volle Auflösung —
#   rund zehnmal mehr Pixel als es darstellen kann.
#
# Warum AVIF und kein WebP:
#   Auf diesem Rechner gibt es keinen WebP-Encoder; sips (macOS) kann AVIF,
#   aber kein WebP. Das ist kein Verlust: AVIF komprimiert Fotos deutlich
#   besser als WebP und wird von über 95 % der Browser unterstützt. Wer kein
#   AVIF kann, bekommt über das <img> im <picture> das Original-JPEG.
#
# Warum Qualität 65:
#   Messung an weg-retreat.jpg bei 1200 px Breite —
#     q50: 25 KB   q60: 36 KB   q70: 50 KB   q80: 72 KB
#   Das Original liegt bei 148 KB. q65 liegt im Bereich, in dem Hauttöne und
#   Gegenlicht noch sauber bleiben, und spart trotzdem rund zwei Drittel.
#
# Warum genau diese Breiten:
#   480  – Telefon ohne Retina und die kleinen Kacheln der Laufschrift
#   768  – Telefon mit Retina (375 × 2) und Tablet
#   1200 – Telefon mit dreifacher Dichte und großer Desktop ohne Retina
#   1600 – Desktop mit Retina
#   Stufen oberhalb der nativen Breite werden übersprungen: hochskalieren
#   macht die Datei größer, ohne ein Pixel mehr Information zu liefern.
#   Ist keine Stufe so groß wie das Original, kommt die native Breite als
#   oberste Stufe dazu (die Hochformate sind 1040 bzw. 1066 px breit).
#
# Warum die Höhe von Hand ausgerechnet und auf gerade gerundet wird:
#   Mit --resampleWidth allein rechnet sips die Höhe selbst aus und rundet
#   dabei auch auf ungerade Werte: 1600×1066 wurde bei Breite 1200 zu
#   1200×799. Bei ungerader Kantenlänge erzeugt sips eine Kachel-AVIF, deren
#   Kacheln nicht aufgehen — die Datei hat die richtige Größe in Bytes, meldet
#   im Browser die richtigen Maße, dekodiert aber vollständig durchsichtig.
#   Man sieht nur einen leeren Kasten, und weil das Bild formal "geladen" ist,
#   meldet weder die Konsole noch img.complete einen Fehler. Das hat fünf von
#   vierzig Dateien betroffen (alle vier 1200×799 und eine 768×1181), während
#   dieselben Bilder in 480, 768 und 1600 px einwandfrei waren.
#   Deshalb: Höhe selbst ausrechnen und auf einen geraden Wert abrunden. Der
#   Unterschied von höchstens einer Pixelzeile ist unsichtbar, alle Bilder
#   stehen ohnehin unter object-fit: cover.
#
# Aufruf aus dem Projektverzeichnis:
#   bash tools/build-images.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
IMG_DIR="assets/img"
QUALITY=65
STUFEN=(480 768 1200 1600)

command -v sips >/dev/null || { echo "sips fehlt (nur macOS)"; exit 1; }

# Alte Ergebnisse weg, sonst bleiben Varianten von umbenannten oder
# gelöschten Bildern als Karteileichen liegen.
rm -f "$IMG_DIR"/*.avif

gesamt_jpg=0
gesamt_avif=0

# Bash 3.2 (macOS-Standard) kennt keine negativen Array-Indizes, deshalb
# sammeln wir die erzeugten Breiten als Zeichenkette und merken uns die
# größte Stufe in einer eigenen Variablen.
for quelle in "$IMG_DIR"/*.jpg; do
  basis="${quelle%.jpg}"

  # Nur konvertieren, was die Seite auch einbindet. In assets/img/ liegen
  # noch Aufnahmen, die aktuell nirgends stehen; für die Varianten zu
  # erzeugen hieße, totes Gewicht ins Repository zu legen. Wird so ein Bild
  # später eingebaut, erkennt dieser Test es beim nächsten Lauf von selbst.
  if ! grep -q "$(basename "$quelle")" index.html; then
    printf '%-46s übersprungen (nicht in index.html eingebunden)\n' "$(basename "$basis")"
    continue
  fi

  nativ=$(sips -g pixelWidth "$quelle" | awk '/pixelWidth/{print $2}')
  nativ_h=$(sips -g pixelHeight "$quelle" | awk '/pixelHeight/{print $2}')
  erzeugt=""
  groesste=0

  for breite in "${STUFEN[@]}"; do
    (( breite > nativ )) && continue
    # kaufmännisch runden, danach auf gerade abrunden (siehe Kopf)
    hoehe=$(( (nativ_h * breite + nativ / 2) / nativ ))
    hoehe=$(( hoehe - hoehe % 2 ))
    sips -s format avif -s formatOptions "$QUALITY" \
         --resampleHeightWidth "$hoehe" "$breite" "$quelle" \
         --out "${basis}-${breite}.avif" >/dev/null
    erzeugt="${erzeugt:+$erzeugt,}$breite"
    groesste=$breite
  done

  if [[ ! -f "${basis}-${nativ}.avif" ]]; then
    sips -s format avif -s formatOptions "$QUALITY" \
         --resampleHeightWidth $(( nativ_h - nativ_h % 2 )) $(( nativ - nativ % 2 )) "$quelle" \
         --out "${basis}-${nativ}.avif" >/dev/null
    erzeugt="${erzeugt:+$erzeugt,}$nativ"
    groesste=$nativ
  fi

  jpg_bytes=$(stat -f%z "$quelle")
  top_bytes=$(stat -f%z "${basis}-${groesste}.avif")
  gesamt_jpg=$(( gesamt_jpg + jpg_bytes ))
  gesamt_avif=$(( gesamt_avif + top_bytes ))

  printf '%-46s nativ %4s px → %-18s | %4s KB → %4s KB\n' \
    "$(basename "$basis")" "$nativ" "$erzeugt" \
    $(( jpg_bytes / 1024 )) $(( top_bytes / 1024 ))
done

echo
printf 'Größte Stufe gesamt: %s KB AVIF statt %s KB JPEG (%s %%)\n' \
  $(( gesamt_avif / 1024 )) $(( gesamt_jpg / 1024 )) \
  $(( 100 - gesamt_avif * 100 / gesamt_jpg ))

# Letzte Kontrolle: eine ungerade Kantenlänge ist der Auslöser für die leeren
# Kachel-AVIF (siehe Kopf). Der Fehler ist im Browser nicht zu erkennen — das
# Bild gilt als geladen und bleibt trotzdem unsichtbar. Deshalb hier abbrechen,
# statt eine unsichtbare Datei ins Repository zu lassen.
ungerade=0
for datei in "$IMG_DIR"/*.avif; do
  masse=$(sips -g pixelWidth -g pixelHeight "$datei" | awk '/pixel/{print $2}')
  breite=$(echo "$masse" | head -1)
  hoehe=$(echo "$masse" | tail -1)
  if (( breite % 2 || hoehe % 2 )); then
    printf 'FEHLER: %s ist %sx%s — ungerade Kante, wird durchsichtig dekodieren\n' \
      "$(basename "$datei")" "$breite" "$hoehe"
    ungerade=1
  fi
done
(( ungerade )) && exit 1
echo "Alle AVIF haben gerade Kantenlängen."
