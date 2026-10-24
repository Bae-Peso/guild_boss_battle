import { useState, useEffect } from 'react';

const DEFAULT_CORNERS = {
  topLeft: 'manufacturer',
  topRight: 'weapon',
  bottomLeft: 'element',
  bottomRight: 'burst'
};

export function useAvatarSettings() {
  const [corners, setCorners] = useState(DEFAULT_CORNERS);

  useEffect(() => {
    const saved = localStorage.getItem('nikke_avatar_corners');
    if (saved) {
      try {
        setCorners({ ...DEFAULT_CORNERS, ...JSON.parse(saved) });
      } catch (e) {}
    }
  }, []);

  const updateCorners = (newCorners) => {
    setCorners(newCorners);
    localStorage.setItem('nikke_avatar_corners', JSON.stringify(newCorners));
    // Trigger custom event to re-render other components if needed
    window.dispatchEvent(new Event('nikke_avatar_corners_changed'));
  };

  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('nikke_avatar_corners');
      if (saved) {
        try {
          setCorners({ ...DEFAULT_CORNERS, ...JSON.parse(saved) });
        } catch (e) {}
      }
    };
    window.addEventListener('nikke_avatar_corners_changed', handleStorageChange);
    return () => window.removeEventListener('nikke_avatar_corners_changed', handleStorageChange);
  }, []);

  return { corners, updateCorners };
}
