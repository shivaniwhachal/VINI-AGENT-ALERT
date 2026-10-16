"""Draw the dark VINI Accounts Alert table."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from vini_alert.table import RULE_LINES, title_for

BG = (12, 16, 22)
TITLE = (246, 248, 252)
MUTED = (148, 163, 180)
TEXT = (232, 237, 244)
HEADER_BG = (24, 33, 46)
ROW_A = (16, 21, 29)
ROW_B = (22, 28, 38)
LINE = (40, 50, 64)
ACCENT = (118, 176, 255)

COLUMNS = (
    ("agent", "Agent", 148),
    ("rooftop", "Rooftop", 390),
    ("metric", "Metric", 140),
    ("issue", "Issue", 300),
    ("csm", "CSM", 340),
)

PAD_X = 28
ROW_H = 38
HEADER_H = 40
FONT_CANDIDATES = {
    "regular": [
        "/usr/share/fonts/truetype/macos/Inter-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ],
    "medium": [
        "/usr/share/fonts/truetype/macos/Inter-Medium.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ],
    "semibold": [
        "/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ],
}


def _font(kind: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES[kind]:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _ellipsis(text: str, font: ImageFont.ImageFont, width: int) -> str:
    text = " ".join(str(text or "").split())
    if font.getlength(text) <= width:
        return text
    ell = "…"
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if font.getlength(text[:mid].rstrip() + ell) <= width:
            lo = mid
        else:
            hi = mid - 1
    return text[:lo].rstrip() + ell


def _wrap(text: str, font: ImageFont.ImageFont, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = word if not cur else cur + " " + word
        if font.getlength(trial) <= width:
            cur = trial
            continue
        if cur:
            lines.append(cur)
        cur = word
    if cur:
        lines.append(cur)
    return lines or [""]


def render_png(rows: list[dict], report_date: str, path: str | Path) -> Path:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    small = _font("regular", 15)
    medium = _font("medium", 16)
    title_font = _font("semibold", 26)
    rule_font = _font("regular", 14)
    header_font = _font("medium", 13)

    width = PAD_X * 2 + sum(col[2] for col in COLUMNS)
    rule_width = width - PAD_X * 2
    rule_lines: list[str] = []
    for line in RULE_LINES:
        rule_lines.extend(_wrap(line, rule_font, rule_width))
    title = title_for(report_date, len(rows))
    top = 28 + 36 + 8 + len(rule_lines) * 22 + 18
    height = top + HEADER_H + ROW_H * max(len(rows), 1) + 24

    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    draw.text((PAD_X, 24), title, font=title_font, fill=TITLE)
    y = 24 + 36
    for line in rule_lines:
        draw.text((PAD_X, y), line, font=rule_font, fill=MUTED)
        y += 22
    y += 16
    draw.rectangle((0, y, width, y + HEADER_H), fill=HEADER_BG)
    draw.rectangle((0, y, 4, y + HEADER_H), fill=ACCENT)
    x = PAD_X
    for _key, label, col_w in COLUMNS:
        draw.text((x, y + 11), label.upper(), font=header_font, fill=MUTED)
        x += col_w
    y += HEADER_H

    body_font = small
    if not rows:
        draw.rectangle((0, y, width, y + ROW_H), fill=ROW_A)
        draw.text((PAD_X, y + 10), "No alerts for this date.", font=body_font, fill=MUTED)
    for i, row in enumerate(rows):
        top_y = y + i * ROW_H
        draw.rectangle((0, top_y, width, top_y + ROW_H), fill=ROW_A if i % 2 == 0 else ROW_B)
        draw.line((PAD_X, top_y + ROW_H - 1, width - PAD_X, top_y + ROW_H - 1), fill=LINE)
        x = PAD_X
        values = {
            "agent": row["agent"],
            "rooftop": row["rooftop"],
            "metric": row["metric"],
            "issue": row["issue"],
            "csm": row["csm"],
        }
        for key, _label, col_w in COLUMNS:
            font = medium if key in {"agent", "metric"} else body_font
            color = ACCENT if key == "metric" else TEXT
            if key == "csm" and row["csm"] == "—":
                color = MUTED
            text = _ellipsis(values[key], font, col_w - 18)
            draw.text((x, top_y + 9), text, font=font, fill=color)
            x += col_w

    image.save(out, format="PNG", optimize=True)
    return out
