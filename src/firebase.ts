import { initializeApp } from "firebase/app";
import { ipcRenderer } from "electron";
import { getDatabase, ref, push, set, update, get } from "firebase/database";
import { getStorage } from "firebase/storage";
import { promises as fs } from "fs";
import path from "path";

const firebaseConfig = {
  apiKey: "AIzaSyDNmM3wDlFN_-7MAjOZQc9YxDYy9-EyDvI",
  authDomain: "nova-dristi.firebaseapp.com",
  databaseURL: "https://nova-dristi-default-rtdb.firebaseio.com",
  projectId: "nova-dristi",
  storageBucket: "nova-dristi.appspot.com",
  messagingSenderId: "655884715976",
  appId: "1:655884715976:web:e7c7c8c8e8c8c8c8e8c8c8",
};
0
const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const storage = getStorage(app);

export interface CustomerData {
  name: string;
  address?: string;
  phone?: string;
  visitCount: number;
  lastVisit?: number;
  imagePath?: string;
  favoriteItems?: string[];
  totalSpent?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StaffData {
  name: string;
  address?: string;
  phone?: string;
  imagePath?: string;
  lastVisit?: number;
  createdAt: string;
  updatedAt: string;
}

export async function addProfile(type: "staff" | "customers", data: FormData) {
  try {
    const name = data.get("name") as string;
    const address = data.get("address") as string;
    const phone = data.get("phone") as string;
    const image = data.get("image") as File;

    if (!name) {
      throw new Error("Name is required");
    }

    const timestamp = new Date().toISOString();

    // Check for existing profiles with the same name
    const baseProfileId = name.toLowerCase().replace(/\s+/g, "_");
    const dbRef = ref(database, type);
    const snapshot = await get(dbRef);
    const existingProfiles = snapshot.val() || {};

    // Find the next available number suffix
    let suffix = 0;
    let profileId = baseProfileId;
    const displayName = name; // Store original name for display/greeting

    while (existingProfiles[profileId]) {
      suffix++;
      profileId = `${baseProfileId}_${suffix}`;
    }

    // Create base profile data
    const baseData = {
      name: displayName, // Original name for display/greeting
      systemName: suffix > 0 ? `${name} ${suffix}` : name, // Name with suffix for system
      address: address || null,
      phone: phone || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Add type-specific fields
    let profileData: CustomerData | StaffData;
    if (type === "customers") {
      profileData = {
        ...baseData,
        visitCount: 0,
        lastVisit: 0,
        favoriteItems: [],
        totalSpent: 0,
      } as CustomerData;
    } else {
      profileData = {
        ...baseData,
        lastVisit: 0,
      } as StaffData;
    }

    // Handle image upload
    if (image && image.size > 0) {
      try {
        const fileName = `${profileId}.jpg`;
        const localImagePath = path.join(process.resourcesPath, "backend", "faces", type, fileName);
        const localImageDir = path.dirname(localImagePath);

        // Create the directory if it doesn't exist
        await fs.mkdir(localImageDir, { recursive: true });

        // Save image to local faces directory
        const buffer = await image.arrayBuffer();
        await fs.writeFile(localImagePath, Buffer.from(buffer));

        // Update the path to include 'backend' prefix
        profileData.imagePath = `/faces/${type}/${fileName}`;
      } catch (error) {
        console.error("Failed to save image:", error);
        return { success: false, error };
      }
    }

    // Save profile data to Firebase
    const profileRef = ref(database, `${type}/${profileId}`);
    await set(profileRef, profileData);

    // Log the creation in activity history
    const activityRef = ref(database, "activity");
    await push(activityRef, {
      type: "profile_created",
      profileType: type,
      profileId,
      name: displayName,
      timestamp,
    });

    return { success: true, data: profileData };
  } catch (error) {
    console.error("Error adding profile:", error);
    return { success: false, error };
  }
}

export async function updateProfile(
  type: "staff" | "customers",
  id: string,
  data: Partial<CustomerData | StaffData>
) {
  try {
    const timestamp = new Date().toISOString();
    const dbRef = ref(database, `${type}/${id}`);

    // Get current data
    const snapshot = await get(dbRef);
    const currentData = snapshot.val();

    // Merge with new data
    const updatedData = {
      ...currentData,
      ...data,
      updatedAt: timestamp,
    };

    await update(dbRef, updatedData);

    // Log the update in activity history
    const activityRef = ref(database, "activity");
    await push(activityRef, {
      type: "profile_updated",
      profileType: type,
      profileId: id,
      name: updatedData.name,
      timestamp,
    });

    return { success: true, data: updatedData };
  } catch (error) {
    console.error("Error updating profile:", error);
    return { success: false, error };
  }
}

// Function to delete profile and related image
export async function deleteProfile(type: "staff" | "customers", id: string) {
  try {
    const dbRef = ref(database, `${type}/${id}`);

    // Get profile data before deletion for activity log
    const snapshot = await get(dbRef);
    const profileData = snapshot.val();

    if (!profileData) {
      throw new Error("Profile data not found");
    }

    try {
      ipcRenderer.invoke("delete-profile-image", profileData.imagePath);
    } catch (error) {
      console.error("Error deleting image:", error);
    }

    // Delete all visit records associated with this profile
    const visitsRef = ref(database, "visits");
    const visitsSnapshot = await get(visitsRef);
    if (visitsSnapshot.exists()) {
      const visits = visitsSnapshot.val();
      for (const [key, visit] of Object.entries(visits)) {
        if ((visit as any).name === profileData.name) {
          const visitRef = ref(database, `visits/${key}`);
          await set(visitRef, null);
        }
      }
    }

    // Delete the profile data from the database
    await set(dbRef, null);

    // Log the deletion in activity history
    const activityRef = ref(database, "activity");
    await push(activityRef, {
      type: "profile_deleted",
      profileType: type,
      profileId: id,
      name: profileData.name,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  } catch (error) {
    console.error("Error deleting profile:", error);
    return { success: false, error };
  }
}

export async function getProfileHistory(
  type: "staff" | "customers",
  id: string
) {
  try {
    const activityRef = ref(database, "activity");
    const snapshot = await get(activityRef);
    const allActivity = snapshot.val() || {};

    // Filter activities for this profile
    const profileActivity = Object.values(allActivity).filter(
      (activity: any) =>
        activity.profileId === id && activity.profileType === type
    );

    return { success: true, data: profileActivity };
  } catch (error) {
    console.error("Error getting profile history:", error);
    return { success: false, error };
  }
}
