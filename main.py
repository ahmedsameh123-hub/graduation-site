"""
Graduation website - FastAPI backend.

Run locally:      python main.py
Run + public URL: python main.py --share      (needs pyngrok + ngrok authtoken)

Everything you edit lives in:
  config.json                 -> all the texts (Arabic + English)
  static/images/hero.jpg      -> main photo (arch frame in the hero)
  static/images/hero/*        -> optional extra hero photos (slideshow inside the arch)
  static/images/gallery/*     -> gallery photos (any number, any names)
  static/images/then.jpg      -> optional: "then" photo  (before/after slider)
  static/images/now.jpg       -> optional: "now" photo   (before/after slider)
  static/images/secret.jpg    -> optional: photo hidden under the scratch card
  static/music/*.mp3          -> optional background song
"""
import argparse
import json
import re
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

try:
    from PIL import Image  # optional: only used to read photo sizes
except ImportError:  # the site still works without Pillow
    Image = None

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
IMAGES_DIR = STATIC_DIR / "images"
GALLERY_DIR = IMAGES_DIR / "gallery"
HERO_DIR = IMAGES_DIR / "hero"
MUSIC_DIR = STATIC_DIR / "music"
CONFIG_FILE = BASE_DIR / "config.json"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
AUDIO_EXT = {".mp3", ".m4a", ".ogg", ".wav"}

for folder in (GALLERY_DIR, HERO_DIR, MUSIC_DIR):
    folder.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Graduation Site", docs_url=None, redoc_url=None)

NO_CACHE = {"Cache-Control": "no-store"}


def natural_key(path: Path):
    """1.jpg, 2.jpg, 10.jpg (not 1, 10, 2)."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", path.name)]


@lru_cache(maxsize=256)
def _image_size(path_str: str, mtime: float):
    """Return (width, height) as the browser will show it (EXIF rotation applied)."""
    if Image is None:
        return None
    try:
        with Image.open(path_str) as img:
            w, h = img.size
            orientation = img.getexif().get(0x0112)
            if orientation in (5, 6, 7, 8):  # phone photos rotated by EXIF
                w, h = h, w
            return w, h
    except Exception:
        return None


def _url(path: Path) -> str:
    version = int(path.stat().st_mtime)  # cache-busting when you replace a photo
    return f"/static/{path.relative_to(STATIC_DIR).as_posix()}?v={version}"


def _hero_urls():
    """hero.jpg first (if it exists), then everything inside static/images/hero/."""
    urls = []
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        candidate = IMAGES_DIR / f"hero{ext}"
        if candidate.exists():
            urls.append(_url(candidate))
            break
    extra = sorted((p for p in HERO_DIR.iterdir() if p.suffix.lower() in IMAGE_EXT), key=natural_key)
    urls.extend(_url(p) for p in extra)
    return urls


def _single_image_url(stem: str):
    """static/images/<stem>.(jpg|jpeg|png|webp) -> url or None"""
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        candidate = IMAGES_DIR / f"{stem}{ext}"
        if candidate.exists():
            return _url(candidate)
    return None


def _find_music():
    files = sorted(
        (p for p in MUSIC_DIR.iterdir() if p.suffix.lower() in AUDIO_EXT),
        key=natural_key,
    )
    return files[0] if files else None


def _gallery_items():
    files = sorted(
        (p for p in GALLERY_DIR.iterdir() if p.suffix.lower() in IMAGE_EXT),
        key=natural_key,
    )
    items = []
    for p in files:
        size = _image_size(str(p), p.stat().st_mtime)
        items.append(
            {
                "name": p.name,
                "src": _url(p),
                "width": size[0] if size else None,
                "height": size[1] if size else None,
            }
        )
    return items


@app.get("/api/site")
def site_data():
    """Config + photo list + music in one request. config.json is re-read on every
    request, so you can edit texts and just refresh the page (no server restart)."""
    try:
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return JSONResponse({"error": "config.json not found"}, 500, headers=NO_CACHE)
    except json.JSONDecodeError as e:
        return JSONResponse(
            {"error": f"config.json has a typo at line {e.lineno}, column {e.colno}: {e.msg}"},
            500,
            headers=NO_CACHE,
        )

    music = _find_music()
    return JSONResponse(
        {
            "config": config,
            "hero_urls": _hero_urls(),
            "then_url": _single_image_url("then"),
            "now_url": _single_image_url("now"),
            "secret_url": _single_image_url("secret"),
            "music_url": _url(music) if music else None,
            "gallery": _gallery_items(),
        },
        headers=NO_CACHE,
    )


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html", headers=NO_CACHE)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--share", action="store_true", help="open an ngrok tunnel and print the public link")
    parser.add_argument("--token", help="ngrok authtoken (only if you did not run: ngrok config add-authtoken ...)")
    args = parser.parse_args()

    if args.share:
        from pyngrok import ngrok  # pip install pyngrok

        if args.token:
            ngrok.set_auth_token(args.token)
        tunnel = ngrok.connect(args.port, "http")
        print("\n" + "=" * 60)
        print("  Send her this link:  ", tunnel.public_url)
        print("=" * 60 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=args.port)
