# backend/app.py
from flask import Flask, request, jsonify, send_file, send_from_directory, session, redirect, url_for, render_template
from flask_cors import CORS
from flask_sock import Sock
import cv2
import face_recognition
import numpy as np
import sqlite3
import pickle
import os
import base64
import json
from werkzeug.utils import secure_filename
from openai import OpenAI
import threading
import websocket
from dotenv import load_dotenv
  


app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'default-secret-key')
CORS(app)  # Enable CORS for development
sock = Sock(app)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AVATAR_DIR = os.path.join(BASE_DIR, 'backend/avatar')
# Configuration
app.config['UPLOAD_FOLDER'] = 'resumes'
app.config['ALLOWED_EXTENSIONS'] = {'pdf'}
app.config['DATABASE'] = 'users.db'
app.config['AVATAR_DIR'] = AVATAR_DIR # Path to your avatar app files
app.config['TTS_SERVER_URL'] = 'ws://localhost:3001'

# Initialize OpenAI
load_dotenv() 
openai_api_key = os.environ.get('OPENAI_API_KEY')
client = OpenAI(api_key=openai_api_key)
# Database setup
def setup_database():
    conn = sqlite3.connect(app.config['DATABASE'])
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users 
                 (user_id INTEGER PRIMARY KEY, name TEXT, face_encoding BLOB, resume_path TEXT)''')
    conn.commit()
    conn.close()

# Load known users from database
def load_known_users():
    conn = sqlite3.connect(app.config['DATABASE'])
    c = conn.cursor()
    c.execute("SELECT user_id, name, face_encoding, resume_path FROM users")
    rows = c.fetchall()
    conn.close()
    
    known_encodings = []
    known_names = []
    known_ids = []
    known_resumes = []
    for row in rows:
        user_id, name, encoding_blob, resume_path = row
        encoding = pickle.loads(encoding_blob)
        known_ids.append(user_id)
        known_names.append(name)
        known_encodings.append(encoding)
        known_resumes.append(resume_path)
    return known_ids, known_names, known_encodings, known_resumes

# Save new user to database
def save_new_user(name, encoding, resume_path):
    conn = sqlite3.connect(app.config['DATABASE'])
    c = conn.cursor()
    encoding_blob = pickle.dumps(encoding)
    c.execute("INSERT INTO users (name, face_encoding, resume_path) VALUES (?, ?, ?)", 
              (name, encoding_blob, resume_path))
    conn.commit()
    conn.close()

# Initialize database and known users
setup_database()
known_ids, known_names, known_encodings, known_resumes = load_known_users()

# Helper functions
def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def process_image(image_data):
    # Convert base64 image data to OpenCV format
    header, encoded = image_data.split(",", 1) if "," in image_data else ("", image_data)
    binary_data = base64.b64decode(encoded)
    np_arr = np.frombuffer(binary_data, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    
    # Resize and convert to RGB
    small_frame = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)
    return cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

# API Routes - Face Recognition
@app.route('/api/recognize', methods=['POST'])
def recognize():
    data = request.json
    if not data or 'image' not in data:
        return jsonify({'status': 'error', 'message': 'No image provided'}), 400

    try:
        frame = process_image(data['image'])
        
        # Face detection
        face_locations = face_recognition.face_locations(frame)
        if not face_locations:
            return jsonify({'status': 'no_face', 'message': 'No face detected'})
        
        # Face recognition
        face_encodings = face_recognition.face_encodings(frame, face_locations)
        for face_encoding in face_encodings:
            matches = face_recognition.compare_faces(known_encodings, face_encoding, tolerance=0.6)
            
            if True in matches:
                first_match_index = matches.index(True)
                name = known_names[first_match_index]
                # Store user in session
                session['user_name'] = name
                session['authenticated'] = True
                return jsonify({'status': 'known', 'name': name})
        
        # Unknown face
        return jsonify({'status': 'unknown', 'message': 'Unknown user detected'})
    
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/signup', methods=['POST'])
def signup():
    try:
        name = request.form.get('name')
        image_data = request.form.get('image_data')
        resume = request.files.get('resume')
        
        if not name:
            return jsonify({'status': 'error', 'message': 'Name is required'}), 400
        
        if not resume or not allowed_file(resume.filename):
            return jsonify({'status': 'error', 'message': 'Valid resume (PDF) required'}), 400
        
        # Process image
        frame = process_image(image_data)
        face_encodings = face_recognition.face_encodings(frame)
        
        if not face_encodings:
            return jsonify({'status': 'error', 'message': 'No face detected in captured image'}), 400
        
        # Save resume
        filename = secure_filename(resume.filename)
        resume_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        resume.save(resume_path)
        
        # Save new user
        save_new_user(name, face_encodings[0], resume_path)
        
        # Update known users
        global known_ids, known_names, known_encodings, known_resumes
        new_id = max(known_ids) + 1 if known_ids else 1
        known_ids.append(new_id)
        known_names.append(name)
        known_encodings.append(face_encodings[0])
        known_resumes.append(resume_path)
        
        # Store user in session
        session['user_name'] = name
        session['authenticated'] = True
        return jsonify({'status': 'success', 'name': name})
    
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/resume/<filename>', methods=['GET'])
def download_resume(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)



@app.route('/avatar/api/chat', methods=['POST'])
def avatar_chat():
    """ChatGPT endpoint for avatar with user context"""
    if not session.get('authenticated'):
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.json
        user_message = data.get('message')
        user_name = session['user_name']
        
        if not user_message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Add user context to prompt
        prompt = f"You are speaking with {user_name}. "
        
        # Add resume content if available
        try:
            user_index = known_names.index(user_name)
            resume_path = known_resumes[user_index]
            if resume_path and os.path.exists(resume_path):
                with open(resume_path, 'r') as f:
                    resume_content = f.read(2000)  # Read first 2000 characters
                    prompt += f"Here is some information about them: {resume_content}\n\n"
        except (ValueError, IndexError):
            pass
        
        prompt += f"User: {user_message}"
        
        # Call ChatGPT
        
        response = client.responses.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )

        assistant_response = response.choices[0].message.content
        return jsonify({'response': assistant_response})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# TTS WebSocket Proxy
@sock.route('/tts-ws')
def tts_proxy(ws):
    """WebSocket proxy to Node.js TTS server"""
    tts_ws = websocket.create_connection(app.config['TTS_SERVER_URL'])
    
    def forward_to_tts():
        while True:
            message = ws.receive()
            if message:
                tts_ws.send(message)
    
    def forward_to_client():
        while True:
            message = tts_ws.recv()
            if message:
                ws.send(message)
    
    # Start forwarding threads
    threading.Thread(target=forward_to_tts, daemon=True).start()
    threading.Thread(target=forward_to_client, daemon=True).start()


AVATAR_DIR = os.path.join(BASE_DIR, 'src', 'Avatar')

@app.route('/avatar/<path:filename>')
def serve_avatar(filename):
    return send_from_directory(AVATAR_DIR, filename)

@app.route('/models/<path:filename>')
def serve_models(filename):
    return send_from_directory(os.path.join(BASE_DIR, 'src', 'models'), filename)

@app.route('/modules/<path:filename>')
def serve_modules(filename):
    return send_from_directory(os.path.join(BASE_DIR, 'src', 'modules'), filename)

# Serve React build in production
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react(path):
    # Only serve React files if they exist
    react_build_path = os.path.join(BASE_DIR, 'frontend', 'build')
    full_path = os.path.join(react_build_path, path)
    
    if path != "" and os.path.exists(full_path) and not os.path.isdir(full_path):
        return send_from_directory(react_build_path, path)
    if path.startswith('avatar/') or path.startswith('models/') or path.startswith('modules/'):
        return serve_avatar(path)
    else:
        # Only return index.html if it exists
        if os.path.exists(os.path.join(react_build_path, 'index.html')):
            return send_from_directory(react_build_path, 'index.html')
        return "Not Found", 404

if __name__ == '__main__':
    app.run(debug=True, port=5000)