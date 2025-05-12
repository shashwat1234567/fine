import { useState, useEffect, useRef } from "react";
import {
  Users,
  UserCheck,
  BarChart3,
  Settings as SettingsIcon,
  Volume2,
  Menu,
  X,
  Star,
  Clock,
  Coffee,
  UserPlus,
  Video,
} from "lucide-react";
import { database } from "./firebase";
import { ref, onValue } from "firebase/database";
import Webcam from "react-webcam";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import VoiceSynthesizer from "./voiceSynthesis";
import { ProfileModal } from "./components/ProfileModal";
import { ProfileDetails } from "./components/ProfileDetails";
import { addProfile } from "./firebase";
import path from "path";
import AIFaceAdd from "./components/AIFaceAdd";

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// Add greeting history management with location tracking for unknown faces
const greetingHistory = new Map<string, number>();
const unknownFaceHistory = new Map<string, number>();

// Add welcoming phrases that will rotate
const welcomingPhrases = [
    "Please make yourself comfortable!",
    "Feel free to relax and enjoy!",
    "We're glad to have you here!",
    "Make yourself at home!",
    "Take your time and enjoy!",
    "We're happy to see you!",
    "Welcome to our space!",
    "Enjoy your time with us!"
];

// Helper function to get a welcoming phrase based on the person's name
const getWelcomingPhrase = (name: string): string => {
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return welcomingPhrases[index % welcomingPhrases.length];
};

// Helper function to format names in a group
const formatNames = (names: string[]): string => {
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return names.join(" and ");
    const last = names.pop();
    return `${names.join(", ")}, and ${last}`;
};

// Add this function to handle group greetings
const getGroupGreeting = (detectedFaces: DetectedFace[]): string => {
    const knownPeople = detectedFaces.filter(face => face.type !== "unknown");
    const unknownPeople = detectedFaces.filter(face => face.type === "unknown");
    const knownNames = [...new Set(knownPeople.map(face => face.name))];
    const unknownMales = unknownPeople.filter(face => face.gender === "Male").length;
    const unknownFemales = unknownPeople.filter(face => face.gender === "Female").length;
    
    if (knownNames.length === 0) {
        if (unknownPeople.length === 1) {
            const honorific = unknownPeople[0].gender === "Female" ? "ma'am" : "sir";
            return `Welcome to AstroNova, ${honorific}! ${getWelcomingPhrase(honorific)}`;
        }
        if (unknownPeople.length === 2) {
            if (unknownMales === 2) return `Welcome to AstroNova, gentlemen! ${getWelcomingPhrase("gentlemen")}`;
            if (unknownFemales === 2) return `Welcome to AstroNova, ladies! ${getWelcomingPhrase("ladies")}`;
            return `Welcome to AstroNova! ${getWelcomingPhrase("everyone")}`;
        }
        return `Welcome to AstroNova, everyone! ${getWelcomingPhrase("everyone")}`;
    }
    
    const formattedKnownNames = formatNames(knownNames);
    
    if (knownNames.length === 1) {
        if (unknownPeople.length === 0) {
            return `Hello ${formattedKnownNames}! ${getWelcomingPhrase(formattedKnownNames)}`;
        }
        if (unknownPeople.length === 1) {
            const honorific = unknownPeople[0].gender === "Female" ? "ma'am" : "sir";
            return `Hello ${formattedKnownNames} and ${honorific}! ${getWelcomingPhrase(formattedKnownNames + honorific)}`;
        }
        return `Hello ${formattedKnownNames} and everyone! ${getWelcomingPhrase(formattedKnownNames + "everyone")}`;
    }
    
    if (knownNames.length === 2) {
        if (unknownPeople.length === 0) {
            return `Hello ${formattedKnownNames}! ${getWelcomingPhrase(formattedKnownNames)}`;
        }
        return `Hello ${formattedKnownNames} and everyone! ${getWelcomingPhrase(formattedKnownNames + "everyone")}`;
    }
    
    if (knownNames.length === 3) {
        if (unknownPeople.length === 0) {
            return `Hello ${formattedKnownNames}! ${getWelcomingPhrase(formattedKnownNames)}`;
        }
        return `Hello ${formattedKnownNames} and everyone! ${getWelcomingPhrase(formattedKnownNames + "everyone")}`;
    }
    
    if (unknownPeople.length === 0) {
        return `Hello everyone! ${getWelcomingPhrase("everyone")}`;
    }
    return `Hello everyone! ${getWelcomingPhrase("everyone")}`;
};

