import cv2
import face_recognition
import firebase_admin
from firebase_admin import credentials, db
import os
import numpy as np
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import base64
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import time
import threading
import urllib.request
import urllib.parse

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Global variable to store the camera stream
camera_stream = None

def generate_frames():
    global camera_stream
    while True:
        if camera_stream is None:
            time.sleep(0.1)
            continue
            
        success, frame = camera_stream.read()
        if not success:
            print("Failed to read frame from camera")
            time.sleep(0.1)
            continue
            
        # Convert frame to JPEG
        ret, buffer = cv2.imencode('.jpg', frame)
        if not ret:
            continue
            
        # Convert to bytes
        frame_bytes = buffer.tobytes()
        
        # Yield the frame in MJPEG format
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/start_stream', methods=['POST'])
def start_stream():
    global camera_stream
    try:
        data = request.get_json()
        ip_camera_url = data.get('camera_url')
        
        if not ip_camera_url:
            return jsonify({'status': 'error', 'message': 'Camera URL is required'}), 400
            
        # Decode the URL
        ip_camera_url = urllib.parse.unquote(ip_camera_url)
        print(f"Starting stream with URL: {ip_camera_url}")
        
        # Release existing stream if any
        if camera_stream is not None:
            camera_stream.release()
            
        # Configure VideoCapture for RTSP stream
        camera_stream = cv2.VideoCapture(ip_camera_url)
        
        # Set buffer size
        camera_stream.set(cv2.CAP_PROP_BUFFERSIZE, 3)
        
        if not camera_stream.isOpened():
            return jsonify({'status': 'error', 'message': 'Failed to open camera stream'}), 500
            
        return jsonify({'status': 'success', 'message': 'Stream started successfully'})
        
    except Exception as e:
        print(f"Error starting stream: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

def generate_frames():
    global camera_stream
    while True:
        if camera_stream is None:
            time.sleep(0.1)
            continue
            
        success, frame = camera_stream.read()
        if not success:
            print("Failed to read frame from camera")
            time.sleep(0.1)
            continue
            
        try:
            # Process frame for face recognition
            face_system = FaceRecognitionSystem()
            detections = face_system.process_frame(frame)
            
            # Draw detection boxes
            for detection in detections:
                if 'location' in detection:
                    h, w = frame.shape[:2]
                    top = int((detection['location']['top'] * h) / 100)
                    right = int((detection['location']['right'] * w) / 100)
                    bottom = int((detection['location']['bottom'] * h) / 100)
                    left = int((detection['location']['left'] * w) / 100)
                    
                    # Draw rectangle for face
                    cv2.rectangle(frame, (left, top), (right, bottom), (0, 255, 0), 2)
            
            # Convert frame to JPEG with lower quality for better performance
            encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 80]
            ret, buffer = cv2.imencode('.jpg', frame, encode_param)
            if not ret:
                continue
                
            # Convert to bytes
            frame_bytes = buffer.tobytes()
            
            # Yield the frame in MJPEG format
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                   
        except Exception as e:
            print(f"Error processing frame: {str(e)}")
            time.sleep(0.1)

