import os

# Base paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Directory paths
FACES_DIR = os.path.join(BASE_DIR, 'faces')
STAFF_FACES_DIR = os.path.join(FACES_DIR, 'staff')
CUSTOMER_FACES_DIR = os.path.join(FACES_DIR, 'customers')
MODELS_DIR = os.path.join(BASE_DIR, 'models')

# Model paths
GENDER_PROTOTXT_PATH = os.path.join(MODELS_DIR, 'deploy_gender.prototxt')
GENDER_MODEL_PATH = os.path.join(MODELS_DIR, 'gender_net.caffemodel')

# Firebase configuration
FIREBASE_KEY_PATH = os.path.join(BASE_DIR, 'firebase-key.json')
FIREBASE_DATABASE_URL = 'https://nova-dristi-default-rtdb.firebaseio.com/'

# Flask configuration
FLASK_HOST = '127.0.0.1'
FLASK_PORT = 5000

# Create required directories
for directory in [FACES_DIR, STAFF_FACES_DIR, CUSTOMER_FACES_DIR, MODELS_DIR]:
    os.makedirs(directory, exist_ok=True)