# Jana - Graduation Surprise

## Folder structure

```
jana/
├── main.py                  <- FastAPI server (don't edit)
├── config.json              <- ALL texts, Arabic ("ar") + English ("en")
├── requirements.txt
├── optimize_images.py       <- optional: shrinks photos so the site loads fast
├── raw_photos/              <- put ORIGINAL photos here (for optimize_images.py)
└── static/
    ├── index.html  css/style.css  js/script.js
    ├── music/               <- ONE song: song.mp3 (optional)
    └── images/
        ├── hero.jpg         <- main photo in the arch frame
        ├── hero/            <- optional: hero2.jpg, hero3.jpg ... (slideshow inside the arch)
        ├── gallery/         <- ALL gallery photos: 1.jpg, 2.jpg, 3.jpg ... (any number)
        ├── then.jpg         <- optional: "then" photo   (before/after slider)
        ├── now.jpg          <- optional: "now" photo    (before/after slider)
        └── secret.jpg       <- optional: photo hidden under the scratch card
```

## Run

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```
Open http://127.0.0.1:8000

## Share with ngrok (2nd terminal)

```powershell
ngrok config add-authtoken YOUR_TOKEN     # only once
ngrok http 8000
```
Send her the https://....ngrok-free.app link.
To open the English version directly: add `?lang=en` to the link.

Or in one command: `python main.py --share`
