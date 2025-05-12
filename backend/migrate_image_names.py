import os
import json
import firebase_admin
from firebase_admin import credentials, db
from datetime import datetime

# Initialize Firebase Admin SDK
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://nova-dristi-default-rtdb.firebaseio.com'
})

def generate_username(name: str, category: str, existing_username: str = None) -> str:
    """Generate a consistent username from the given name."""
    # If there's an existing username and it's valid, use it
    if existing_username and all(c.isalnum() or c == '_' for c in existing_username.lower()):
        return existing_username.lower()

    # Convert name to lowercase and replace spaces/special chars with underscore
    username = name.lower()
    username = ''.join(c for c in username if c.isalnum() or c.isspace())
    username = username.strip().replace(' ', '_')

    # Get existing usernames from Firebase
    existing_profiles = db.reference(f'/{category}').get() or {}
    existing_usernames = {profile.get('systemName', '').lower()
                         for profile in existing_profiles.values()
                         if profile.get('systemName')}

    # If username is already taken, append numbers until we find a unique one
    final_username = username
    counter = 1
    while final_username in existing_usernames:
        final_username = f"{username}_{counter}"
        counter += 1

    return final_username

def migrate_image_names():
    """Migrate image names to use consistent username-based naming."""
    categories = ['staff', 'customers']
    base_path = 'faces'

    for category in categories:
        print(f"\nProcessing {category}...")
        profiles_ref = db.reference(f'/{category}')
        profiles = profiles_ref.get() or {}

        dir_path = os.path.join(base_path, category)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path)
            print(f"✅ Created directory: {dir_path}")

        # Get all image files in the directory (case-insensitive)
        files = [f for f in os.listdir(dir_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]

        for profile_id, profile in profiles.items():
            try:
                if not profile.get('name'):
                    print(f"⚠️ Skipping profile {profile_id}: No name found")
                    continue

                # Generate consistent username
                username = generate_username(
                    name=profile['name'],
                    category=category,
                    existing_username=profile.get('systemName')
                )

                new_filename = f"{username}.jpg"
                current_image_path = None

                # Try to find the current image path using multiple methods
                current_image_path = None
                
                # Method 1: Check exact match with systemName
                if profile.get('systemName'):
                    exact_match = next((f for f in files if os.path.splitext(f)[0].lower() == profile['systemName'].lower()), None)
                    if exact_match:
                        current_image_path = os.path.join(dir_path, exact_match)
                
                # Method 2: Check imagePath if Method 1 failed
                if not current_image_path and profile.get('imagePath'):
                    img_filename = os.path.basename(profile['imagePath'])
                    img_match = next((f for f in files if f.lower() == img_filename.lower()), None)
                    if img_match:
                        current_image_path = os.path.join(dir_path, img_match)
                
                # Method 3: Look for files matching profile_id if previous methods failed
                if not current_image_path:
                    matching_files = [f for f in files if f.lower().startswith(profile_id.lower())]
                    if matching_files:
                        current_image_path = os.path.join(dir_path, matching_files[0])

                if current_image_path and os.path.exists(current_image_path):
                    new_image_path = os.path.join(dir_path, new_filename)

                    # Rename the file if it exists and needs to be renamed
                    if current_image_path != new_image_path:
                        os.rename(current_image_path, new_image_path)
                        print(f"✅ Renamed: {os.path.basename(current_image_path)} → {new_filename}")

                    # Update database entry
                    updates = {
                        'systemName': username,
                        'imagePath': f'/faces/{category}/{new_filename}',
                        'lastUpdated': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    }
                    profiles_ref.child(profile_id).update(updates)
                    print(f"✅ Updated database for {profile['name']} ({username})")
                else:
                    print(f"⚠️ No image found for {profile['name']}, removing from database...")
                    # Remove the profile from database if no image is found
                    profiles_ref.child(profile_id).delete()
                    print(f"✅ Removed {profile['name']} from database")

            except Exception as e:
                print(f"❌ Error processing {profile.get('name', profile_id)}: {str(e)}")

    print('\n✨ Migration completed!')

if __name__ == '__main__':
    migrate_image_names()