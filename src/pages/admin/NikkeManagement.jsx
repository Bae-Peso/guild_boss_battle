import { useEffect, useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { BURST_BIT, burstMaskToLabel } from '../../utils/burst';

export default function NikkeManagement() {
  const [nikkes, setNikkes] = useState([]);
  const [loading, setLoading] = useState(true);

  // View & Search states
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'card'
  const [searchQuery, setSearchQuery] = useState('');
  
  // Sort states
  const [sortField, setSortField] = useState('id');
  const [sortDir, setSortDir] = useState('asc');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form states
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [altText, setAltText] = useState('');
  
  const [imageUploadMode, setImageUploadMode] = useState('url'); // 'url' | 'file'
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageFile, setImageFile] = useState(null);
  
  const [burstType, setBurstType] = useState(1);
  const [className, setClassName] = useState('화력형');
  const [manufacturer, setManufacturer] = useState('엘리시온');
  const [weapon, setWeapon] = useState('AR');
  const [element, setElement] = useState('작열');
  
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const fetchNikkes = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('nikkes').select('*');
    if (data) setNikkes(data);
    else if (error) console.error("Nikkes fetch error:", error);
    setLoading(false);
  };

  useEffect(() => {
    fetchNikkes();
  }, []);

  const openNewModal = () => {
    setEditingId(null);
    setName('');
    setAliases('');
    setAltText('');
    setImageUrlInput('');
    setImageFile(null);
    setBurstType(1);
    setClassName('화력형');
    setManufacturer('엘리시온');
    setWeapon('AR');
    setElement('작열');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsModalOpen(true);
  };

  const handleEdit = (n) => {
    setEditingId(n.id);
    setName(n.name);
    setAliases(n.aliases || '');
    setAltText(n.alt_text || '');
    setBurstType(n.burst_type);
    setClassName(n.class);
    setManufacturer(n.manufacturer);
    setWeapon(n.weapon);
    setElement(n.element);
    
    setImageUploadMode('url');
    setImageUrlInput(n.image_url || '');
    setImageFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const handleAliasUpdate = async (id, newAliases) => {
    // Optimistic update
    setNikkes(prev => prev.map(n => n.id === id ? { ...n, aliases: newAliases } : n));
    const { error } = await supabase.from('nikkes').update({ aliases: newAliases }).eq('id', id);
    if (error) {
      alert('축약어 업데이트 실패: ' + error.message);
      fetchNikkes(); // revert
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return alert('이름을 입력해주세요.');
    if (!burstType) return alert('버스트 단계를 하나 이상 선택해주세요.');

    if (imageUploadMode === 'file' && !imageFile && !editingId) {
      return alert('이미지를 첨부해주세요.');
    }
    if (imageUploadMode === 'url' && !imageUrlInput.trim() && !editingId) {
      return alert('이미지 URL을 입력해주세요.');
    }
    
    setSubmitting(true);
    let finalImageUrl = imageUrlInput;
    
    if (imageUploadMode === 'file' && imageFile) {
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('nikke_images')
        .upload(fileName, imageFile);

      if (uploadError) {
        alert(`이미지 업로드 실패: ${uploadError.message}`);
        setSubmitting(false);
        return;
      }
      const { data: { publicUrl } } = supabase.storage
        .from('nikke_images')
        .getPublicUrl(fileName);
        
      finalImageUrl = publicUrl;
    }

    const payload = {
      name: name.trim(),
      aliases: aliases.trim(),
      alt_text: altText.trim(),
      burst_type: burstType,
      class: className,
      manufacturer: manufacturer,
      weapon: weapon,
      element: element,
    };
    
    if (finalImageUrl) {
      payload.image_url = finalImageUrl;
    }

    let error;
    if (editingId) {
      const { error: updateErr } = await supabase.from('nikkes').update(payload).eq('id', editingId);
      error = updateErr;
    } else {
      const { error: insertErr } = await supabase.from('nikkes').insert(payload);
      error = insertErr;
    }

    if (error) {
      alert(`DB 저장 실패: ${error.message}`);
    } else {
      alert(editingId ? '성공적으로 수정되었습니다.' : '성공적으로 등록되었습니다.');
      closeModal();
      fetchNikkes();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id, imageUrl) => {
    if (!window.confirm('정말 삭제하시겠습니까? (이미지도 함께 삭제됩니다)')) return;
    
    if (imageUrl && imageUrl.includes('supabase.co/storage')) {
      try {
        const urlObj = new URL(imageUrl);
        const parts = urlObj.pathname.split('/');
        const fileName = parts[parts.length - 1];
        if (fileName) {
          await supabase.storage.from('nikke_images').remove([fileName]);
        }
      } catch (err) {
        console.warn('Failed to parse or delete image', err);
      }
    }
    
    const { error } = await supabase.from('nikkes').delete().eq('id', id);
    if (!error) fetchNikkes();
    else alert(`삭제 중 오류 발생: ${error.message}`);
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  let filteredNikkes = nikkes.filter(n => {
    const q = searchQuery.toLowerCase();
    return (
      n.name.toLowerCase().includes(q) ||
      (n.aliases && n.aliases.toLowerCase().includes(q)) ||
      n.manufacturer.toLowerCase().includes(q)
    );
  });

  filteredNikkes.sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];
    
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const SortableTh = ({ field, children, width }) => (
    <th 
      onClick={() => handleSort(field)}
      style={{ padding: '12px', color: 'var(--text-muted)', fontWeight: 'bold', cursor: 'pointer', width: width }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {children}
        {sortField === field && (
          <span style={{ fontSize: '0.8rem', color: 'var(--accent-green)' }}>
            {sortDir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </div>
    </th>
  );

  return (
    <div className="admin-content-inner" style={{ paddingBottom: '5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ margin: '0 0 5px 0' }}>니케 도감 관리</h2>
          <p style={{ margin: 0, color: 'var(--text-dim)' }}>새로운 니케를 등록하고 기존 도감을 관리합니다.</p>
        </div>
        <button onClick={openNewModal} className="primary-btn" style={{ padding: '8px 16px', fontSize: '1rem' }}>
          + 신규 니케 등록
        </button>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>목록 ({filteredNikkes.length}명)</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input 
            type="text" 
            placeholder="이름/축약어/기업 검색..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--border-2)', backgroundColor: 'var(--border-color)', color: 'var(--text-strong)' }}
          />
          <div style={{ display: 'flex', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
            <button 
              onClick={() => setViewMode('table')}
              style={{ padding: '6px 12px', backgroundColor: viewMode === 'table' ? '#4f46e5' : 'transparent', color: 'var(--text-strong)', border: 'none', cursor: 'pointer' }}
            >표</button>
            <button 
              onClick={() => setViewMode('card')}
              style={{ padding: '6px 12px', backgroundColor: viewMode === 'card' ? '#4f46e5' : 'transparent', color: 'var(--text-strong)', border: 'none', cursor: 'pointer' }}
            >카드</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div>로딩 중...</div>
      ) : filteredNikkes.length === 0 ? (
        <div style={{ color: 'var(--text-dim)' }}>조건에 맞는 니케가 없습니다.</div>
      ) : viewMode === 'table' ? (
        <div style={{ overflowX: 'auto', backgroundColor: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border-2)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-1)', borderBottom: '1px solid var(--border-2)' }}>
                <SortableTh field="id" width="60px">ID</SortableTh>
                <th style={{ padding: '12px', color: 'var(--text-muted)', fontWeight: 'bold', width: '60px' }}>이미지</th>
                <SortableTh field="name">이름 및 축약어</SortableTh>
                <SortableTh field="manufacturer">기업</SortableTh>
                <SortableTh field="burst_type">버스트</SortableTh>
                <SortableTh field="element">속성</SortableTh>
                <SortableTh field="weapon">무기</SortableTh>
                <SortableTh field="class">클래스</SortableTh>
                <th style={{ padding: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredNikkes.map(n => (
                <tr key={n.id} style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <td style={{ padding: '12px', color: 'var(--text-dim)' }}>{n.id}</td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ width: '40px', height: '40px', backgroundColor: 'var(--surface-1)', borderRadius: '4px', overflow: 'hidden' }}>
                      {n.image_url && <img src={n.image_url} alt={n.alt_text || n.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-strong)', marginBottom: '4px' }}>{n.name}</div>
                    <input 
                      type="text" 
                      defaultValue={n.aliases || ''} 
                      onBlur={(e) => handleAliasUpdate(n.id, e.target.value)}
                      placeholder="축약어 (쉼표 구분)"
                      style={{ padding: '2px 6px', fontSize: '0.75rem', backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-2)', color: 'var(--text-muted)', borderRadius: '4px', width: '100%' }}
                    />
                  </td>
                  <td style={{ padding: '12px' }}>{n.manufacturer}</td>
                  <td style={{ padding: '12px' }}>B{burstMaskToLabel(n.burst_type)}</td>
                  <td style={{ padding: '12px' }}>{n.element}</td>
                  <td style={{ padding: '12px' }}>{n.weapon}</td>
                  <td style={{ padding: '12px' }}>{n.class}</td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleEdit(n)} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '0.85rem' }}>수정</button>
                      <button onClick={() => handleDelete(n.id, n.image_url)} className="btn-danger" style={{ padding: '4px 8px', fontSize: '0.85rem' }}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {filteredNikkes.map(n => (
            <div key={n.id} style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-2)', position: 'relative' }}>
              <div style={{ aspectRatio: '1', backgroundColor: 'var(--surface-1)', position: 'relative' }}>
                <img src={n.image_url} alt={n.alt_text || n.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', top: '5px', left: '5px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  B{burstMaskToLabel(n.burst_type)}
                </div>
              </div>
              <div style={{ padding: '10px' }}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: 'var(--text-strong)' }}>{n.name}</h4>
                <input 
                  type="text" 
                  defaultValue={n.aliases || ''} 
                  onBlur={(e) => handleAliasUpdate(n.id, e.target.value)}
                  placeholder="축약어 입력..."
                  style={{ padding: '2px 6px', fontSize: '0.75rem', backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-2)', color: 'var(--text-muted)', borderRadius: '4px', width: '100%', marginBottom: '8px' }}
                />
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  <span style={{ backgroundColor: 'var(--border-color)', padding: '2px 6px', borderRadius: '4px' }}>{n.class}</span>
                  <span style={{ backgroundColor: 'var(--border-color)', padding: '2px 6px', borderRadius: '4px' }}>{n.manufacturer}</span>
                  <span style={{ backgroundColor: 'var(--border-color)', padding: '2px 6px', borderRadius: '4px' }}>{n.weapon}</span>
                  <span style={{ backgroundColor: 'var(--border-color)', padding: '2px 6px', borderRadius: '4px' }}>{n.element}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button onClick={() => handleEdit(n)} className="btn-secondary" style={{ flex: 1, padding: '4px', fontSize: '0.85rem' }}>수정</button>
                  <button onClick={() => handleDelete(n.id, n.image_url)} className="btn-danger" style={{ flex: 1, padding: '4px', fontSize: '0.85rem' }}>삭제</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Overlay */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: '#1e2430', width: '90%', maxWidth: '600px', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--text-strong)' }}>{editingId ? '니케 정보 수정' : '신규 니케 등록'}</h3>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', color: 'var(--text-strong)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>
            
            <div style={{ padding: '20px', overflowY: 'auto' }}>
              <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>니케 이름</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} required />
                </div>
                
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>축약어 사전 (쉼표로 구분)</label>
                  <input type="text" value={aliases} onChange={e => setAliases(e.target.value)} placeholder="예: 흑영, 흑련" />
                  <small style={{ color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>표 뷰에서 직접 수정하는 것도 가능합니다.</small>
                </div>
                
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>초상화 이미지</label>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input type="radio" name="imageMode" checked={imageUploadMode === 'url'} onChange={() => setImageUploadMode('url')} /> URL 입력
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input type="radio" name="imageMode" checked={imageUploadMode === 'file'} onChange={() => setImageUploadMode('file')} /> 파일 업로드
                    </label>
                  </div>
                  {imageUploadMode === 'url' ? (
                    <input type="url" value={imageUrlInput} onChange={e => setImageUrlInput(e.target.value)} placeholder="https://..." style={{ width: '100%' }} />
                  ) : (
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={e => setImageFile(e.target.files[0])} style={{ padding: '0.5rem', backgroundColor: 'var(--border-color)', border: '1px solid var(--border-2)', borderRadius: '4px', width: '100%', color: 'var(--text-strong)' }} />
                  )}
                </div>
                
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>대체 텍스트 (이미지 로드 실패시 텍스트)</label>
                  <input type="text" value={altText} onChange={e => setAltText(e.target.value)} placeholder="예: 레드후드 이미지" />
                </div>

                <div className="form-group">
                  <label>버스트 단계 (중복 선택 가능)</label>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    {[1, 2, 3].map(stage => {
                      const bit = BURST_BIT[stage];
                      return (
                        <label key={stage} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={(burstType & bit) !== 0}
                            onChange={() => setBurstType(burstType ^ bit)}
                          />
                          {stage}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label>클래스</label>
                  <select value={className} onChange={e => setClassName(e.target.value)} required>
                    <option value="화력형">화력형</option>
                    <option value="방어형">방어형</option>
                    <option value="지원형">지원형</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>기업</label>
                  <select value={manufacturer} onChange={e => setManufacturer(e.target.value)} required>
                    <option value="엘리시온">엘리시온</option>
                    <option value="미실리스">미실리스</option>
                    <option value="테트라">테트라</option>
                    <option value="필그림">필그림</option>
                    <option value="어브노멀">어브노멀</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>무기</label>
                  <select value={weapon} onChange={e => setWeapon(e.target.value)} required>
                    <option value="AR">AR</option>
                    <option value="SMG">SMG</option>
                    <option value="SG">SG</option>
                    <option value="SR">SR</option>
                    <option value="RL">RL</option>
                    <option value="MG">MG</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>속성</label>
                  <select value={element} onChange={e => setElement(e.target.value)} required>
                    <option value="작열">작열</option>
                    <option value="수냉">수냉</option>
                    <option value="풍압">풍압</option>
                    <option value="철갑">철갑</option>
                    <option value="전격">전격</option>
                  </select>
                </div>

                <div style={{ gridColumn: '1 / -1', marginTop: '10px' }}>
                  <button type="submit" className="primary-btn w-full" disabled={submitting} style={{ padding: '12px' }}>
                    {submitting ? '처리 중...' : (editingId ? '수정 내용 저장' : '신규 니케 등록')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
