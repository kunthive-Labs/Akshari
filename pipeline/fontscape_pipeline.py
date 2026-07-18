#!/usr/bin/env python3
"""Re-runnable Fontscape catalog pipeline.

Run each stage independently. Inputs and outputs are JSON, so calibration and review
can happen in pull requests before tags are written to the application database.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
DATA = ROOT / "data"
SPECIMENS = ROOT / "specimens"
FONT_DIR = ROOT / "fonts"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True))


def ingest(args: argparse.Namespace) -> None:
    """Download normalized Google Fonts family metadata."""
    key = args.api_key or os.environ.get("GOOGLE_FONTS_API_KEY")
    if not key:
        raise SystemExit("GOOGLE_FONTS_API_KEY is required for ingest.")
    response = requests.get(f"https://www.googleapis.com/webfonts/v1/webfonts?key={key}", timeout=60)
    response.raise_for_status()
    catalog = []
    for item in response.json()["items"]:
        catalog.append({
            "family": item["family"], "google_fonts_id": item["family"].lower().replace(" ", "-"),
            "category": item.get("category"), "subsets": item.get("subsets", []),
            "variants": item.get("variants", []), "files": item.get("files", []),
            "version": item.get("version"), "last_modified": item.get("lastModified"),
        })
    save_json(Path(args.output), catalog)
    print(f"Wrote {len(catalog)} Google Fonts families to {args.output}")


def download(args: argparse.Namespace) -> None:
    """Fetch one regular font file per family for metrics and specimen rendering."""
    catalog = load_json(Path(args.catalog))
    target = Path(args.output_dir); target.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    for item in catalog[:args.limit or None]:
        files = item.get("files", {})
        url = files.get("regular") or files.get("400") or next(iter(files.values()), None)
        if not url: continue
        output = target / f"{item['google_fonts_id']}.ttf"
        if output.exists() and not args.force: continue
        response = requests.get(url, timeout=90); response.raise_for_status()
        output.write_bytes(response.content); downloaded += 1
    print(f"Downloaded {downloaded} font files to {target}")


def metrics(font_path: Path) -> dict[str, Any]:
    """Read deterministic geometry from OpenType tables, never from the vision model."""
    font = TTFont(font_path)
    units = font["head"].unitsPerEm
    os2 = font["OS/2"]
    hhea = font["hhea"]
    cmap = font.getBestCmap()
    widths = [font["hmtx"].metrics[cmap[ord(c)]][0] for c in "abcdefghijklmnopqrstuvwxyz" if ord(c) in cmap]
    panose = os2.panose
    serif = "none" if panose.bSerifStyle in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9) else "serif"
    return {
        "x_height_ratio": round(getattr(os2, "sxHeight", 0) / units, 3),
        "cap_height_ratio": round(getattr(os2, "sCapHeight", 0) / units, 3),
        "average_width": round((sum(widths) / len(widths) / units) if widths else 0, 3),
        "ascender_ratio": round(hhea.ascent / units, 3),
        "serif_presence": serif,
        "weight_class": os2.usWeightClass,
        "width_class": os2.usWidthClass,
    }


def extract_features(args: argparse.Namespace) -> None:
    font_paths = list(Path(args.font_dir).glob("**/*.[to][tt][ff]"))
    payload = {path.name: metrics(path) for path in font_paths}
    save_json(Path(args.output), payload)
    print(f"Extracted features for {len(payload)} font files")


def render_specimen(font_path: Path, output: Path) -> None:
    """Render a consistent calibration image for vision tagging and the catalog."""
    image = Image.new("RGB", (1600, 1000), "#f7f6f2")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(font_path, 104)
    small = ImageFont.truetype(font_path, 38)
    draw.text((84, 70), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", font=small, fill="#152b49")
    draw.text((84, 145), "abcdefghijklmnopqrstuvwxyz", font=small, fill="#152b49")
    draw.text((84, 260), "0123456789", font=small, fill="#2d7d79")
    draw.text((84, 370), "Sphinx of black quartz, judge my vow.", font=font, fill="#152b49")
    draw.multiline_text((84, 565), "Type makes language visible.\nA careful rhythm turns reading into trust.", font=small, fill="#52606e", spacing=15)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, quality=92)


def render(args: argparse.Namespace) -> None:
    source, target = Path(args.font_dir), Path(args.output_dir)
    paths = list(source.glob("**/*.[to][tt][ff]"))
    for path in paths: render_specimen(path, target / f"{path.stem}.jpg")
    print(f"Rendered {len(paths)} specimen images")


def tag_with_claude(image_path: Path, feature_vector: dict[str, Any], vocabulary: dict[str, Any], model: str) -> list[dict[str, Any]]:
    """Return fixed-vocabulary tags. Requires ANTHROPIC_API_KEY and never invents facets."""
    from anthropic import Anthropic
    encoded = base64.b64encode(image_path.read_bytes()).decode()
    allowed = [tag for values in vocabulary["buckets"].values() for tag in values]
    prompt = f"""You are tagging a typeface for a semantic discovery catalog.\nUse ONLY tags from this vocabulary: {allowed}.\nGeometric measurements: {json.dumps(feature_vector)}\nReturn JSON only: {{\"tags\":[{{\"tag\": string, \"confidence\": number}}]}}.\nReturn 3 to 7 tags with confidence 0 to 1. Do not identify the font."""
    result = Anthropic().messages.create(model=model, max_tokens=500, messages=[{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":encoded}},{"type":"text","text":prompt}]}])
    payload = json.loads(result.content[0].text)
    return [tag for tag in payload["tags"] if tag["tag"] in allowed and 0 <= tag["confidence"] <= 1]


def tag(args: argparse.Namespace) -> None:
    vocab, feature_map = load_json(Path(args.vocabulary)), load_json(Path(args.features))
    output = {}
    for image_path in Path(args.specimens).glob("*.jpg"):
        output[image_path.stem] = tag_with_claude(image_path, feature_map.get(f"{image_path.stem}.ttf", {}), vocab, args.model)
    save_json(Path(args.output), output)
    print(f"Tagged {len(output)} specimens with fixed vocabulary {vocab['version']}")


def embed(args: argparse.Namespace) -> None:
    """Use CLIP image embeddings. This stays offline after the model has been downloaded once."""
    from transformers import CLIPModel, CLIPProcessor
    model = CLIPModel.from_pretrained(args.model)
    processor = CLIPProcessor.from_pretrained(args.model)
    output = {}
    for image_path in Path(args.specimens).glob("*.jpg"):
        inputs = processor(images=Image.open(image_path), return_tensors="pt")
        vector = model.get_image_features(**inputs)[0].detach().tolist()
        output[image_path.stem] = vector
    save_json(Path(args.output), output)
    print(f"Embedded {len(output)} specimens")


def write(args: argparse.Namespace) -> None:
    """Persist a reviewed catalog run. Run this only after tag calibration review."""
    import psycopg
    catalog = load_json(Path(args.catalog))
    features = load_json(Path(args.features))
    tags = load_json(Path(args.tags))
    embeddings = load_json(Path(args.embeddings))
    with psycopg.connect(args.database_url) as connection, connection.cursor() as cursor:
        for item in catalog:
            family_id = item["google_fonts_id"]
            cursor.execute("""INSERT INTO fonts(family, google_fonts_id, source_url, preview_url, weights, styles, subsets, category)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
              ON CONFLICT (google_fonts_id) DO UPDATE SET family = EXCLUDED.family, preview_url = EXCLUDED.preview_url, weights = EXCLUDED.weights, styles = EXCLUDED.styles, subsets = EXCLUDED.subsets, category = EXCLUDED.category
              RETURNING id""", (item["family"], family_id, f"https://fonts.google.com/specimen/{item['family'].replace(' ', '+')}", f"{args.font_url_prefix.rstrip('/')}/{family_id}.ttf", [int(v) for v in item.get("variants", ["400"]) if v.isdigit()], ["normal"], item.get("subsets", ["latin"]), item.get("category")))
            font_id = cursor.fetchone()[0]
            key = next((name for name in features if name.startswith(family_id) or name.lower().startswith(item["family"].lower().replace(" ", "-"))), None)
            if key:
                value = features[key]
                cursor.execute("""INSERT INTO font_features(font_id, x_height_ratio, cap_height_ratio, average_width, metrics)
                  VALUES (%s,%s,%s,%s,%s) ON CONFLICT (font_id) DO UPDATE SET x_height_ratio = EXCLUDED.x_height_ratio, cap_height_ratio = EXCLUDED.cap_height_ratio, average_width = EXCLUDED.average_width, metrics = EXCLUDED.metrics""", (font_id, value.get("x_height_ratio"), value.get("cap_height_ratio"), value.get("average_width"), json.dumps(value)))
            cursor.execute("DELETE FROM font_tags WHERE font_id = %s AND tag_version = %s", (font_id, args.tag_version))
            specimen = item["family"].replace(" ", "-")
            for tag_value in tags.get(specimen, []): cursor.execute("INSERT INTO font_tags(font_id, tag, confidence, tag_version, source) VALUES (%s,%s,%s,%s,'pipeline')", (font_id, tag_value["tag"], tag_value["confidence"], args.tag_version))
            vector = embeddings.get(specimen)
            if vector and len(vector) == 512:
                cursor.execute("""INSERT INTO font_embeddings(font_id, embedding_type, embedding, embedding_version) VALUES (%s,'visual',%s,%s)
                  ON CONFLICT (font_id, embedding_type, embedding_version) DO UPDATE SET embedding = EXCLUDED.embedding""", (font_id, str(vector), args.embedding_version))
    print(f"Wrote {len(catalog)} catalog rows to Postgres")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fontscape offline catalog pipeline")
    sub = parser.add_subparsers(required=True)
    command = sub.add_parser("ingest"); command.add_argument("--api-key"); command.add_argument("--output", default=DATA / "catalog.json"); command.set_defaults(func=ingest)
    command = sub.add_parser("download"); command.add_argument("--catalog", default=DATA / "catalog.json"); command.add_argument("--output-dir", default=FONT_DIR); command.add_argument("--limit", type=int); command.add_argument("--force", action="store_true"); command.set_defaults(func=download)
    command = sub.add_parser("features"); command.add_argument("--font-dir", default=FONT_DIR); command.add_argument("--output", default=DATA / "features.json"); command.set_defaults(func=extract_features)
    command = sub.add_parser("render"); command.add_argument("--font-dir", default=FONT_DIR); command.add_argument("--output-dir", default=SPECIMENS); command.set_defaults(func=render)
    command = sub.add_parser("tag"); command.add_argument("--specimens", default=SPECIMENS); command.add_argument("--features", default=DATA / "features.json"); command.add_argument("--vocabulary", default=ROOT / "config/tags.v1.json"); command.add_argument("--model", default=os.environ.get("FONTSCAPE_TAG_MODEL", "claude-sonnet-4-5")); command.add_argument("--output", default=DATA / "tags.v1.json"); command.set_defaults(func=tag)
    command = sub.add_parser("embed"); command.add_argument("--specimens", default=SPECIMENS); command.add_argument("--model", default="openai/clip-vit-base-patch32"); command.add_argument("--output", default=DATA / "embeddings.clip.json"); command.set_defaults(func=embed)
    command = sub.add_parser("write"); command.add_argument("--database-url", default=os.environ.get("DATABASE_URL")); command.add_argument("--catalog", default=DATA / "catalog.json"); command.add_argument("--features", default=DATA / "features.json"); command.add_argument("--tags", default=DATA / "tags.v1.json"); command.add_argument("--embeddings", default=DATA / "embeddings.clip.json"); command.add_argument("--font-url-prefix", default="/fonts"); command.add_argument("--tag-version", default="v1"); command.add_argument("--embedding-version", default="clip-v1"); command.set_defaults(func=write)
    args = parser.parse_args(); args.func(args)


if __name__ == "__main__": main()
