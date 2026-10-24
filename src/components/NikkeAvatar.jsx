import React from 'react';
import { useGameData } from '../contexts/GameDataContext';
import { useAvatarSettings } from '../hooks/useAvatarSettings';
import { burstMaskToLabel } from '../utils/burst';

export default function NikkeAvatar({ nikkeId, size = 50, style = {} }) {
  const { nikkes, gameIcons } = useGameData();
  const { corners } = useAvatarSettings();

  const nikke = nikkes?.find(n => n.id === nikkeId);

  if (!nikke) {
    return (
      <div style={{ width: size, height: size, backgroundColor: 'var(--surface-2)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--border-3)', fontSize: size * 0.4, flexShrink: 0, ...style }}>
        ?
      </div>
    );
  }

  const getIconUrl = (category) => {
    if (!category || category === 'none') return null;
    const value = category === 'burst' ? burstMaskToLabel(nikke.burst_type) : String(nikke[category] || '');
    if (!value) return null;
    const icon = gameIcons?.find(i => i.category === category && String(i.name).toUpperCase() === value.toUpperCase());
    return icon?.image_url || null;
  };

  const cornerStyles = {
    position: 'absolute',
    width: '35%',
    height: '35%',
    objectFit: 'contain',
    zIndex: 2,
    filter: 'drop-shadow(0px 0px 2px rgba(0,0,0,0.8))'
  };

  const tooltipText = `${nikke.name} (버스트 ${burstMaskToLabel(nikke.burst_type) || '?'}, ${nikke.element || '?'}, ${nikke.weapon || '?'}, ${nikke.manufacturer || '?'})`;

  return (
    <div title={tooltipText} style={{ width: size, height: size, position: 'relative', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'var(--surface-4)', flexShrink: 0, ...style }}>
      {nikke.image_url ? (
        <img src={nikke.image_url} alt={nikke.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, color: 'var(--text-strong)' }}>{nikke.name.substring(0,3)}</div>
      )}

      {/* Top Left */}
      {getIconUrl(corners.topLeft) && (
        <img src={getIconUrl(corners.topLeft)} style={{ ...cornerStyles, top: '2%', left: '2%' }} alt="top-left" />
      )}
      {/* Top Right */}
      {getIconUrl(corners.topRight) && (
        <img src={getIconUrl(corners.topRight)} style={{ ...cornerStyles, top: '2%', right: '2%' }} alt="top-right" />
      )}
      {/* Bottom Left */}
      {getIconUrl(corners.bottomLeft) && (
        <img src={getIconUrl(corners.bottomLeft)} style={{ ...cornerStyles, bottom: '2%', left: '2%' }} alt="bottom-left" />
      )}
      {/* Bottom Right */}
      {getIconUrl(corners.bottomRight) && (
        <img src={getIconUrl(corners.bottomRight)} style={{ ...cornerStyles, bottom: '2%', right: '2%' }} alt="bottom-right" />
      )}
    </div>
  );
}
