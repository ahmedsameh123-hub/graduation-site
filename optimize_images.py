"""
Resize + compress your photos so the site loads fast on her phone.

1) Put ALL your original photos in the  raw_photos/  folder.
   - hero.jpg (exactly "hero")               -> static/images/hero.jpg          (main photo)
   - hero2.jpg, hero3.jpg ... (start hero)   -> static/images/hero/             (extra slideshow photos)
   - then.*, now.*, secret.*                 -> static/images/then.jpg / now.jpg / secret.jpg  (optional surprises)
   - Every other file                        -> static/images/gallery/
2) Run:  python optimize_images.py
"""
import re
from pathlib import Path
from PIL import Image, ImageOps

BASE = Path(__file__).resolve().parent
RAW = BASE / "raw_photos"
OUT_HERO = BASE / "static" / "images"
OUT_HERO_EXTRA = BASE / "static" / "images" / "hero"
OUT_GALLERY = BASE / "static" / "images" / "gallery"
SPECIAL = {"hero", "then", "now", "secret"}
EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}

OUT_GALLERY.mkdir(parents=True, exist_ok=True)
OUT_HERO_EXTRA.mkdir(parents=True, exist_ok=True)

files = sorted(p for p in RAW.iterdir() if p.suffix.lower() in EXT)
if not files:
    print("No photos found in raw_photos/  (put your photos there first)")

for p in files:
    stem = p.stem.lower()
    is_hero = stem.startswith("hero")
    is_special = stem in SPECIAL  # hero / then / now / secret
    max_side = 2000 if (is_hero or is_special) else 1600
    is_main_hero = is_special
    out_name = f"{stem}.jpg" if is_special else re.sub(r"[^\w\-]+", "_", p.stem) + ".jpg"
    if is_main_hero:
        out_path = OUT_HERO / out_name
    elif is_hero:
        out_path = OUT_HERO_EXTRA / out_name
    else:
        out_path = OUT_GALLERY / out_name

    with Image.open(p) as img:
        img = ImageOps.exif_transpose(img)  # fix phone rotation
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.thumbnail((max_side, max_side), Image.LANCZOS)
        img.save(out_path, "JPEG", quality=82, optimize=True, progressive=True)

    before = p.stat().st_size / 1024
    after = out_path.stat().st_size / 1024
    print(f"{p.name:30s} {before:8.0f} KB -> {after:6.0f} KB   ({out_path.relative_to(BASE)})")

print("\nDone. Refresh the website.")
