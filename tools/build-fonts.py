#!/usr/bin/env python3
"""
Holt Literata und Jost von Google, schneidet sie zu und legt sie lokal ab.

Warum überhaupt:
  Bisher lud die Seite die Schriften bei jedem Besuch von fonts.googleapis.com
  und fonts.gstatic.com. Das kostet zwei fremde Verbindungen (DNS, TLS,
  Handshake), bevor das erste Wort steht — gemessen 350 KB über 6 Anfragen.
  Und es ist ein Rechtsproblem: dabei geht die IP-Adresse jedes Besuchers an
  Google in die USA. Dafür gibt es in Deutschland seit dem Urteil des
  LG München (3 O 17493/20) laufend Abmahnungen. Lokal gehostet ist die Seite
  schneller, und die Datenschutzerklärung braucht keinen Google-Abschnitt.

Warum die Originaldateien von GitHub statt der CSS-API:
  Die API liefert die Schrift in Subsets (latin, latin-ext, kyrillisch …),
  jedes als eigene Datei mit eigener unicode-range. Das ō in "dōTERRA" liegt
  in latin-ext — die Seite bräuchte also zwei Dateien pro Schnitt, obwohl sie
  aus latin-ext nur ein einziges Zeichen benutzt. Aus der vollständigen Datei
  schneiden wir stattdessen genau einen Satz, der alles Nötige enthält:
  eine Datei pro Schnitt, drei Anfragen statt sechs.

Welche Zeichen drin sind (ZEICHEN weiter unten):
  ASCII, die westeuropäischen Akzente aus Latin-1, ein paar Sonderfälle wie ō
  sowie die Typografie-Zeichen (Gedankenstrich, deutsche Anführungszeichen,
  Euro, Copyright). Bewusst großzügiger als der aktuelle Text: Anki soll
  Wörter ändern können, ohne dass dieses Skript neu laufen muss. Wer ein
  Zeichen außerhalb benutzt, sieht es in der Ersatzschrift — das fällt auf,
  bevor es jemand anders merkt.

Warum opsz nur bei der kursiven Literata festgenagelt wird:
  Literata hat neben dem Gewicht eine optische Achse: bei großem Schriftgrad
  werden die Serifen feiner und die Abstände enger. Diese Achse ist teuer —
  gemessen am zugeschnittenen Schnitt:
      mit opsz 87 KB   ohne opsz 41 KB
  Die aufrechte Literata setzt die Überschriften bis 48 px, dort trägt die
  Achse sichtbar; sie behält sie. Die kursive steht ausschließlich in
  Fließtextgröße (Motto, Zitat, Kursplan-Dreiklang) — für sie wird die Achse
  auf 16 festgenagelt. Das spart 46 KB, ohne dass sich etwas ändert.

Warum kein unicode-range in der erzeugten CSS:
  Es gibt nur noch eine Datei pro Schnitt, die alles abdeckt. Eine Angabe,
  die nie zu einem zweiten Download führt, wäre nur Beiwerk.

Aufruf aus dem Projektverzeichnis:
  python3 tools/build-fonts.py

Voraussetzung:
  pip3 install fonttools brotli
"""
import collections
import io
import pathlib
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROH = "https://raw.githubusercontent.com/google/fonts/main/ofl/"

# Zieldatei -> (Quelle, CSS-Familie, Stil, Gewichtsbereich, opsz festnageln?)
SCHNITTE = [
    ("literata.woff2",
     ROH + "literata/Literata%5Bopsz,wght%5D.ttf",
     "Literata", "normal", "200 600", None),
    ("literata-italic.woff2",
     ROH + "literata/Literata-Italic%5Bopsz,wght%5D.ttf",
     "Literata", "italic", "200 500", 16),
    ("jost.woff2",
     ROH + "jost/Jost%5Bwght%5D.ttf",
     "Jost", "normal", "300 600", None),
]

LIZENZ = ROH + "literata/OFL.txt"

ZEICHEN = (
    "".join(chr(c) for c in range(0x20, 0x7F))            # ASCII
    + "ÄÖÜäöüß"                                            # Deutsch
    + "ÀÁÂÃÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕØÙÚÛÝ"                          # Latin-1 groß
    + "àáâãåæçèéêëìíîïñòóôõøùúûýÿ"                         # Latin-1 klein
    + "ŌōŚśŠšŽžŸŒœ"                                        # u. a. ō aus dōTERRA
    + "–—‘’‚“”„†•…‹›€£©®™°·§±×÷"                           # Typografie
)

