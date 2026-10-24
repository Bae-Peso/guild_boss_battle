import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function ProfileImageManagement() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);

  // 수정 상태 관리
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editAliases, setEditAliases] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [updateLoading, setUpdateLoading] = useState(false);

  useEffect(() => {
    fetchImages();
  }, []);

  const fetchImages = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profile_images')
      .select('*')
      .order('name', { ascending: true });
    
    if (error) {
      console.error(error);
      alert('프로필 이미지 목록을 불러오는데 실패했습니다.');
    } else {
      setImages(data || []);
    }
    setLoading(false);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim()) return;

    setSubmitLoading(true);
    const { error } = await supabase
      .from('profile_images')
      .insert({
        name: newName.trim(),
        aliases: newAliases.trim(),
        image_url: newUrl.trim()
      });

    if (error) {
      console.error(error);
      alert('추가 실패: ' + error.message);
    } else {
      setNewName('');
      setNewAliases('');
      setNewUrl('');
      fetchImages();
    }
    setSubmitLoading(false);
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`'${name}' 이미지를 삭제하시겠습니까? (이 이미지를 사용중인 유저는 기본값으로 돌아갑니다)`)) return;
    
    const { error } = await supabase
      .from('profile_images')
      .delete()
      .eq('id', id);
      
    if (error) {
      console.error(error);
      alert('삭제 실패: ' + error.message);
    } else {
      setImages(prev => prev.filter(img => img.id !== id));
    }
  };

  const handleEditClick = (img) => {
    setEditingId(img.id);
    setEditName(img.name);
    setEditAliases(img.aliases || '');
    setEditUrl(img.image_url);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditAliases('');
    setEditUrl('');
  };

  const handleUpdate = async (e, id) => {
    e.preventDefault();
    if (!editName.trim() || !editUrl.trim()) return;

    setUpdateLoading(true);
    const { error } = await supabase
      .from('profile_images')
      .update({
        name: editName.trim(),
        aliases: editAliases.trim(),
        image_url: editUrl.trim()
      })
      .eq('id', id);

    if (error) {
      console.error(error);
      alert('수정 실패: ' + error.message);
    } else {
      setEditingId(null);
      fetchImages();
    }
    setUpdateLoading(false);
  };

  return (
    <div className="admin-page-container fade-in">
      <h2>기본 프로필 이미지 설정</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>유저들이 선택할 수 있는 기본 프로필 이미지를 등록하고 관리합니다.</p>
      
      <div className="admin-card" style={{ marginBottom: '30px' }}>
        <h3>새 이미지 등록</h3>
        <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.8fr auto', gap: '15px', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>이름 (대체텍스트)</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="예: 라피 기본"
              required
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>축약어 (쉼표 구분)</label>
            <input
              type="text"
              value={newAliases}
              onChange={e => setNewAliases(e.target.value)}
              placeholder="예: 라피, 라삐"
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>이미지 URL</label>
            <input 
              type="url" 
              value={newUrl} 
              onChange={e => setNewUrl(e.target.value)} 
              placeholder="https://..."
              required 
            />
          </div>
          <button type="submit" className="primary-btn" disabled={submitLoading} style={{ padding: '12px 20px', height: '46px' }}>
            {submitLoading ? '추가 중...' : '추가'}
          </button>
        </form>
      </div>

      <div className="admin-card">
        <h3>등록된 이미지 목록 ({images.length})</h3>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>로딩 중...</div>
        ) : images.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>등록된 이미지가 없습니다.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', marginTop: '20px' }}>
            {images.map(img => (
              <div key={img.id} style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px', backgroundColor: 'var(--surface-1)', display: 'flex', justifyContent: 'center', position: 'relative' }}>
                  <img 
                    src={editingId === img.id ? editUrl : img.image_url} 
                    alt={editingId === img.id ? editName : img.name} 
                    style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border-3)' }} 
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23333"/><text x="40" y="45" font-family="sans-serif" font-size="12" fill="%23888" text-anchor="middle">Error</text></svg>';
                    }}
                  />
                </div>
                <div style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {editingId === img.id ? (
                    <form onSubmit={(e) => handleUpdate(e, img.id)} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="이름"
                        required
                        style={{ padding: '5px', borderRadius: '4px', border: '1px solid var(--border-3)', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)' }}
                      />
                      <input
                        type="text"
                        value={editAliases}
                        onChange={e => setEditAliases(e.target.value)}
                        placeholder="축약어 (쉼표 구분)"
                        style={{ padding: '5px', borderRadius: '4px', border: '1px solid var(--border-3)', backgroundColor: 'var(--surface-1)', color: 'var(--text-muted)' }}
                      />
                      <input
                        type="url"
                        value={editUrl}
                        onChange={e => setEditUrl(e.target.value)}
                        placeholder="URL"
                        required
                        style={{ padding: '5px', borderRadius: '4px', border: '1px solid var(--border-3)', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)' }}
                      />
                      <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}>
                        <button type="submit" disabled={updateLoading} style={{ flex: 1, padding: '6px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--accent-green)', color: 'var(--text-inverse)', cursor: 'pointer', fontWeight: 'bold' }}>
                          {updateLoading ? '...' : '저장'}
                        </button>
                        <button type="button" onClick={handleCancelEdit} style={{ flex: 1, padding: '6px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--border-3)', color: 'var(--text-strong)', cursor: 'pointer' }}>
                          취소
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div style={{ fontWeight: 'bold', color: 'var(--text-strong)', fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {img.name}
                      </div>
                      {img.aliases && (
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={img.aliases}>
                          🔎 {img.aliases}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                        <button 
                          onClick={() => handleEditClick(img)} 
                          className="secondary-btn"
                          style={{ flex: 1, padding: '8px' }}
                        >
                          수정
                        </button>
                        <button 
                          onClick={() => handleDelete(img.id, img.name)} 
                          className="secondary-btn"
                          style={{ flex: 1, padding: '8px', color: 'var(--danger-bright)', borderColor: 'var(--danger-bright)' }}
                        >
                          삭제
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
