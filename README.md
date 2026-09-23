# MediTrack — Medication Management System

A complete React + Vite + FastAPI medication management app with:
- Signup/login/logout using JWT
- SQLite database
- Medication CRUD and dose tracking
- Persistent notifications with unread badge
- Prescription upload endpoint
- Gemini API integration for prescription image analysis
- Responsive dashboard with animations
- PWA manifest + service worker for installable web app
- Browser notification support when permitted

## Project structure

MediTrack/
  backend/
    app/
      main.py
    .env.example
    requirements.txt
  frontend/
    src/
      App.jsx
      api.js
      main.jsx
      styles.css
    public/
      manifest.webmanifest
      sw.js
      icon.svg
    index.html
    package.json
    vite.config.js

## Backend setup

PowerShell:

cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

Copy `.env.example` to `.env` and put your Gemini key there:

GEMINI_API_KEY=YOUR_GEMINI_KEY_HERE

Then run:

python -m uvicorn app.main:app --reload --port 8000

API docs:
http://127.0.0.1:8000/docs

## Frontend setup

Open another terminal:

cd frontend
npm install
npm run dev

Open the URL Vite prints, normally:
http://localhost:5173

## Gemini key

Keep the Gemini key in `backend/.env`, never in React source code. The backend reads GEMINI_API_KEY and calls Gemini server-side.

## PWA / installable app

After deploying the frontend over HTTPS, supported browsers can offer an Install App option because the project includes a web app manifest and service worker. Users can keep using the normal website or install it as an app-like PWA.

This does not create a native .exe or Android APK. If you later want those, the same web app can be packaged with a desktop/mobile wrapper such as Tauri/Electron/Capacitor.

## Important

This is a functional development-ready foundation, not a medical device. AI prescription extraction must be reviewed by a human before medication data is trusted or used clinically.