# kern/liga/clig/calt sorgen für richtige Abstände und Ligaturen, locl für
# sprachabhängige Formen, ccmp/mark/mkmk für zusammengesetzte Zeichen.
# Alles andere (Kapitälchen, Mediävalziffern, Brüche) kommt auf der Seite
# nicht vor und würde nur Bytes kosten.
FEATURES = ["kern", "liga", "clig", "calt", "locl", "ccmp", "mark", "mkmk"]

WURZEL = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = WURZEL / "assets" / "fonts"
ZIEL_CSS = WURZEL / "assets" / "css" / "fonts.css"

KOPF = """/* Diese Datei wird erzeugt — nicht von Hand ändern.
   Quelle: tools/build-fonts.py, dort steht auch die Begründung.

   font-display: swap heißt: bis die Schrift geladen ist, zeigt der Browser
   die Ersatzschrift aus --font-serif bzw. --font-sans. Ein kurzer Sprung ist
   besser als ein leerer Bildschirm.

   Lizenz: SIL Open Font License 1.1, siehe assets/fonts/OFL.txt. */
"""


def hole(url: str) -> bytes:
    return urllib.request.urlopen(url).read()


def entlazy(f: TTFont) -> None:
    """Macht die gvar-Tabelle vollständig.

    fontTools liest gvar verzögert und behauptet dabei, Einträge zu kennen,
    die in der Datei gar nicht stehen (etwa für Glyphen ohne eigene
    Variation). Der Subsetter greift beim Verkleinern darauf zu und bricht
    mit KeyError ab. Ein echtes dict mit Vorgabewert löst das: fehlende
    Glyphen bekommen eine leere Variationsliste, was genau der Wahrheit
    entspricht.
    """
    if "gvar" not in f:
        return
    gv = f["gvar"].variations
    voll = collections.defaultdict(list)
    for name in f.getGlyphOrder():
        try:
            voll[name] = gv[name]
        except KeyError:
            pass
    f["gvar"].variations = voll


def schneide(rohdaten, opsz):
    f = TTFont(io.BytesIO(rohdaten), lazy=False)
    entlazy(f)
    if opsz is not None:
        f = instancer.instantiateVariableFont(f, {"opsz": opsz}, inplace=False)
        entlazy(f)

    optionen = subset.Options()
    optionen.layout_features = FEATURES
    optionen.name_IDs = ["*"]          # Lizenzhinweise bleiben in der Datei
    optionen.notdef_outline = True     # Platzhalter für fehlende Zeichen

    schnitt = subset.Subsetter(options=optionen)
    schnitt.populate(unicodes=sorted({ord(c) for c in ZEICHEN}))
    schnitt.subset(f)

    f.flavor = "woff2"
    puffer = io.BytesIO()
    f.save(puffer)
    return puffer.getvalue()


def main() -> None:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    for alt in FONT_DIR.glob("*.woff2"):
        alt.unlink()

    (FONT_DIR / "OFL.txt").write_bytes(hole(LIZENZ))

    ausgabe = [KOPF]
    gesamt = 0
    for datei, url, familie, stil, gewicht, opsz in SCHNITTE:
        roh = hole(url)
        klein = schneide(roh, opsz)
        (FONT_DIR / datei).write_bytes(klein)
        gesamt += len(klein)
        print(f"{datei:24} {len(roh) / 1024:7.1f} KB  ->  {len(klein) / 1024:6.1f} KB"
              + (f"   (opsz auf {opsz} festgenagelt)" if opsz else ""))

        ausgabe.append(
            "\n@font-face {\n"
            f"  font-family: '{familie}';\n"
            f"  font-style: {stil};\n"
            f"  font-weight: {gewicht};\n"
            "  font-display: swap;\n"
            f"  src: url('../fonts/{datei}') format('woff2');\n"
            "}\n"
        )

    ZIEL_CSS.write_text("".join(ausgabe), encoding="utf-8")
    print(f"\n{ZIEL_CSS.relative_to(WURZEL)} geschrieben, "
          f"{gesamt / 1024:.0f} KB Schriften gesamt")


if __name__ == "__main__":
    main()
