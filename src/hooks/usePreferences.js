import { useState, useEffect } from 'react';

export function usePreferences() {
  const [hpMode, setHpModeState] = useState(() => {
    return localStorage.getItem('nikke_bomanda_hpMode') || 'detail';
  });

  const [showSquad, setShowSquadState] = useState(() => {
    return localStorage.getItem('nikke_bomanda_showSquad') === 'true';
  });

  useEffect(() => {
    const handlePrefChange = (e) => {
      if (e.detail.hpMode !== undefined) setHpModeState(e.detail.hpMode);
      if (e.detail.showSquad !== undefined) setShowSquadState(e.detail.showSquad);
    };
    window.addEventListener('prefChange', handlePrefChange);
    return () => window.removeEventListener('prefChange', handlePrefChange);
  }, []);

  const setHpMode = (mode) => {
    setHpModeState(mode);
    localStorage.setItem('nikke_bomanda_hpMode', mode);
    window.dispatchEvent(new CustomEvent('prefChange', { detail: { hpMode: mode } }));
  };

  const setShowSquad = (show) => {
    setShowSquadState(show);
    localStorage.setItem('nikke_bomanda_showSquad', String(show));
    window.dispatchEvent(new CustomEvent('prefChange', { detail: { showSquad: show } }));
  };

  return { hpMode, setHpMode, showSquad, setShowSquad };
}
