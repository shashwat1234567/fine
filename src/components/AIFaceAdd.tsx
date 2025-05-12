import React, { useState } from 'react';
import { Camera, CheckCircle } from 'lucide-react';

interface FaceLocation {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface UnknownFace {
  name: string;
  type: 'unknown';
  location: FaceLocation;
  greeting?: string;
  gender?: string;
  shownAt: number;
  imageSrc?: string; // Optionally, if you have a base64 or url for the face
}

interface AIFaceAddProps {
  faces: UnknownFace[];
  onAdd: (formData: FormData) => void;
  onRemoveFace: (face: UnknownFace) => void;
}

const AIFaceAdd: React.FC<AIFaceAddProps> = ({ faces, onAdd, onRemoveFace }) => {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    type: 'customer',
  });

  const handleSelect = (idx: number) => {
    setSelectedIdx(idx);
    setForm({ name: '', address: '', phone: '', type: 'customer' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, type: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIdx === null) return;
    const face = faces[selectedIdx];
    const formData = new FormData();
    formData.append('name', form.name);
    formData.append('address', form.address);
    formData.append('phone', form.phone);
    formData.append('type', form.type);
    
    // Add face image if available
    if (face.imageSrc) {
      try {
        // Get the relative path from the URL
        const relativePath = face.imageSrc.replace('http://localhost:5000', '');
        // Fetch the image from the backend
        const response = await fetch(`http://localhost:5000${relativePath}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        const blob = await response.blob();
        // Get the filename from the URL
        const filename = relativePath.split('/').pop() || 'face.jpg';
        // Create a new File object with the correct filename
        const file = new File([blob], filename, { type: 'image/jpeg' });
        formData.append('image', file);
      } catch (error) {
        console.error('Error fetching image:', error);
        // Continue with form submission even if image fetch fails
      }
    }

    onAdd(formData);
    onRemoveFace(face);
    setSelectedIdx(null);
    setForm({ name: '', address: '', phone: '', type: 'customer' });
  };

  return (
    <div className="flex flex-row gap-8">
      {/* Extracted Faces Grid */}
      <div className="flex-1">
        <h2 className="text-3xl font-bold mb-4">Extracted Faces</h2>
        <div className="grid grid-cols-4 gap-6">
          {faces.map((face, idx) => (
            <div
              key={idx}
              className={`relative w-48 h-48 rounded-lg bg-gray-200 flex items-center justify-center cursor-pointer border-2 transition-all duration-150 ${
                selectedIdx === idx ? 'border-black' : 'border-transparent'
              }`}
              onClick={() => handleSelect(idx)}
            >
              {face.imageSrc ? (
                <img 
                  src={face.imageSrc} 
                  alt="Detected face"
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : (
                <Camera className="w-12 h-12 text-gray-300" />
              )}
              {selectedIdx === idx && (
                <span className="absolute top-2 right-2 bg-black text-white rounded-full p-1">
                  <CheckCircle className="w-6 h-6" />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      {/* Add Person Form */}
      <div className="w-[400px] bg-white rounded-lg shadow p-8 flex flex-col items-center">
        <h2 className="text-3xl font-bold mb-6">Add Person</h2>
        <div className="w-32 h-32 rounded-lg bg-gray-200 flex items-center justify-center mb-6">
          {selectedIdx !== null && faces[selectedIdx]?.imageSrc ? (
            <img 
              src={faces[selectedIdx].imageSrc} 
              alt="Selected face"
              className="w-full h-full object-cover rounded-lg"
            />
          ) : (
            <Camera className="w-12 h-12 text-gray-300" />
          )}
        </div>
        <form className="w-full flex flex-col gap-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium mb-1">Full Name</label>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <input
              type="text"
              name="address"
              value={form.address}
              onChange={handleChange}
              className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone Number</label>
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                name="type"
                value="customer"
                checked={form.type === 'customer'}
                onChange={handleTypeChange}
                className="mr-2"
              />
              Customer
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="type"
                value="staff"
                checked={form.type === 'staff'}
                onChange={handleTypeChange}
                className="mr-2"
              />
              Staff
            </label>
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add Person
          </button>
        </form>
      </div>
    </div>
  );
};

export default AIFaceAdd; 