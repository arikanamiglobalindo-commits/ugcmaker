# UGC Video Maker

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white)
![EJS](https://img.shields.io/badge/EJS-templates-B4CA65)
![License](https://img.shields.io/badge/license-MIT-blue)

<img width="3092" height="933" alt="a" src="https://github.com/user-attachments/assets/01576cc4-ecae-440a-83ad-a3072dabc3f2" />

<p></p>
UGC Video Maker is a local-first web application for generating affiliate-style UGC videos with the Seedance 2.5 model through the KIE AI API. It is designed for creators, affiliate teams, and product marketers who need a simple workflow: upload product references, choose a creator/background reference, write a short script, and generate a ready-to-review video.

Need an API key? Get one from the <a href="https://kie.ai/api-key" target="_blank">KIE AI dashboard</a>. If you enable an IP whitelist on the key, add the IP of the machine running this app.

## Features

- Product, creator, and background image references
- KIE AI models: Seedance 2.5 / 2.0 / 2.0 Fast / 2.0 Mini, Kling 4.0 / 4.0 Flash / 3.0 / 3.0 Turbo, Vidu Q4 and MiniMax H3
- Selectable ElevenLabs creator voice (via KIE AI) for Seedance, Kling 4.0, Vidu Q4 and MiniMax H3
- UGC presets such as product demo, unboxing, testimonial, ASMR, and affiliate selling
- Configurable language, voice tone, music, resolution, ratio, and duration
- Editable advanced prompt with visual reference mentions
- Queue-based batch generation workflow
- Local video download after generation
- Local thumbnail capture for generated videos
- History gallery with playable video modal
- SQLite persistence for settings, assets, queue items, and completed videos
- Real-person reference fallback using a subtle diagonal pattern retry

## Tech Stack

- Node.js
- Express
- EJS
- SQLite via `better-sqlite3`
- Multer for image uploads
- Sharp for reference-image preprocessing
- Vanilla JavaScript and CSS

## Requirements

- Node.js 18 or newer
- npm
- KIE AI API key with credits

## Getting Started

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Open the local app:

```txt
http://localhost:3000
```

For development with auto-reload:

```bash
npm run dev
```

## Configuration

Open the Settings page inside the app and configure:

- KIE AI API key
- API base URL
- Default model
- Default resolution
- Default aspect ratio

Default API base URL:

```txt
https://api.kie.ai
```

Reference images are uploaded to KIE AI's temporary file storage (`kieai.redpandaai.co`, deleted after 24 hours) because the API only accepts image URLs.

The API key is stored in the local SQLite database. Do not commit the database file to a public repository.

## Project Structure

```txt
.
├── database.js          # SQLite schema and data helpers
├── server.js            # Express app entry point
├── routes/              # Page and API routes
├── services/            # KIE AI (Seedance 2.5) API and local media helpers
├── views/               # EJS pages and partials
├── public/              # CSS, client-side JS, and static images
├── uploads/             # User-uploaded reference images
├── downloads/           # Locally saved videos and thumbnails
└── data/                # Local SQLite database
```

## Local Data

This project is intended to run locally. Uploaded assets, generated videos, thumbnails, and the SQLite database are stored on the same machine:

- `uploads/`
- `downloads/`
- `data/ugc.db`

These directories may contain private user images, generated videos, and API configuration, so they are ignored by Git.

## Notes

- Keep generated media and API credentials private when sharing the project.
- Use product images with clear lighting and minimal clutter for more consistent results.
- Review model usage and pricing at https://kie.ai/pricing before running large batches.
