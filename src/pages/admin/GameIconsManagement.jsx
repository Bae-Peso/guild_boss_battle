import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useGameData } from '../../contexts/GameDataContext';

export default function GameIconsManagement() {
  const { gameIcons, refreshGameData } = useGameData();
  const [loading, setLoading] = useState(false);
  const [icons, setIcons] = useState([]);

  useEffect(() => {
    if (gameIcons) setIcons(gameIcons);
  }, [gameIcons]);

  const handleUpdate = async (id, newUrl) => {
    setLoading(true);
    const { error } = await supabase.from('game_icons').update({ image_url: newUrl }).eq('id', id);
    if (error) {
      alert('오류: ' + error.message);
    } else {
      await refreshGameData();
    }
    setLoading(false);
  };

  const grouped = icons.reduce((acc, icon) => {
    if (!acc[icon.category]) acc[icon.category] = [];
    acc[icon.category].push(icon);
    return acc;
  }, {});

  const categories = ['manufacturer', 'burst', 'element', 'class', 'weapon'];
  const catNames = { manufacturer: '기업', burst: '버스트', element: '속성', class: '클래스', weapon: '무기' };

  return (
    <div style={{ padding: '2rem' }}>
      <h2 style={{ color: 'var(--text-strong)' }}>게임 아이콘 관리</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>니케 초상화 오버레이에 사용될 아이콘 이미지 URL을 등록하세요. (수정 후 커서를 바깥으로 빼면 자동 저장됩니다.)</p>

      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: '2rem', backgroundColor: 'var(--surface-2)', padding: '1rem', borderRadius: '8px' }}>
          <h3 style={{ borderBottom: '1px solid var(--border-2)', paddingBottom: '0.5rem', color: 'var(--text-strong)', margin: 0 }}>{catNames[cat]}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-1)' }}>
                <th style={{ padding: '10px', textAlign: 'left', width: '20%', color: 'var(--text-muted)' }}>이름</th>
                <th style={{ padding: '10px', textAlign: 'left', width: '15%', color: 'var(--text-muted)' }}>미리보기</th>
                <th style={{ padding: '10px', textAlign: 'left', color: 'var(--text-muted)' }}>이미지 URL</th>
              </tr>
            </thead>
            <tbody>
              {(grouped[cat] || []).map(icon => (
                <tr key={icon.id} style={{ borderBottom: '1px solid var(--border-1)' }}>
                  <td style={{ padding: '10px', color: 'var(--text-strong)' }}>{icon.name}</td>
                  <td style={{ padding: '10px' }}>
                    {icon.image_url ? (
                      <img src={icon.image_url} alt={icon.name} style={{ width: '30px', height: '30px', objectFit: 'contain', backgroundColor: '#111', padding: '2px', borderRadius: '4px' }} />
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>없음</span>
                    )}
                  </td>
                  <td style={{ padding: '10px', display: 'flex', gap: '10px' }}>
                    <input 
                      type="text" 
                      defaultValue={icon.image_url || ''} 
                      onBlur={e => {
                        if (e.target.value !== (icon.image_url || '')) {
                          handleUpdate(icon.id, e.target.value);
                        }
                      }}
                      placeholder="https://..."
                      style={{ flex: 1, padding: '8px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
