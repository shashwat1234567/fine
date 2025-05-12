import React, { useEffect, useState } from "react";
import { X, Clock, Calendar, Trash2 } from "lucide-react";
import { Line } from "react-chartjs-2";
import { database } from "../firebase";
import { ref, query, orderByChild, get } from "firebase/database";
import { deleteProfile } from "../firebase";
import { ipcRenderer } from "electron";
import path from "path";
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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface Visit {
  name: string;
  time: string;
  type: string;
}

interface ProfileDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  profile: {
    name: string;
    systemName?: string;
    type: "staff" | "customers";
    imagePath?: string;
    visitCount?: number;
    lastVisit?: string;
  } | null;
}

declare global {
  interface Window {
    ipcRenderer: {
      invoke(channel: string, ...args: any[]): Promise<any>;
    };
  }
}

export function ProfileDetails({
  isOpen,
  onClose,
  profile,
}: ProfileDetailsProps) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitTrends, setVisitTrends] = useState<{
    labels: string[];
    data: number[];
  }>({
    labels: [],
    data: [],
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [imagePath, setImagePath] = useState<string>("");

  useEffect(() => {
    const loadImagePath = async () => {
      if (profile?.imagePath) {
        try {
          const fullPath = await ipcRenderer.invoke(
            "get-resource-path",
            profile.imagePath
          );

          if (fullPath) {
            const dbPath = profile.imagePath.replace("/backend","");
            setImagePath(path.join(process.resourcesPath, "backend", dbPath));
          } else {
            console.error("Image path not found:", profile.imagePath);
            setImagePath("");
          }
        } catch (error) {
          console.error("Error getting resource path:", error);
          setImagePath("");
        }
      } else {
        setImagePath("");
      }
    };

    if (isOpen && profile) {
      loadImagePath();
    }
  }, [isOpen, profile]);

  useEffect(() => {
    const fetchVisits = async () => {
      if (!profile?.name) return;

      try {
        const visitsRef = ref(database, "visits");
        const visitsQuery = query(visitsRef, orderByChild("name"));
        const snapshot = await get(visitsQuery);

        if (snapshot.exists()) {
          const allVisits = Object.values(snapshot.val()) as Visit[];
          const profileVisits = allVisits.filter(
            (v) => v.name === profile.name
          );
          setVisits(profileVisits);

          // Process visit trends
          const visitsByMonth: { [key: string]: number } = {};
          profileVisits.forEach((visit) => {
            const date = new Date(visit.time);
            const monthYear = date.toLocaleString("default", {
              month: "short",
              year: "2-digit",
            });
            visitsByMonth[monthYear] = (visitsByMonth[monthYear] || 0) + 1;
          });

          const sortedMonths = Object.keys(visitsByMonth).sort((a, b) => {
            const dateA = new Date(a);
            const dateB = new Date(b);
            return dateA.getTime() - dateB.getTime();
          });

          setVisitTrends({
            labels: sortedMonths,
            data: sortedMonths.map((month) => visitsByMonth[month]),
          });
        }
      } catch (error) {
        console.error("Error fetching visits:", error);
      }
    };

    if (isOpen && profile) {
      fetchVisits();
    }
  }, [isOpen, profile]);

  const handleDelete = async () => {
    if (!profile) return;

    if (
      window.confirm(
        `Are you sure you want to delete ${profile.name}'s profile?`
      )
    ) {
      setIsDeleting(true);
      try {
        const result = await deleteProfile(
          profile.type,
          profile.systemName?.toLowerCase().replace(/\s+/g, "_") ||
            profile.name.toLowerCase().replace(/\s+/g, "_")
        );
        if (result.success) {
          onClose();
        } else {
          alert("Failed to delete profile");
        }
      } catch (error) {
        console.error("Error deleting profile:", error);
        alert("Failed to delete profile");
      } finally {
        setIsDeleting(false);
      }
    }
  };

  if (!isOpen || !profile) return null;

  const visitData = {
    labels: visitTrends.labels,
    datasets: [
      {
        label: "Visits",
        data: visitTrends.data,
        borderColor: "rgb(75, 192, 192)",
        tension: 0.1,
      },
    ],
  };

  const fallbackImage =
    "https://images.unsplash.com/photo-1633332755192-727a05c4013d?auto=format&fit=crop&w=200&h=200";

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-lg p-4 w-[80%] max-w-md h-[60vh] m-4 overflow-y-auto relative">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <img
                src={imagePath || fallbackImage}
                alt={profile.name}
                className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = fallbackImage;
                }}
              />
              {profile.systemName && profile.systemName !== profile.name && (
                <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                  {profile.systemName.split(" ").pop()}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-2xl font-bold">{profile.name}</h2>
              <p className="text-gray-600 capitalize">{profile.type}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-red-500 hover:text-red-700 p-2 rounded-full hover:bg-red-50"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-4">Visit Statistics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Clock className="w-5 h-5 text-blue-500" />
                  <div>
                    <p className="text-sm text-gray-600">Total Visits</p>
                    <p className="text-lg font-semibold">{visits.length}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Calendar className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-sm text-gray-600">Last Visit</p>
                    <p className="text-lg font-semibold">
                      {profile.lastVisit
                        ? new Date(profile.lastVisit).toLocaleDateString()
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-4">Visit Trends</h3>
              <div className="h-64">
                <Line
                  data={visitData}
                  options={{
                    maintainAspectRatio: false,
                    scales: {
                      y: {
                        beginAtZero: true,
                        ticks: {
                          stepSize: 1,
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="space-y-3">
              {visits
                .slice(-5)
                .reverse()
                .map((visit, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-gray-500" />
                      <span className="text-sm">
                        {new Date(visit.time).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-gray-600">
                      {visit.type}
                    </span>
                  </div>
                ))}
              {visits.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-2">
                  No recent activity
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
