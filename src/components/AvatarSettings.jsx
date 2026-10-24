import React from 'react';
import { useAvatarSettings } from '../hooks/useAvatarSettings';
import NikkeAvatar from './NikkeAvatar';
import { useGameData } from '../contexts/GameDataContext';

export default function AvatarSettings() {
  const { corners, updateCorners } = useAvatarSettings();
  const { nikkes } = useGameData();

  const handleCornerChange = (corner, value) => {
    updateCorners({
      ...corners,
      [corner]: value
    });
  };

  const options = [
    { value: 'none', label: '표시 안함' },
    { value: 'manufacturer', label: '기업' },
    { value: 'burst', label: '버스트' },
    { value: 'element', label: '속성' },
    { value: 'class', label: '클래스' },
    { value: 'weapon', label: '무기' }
  ];

  // Pick a random or first available Nikke for preview
  const previewNikke = nikkes && nikkes.length > 0 ? nikkes.find(n => n.name === '레드 후드' || n.name === '모더니아') || nikkes[0] : null;

  return (
    <div className="lobby-card" style={{ marginBottom: '2.5rem', backgroundColor: 'var(--surface-2)', border: 'none', padding: '2rem' }}>
      <h3 style={{ color: 'var(--text-strong)', borderBottom: '1px solid var(--border-2)', paddingBottom: '0.8rem', marginBottom: '1.5rem' }}>니케 초상화 정보 표시 설정</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        현황판이나 모의전 기록에서 보여지는 니케 초상화의 4개 모서리에 어떤 정보를 표시할지 설정합니다. 설정은 현재 브라우저에 저장됩니다.
      </p>

      <div style={{ display: 'flex', gap: '30px', alignItems: 'center', flexWrap: 'wrap' }}>
        
        {/* Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>미리보기</div>
          {previewNikke ? (
            <NikkeAvatar nikkeId={previewNikke.id} size={100} style={{ border: '2px solid var(--border-3)' }} />
          ) : (
            <div style={{ width: 100, height: 100, backgroundColor: 'var(--surface-1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>...</div>
          )}
        </div>

        {/* Controls */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.85rem' }}>좌측 상단</label>
            <select 
              value={corners.topLeft} 
              onChange={e => handleCornerChange('topLeft', e.target.value)}
              style={{ width: '100%', padding: '10px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px' }}
            >
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.85rem' }}>우측 상단</label>
            <select 
              value={corners.topRight} 
              onChange={e => handleCornerChange('topRight', e.target.value)}
              style={{ width: '100%', padding: '10px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px' }}
            >
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.85rem' }}>좌측 하단</label>
            <select 
              value={corners.bottomLeft} 
              onChange={e => handleCornerChange('bottomLeft', e.target.value)}
              style={{ width: '100%', padding: '10px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px' }}
            >
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.85rem' }}>우측 하단</label>
            <select 
              value={corners.bottomRight} 
              onChange={e => handleCornerChange('bottomRight', e.target.value)}
              style={{ width: '100%', padding: '10px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px' }}
            >
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

        </div>
      </div>
    </div>
  );
}