// Modify the shouldShowGreeting function to handle group greetings
const shouldShowGreeting = (
    personId: string,
    type: string,
    location?: { top: number; left: number }
): boolean => {
    const now = Date.now();

    // Add special handling for group greetings
    if (type === 'group') {
        const lastGroupGreeting = greetingHistory.get(personId);
        if (!lastGroupGreeting || now - lastGroupGreeting > 2 * 60 * 60 * 1000) {
            greetingHistory.set(personId, now);
            return true;
        }
        return false;
    }

    // Rest of the existing logic for individual greetings
    if (type === "unknown" && location) {
        const locationKey = `${Math.round(location.top)}-${Math.round(location.left)}`;
        const lastUnknownGreeting = unknownFaceHistory.get(locationKey);

        if (!lastUnknownGreeting || now - lastUnknownGreeting > 2000) { // 2 seconds
            unknownFaceHistory.set(locationKey, now);
            return true;
        }
        return false;
    }

    const lastGreeting = greetingHistory.get(personId);
    if (!lastGreeting || now - lastGreeting > 24 * 60 * 60 * 1000) { // 24 hours for customers
        greetingHistory.set(personId, now);
        return true;
    }
    return false;
};

interface DetectedFace {
  name: string;
  type: "staff" | "customer" | "unknown";
  location: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  greeting?: string;
  gender?: string;
}

interface VisitData {
  name: string;
  category: string;
  time: string;
  type: string;
}

interface StaffMember {
  name: string;
  imagePath: string;
  lastVisit?: string;
  address?: string;
  phone?: string;
}

interface Customer {
  name: string;
  imagePath: string;
  visitCount: number;
  lastVisit?: string;
  favoriteItems?: string[];
  totalSpent?: number;
  address?: string;
  phone?: string;
}

interface UnknownFace extends DetectedFace {
  shownAt: number;
  imageSrc?: string;
}

interface ExtractedFace {
  url: string;
  timestamp: number;
  filename: string;
}

const getGreeting = (
  name: string,
  type: "staff" | "customer" | "unknown",
  detectedGender?: string
): string => {
  if (type === "unknown") {
    const honorific = detectedGender === "Female" ? "ma'am" : "sir";
    return `Hello ${honorific}, welcome to AstroNova!`;
  }

  return `Hello ${name}, welcome back to AstroNova!`;
};

interface Greeting {
  text: string;
  timestamp: number;
}

