# backend/app.py
"""
Unified Flask backend that consolidates the original Flask APIs *and* the Node.js
`server.js` functionality into a single service listening on **port 5000**.

Key features now included
-------------------------
* **Face‑recognition onboarding** (`/api/recognize`, `/api/signup`) – unchanged.
* **Chat endpoints**
  * `/avatar/api/chat` – keeps the personalised résumé logic.
  * `/chat` – a lightweight wrapper mirroring the Node.js version.
* **Text‑to‑speech (ElevenLabs) support**
  * **HTTP** `/tts-proxy` → streams via ElevenLabs REST endpoint.
  * **WebSocket** `/tts‑ws` → full‑duplex proxy to ElevenLabs WS endpoint (or any
    custom URL via `TTS_WS_URL`).
* **Static assets** – serves the old *public/models* and *public/modules* folders
  with the same headers/caching semantics that `server.js` used.
* **Single process, no extra ports** – just run `python app.py` and everything is
  available on <http://localhost:5000> / `ws://localhost:5000/tts-ws`.

Environment variables
---------------------
* `OPENAI_API_KEY` – OpenAI credentials (required).
* `ELEVENLABS_API_KEY` & `VOICE_ID` – for ElevenLabs TTS.
* `TTS_WS_URL` – (optional) override for the ElevenLabs WebSocket URL.
* `SECRET_KEY` – Flask session secret.

Install‑time deps (pip):
```
flask flask-cors flask-sock python-dotenv openai face-recognition opencv-python
numpy websocket-client requests python-dotenv
```
"""

import base64
import json
import os
import pickle
import sqlite3
import threading
from datetime import timedelta

import cv2
import face_recognition
import numpy as np
import requests
import websocket  # websocket‑client
from dotenv import load_dotenv
from flask import (Flask, jsonify, request, send_from_directory, session, abort)
from flask_cors import CORS
from flask_sock import Sock
from openai import OpenAI
from werkzeug.utils import secure_filename

# ---------------------------------------------------------------------------
# Initialisation & configuration
# ---------------------------------------------------------------------------

load_dotenv()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")  # mirrors server.js staticPath
FRONTEND_BUILD = os.path.join(BASE_DIR, "build")
AVATAR_DIR = os.path.join(BASE_DIR, "src", "Avatar")
MODELS_DIR = os.path.join(PUBLIC_DIR, "models")
MODULES_DIR = os.path.join(PUBLIC_DIR, "modules")

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "default-secret-key")
app.permanent_session_lifetime = timedelta(hours=4)

app.config.update(
    SESSION_COOKIE_SAMESITE="None",   # allow cross-site
    SESSION_COOKIE_SECURE= True     # set **True** in prod (HTTPS)
)

CORS(
    app,
    origins="http://localhost:3000",   # exact origin, not "*", so cookies still work
    supports_credentials=True,
)
sock = Sock(app)

# OpenAI client
openai_api_key = os.getenv("OPENAI_API_KEY")
openai_client = OpenAI(api_key=openai_api_key)

# ---------------------------------------------------------------------------
# Database helpers (unchanged)
# ---------------------------------------------------------------------------

app.config.update(
    UPLOAD_FOLDER="resumes",
    ALLOWED_EXTENSIONS={"pdf"},
    DATABASE="users.db",
)

def setup_database():
    conn = sqlite3.connect(app.config["DATABASE"])
    c = conn.cursor()
    c.execute(
        """CREATE TABLE IF NOT EXISTS users (
            user_id      INTEGER PRIMARY KEY,
            name         TEXT,
            face_encoding BLOB,
            resume_path  TEXT
        )"""
    )
    conn.commit()
    conn.close()


def load_known_users():
    conn = sqlite3.connect(app.config["DATABASE"])
    c = conn.cursor()
    c.execute("SELECT user_id, name, face_encoding, resume_path FROM users")
    rows = c.fetchall()
    conn.close()

    ids, names, encodings, resumes = [], [], [], []
    for user_id, name, enc_blob, resume in rows:
        ids.append(user_id)
        names.append(name)
        encodings.append(pickle.loads(enc_blob))
        resumes.append(resume)
    return ids, names, encodings, resumes


def save_new_user(name, encoding, resume_path):
    conn = sqlite3.connect(app.config["DATABASE"])
    c = conn.cursor()
    c.execute(
        "INSERT INTO users (name, face_encoding, resume_path) VALUES (?, ?, ?)",
        (name, pickle.dumps(encoding), resume_path),
    )
    conn.commit()
    conn.close()


