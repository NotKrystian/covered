#!/usr/bin/env python3
"""Covered logo: mark + lockup SVGs (paths only, no font needed to display them).

  python3 make_logo.py        writes assets/covered-mark.svg, assets/covered-lockup.svg

The mark is an open rounded square whose tick breaks out of its top-right corner:
one stroke weight, black on warm grey, the green accent used once (the tick).
The wordmark is "Covered" in Geist 650, outlined from assets/fonts/Geist-Variable.woff2.
"""

import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
INK, ACCENT = "#0b0b0b", "#5fd38a"

# 120 x 120 box; the same paths are inlined in covered-film.html
MARK_BOX = "M72 17 H42 A25 25 0 0 0 17 42 V78 A25 25 0 0 0 42 103 H78 A25 25 0 0 0 103 78 V60"
MARK_TICK = "M40 59 L57 76 L101 30"
STROKE = 12.5


def mark_group(dx=0.0, dy=0.0, s=1.0):
    return (f'<g transform="translate({dx:g} {dy:g}) scale({s:g})" fill="none" stroke-width="{STROKE}" '
            f'stroke-linecap="round" stroke-linejoin="round">'
            f'<path stroke="{INK}" d="{MARK_BOX}"/><path stroke="{ACCENT}" d="{MARK_TICK}"/></g>')


def wordmark_path(text, size, x0, baseline, tracking=-0.03):
    font = TTFont(os.path.join(ASSETS, "fonts", "Geist-Variable.woff2"))
    font = instantiateVariableFont(font, {"wght": 650})
    upem = font["head"].unitsPerEm
    cmap, glyphs, hmtx = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    k = size / upem
    pen = SVGPathPen(glyphs)
    x = x0
    for ch in text:
        g = cmap[ord(ch)]
        glyphs[g].draw(TransformPen(pen, (k, 0, 0, -k, x, baseline)))
        x += hmtx[g][0] * k + tracking * size
    cap = font["OS/2"].sCapHeight * k
    return pen.getCommands(), x - tracking * size, cap


def main():
    with open(os.path.join(ASSETS, "covered-mark.svg"), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">'
                f'<title>Covered</title>{mark_group()}</svg>\n')
    # lockup: cap height ~0.72 of the mark's drawn height, caps centred on the mark
    size = 86
    d, _, cap = wordmark_path("Covered", size, 0, 0)
    baseline = 60 + cap / 2
    d, x_end, _ = wordmark_path("Covered", size, 128, baseline)
    width = x_end + 6
    with open(os.path.join(ASSETS, "covered-lockup.svg"), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} 120" width="{width:.0f}" height="120">'
                f'<title>Covered</title>{mark_group()}<path fill="{INK}" d="{d}"/></svg>\n')
    print(f"wrote covered-mark.svg, covered-lockup.svg (lockup {width:.0f} x 120, cap {cap:.1f})")


if __name__ == "__main__":
    main()