function App() {
  const [visits, setVisits] = useState<VisitData[]>([]);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [greetings, setGreetings] = useState<Map<string, Greeting>>(new Map());
  const [metrics, setMetrics] = useState({
    total: 0,
    returning: 0,
    unknown: 0,
  });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedAudio, setSelectedAudio] = useState("");
  const [selectedAudioOutput, setSelectedAudioOutput] = useState("");
  const [devices, setDevices] = useState<{
    videoDevices: MediaDeviceInfo[];
    audioDevices: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
  }>({ videoDevices: [], audioDevices: [], audioOutputs: [] });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addModalType, setAddModalType] = useState<"staff" | "customer">("customer");
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [isProfileDetailsOpen, setIsProfileDetailsOpen] = useState(false);
  const [aiUnknownFaces, setAiUnknownFaces] = useState<UnknownFace[]>([]);
  const webcamRef = useRef<Webcam>(null);
  const processingRef = useRef(false);
  const voiceSynthesizerRef = useRef<VoiceSynthesizer | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [frameRate, setFrameRate] = useState(1000); // Adjustable frame rate in ms
  const [cameraType, setCameraType] = useState<'webcam' | 'ip'>('webcam');
  const [ipCameraUrl, setIpCameraUrl] = useState('');
  const [isCameraSettingsOpen, setIsCameraSettingsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Add effect to handle video stream
  useEffect(() => {
    if (cameraType === 'ip' && ipCameraUrl && videoRef.current) {
      const video = videoRef.current;
      
      // Set up error handling
      const handleError = (error: Event) => {
        console.error('Video error:', error);
        // You could add a user-friendly error message here
      };

      // Set up video source
      video.src = ipCameraUrl;
      video.play().catch(error => {
        console.error('Error playing video:', error);
      });

      // Add error listener
      video.addEventListener('error', handleError);

      // Cleanup
      return () => {
        video.removeEventListener('error', handleError);
        video.src = '';
      };
    }
  }, [cameraType, ipCameraUrl]);

  useEffect(() => {
    // Initialize voice synthesizer
    voiceSynthesizerRef.current = new VoiceSynthesizer();

    // Load available devices
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput"
        );
        const audioDevices = devices.filter(
          (device) => device.kind === "audioinput"
        );
        const audioOutputs = devices.filter(
          (device) => device.kind === "audiooutput"
        );
        setDevices({ videoDevices, audioDevices, audioOutputs });

        // Set default devices if available
        if (videoDevices.length > 0) {
          setSelectedCamera(videoDevices[0].deviceId);
        }
        if (audioDevices.length > 0) {
          setSelectedAudio(audioDevices[0].deviceId);
        }
        if (audioOutputs.length > 0) {
          setSelectedAudioOutput(audioOutputs[0].deviceId);
        }
      })
      .catch(console.error);

    // Set up Firebase listeners
    const visitsRef = ref(database, "visits");
    const staffRef = ref(database, "staff");
    const customersRef = ref(database, "customers");

    const unsubscribeVisits = onValue(visitsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const visitsArray = Object.values(data) as VisitData[];
        setVisits(visitsArray);

        // Update metrics
        const last24Hours = new Date();
        last24Hours.setHours(last24Hours.getHours() - 24);

        const recentVisits = visitsArray.filter(
            (visit) => 
                new Date(visit.time) > last24Hours && 
                visit.name !== "System" && 
                visit.name !== "Initialization"
        );

        const unknownVisits = recentVisits.filter(
            (visit) => visit.type === "Unknown"
        );

        const uniqueVisitors = new Set(recentVisits.map((visit) => visit.name));
        const returningVisitors = new Set(
            recentVisits
                .filter((visit) =>
                    visitsArray.some(
                        (v) =>
                            v.name === visit.name &&
                            new Date(v.time) < new Date(visit.time)
                    )
                )
                .map((visit) => visit.name)
        );

        setMetrics({
            total: recentVisits.length,
            returning: returningVisitors.size,
            unknown: unknownVisits.length,
        });
      }
    });

    const unsubscribeStaff = onValue(staffRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setStaffMembers(Object.values(data));
      }
    });

    const unsubscribeCustomers = onValue(customersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setCustomers(Object.values(data));
      }
    });

    return () => {
      unsubscribeVisits();
      unsubscribeStaff();
      unsubscribeCustomers();
      if (voiceSynthesizerRef.current) {
        voiceSynthesizerRef.current.close();
      }
    };
  }, []);

  const processFrame = async () => {
    if (processingRef.current) return;

    try {
      processingRef.current = true;
      let response;

      if (cameraType === 'webcam' && webcamRef.current) {
        const imageSrc = webcamRef.current.getScreenshot();
        if (!imageSrc) return;

        response = await fetch("http://localhost:5000/process-frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: imageSrc }),
        });
      } else if (cameraType === 'ip' && ipCameraUrl) {
        response = await fetch("http://localhost:5000/process-ip-camera", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ camera_url: ipCameraUrl }),
        });
      } else {
        return;
      }

      const data = await response.json();

      if (data.status === "success" && data.detections) {
        setDetectedFaces(data.detections);

        // Adjust frame rate based on number of faces
        const newFrameRate = data.detections.length > 0 ? 500 : 1000;
        setFrameRate(newFrameRate);

        // Check if there are multiple people in frame
        if (data.detections.length > 1) {
          const groupGreeting = getGroupGreeting(data.detections);
          const groupId = data.detections
              .map((face: DetectedFace) => face.name)
              .sort()
              .join('-');

          if (shouldShowGreeting(groupId, 'customer', undefined)) {
              if (voiceSynthesizerRef.current) {
                  voiceSynthesizerRef.current.speak(groupGreeting, 'customer');
              }
              setGreetings((prev) =>
                  new Map(prev).set(groupId, {
                      text: groupGreeting,
                      timestamp: Date.now(),
                  })
              );
          }
        } else {
          // Single person - use existing individual greeting logic
          data.detections.forEach((detection: DetectedFace) => {
              const personId = detection.type === "unknown"
                  ? `unknown-${detection.location.top}-${detection.location.left}`
                  : detection.name;

              if (shouldShowGreeting(personId, detection.type, detection.location)) {
                  const greeting = getGreeting(detection.name, detection.type, detection.gender);

                  if (voiceSynthesizerRef.current) {
                      voiceSynthesizerRef.current.speak(
                          greeting,
                          detection.type,
                          detection.gender
                      );
                  }

                  setGreetings((prev) =>
                      new Map(prev).set(personId, {
                          text: greeting,
                          timestamp: Date.now(),
                      })
                  );
              }
          });
        }
      }
    } catch (error) {
      console.error("Error processing frame:", error);
    } finally {
      processingRef.current = false;
    }
  };

  useEffect(() => {
    const processFrameWithThrottle = async () => {
        if (isProcessing) return;
        
        try {
            setIsProcessing(true);
            await processFrame();
        } finally {
            setIsProcessing(false);
        }
    };

    const interval = setInterval(processFrameWithThrottle, frameRate);
    return () => clearInterval(interval);
  }, [frameRate]);

  useEffect(() => {
    if (detectedFaces.length === 0) return;
    setAiUnknownFaces((prev) => {
      // Add new unknown faces with timestamp
      const now = Date.now();
      const updated = [...prev];
      detectedFaces.forEach((face) => {
        if (face.type === "unknown") {
          const exists = updated.find(
            (f) =>
              Math.abs(f.location.top - face.location.top) < 2 &&
              Math.abs(f.location.left - face.location.left) < 2
          );
          if (!exists) {
            updated.push({ ...face, shownAt: now });
          }
        }
      });
      // Remove faces older than 10 minutes
      return updated.filter((f) => now - f.shownAt < 10 * 60 * 1000);
    });
  }, [detectedFaces]);

  const handleAddProfile = async (formData: FormData) => {
    try {
      const type = formData.get('type') as string;
      const result = await addProfile(type === 'customer' ? 'customers' : 'staff', formData);
      if (result.success) {
        console.log("Profile added successfully");
      } else {
        console.error("Failed to add profile:", result.error);
      }
    } catch (error) {
      console.error("Error adding profile:", error);
    }
  };

  const handleRemoveUnknownFace = (face: UnknownFace) => {
    setAiUnknownFaces((prev) =>
      prev.filter(
        (f) =>
          !(Math.abs(f.location.top - face.location.top) < 2 &&
            Math.abs(f.location.left - face.location.left) < 2)
      )
    );
  };

  // Add this effect to load existing faces when AI add tab is opened
  useEffect(() => {
    if (activeTab === "aiadd") {
      // Load existing faces
      fetch("http://localhost:5000/faces/extracted/list")
        .then(res => res.json())
        .then(data => {
          if (data.status === "success") {
            const faces = (data.faces as ExtractedFace[]).map(face => ({
              name: "Unknown",
              type: "unknown" as const,
              location: { top: 0, right: 0, bottom: 0, left: 0 },
              shownAt: face.timestamp * 1000, // Convert to milliseconds
              imageSrc: `http://localhost:5000${face.url}`
            }));
            setAiUnknownFaces(prev => {
              // Combine existing faces with newly loaded ones, avoiding duplicates
              const newFaces = faces.filter(face => {
                // Extract path portion from full URLs for comparison
                const newPath = face.imageSrc.replace('http://localhost:5000', '');
                return !prev.some(p => {
                  const existingPath = p.imageSrc?.replace('http://localhost:5000', '');
                  return existingPath === newPath;
                });
              });
              return [...prev, ...newFaces];
            });
          }
        })
        .catch(error => {
          console.error("Error loading existing faces:", error);
        });
    }
  }, [activeTab]);

  const processFacesInBatch = async (detections: DetectedFace[]) => {
    // Split detections into smaller batches
    const batchSize = 3; // Adjust based on performance
    const batches = [];
    
    for (let i = 0; i < detections.length; i += batchSize) {
        batches.push(detections.slice(i, i + batchSize));
    }

    // Process batches sequentially
    for (const batch of batches) {
        await Promise.all(batch.map(async (detection) => {
            // Process each face in the batch
            const personId = detection.type === "unknown"
                ? `unknown-${detection.location.top}-${detection.location.left}`
                : detection.name;

            if (shouldShowGreeting(personId, detection.type, detection.location)) {
                // Handle greetings
            }
        }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navigation */}
      <nav className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <img
                  src="icon.png"
                  alt="Nova Dristi Logo"
                  className="h-8 w-8"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDJMMiA3bDEwIDUgMTAtNS0xMC01WiIvPjxwYXRoIGQ9Ik0yIDE3bDEwIDUgMTAtNSIvPjxwYXRoIGQ9Ik0yIDEybDEwIDUgMTAtNSIvPjwvc3ZnPg==';
                  }}
                />
                <span className="ml-2 text-xl font-bold">Nova Dristi</span>
              </div>

              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={`${
                    activeTab === "dashboard"
                      ? "border-blue-500 text-gray-900"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Dashboard
                </button>

                <button
                  onClick={() => setActiveTab("staff")}
                  className={`${
                    activeTab === "staff"
                      ? "border-blue-500 text-gray-900"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <UserCheck className="w-4 h-4 mr-2" />
                  Staff
                </button>

                <button
                  onClick={() => setActiveTab("customers")}
                  className={`${
                    activeTab === "customers"
                      ? "border-blue-500 text-gray-900"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <Users className="w-4 h-4 mr-2" />
                  Customers
                </button>

                <button
                  onClick={() => setActiveTab("settings")}
                  className={`${
                    activeTab === "settings"
                      ? "border-blue-500 text-gray-900"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <SettingsIcon className="w-4 h-4 mr-2" />
                  Settings
                </button>

                <button
                  onClick={() => setActiveTab("aiadd")}
                  className={`${
                    activeTab === "aiadd"
                      ? "border-blue-500 text-gray-900"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  AI add
                </button>
              </div>
            </div>

            <div className="flex items-center sm:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              >
                {isMobileMenuOpen ? (
                  <X className="block h-6 w-6" />
                ) : (
                  <Menu className="block h-6 w-6" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="sm:hidden">
            <div className="pt-2 pb-3 space-y-1">
              {[
                { id: "dashboard", icon: BarChart3, label: "Dashboard" },
                { id: "staff", icon: UserCheck, label: "Staff" },
                { id: "customers", icon: Users, label: "Customers" },
                { id: "settings", icon: SettingsIcon, label: "Settings" },
              ].map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => {
                    setActiveTab(id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`${
                    activeTab === id
                      ? "bg-blue-50 border-blue-500 text-blue-700"
                      : "border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700"
                  } block pl-3 pr-4 py-2 border-l-4 text-base font-medium w-full text-left`}
                >
                  <div className="flex items-center">
                    <Icon className="w-4 h-4 mr-2" />
                    {label}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 bg-blue-500 rounded-md p-3">
                      <Users className="h-6 w-6 text-white" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">
                          Total Visitors
                        </dt>
                        <dd className="text-lg font-semibold text-gray-900">
                          {metrics.total}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 bg-green-500 rounded-md p-3">
                      <UserCheck className="h-6 w-6 text-white" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">
                          Returning Visitors
                        </dt>
                        <dd className="text-lg font-semibold text-gray-900">
                          {metrics.returning}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 bg-purple-500 rounded-md p-3">
                      <UserPlus className="h-6 w-6 text-white" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">
                          Unknown Visitors
                        </dt>
                        <dd className="text-lg font-semibold text-gray-900">
                          {metrics.unknown}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Camera feed and recent activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">
                      Live Feed
                    </h2>
                    <div className="flex items-center space-x-2">
                      <select
                        value={selectedCamera}
                        onChange={(e) => setSelectedCamera(e.target.value)}
                        className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                      >
                        {devices.videoDevices.map((device) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {device.label ||
                              `Camera ${device.deviceId.slice(0, 5)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="relative">
                    {cameraType === 'webcam' ? (
                      <Webcam
                        ref={webcamRef}
                        audio={false}
                        videoConstraints={{
                          deviceId: selectedCamera,
                          width: 1280,
                          height: 720,
                        }}
                        className="w-full rounded-lg"
                      />
                    ) : (
                      <div className="w-full h-[480px] bg-gray-200 rounded-lg overflow-hidden">
                        <img
                          src="http://localhost:5000/video_feed"
                          className="w-full h-full object-cover"
                          alt="IP Camera Stream"
                        />
                      </div>
                    )}

                    {detectedFaces.map((face, index) => (
                      <div
                        key={index}
                        style={{
                          position: "absolute",
                          top: `${face.location.top}%`,
                          left: `${face.location.left}%`,
                          width: `${face.location.right - face.location.left}%`,
                          height: `${
                            face.location.bottom - face.location.top
                          }%`,
                          border: "2px solid",
                          borderColor:
                            face.type === "staff"
                              ? "#10B981"
                              : face.type === "customer"
                              ? "#3B82F6"
                              : "#F59E0B",
                        }}
                      >
                        <div
                          className={`absolute -top-6 left-0 px-2 py-1 text-xs font-semibold text-white rounded-t-md ${
                            face.type === "staff"
                              ? "bg-green-500"
                              : face.type === "customer"
                              ? "bg-blue-500"
                              : "bg-yellow-500"
                          }`}
                        >
                          {face.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-white shadow rounded-lg p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Recent Activity
                  </h2>
                  <button className="text-sm text-blue-600 hover:text-blue-800">
                    View all
                  </button>
                </div>

                <div className="flow-root">
                  <ul className="-my-5 divide-y divide-gray-200">
                    {visits
                      .slice(-5)
                      .reverse()
                      .map((visit, index) => (
                        <li key={index} className="py-4">
                          <div className="flex items-center space-x-4">
                            <div className="flex-shrink-0">
                              <div
                                className={`h-8 w-8 rounded-full flex items-center justify-center ${
                                  visit.category === "staff"
                                    ? "bg-green-100 text-green-600"
                                    : visit.category === "customer"
                                    ? "bg-blue-100 text-blue-600"
                                    : "bg-yellow-100 text-yellow-600"
                                }`}
                              >
                                {visit.category === "staff" ? (
                                  <UserCheck className="h-5 w-5" />
                                ) : (
                                  <Users className="h-5 w-5" />
                                )}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {visit.name}
                              </p>
                              <p className="text-sm text-gray-500">
                                {new Date(visit.time).toLocaleString()}
                              </p>
                            </div>
                            <div>
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  visit.category === "staff"
                                    ? "bg-green-100 text-green-800"
                                    : visit.category === "customer"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-yellow-100 text-yellow-800"
                                }`}
                              >
                                {visit.category}
                              </span>
                            </div>
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {(activeTab === "staff" || activeTab === "customers") && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">
                {activeTab === "staff" ? "Staff Members" : "Customers"}
              </h2>
              <button
                onClick={() => {
                  setAddModalType(activeTab === "staff" ? "staff" : "customer");
                  setIsAddModalOpen(true);
                }}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Add {activeTab === "staff" ? "Staff" : "Customer"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {(activeTab === "staff" ? staffMembers : customers).map(
                (profile, index) => (
                  <div
                    key={index}
                    className="bg-white shadow rounded-lg overflow-hidden hover:shadow-lg transition-shadow duration-200 cursor-pointer"
                    onClick={() => {
                      setSelectedProfile({ ...profile, type: activeTab });
                      setIsProfileDetailsOpen(true);
                    }}
                  >
                    <div className="p-6">
                      <div className="flex items-center space-x-4">
                        <div className="flex-shrink-0">
                          <img
                            src={
                              profile.imagePath
                                ? path.join(process.resourcesPath,"backend", profile.imagePath.replace("/backend",""))
                                : "https://images.unsplash.com/photo-1633332755192-727a05c4013d?auto=format&fit=crop&w=200&h=200"
                            }
                            alt={profile.name}
                            className="h-12 w-12 rounded-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src =
                                "https://images.unsplash.com/photo-1633332755192-727a05c4013d?auto=format&fit=crop&w=200&h=200";
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-medium text-gray-900">
                            {profile.name}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {activeTab === "customers" ? (
                              <>
                                <span className="font-medium">
                                  {(profile as Customer).visitCount}
                                </span>{" "}
                                visits
                              </>
                            ) : (
                              "Staff Member"
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center text-sm text-gray-500">
                        <Clock className="flex-shrink-0 mr-1.5 h-4 w-4" />
                        <span>
                          Last visit:{" "}
                          {profile.lastVisit
                            ? new Date(profile.lastVisit).toLocaleDateString()
                            : "Never"}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium leading-6 text-gray-900">
                  Device Settings
                </h3>

                <div className="mt-6 grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="camera"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Camera
                    </label>
                    <select
                      id="camera"
                      value={selectedCamera}
                      onChange={(e) => setSelectedCamera(e.target.value)}
                      className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                      {devices.videoDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label ||
                            `Camera ${device.deviceId.slice(0, 5)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="audio"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Microphone
                    </label>
                    <select
                      id="audio"
                      value={selectedAudio}
                      onChange={(e) => setSelectedAudio(e.target.value)}
                      className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                      {devices.audioDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label ||
                            `Microphone ${device.deviceId.slice(0, 5)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="audio"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Speaker
                    </label>
                    <select
                      id="audio"
                      value={selectedAudioOutput}
                      onChange={(e) => setSelectedAudioOutput(e.target.value)}
                      className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                      {devices.audioOutputs.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label ||
                            `Speaker ${device.deviceId.slice(0, 5)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium leading-6 text-gray-900">
                  Voice Settings
                </h3>
                <div className="mt-2 max-w-xl text-sm text-gray-500">
                  <p>Configure text-to-speech settings for greetings.</p>
                </div>
                <div className="mt-5">
                  <div className="flex items-center">
                    <Volume2 className="h-5 w-5 text-gray-400" />
                    <span className="ml-2 text-sm text-gray-500">
                      Voice synthesis is enabled
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "aiadd" && (
          <AIFaceAdd
            faces={aiUnknownFaces as any}
            onAdd={handleAddProfile}
            onRemoveFace={handleRemoveUnknownFace}
          />
        )}
      </main>

      {/* Modals */}
      <ProfileModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleAddProfile}
        type={addModalType}
      />

      <ProfileDetails
        isOpen={isProfileDetailsOpen}
        onClose={() => setIsProfileDetailsOpen(false)}
        profile={selectedProfile}
      />

      {/* Add Camera Settings Modal */}
      {isCameraSettingsOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Camera Settings</h2>
              <button
                onClick={() => setIsCameraSettingsOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Camera Type
                </label>
                <div className="flex space-x-4">
                  <button
                    onClick={() => setCameraType('webcam')}
                    className={`flex-1 p-2 rounded ${
                      cameraType === 'webcam'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    Webcam
                  </button>
                  <button
                    onClick={() => setCameraType('ip')}
                    className={`flex-1 p-2 rounded ${
                      cameraType === 'ip'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    IP Camera
                  </button>
                </div>
              </div>

              {cameraType === 'webcam' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Webcam
                  </label>
                  <select
                    value={selectedCamera}
                    onChange={(e) => setSelectedCamera(e.target.value)}
                    className="w-full p-2 border rounded"
                  >
                    {devices.videoDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${device.deviceId}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {cameraType === 'ip' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    IP Camera URL
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={ipCameraUrl}
                      onChange={(e) => setIpCameraUrl(e.target.value)}
                      placeholder="e.g., rtsp://username:password@192.168.1.100:554/stream"
                      className="flex-1 p-2 border rounded"
                    />
                    <button
                      onClick={async () => {
                        if (ipCameraUrl) {
                          try {
                            // Start the stream
                            const response = await fetch('http://localhost:5000/start_stream', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({ camera_url: ipCameraUrl }),
                            });
                            
                            const data = await response.json();
                            if (data.status === 'success') {
                              setSelectedCamera('ip-camera');
                              setIsCameraSettingsOpen(false);
                            } else {
                              console.error('Failed to start stream:', data.message);
                              alert('Failed to start stream: ' + data.message);
                            }
                          } catch (error) {
                            console.error('Error starting stream:', error);
                            alert('Error starting stream. Please check the console for details.');
                          }
                        }
                      }}
                      className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Camera Settings Button */}
      <button
        onClick={() => setIsCameraSettingsOpen(true)}
        className="fixed bottom-4 right-4 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600"
      >
        <Video size={24} />
      </button>
    </div>
  );
}

export default App;