# Prepare face‑recog cache on startup
setup_database()
known_ids, known_names, known_encodings, known_resumes = load_known_users()

# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in app.config["ALLOWED_EXTENSIONS"]


def process_image(image_data: str):
    """Convert base64 image data → 1/4‑scaled RGB np.ndarray."""
    header, encoded = image_data.split(",", 1) if "," in image_data else ("", image_data)
    binary_data = base64.b64decode(encoded)
    arr = np.frombuffer(binary_data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    small = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)
    return cv2.cvtColor(small, cv2.COLOR_BGR2RGB)


def send_static_with_headers(directory: str, filename: str, headers: dict):
    response = send_from_directory(directory, filename)
    for k, v in headers.items():
        response.headers[k] = v
    return response

# ---------------------------------------------------------------------------
# Face recognition APIs (unchanged) - MUST BE BEFORE CATCH-ALL
# ---------------------------------------------------------------------------

@app.route("/api/recognize", methods=["POST"])
def recognize():
    data = request.get_json(force=True)
    if not data or "image" not in data:
        return jsonify({"status": "error", "message": "No image provided"}), 400

    frame = process_image(data["image"])
    face_locations = face_recognition.face_locations(frame)
    if not face_locations:
        return jsonify({"status": "no_face", "message": "No face detected"})

    for enc in face_recognition.face_encodings(frame, face_locations):
        matches = face_recognition.compare_faces(known_encodings, enc, tolerance=0.6)
        if True in matches:
            idx = matches.index(True)
            session["user_name"]=known_names[idx]
            session["authenticated"]=True # type: ignore
            return jsonify({"status": "known", "name": known_names[idx]})

    return jsonify({"status": "unknown", "message": "Unknown user detected"})


@app.route("/api/signup", methods=["POST"])
def signup():
    try:
        name = request.form.get("name")
        image_data = request.form.get("image_data")
        resume = request.files.get("resume")

        if not name:
            return jsonify({"status": "error", "message": "Name is required"}), 400
        if not resume or not allowed_file(resume.filename):
            return jsonify({"status": "error", "message": "Valid resume (PDF) required"}), 400

        frame = process_image(image_data)
        encodings = face_recognition.face_encodings(frame)
        if not encodings:
            return jsonify({"status": "error", "message": "No face detected"}), 400

        os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
        file_path = os.path.join(app.config["UPLOAD_FOLDER"], secure_filename(resume.filename))
        resume.save(file_path)

        save_new_user(name, encodings[0], file_path)
        global known_ids, known_names, known_encodings, known_resumes
        new_id = max(known_ids or [0]) + 1
        known_ids.append(new_id)
        known_names.append(name)
        known_encodings.append(encodings[0])
        known_resumes.append(file_path)

        session["user_name"]=name 
        session[authenticated]=True  # type: ignore
        return jsonify({"status": "success", "name": name})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    

@app.route('/api/username', methods=['GET'])
def get_username():
    if not session.get("authenticated") or "user_name" not in session:
        return jsonify({"error": "Not authenticated"}), 401
    return jsonify({"name": session["user_name"]})


@app.route("/api/resume/<path:filename>")
def download_resume(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

# ---------------------------------------------------------------------------
# Chat endpoints - MUST BE BEFORE CATCH-ALL
# ---------------------------------------------------------------------------

@app.route("/avatar/api/chat", methods=["POST"])
def avatar_chat():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(force=True)
    user_message = data.get("message")
    if not user_message:
        return jsonify({"error": "Message is required"}), 400

    user_name = session["user_name"]
    prompt_parts = [f"You are speaking with {user_name}."]

    try:
        idx = known_names.index(user_name)
        resume_path = known_resumes[idx]
        if resume_path and os.path.exists(resume_path):
            with open(resume_path, "r", errors="ignore") as fh:
                prompt_parts.append("Here is some information about them: " + fh.read(2000))
    except ValueError:
        pass

    prompt_parts.append(f"User: {user_message}")

    response = openai_client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": "\n\n".join(prompt_parts)}],
        temperature=0.7,
    )
    assistant = response.choices[0].message.content
    return jsonify({"response": assistant})


@app.route("/chat", methods=["POST"])
def simple_chat():
    """Lightweight endpoint migrated from server.js."""
    data = request.get_json(force=True)
    user_message = data.get("message")
    if not user_message:
        return jsonify({"error": "Message is required"}), 400

    response = openai_client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": user_message}],
        temperature=0.7,
    )
    assistant = response.choices[0].message.content
    return jsonify({"response": assistant})

