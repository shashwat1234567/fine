import cv2
import numpy as np
from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort
from collections import defaultdict
import time

class YOLOTracker:
    def __init__(self):
        # Initialize YOLO model
        self.yolo_model = YOLO('yolov8n.pt')
        
        # Initialize DeepSORT tracker
        self.tracker = DeepSort(
            max_age=30,
            n_init=3,
            nms_max_overlap=1.0,
            max_cosine_distance=0.3,
            nn_budget=None,
            override_track_class=None,
            embedder="mobilenet",
            half=True,
            bgr=True,
            embedder_gpu=True
        )
        
        # Store tracking data
        self.tracked_people = defaultdict(lambda: {
            'face_processed': False,
            'greeted': False,
            'last_seen': time.time(),
            'roi': None
        })
        
        # Group greeting cooldown
        self.last_group_greeting = 0
        self.group_greeting_cooldown = 30  # seconds
        
        # Optimization parameters
        self.frame_skip = 2  # Process every 3rd frame
        self.frame_counter = 0
        self.target_width = 640  # Target width for processing
        self.last_detection_time = 0
        self.detection_interval = 0.1  # Minimum time between detections (seconds)
        
    def preprocess_frame(self, frame):
        """Preprocess frame for detection"""
        # Resize frame to target width while maintaining aspect ratio
        height, width = frame.shape[:2]
        scale = self.target_width / width
        new_height = int(height * scale)
        return cv2.resize(frame, (self.target_width, new_height))
        
    def process_frame(self, frame):
        """Process a single frame for detection and tracking"""
        current_time = time.time()
        
        # Skip frames if needed
        self.frame_counter += 1
        if self.frame_counter % (self.frame_skip + 1) != 0:
            return self._get_last_tracking_results()
            
        # Check minimum detection interval
        if current_time - self.last_detection_time < self.detection_interval:
            return self._get_last_tracking_results()
            
        self.last_detection_time = current_time
        
        # Preprocess frame
        processed_frame = self.preprocess_frame(frame)
        
        # Run YOLO detection
        results = self.yolo_model(processed_frame, classes=[0])  # Only detect people (class 0)
        
        # Extract detections
        detections = []
        for result in results:
            boxes = result.boxes.xyxy.cpu().numpy()
            confidences = result.boxes.conf.cpu().numpy()
            
            for box, conf in zip(boxes, confidences):
                if conf > 0.5:  # Only keep detections with confidence > 0.5
                    detections.append((box, conf, 'person'))
        
        # Update tracker
        tracks = self.tracker.update_tracks(detections, frame=processed_frame)
        
        # Process tracking results
        active_tracks = {}
        
        for track in tracks:
            if not track.is_confirmed():
                continue
                
            track_id = track.track_id
            ltrb = track.to_ltrb()
            
            # Update tracking data
            self.tracked_people[track_id].update({
                'last_seen': current_time,
                'roi': ltrb,
                'confidence': track.get_det_conf()  # Get detection confidence
            })
            
            active_tracks[track_id] = self.tracked_people[track_id]
        
        # Clean up old tracks
        self._cleanup_old_tracks(current_time)
        
        # Check for group greeting
        num_people = len(active_tracks)
        group_greeting_needed = False
        
        if num_people >= 4 and (current_time - self.last_group_greeting) > self.group_greeting_cooldown:
            group_greeting_needed = True
            self.last_group_greeting = current_time
        
        # Store results for frame skipping
        self.last_results = {
            'num_people': num_people,
            'group_greeting_needed': group_greeting_needed,
            'tracked_people': active_tracks
        }
        
        return self.last_results
        
    def _get_last_tracking_results(self):
        """Return last tracking results for skipped frames"""
        return self.last_results 
    
    def _cleanup_old_tracks(self, current_time):
        # Remove tracks older than 5 seconds
        for track_id in list(self.tracked_people.keys()):
            if (current_time - self.tracked_people[track_id]['last_seen']) > 5:
                del self.tracked_people[track_id] 