@app.route('/stop_stream', methods=['POST'])
def stop_stream():
    global camera_stream
    try:
        if camera_stream is not None:
            camera_stream.release()
            camera_stream = None
        return jsonify({'status': 'success', 'message': 'Stream stopped successfully'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

def download_cascade_classifier():
    """Download the cascade classifier if not present"""
    model_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(model_dir, exist_ok=True)
    
    cascade_path = os.path.join(model_dir, 'haarcascade_frontalface_default.xml')
    if not os.path.exists(cascade_path):
        print("Downloading cascade classifier...")
        url = "https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_default.xml"
        try:
            urllib.request.urlretrieve(url, cascade_path)
            print("✅ Downloaded cascade classifier")
        except Exception as e:
            print(f"❌ Failed to download cascade classifier: {str(e)}")
            return False
    return True

# Download cascade classifier before initializing the system
if not download_cascade_classifier():
    print("⚠️ Cascade classifier not available, face detection may be slower")

# Initialize Firebase
cred = credentials.Certificate("firebase-key.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://nova-dristi-default-rtdb.firebaseio.com/'
})

class FaceRecognitionSystem:
    def __init__(self):
        self.staff_faces = []
        self.known_faces = []
        self.firebase_ref = db.reference('/')
        self.face_modification_times = {}  # Track modification times of face files
        self.load_face_data()
        self.setup_gender_model()
        self.setup_file_watcher()
        self.frame_counter = 0
        self.previous_faces = []
        
        # Initialize Cascade Classifier
        cascade_path = os.path.join(os.path.dirname(__file__), 'models', 'haarcascade_frontalface_default.xml')
        self.face_cascade = cv2.CascadeClassifier(cascade_path)
        if self.face_cascade.empty():
            print("⚠️ Failed to load cascade classifier")
        else:
            print("✅ Loaded cascade classifier")

    def setup_gender_model(self):
        # Gender detection model initialization
        model_dir = os.path.join(os.path.dirname(__file__), 'models')
        self.gender_net = cv2.dnn.readNetFromCaffe(
            os.path.join(model_dir, 'deploy_gender.prototxt'),
            os.path.join(model_dir, 'gender_net.caffemodel')
        )
        self.gender_list = ['Male', 'Female']

    def setup_file_watcher(self):
        """Set up watchers for the faces directories"""
        class FaceDirectoryHandler(FileSystemEventHandler):
            def __init__(self, face_system):
                self.face_system = face_system

            def on_created(self, event):
                if not event.is_directory and event.src_path.lower().endswith(('.png', '.jpg', '.jpeg')):
                    print(f"🔄 New face image detected: {event.src_path}")
                    self.face_system.update_single_face(event.src_path)

            def on_modified(self, event):
                if not event.is_directory and event.src_path.lower().endswith(('.png', '.jpg', '.jpeg')):
                    print(f"🔄 Face image modified: {event.src_path}")
                    self.face_system.update_single_face(event.src_path)

            def on_deleted(self, event):
                if not event.is_directory and event.src_path.lower().endswith(('.png', '.jpg', '.jpeg')):
                    print(f"🗑️ Face image deleted: {event.src_path}")
                    self.face_system.remove_face(event.src_path)

        event_handler = FaceDirectoryHandler(self)
        observer = Observer()
        
        for category in ['staff', 'customers']:
            dir_path = os.path.join('faces', category)
            if os.path.exists(dir_path):
                observer.schedule(event_handler, dir_path, recursive=False)
                print(f"👀 Watching directory: {dir_path}")

        observer.start()
        print("✅ File watcher initialized")

    def update_single_face(self, image_path):
        """Update a single face in the system"""
        try:
            # Determine category from path
            category = 'staff' if 'staff' in image_path else 'customers'
            file = os.path.basename(image_path)
            name = os.path.splitext(file)[0]
            
            # Load and encode the face
            image = face_recognition.load_image_file(image_path)
            encodings = face_recognition.face_encodings(image)
            
            if not encodings:
                print(f"⚠️ No faces found in {file}")
                return
            
            # Update the face data
            target = self.staff_faces if category == 'staff' else self.known_faces
            
            # Remove existing face if present
            target[:] = [face for face in target if face['name'] != name]
            
            # Add new face
            target.append({
                'name': name,
                'encoding': encodings[0]
            })
            
            # Update Firebase
            existing_data = self.firebase_ref.child(category).child(name.lower().replace(' ', '_')).get() or {}
            firebase_data = {
                **existing_data,
                'name': name,
                'imagePath': f'/faces/{category}/{file}',
                'lastUpdated': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            
            if category == 'customers':
                if 'visitCount' not in firebase_data:
                    firebase_data['visitCount'] = 0
                if 'lastVisit' not in firebase_data:
                    firebase_data['lastVisit'] = None
            else:
                if 'lastVisit' not in firebase_data:
                    firebase_data['lastVisit'] = None
            
            self.firebase_ref.child(category).child(name.lower().replace(' ', '_')).update(firebase_data)
            print(f"✅ Updated face: {name}")
            
        except Exception as e:
            print(f"❌ Error updating face {image_path}: {str(e)}")

    def remove_face(self, image_path):
        """Remove a face from the system"""
        try:
            category = 'staff' if 'staff' in image_path else 'customers'
            file = os.path.basename(image_path)
            name = os.path.splitext(file)[0]
            
            # Remove from memory
            target = self.staff_faces if category == 'staff' else self.known_faces
            target[:] = [face for face in target if face['name'] != name]
            
            # Remove from Firebase
            self.firebase_ref.child(category).child(name.lower().replace(' ', '_')).delete()
            print(f"✅ Removed face: {name}")
            
        except Exception as e:
            print(f"❌ Error removing face {image_path}: {str(e)}")

    def load_face_data(self):
        """Initial load of all face data"""
        print("Loading face data...")
        
        # Clear existing face data
        self.known_faces = []
        self.staff_faces = []
        self.face_modification_times = {}
        
        # Initialize visits if not exists
        visits_ref = self.firebase_ref.child('visits')
        if not visits_ref.get():
            initial_visits = {
                'init': {
                    'name': 'System',
                    'category': 'system',
                    'time': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    'type': 'System Initialization'
                }
            }
            visits_ref.set(initial_visits)
            print("✅ Initialized visits node in Firebase")
        
        for category in ['staff', 'customers']:
            dir_path = os.path.join('faces', category)
            if not os.path.exists(dir_path):
                print(f"⚠️ Missing directory: {dir_path}")
                continue

            print(f"🔍 Scanning {dir_path}...")
            for file in os.listdir(dir_path):
                if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                    try:
                        image_path = os.path.join(dir_path, file)
                        # Store modification time
                        self.face_modification_times[image_path] = os.path.getmtime(image_path)
                        
                        image = face_recognition.load_image_file(image_path)
                        encodings = face_recognition.face_encodings(image)
                        if encodings:
                            name = os.path.splitext(file)[0]
                            
                            target = self.staff_faces if category == 'staff' else self.known_faces
                            target.append({
                                'name': name,
                                'encoding': encodings[0]
                            })
                            
                            # Get existing data to preserve other fields
                            existing_data = self.firebase_ref.child(category).child(name.lower().replace(' ', '_')).get() or {}
                            
                            firebase_data = {
                                **existing_data,
                                'name': name,
                                'imagePath': f'/faces/{category}/{file}',
                                'lastUpdated': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            }
                            
                            # Set default values only if they don't exist
                            if category == 'customers':
                                if 'visitCount' not in firebase_data:
                                    firebase_data['visitCount'] = 0
                                if 'lastVisit' not in firebase_data:
                                    firebase_data['lastVisit'] = None
                            else:
                                if 'lastVisit' not in firebase_data:
                                    firebase_data['lastVisit'] = None
                            
                            self.firebase_ref.child(category).child(name.lower().replace(' ', '_')).update(firebase_data)
                            print(f"✅ Loaded and saved {file}")
                        else:
                            print(f"⚠️ No faces found in {file}")
                    except Exception as e:
                        print(f"❌ Error loading {file}: {str(e)}")

        print(f"\n📊 Loaded {len(self.staff_faces)} staff and {len(self.known_faces)} customers")

    def should_log_visit(self, name: str, category: str) -> bool:
        """Check if a visit should be logged based on time constraints"""
        try:
            ref = self.firebase_ref.child(category).child(name.lower().replace(' ', '_'))
            data = ref.get()
            
            if not data:
                return True
                
            last_visit = data.get('lastVisit')
            if not last_visit:
                return True
                
            last_visit_time = datetime.strptime(last_visit, "%Y-%m-%d %H:%M:%S")
            current_time = datetime.now()
            
            if category == 'staff':
                return last_visit_time.date() < current_time.date()
            elif category == 'customers':
                # For customers, only log once per day
                return last_visit_time.date() < current_time.date()
            else:
                # For unknown visitors, use 2 second cooldown
                time_diff = current_time - last_visit_time
                return time_diff > timedelta(seconds=2)
                
        except Exception as e:
            print(f"Error checking visit time: {str(e)}")
            return True

    def detect_faces_cascade(self, frame):
        """Detect faces using cascade classifier"""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.05,  # More precise scaling
            minNeighbors=7,    # Increased from 5 to 7 for better accuracy
            minSize=(40, 40),  # Increased minimum face size
            flags=cv2.CASCADE_SCALE_IMAGE
        )
        return faces

    def process_frame(self, frame):
        """Process a single frame for face recognition"""
        # Skip every other frame
        self.frame_counter += 1
        if self.frame_counter % 2 != 0:
            return []

        # Reduce resolution for faster processing
        frame = cv2.resize(frame, (640, 480))
        
        # Convert to RGB for face_recognition
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Detect faces using face_recognition library
        face_locations = face_recognition.face_locations(rgb_frame, model="hog")
        
        # Get face encodings
        face_encodings = face_recognition.face_encodings(rgb_frame, face_locations, num_jitters=2)
        
        # Store current faces for next frame
        self.previous_faces = face_locations
        
        self.firebase_ref.child('currentDetections').delete()
        
        detections = []
        for idx, (top, right, bottom, left) in enumerate(face_locations):
            if idx < len(face_encodings):
                face_encoding = face_encodings[idx]
                
                # Extract face region for gender detection
                face_img = frame[top:bottom, left:right]
                
                frame_height, frame_width = frame.shape[:2]
                detection = {
                    'location': {
                        'top': (top / frame_height) * 100,
                        'right': (right / frame_width) * 100,
                        'bottom': (bottom / frame_height) * 100,
                        'left': (left / frame_width) * 100
                    }
                }

                # Check staff first with increased tolerance
                matches = face_recognition.compare_faces([sf['encoding'] for sf in self.staff_faces], face_encoding, tolerance=0.4)
                if True in matches:
                    staff_index = matches.index(True)
                    system_name = self.staff_faces[staff_index]['name']
                    # Get the original name from Firebase
                    staff_data = self.firebase_ref.child('staff').child(system_name.lower().replace(' ', '_')).get()
                    display_name = staff_data.get('name') if staff_data and staff_data.get('name') else system_name
                    greeting = f"Hello {display_name}, welcome back to AstroNova!"
                    detection.update({
                        'name': display_name,
                        'type': 'staff',
                        'greeting': greeting
                    })
                    
                    if self.should_log_visit(system_name, 'staff'):
                        self.log_visit(display_name, 'staff')
                        self.firebase_ref.child('staff').child(system_name.lower().replace(' ', '_')).update({
                            'lastVisit': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            'name': display_name
                        })
                else:
                    # Then check customers with increased tolerance
                    matches = face_recognition.compare_faces([cf['encoding'] for cf in self.known_faces], face_encoding, tolerance=0.4)
                    if True in matches:
                        customer_index = matches.index(True)
                        system_name = self.known_faces[customer_index]['name']
                        # Get the original name from Firebase
                        customer_data = self.firebase_ref.child('customers').child(system_name.lower().replace(' ', '_')).get()
                        display_name = customer_data.get('name') if customer_data and customer_data.get('name') else system_name
                        greeting = f"Hello {display_name}, welcome back to AstroNova!"
                        detection.update({
                            'name': display_name,
                            'type': 'customer',
                            'greeting': greeting
                        })
                        
                        if self.should_log_visit(system_name, 'customers'):
                            self.log_visit(display_name, 'customer')
                            customer_ref = self.firebase_ref.child('customers').child(system_name.lower().replace(' ', '_'))
                            current_visits = customer_ref.child('visitCount').get() or 0
                            customer_ref.update({
                                'visitCount': current_visits + 1,
                                'lastVisit': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                'name': display_name
                            })
                    else:
                        # For unknown faces, detect gender and check cooldown
                        unknown_ref = self.firebase_ref.child('unknown_visitors')
                        last_unknown_greeting = unknown_ref.child('last_greeting').get()
                        current_time = datetime.now()
                        should_greet = True

                        if last_unknown_greeting:
                            last_time = datetime.strptime(last_unknown_greeting, "%Y-%m-%d %H:%M:%S")
                            if (current_time - last_time) < timedelta(seconds=2):
                                should_greet = False

                        gender = self.detect_gender(face_img)
                        honorific = "ma'am" if gender == "Female" else "sir"
                        greeting = f"Welcome to AstroNova, {honorific}! How may we assist you today?" if should_greet else ""
                        
                        detection.update({
                            'name': 'Unknown',
                            'type': 'unknown',
                            'gender': gender,
                            'greeting': greeting
                        })
                        
                        if should_greet:
                            # Update last greeting time and log visit
                            unknown_ref.update({
                                'last_greeting': current_time.strftime("%Y-%m-%d %H:%M:%S")
                            })
                            self.log_visit('Unknown', 'unknown')
                            
                            # Extract and save unknown face after greeting
                            try:
                                # Create extracted_faces directory if it doesn't exist
                                extracted_faces_dir = os.path.join('faces', 'extracted_faces')
                                os.makedirs(extracted_faces_dir, exist_ok=True)
                                
                                # Generate filename with timestamp
                                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                                filename = f"face_{timestamp}.jpg"
                                filepath = os.path.join(extracted_faces_dir, filename)
                                
                                # Save the face image
                                success = cv2.imwrite(filepath, face_img)
                                if success:
                                    print(f"✅ Saved unknown face to {filepath}")
                                    detection['imageSrc'] = f"/faces/extracted_faces/{filename}"
                                else:
                                    print(f"❌ Failed to save unknown face to {filepath}")
                            except Exception as e:
                                print(f"❌ Error saving unknown face: {str(e)}")
                
                detections.append(detection)
                self.firebase_ref.child('currentDetections').child(str(idx)).set(detection)
        
        return detections

    def log_visit(self, display_name, category):
        """Log a visit to Firebase"""
        visit_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        visit_data = {
            'name': display_name,
            'category': category,
            'time': visit_time,
            'type': 'Unknown' if category == 'unknown' else 'Recognized'
        }
        self.firebase_ref.child('visits').push().set(visit_data)

    def detect_gender(self, face_img):
        """Detect gender from face image"""
        try:
            # Preprocess the face image
            blob = cv2.dnn.blobFromImage(face_img, 1.0, (227, 227), 
                                       (78.4263377603, 87.7689143744, 114.895847746),
                                       swapRB=False)
            
            # Gender detection
            self.gender_net.setInput(blob)
            gender_preds = self.gender_net.forward()
            gender = self.gender_list[gender_preds[0].argmax()]
            
            return gender
        except Exception as e:
            print(f"Error detecting gender: {str(e)}")
            return None

@app.route('/process-frame', methods=['POST'])
def process_frame():
    try:
        data = request.get_json()
        image_data = data['image'].split(',')[1]
        
        nparr = np.frombuffer(base64.b64decode(image_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        detections = system.process_frame(frame)
        
        return jsonify({'status': 'success', 'detections': detections})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/process-ip-camera', methods=['POST'])
def process_ip_camera():
    try:
        data = request.get_json()
        ip_camera_url = data.get('camera_url')
        
        print(f"\n🔍 Attempting to connect to IP camera...")
        print(f"📹 Camera URL: {ip_camera_url}")
        
        if not ip_camera_url:
            print("❌ Error: Camera URL is required")
            return jsonify({'status': 'error', 'message': 'Camera URL is required'}), 400
            
        # Decode the URL
        ip_camera_url = urllib.parse.unquote(ip_camera_url)
        print(f"🔗 Decoded URL: {ip_camera_url}")
            
        # Open the IP camera stream
        print("🔄 Opening camera stream...")
        cap = cv2.VideoCapture(ip_camera_url)
        
        if not cap.isOpened():
            print("❌ Error: Failed to open IP camera stream")
            return jsonify({'status': 'error', 'message': 'Failed to open IP camera stream'}), 500
            
        print("✅ Camera stream opened successfully")
            
        # Read a frame
        print("📸 Attempting to read frame...")
        ret, frame = cap.read()
        if not ret:
            print("❌ Error: Failed to read frame from IP camera")
            cap.release()
            return jsonify({'status': 'error', 'message': 'Failed to read frame from IP camera'}), 500
            
        print("✅ Frame read successfully")
            
        # Process the frame
        print("🔄 Processing frame...")
        detections = system.process_frame(frame)
        print(f"✅ Frame processed. Found {len(detections)} faces")
        
        # Release the camera
        cap.release()
        print("🔒 Camera released")
        
        return jsonify({'status': 'success', 'detections': detections})
    except Exception as e:
        print(f"❌ Error in process_ip_camera: {str(e)}")
        if 'cap' in locals():
            cap.release()
            print("🔒 Camera released after error")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/extract-face', methods=['POST'])
def extract_face():
    try:
        data = request.get_json()
        image_data = data['image'].split(',')[1]
        location = data['location']
        
        # Convert base64 to image
        nparr = np.frombuffer(base64.b64decode(image_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Get frame dimensions
        frame_height, frame_width = frame.shape[:2]
        
        # Convert percentage to pixels
        top = int((location['top'] / 100) * frame_height)
        right = int((location['right'] / 100) * frame_width)
        bottom = int((location['bottom'] / 100) * frame_height)
        left = int((location['left'] / 100) * frame_width)
        
        # Extract face region
        face_img = frame[top:bottom, left:right]
        
        # Create extracted_faces directory if it doesn't exist
        extracted_faces_dir = os.path.join('faces', 'extracted_faces')
        os.makedirs(extracted_faces_dir, exist_ok=True)
        
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"face_{timestamp}.jpg"
        filepath = os.path.join(extracted_faces_dir, filename)
        
        # Save the face image
        success = cv2.imwrite(filepath, face_img)
        if not success:
            print(f"Failed to save image to {filepath}")
            return jsonify({'status': 'error', 'message': 'Failed to save image'}), 500
            
        print(f"Successfully saved face image to {filepath}")
        
        # Return the URL path to access the image
        image_url = f"/faces/extracted_faces/{filename}"
        
        return jsonify({
            'status': 'success',
            'image_url': image_url,
            'saved_path': filepath
        })
    except Exception as e:
        print(f"Error in extract-face: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/faces/<path:filename>')
def serve_face(filename):
    try:
        # Get the current directory where main.py is located
        current_dir = os.path.dirname(os.path.abspath(__file__))
        print(f"Serving file: {filename} from directory: {current_dir}")
        return send_from_directory(os.path.join(current_dir, 'faces'), filename)
    except Exception as e:
        print(f"Error serving face image: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 404

@app.route('/faces/extracted/list')
def list_extracted_faces():
    try:
        extracted_faces_dir = os.path.join('faces', 'extracted_faces')
        faces = []
        
        if os.path.exists(extracted_faces_dir):
            for filename in os.listdir(extracted_faces_dir):
                if filename.endswith(('.jpg', '.jpeg', '.png')):
                    file_path = os.path.join(extracted_faces_dir, filename)
                    creation_time = os.path.getctime(file_path)
                    faces.append({
                        'url': f'/faces/extracted_faces/{filename}',
                        'timestamp': creation_time,
                        'filename': filename
                    })
        
        # Sort by timestamp, newest first
        faces.sort(key=lambda x: x['timestamp'], reverse=True)
        return jsonify({'status': 'success', 'faces': faces})
    except Exception as e:
        print(f"Error listing faces: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# Create faces directories if they don't exist
os.makedirs('faces/staff', exist_ok=True)
os.makedirs('faces/customers', exist_ok=True)
os.makedirs('models', exist_ok=True)

try:
    system = FaceRecognitionSystem()
    
    if __name__ == "__main__":
        app.run(port=5000)
        
except Exception as e:
    print(f"Failed to initialize system: {str(e)}")
    raise

def cleanup_old_faces():
    """Clean up faces older than 24 hours"""
    while True:
        try:
            extracted_faces_dir = os.path.join('faces', 'extracted_faces')
            current_time = time.time()
            
            if os.path.exists(extracted_faces_dir):
                for filename in os.listdir(extracted_faces_dir):
                    filepath = os.path.join(extracted_faces_dir, filename)
                    # Get file creation time
                    file_time = os.path.getctime(filepath)
                    # If file is older than 24 hours, delete it
                    if current_time - file_time > 24 * 60 * 60:  # 24 hours in seconds
                        try:
                            os.remove(filepath)
                            print(f"✅ Removed old face image: {filename}")
                        except Exception as e:
                            print(f"❌ Error removing {filename}: {str(e)}")
            
            time.sleep(3600)  # Check every hour
        except Exception as e:
            print(f"❌ Error in cleanup thread: {str(e)}")
            time.sleep(3600)  # Retry after an hour if there's an error

# Start cleanup thread when app starts
cleanup_thread = threading.Thread(target=cleanup_old_faces, daemon=True)
cleanup_thread.start()