# ---------------------------------------------------------------------------
# ElevenLabs TTS – HTTP proxy & WS bridge - MUST BE BEFORE CATCH-ALL
# ---------------------------------------------------------------------------


def _elevenlabs_headers(api_key: str):
    return {
        "Content-Type": "application/json",
        "xi-api-key": api_key,
    }


@app.route("/tts-proxy", methods=["POST"])
def tts_proxy():
    """HTTP proxy that mirrors server.js `/tts-proxy`."""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    voice_id = os.environ.get("VOICE_ID")
    if not api_key or not voice_id:
        return jsonify({"error": "Missing ELEVENLABS_API_KEY or VOICE_ID"}), 500

    try:
        payload = request.get_json(force=True)
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
        r = requests.post(url, headers=_elevenlabs_headers(api_key), json=payload, timeout=30)
        if r.status_code != 200:
            return jsonify({"error": r.text}), r.status_code
        # ElevenLabs returns audio bytes; stream them back
        # For simplicity we forward the entire JSON response (mirrors server.js)
        return jsonify(r.json())
    except Exception as exc:
        return jsonify({"error": f"TTS Proxy failed: {exc}"}), 500


@sock.route("/tts-ws")
def tts_ws_proxy(ws):
    """Bidirectional WebSocket proxy to ElevenLabs (or custom) endpoint."""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    voice_id = os.environ.get("VOICE_ID")
    remote_url = os.environ.get(
        "TTS_WS_URL",
        f"wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream",
    )
    if not api_key or not voice_id:
        ws.send(json.dumps({"error": "TTS credentials not configured"}))
        ws.close()
        return

    remote_ws = websocket.create_connection(remote_url, header=[f"xi-api-key: {api_key}"])

    def _client_to_tts():
        while True:
            try:
                msg = ws.receive()
                if msg is None:
                    break
                remote_ws.send(msg)
            except Exception:
                break
        remote_ws.close()

    def _tts_to_client():
        while True:
            try:
                msg = remote_ws.recv()
                if msg is None:
                    break
                ws.send(msg)
            except Exception:
                break
        ws.close()

    threading.Thread(target=_client_to_tts, daemon=True).start()
    threading.Thread(target=_tts_to_client, daemon=True).start()

# ---------------------------------------------------------------------------
# Static asset routes – mirrors Node.js behaviour - MUST BE BEFORE CATCH-ALL
# ---------------------------------------------------------------------------

@app.route("/models/<path:filename>")
def serve_models(filename):
    return send_static_with_headers(
        MODELS_DIR,
        filename,
        {
            "Content-Type": "model/gltf-binary",
            "Cache-Control": "public, max-age=31536000",
        },
    )


@app.route("/modules/<path:filename>")
def serve_modules(filename):
    return send_static_with_headers(
        MODULES_DIR,
        filename,
        {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-store",
        },
    )


# Generic static: anything else under /public
@app.route("/public/<path:filename>")
def serve_public(filename):
    return send_from_directory(PUBLIC_DIR, filename)

# ---------------------------------------------------------------------------
# React SPA fallback - MUST BE LAST TO AVOID INTERCEPTING API ROUTES
# ---------------------------------------------------------------------------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def catch_all(path):
    # IMPORTANT: Let /api/* routes hit your real endpoints FIRST
    # This catch-all should only handle non-API routes
    if path.startswith("api/"):
        print(f"API route {path} reached catch-all - this shouldn't happen!")
        return abort(404)

    # Allow special prefixes first…
    if path.startswith("models/") or path.startswith("modules/"):
        return app.send_static_file(path)

    full = os.path.join(FRONTEND_BUILD, path)
    if path and os.path.exists(full) and not os.path.isdir(full):
        return send_from_directory(FRONTEND_BUILD, path)

    return send_from_directory(FRONTEND_BUILD, "index.html")

# ---------------------------------------------------------------------------
# Debug route to check server status
# ---------------------------------------------------------------------------

@app.route("/api/health")
def health_check():
    """Simple health check endpoint."""
    return jsonify({
        "status": "healthy",
        "session": dict(session),
        "authenticated": session.get("authenticated", False)
    })

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Starting Flask server on http://localhost:5000")
    print("Available API endpoints:")
    print("  GET  /api/health")
    print("  GET  /api/username") 
    print("  POST /api/recognize")
    print("  POST /api/signup")
    print("  POST /chat")
    print("  POST /avatar/api/chat")
    print("  POST /tts-proxy")
    print("  WS   /tts-ws")
    app.run(debug=True, port=5000)