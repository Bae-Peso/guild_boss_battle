import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useGameData } from '../../contexts/GameDataContext';
import { uploadEmoticonImage, removeEmoticonImages, EMOTICON_ACCEPT } from '../../lib/emoticonImage';

// 채팅 이모티콘 관리 (사이트 관리자 전용)
// - 패키지(카테고리) 단위로 이모티콘을 등록한다. 등록된 이모티콘은 모든 유저가 채팅에서 사용한다.
// - 이미지는 파일로 올려 emoticon_images 버킷에 보관한다. 애니메이션 WebP/GIF 는 반복 횟수를 무한으로 고쳐 올린다.
//   (예전에 URL 로 등록한 이모티콘도 그대로 표시된다)
export default function EmoticonManagement() {
  const { refreshGameData } = useGameData();
  const [packs, setPacks] = useState([]); // [{...pack, emoticons: [...]}]
  const [loading, setLoading] = useState(true);

  // 패키지 추가
  const [newPackName, setNewPackName] = useState('');
  const [newPackSort, setNewPackSort] = useState('');

  // 이모티콘 추가
  const [selectedPackId, setSelectedPackId] = useState('');
  const [newEmoName, setNewEmoName] = useState('');
  const [newEmoFiles, setNewEmoFiles] = useState([]);
  const [newEmoPreviews, setNewEmoPreviews] = useState([]);
  const [newEmoSort, setNewEmoSort] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const fileInputRef = useRef(null);

  // 이모티콘 수정
  const [editingEmoId, setEditingEmoId] = useState(null);
  const [editEmoName, setEditEmoName] = useState('');
  const [editEmoFile, setEditEmoFile] = useState(null);
  const [editEmoPreview, setEditEmoPreview] = useState('');
  const [editEmoSort, setEditEmoSort] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  // 선택한 파일 미리보기용 object URL 정리
  useEffect(() => {
    const urls = newEmoFiles.map(f => URL.createObjectURL(f));
    setNewEmoPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u));
  }, [newEmoFiles]);

  useEffect(() => {
    if (!editEmoFile) { setEditEmoPreview(''); return; }
    const u = URL.createObjectURL(editEmoFile);
    setEditEmoPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [editEmoFile]);

  const fetchData = async () => {
    setLoading(true);
    const [packsRes, emojisRes] = await Promise.all([
      supabase.from('emoticon_packs').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('emoticons').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
    ]);

    if (packsRes.error) {
      console.error(packsRes.error);
      alert('이모티콘 패키지를 불러오지 못했습니다. (마이그레이션 add_chat_emoticons.sql 실행 여부를 확인하세요)');
      setLoading(false);
      return;
    }

    const byPack = {};
    (emojisRes.data || []).forEach(e => { (byPack[e.pack_id] = byPack[e.pack_id] || []).push(e); });
    const grouped = (packsRes.data || []).map(p => ({ ...p, emoticons: byPack[p.id] || [] }));
    setPacks(grouped);
    if (!selectedPackId && grouped.length > 0) setSelectedPackId(grouped[0].id);
    setLoading(false);
  };

  // 변경 후 관리 화면 + 전역(채팅 선택창) 데이터 모두 갱신
  const refreshAll = async () => {
    await fetchData();
    refreshGameData();
  };

  const handleAddPack = async (e) => {
    e.preventDefault();
    if (!newPackName.trim()) return;
    const { error } = await supabase.from('emoticon_packs').insert({
      name: newPackName.trim(),
      sort_order: newPackSort ? parseInt(newPackSort) : 0
    });
    if (error) {
      console.error(error);
      alert('패키지 추가 실패: ' + error.message);
    } else {
      setNewPackName('');
      setNewPackSort('');
      refreshAll();
    }
  };

  const handleDeletePack = async (pack) => {
    const { id, name } = pack;
    const count = pack.emoticons.length;
    if (!confirm(`'${name}' 패키지를 삭제하시겠습니까?${count > 0 ? `\n소속된 이모티콘 ${count}개도 함께 삭제되며, 이미 보낸 채팅에서도 보이지 않게 됩니다.` : ''}`)) return;
    const { error } = await supabase.from('emoticon_packs').delete().eq('id', id);
    if (error) {
      console.error(error);
      alert('삭제 실패: ' + error.message);
    } else {
      await removeEmoticonImages(pack.emoticons.map(e => e.image_url));
      if (selectedPackId === id) setSelectedPackId('');
      refreshAll();
    }
  };

  // 파일 이름에서 확장자를 뗀 것을 기본 이모티콘 이름으로 쓴다.
  const baseName = (fileName) => fileName.replace(/\.[^.]+$/, '');

  // 여러 파일을 한 번에 올릴 수 있다. 이름을 비우면 파일 이름을 쓰고, 정렬 순서는 입력값부터 1씩 늘린다.
  const handleAddEmoticon = async (e) => {
    e.preventDefault();
    if (!selectedPackId) { alert('패키지를 먼저 선택/생성해주세요.'); return; }
    if (newEmoFiles.length === 0) { alert('이미지 파일을 선택해주세요.'); return; }

    setSubmitLoading(true);
    const startSort = newEmoSort ? parseInt(newEmoSort) : 0;
    const single = newEmoFiles.length === 1;
    const failed = [];
    let loopFixedCount = 0;

    for (let i = 0; i < newEmoFiles.length; i++) {
      const file = newEmoFiles[i];
      let uploaded = null;
      try {
        uploaded = await uploadEmoticonImage(file, selectedPackId);
        const { error } = await supabase.from('emoticons').insert({
          pack_id: selectedPackId,
          name: (single && newEmoName.trim()) || baseName(file.name),
          image_url: uploaded.url,
          sort_order: startSort + i
        });
        if (error) throw error;
        if (uploaded.loopFixed) loopFixedCount++;
      } catch (err) {
        console.error(err);
        if (uploaded) await removeEmoticonImages([uploaded.url]);
        failed.push(`${file.name}: ${err.message}`);
      }
    }

    setSubmitLoading(false);
    const okCount = newEmoFiles.length - failed.length;
    if (failed.length > 0) {
      alert(`${okCount}개 추가, ${failed.length}개 실패\n\n${failed.join('\n')}`);
    } else if (loopFixedCount > 0) {
      alert(`${okCount}개 추가 완료. 애니메이션 ${loopFixedCount}개는 무한 반복으로 바꿔서 올렸습니다.`);
    }
    setNewEmoName('');
    setNewEmoFiles([]);
    setNewEmoSort('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    refreshAll();
  };

  const handleDeleteEmoticon = async (emo) => {
    if (!confirm(`'${emo.name}' 이모티콘을 삭제하시겠습니까?\n이미 보낸 채팅에서도 보이지 않게 됩니다.`)) return;
    const { error } = await supabase.from('emoticons').delete().eq('id', emo.id);
    if (error) {
      console.error(error);
      alert('삭제 실패: ' + error.message);
    } else {
      await removeEmoticonImages([emo.image_url]);
      refreshAll();
    }
  };

  const startEditEmoticon = (emo) => {
    setEditingEmoId(emo.id);
    setEditEmoName(emo.name);
    setEditEmoFile(null);
    setEditEmoSort((emo.sort_order ?? 0).toString());
  };

  // 이미지를 바꾸면 새 파일을 먼저 올리고, 저장에 성공한 뒤에 옛 파일을 지운다.
  // (이미 보낸 채팅은 옛 URL 을 들고 있으므로, 이미지를 바꾸면 지난 채팅의 이모티콘은 보이지 않게 된다)
  const handleUpdateEmoticon = async (e, emo) => {
    e.preventDefault();
    if (!editEmoName.trim()) return;
    if (editEmoFile && !confirm('이미지를 바꾸면 이미 보낸 채팅의 이 이모티콘은 보이지 않게 됩니다. 계속할까요?')) return;

    setEditLoading(true);
    let uploaded = null;
    try {
      if (editEmoFile) uploaded = await uploadEmoticonImage(editEmoFile, emo.pack_id);
      const { error } = await supabase.from('emoticons').update({
        name: editEmoName.trim(),
        ...(uploaded ? { image_url: uploaded.url } : {}),
        sort_order: editEmoSort ? parseInt(editEmoSort) : 0
      }).eq('id', emo.id);
      if (error) throw error;
      if (uploaded) await removeEmoticonImages([emo.image_url]);
      setEditingEmoId(null);
      setEditEmoFile(null);
      refreshAll();
    } catch (err) {
      console.error(err);
      if (uploaded) await removeEmoticonImages([uploaded.url]);
      alert('수정 실패: ' + err.message);
    }
    setEditLoading(false);
  };

  const imgFallback = (e) => {
    e.target.onerror = null;
    e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23333"/><text x="32" y="37" font-family="sans-serif" font-size="11" fill="%23888" text-anchor="middle">Error</text></svg>';
  };

  const totalEmoticons = packs.reduce((sum, p) => sum + p.emoticons.length, 0);

  return (
    <div className="admin-page-container fade-in">
      <h2>채팅 이모티콘 관리</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
        패키지(카테고리)별로 이모티콘을 등록합니다. 등록된 이모티콘은 모든 유저가 채팅에서 사용할 수 있습니다. (WebP, GIF, PNG, JPG 파일 · 최대 5MB. 애니메이션은 무한 반복으로 바꿔서 저장됩니다)
      </p>

      {/* 패키지 관리 */}
      <div className="admin-card" style={{ marginBottom: '30px' }}>
        <h3>패키지(카테고리) 관리</h3>
        <form onSubmit={handleAddPack} style={{ display: 'grid', gridTemplateColumns: '2fr 100px auto', gap: '15px', alignItems: 'end', marginBottom: '20px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>패키지 이름</label>
            <input type="text" value={newPackName} onChange={e => setNewPackName(e.target.value)} placeholder="예: 기본 이모티콘" required />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>정렬 순서</label>
            <input type="number" value={newPackSort} onChange={e => setNewPackSort(e.target.value)} placeholder="0" />
          </div>
          <button type="submit" className="primary-btn" style={{ padding: '12px 20px', height: '46px' }}>패키지 추가</button>
        </form>

        {packs.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>등록된 패키지가 없습니다. 먼저 패키지를 추가하세요.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {packs.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-1)', borderRadius: '8px', padding: '8px 12px' }}>
                <span style={{ color: 'var(--text-strong)', fontWeight: 'bold' }}>{p.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>순서 {p.sort_order} · {p.emoticons.length}개</span>
                <button onClick={() => handleDeletePack(p)} className="secondary-btn" style={{ padding: '4px 10px', color: 'var(--danger-bright)', borderColor: 'var(--danger-bright)' }}>삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 이모티콘 추가 */}
      <div className="admin-card" style={{ marginBottom: '30px' }}>
        <h3>이모티콘 등록</h3>
        <form onSubmit={handleAddEmoticon} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 2fr 100px auto', gap: '15px', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>패키지</label>
            <select value={selectedPackId} onChange={e => setSelectedPackId(e.target.value)} style={{ width: '100%', padding: '12px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-0)', color: 'var(--text-strong)' }}>
              <option value="">패키지 선택</option>
              {packs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>이름 (대체텍스트)</label>
            <input
              type="text"
              value={newEmoName}
              onChange={e => setNewEmoName(e.target.value)}
              placeholder={newEmoFiles.length > 1 ? '여러 개는 파일 이름으로 등록' : '비우면 파일 이름'}
              disabled={newEmoFiles.length > 1}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>이미지 파일 (여러 개 선택 가능)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept={EMOTICON_ACCEPT}
              multiple
              onChange={e => setNewEmoFiles(Array.from(e.target.files || []))}
              style={{ padding: '9px', border: '1px solid var(--border-1)', borderRadius: '4px', background: 'var(--surface-0)', color: 'var(--text-strong)', width: '100%' }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>정렬 순서</label>
            <input type="number" value={newEmoSort} onChange={e => setNewEmoSort(e.target.value)} placeholder="0" />
          </div>
          <button type="submit" className="primary-btn" disabled={submitLoading} style={{ padding: '12px 20px', height: '46px' }}>
            {submitLoading ? '올리는 중...' : '추가'}
          </button>
        </form>
        {newEmoPreviews.length > 0 && (
          <div style={{ marginTop: '15px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>미리보기 ({newEmoPreviews.length}):</span>
            {newEmoPreviews.map((src, i) => (
              <img key={src} src={src} alt={newEmoFiles[i]?.name} title={newEmoFiles[i]?.name} onError={imgFallback} style={{ width: '64px', height: '64px', objectFit: 'contain', backgroundColor: 'var(--surface-1)', borderRadius: '8px' }} />
            ))}
          </div>
        )}
      </div>

      {/* 등록된 이모티콘 목록 */}
      <div className="admin-card">
        <h3>등록된 이모티콘 ({totalEmoticons})</h3>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>로딩 중...</div>
        ) : totalEmoticons === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>등록된 이모티콘이 없습니다.</div>
        ) : (
          packs.filter(p => p.emoticons.length > 0).map(p => (
            <div key={p.id} style={{ marginTop: '20px' }}>
              <h4 style={{ color: 'var(--text-strong)', borderBottom: '1px solid var(--border-1)', paddingBottom: '8px', marginBottom: '15px' }}>
                {p.name} <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 'normal' }}>({p.emoticons.length})</span>
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '15px' }}>
                {p.emoticons.map(emo => (
                  <div key={emo.id} style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '15px', backgroundColor: 'var(--surface-1)', display: 'flex', justifyContent: 'center' }}>
                      <img src={(editingEmoId === emo.id && editEmoPreview) || emo.image_url} alt={emo.name} onError={imgFallback} style={{ width: '72px', height: '72px', objectFit: 'contain' }} />
                    </div>
                    <div style={{ padding: '12px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {editingEmoId === emo.id ? (
                        <form onSubmit={(e) => handleUpdateEmoticon(e, emo)} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <input type="text" value={editEmoName} onChange={e => setEditEmoName(e.target.value)} placeholder="이름" required style={{ padding: '5px', borderRadius: '4px', border: '1px solid var(--border-3)', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)' }} />
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            이미지 교체 (선택)
                            <input type="file" accept={EMOTICON_ACCEPT} onChange={e => setEditEmoFile(e.target.files?.[0] || null)} style={{ width: '100%', marginTop: '3px', fontSize: '0.75rem', color: 'var(--text-strong)' }} />
                          </label>
                          <input type="number" value={editEmoSort} onChange={e => setEditEmoSort(e.target.value)} placeholder="정렬" style={{ padding: '5px', borderRadius: '4px', border: '1px solid var(--border-3)', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)' }} />
                          <div style={{ display: 'flex', gap: '5px' }}>
                            <button type="submit" disabled={editLoading} style={{ flex: 1, padding: '6px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--accent-green)', color: 'var(--text-inverse)', cursor: 'pointer', fontWeight: 'bold' }}>{editLoading ? '저장 중' : '저장'}</button>
                            <button type="button" onClick={() => { setEditingEmoId(null); setEditEmoFile(null); }} style={{ flex: 1, padding: '6px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--border-3)', color: 'var(--text-strong)', cursor: 'pointer' }}>취소</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div style={{ fontWeight: 'bold', color: 'var(--text-strong)', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emo.name}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>순서: {emo.sort_order}</div>
                          <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
                            <button onClick={() => startEditEmoticon(emo)} className="secondary-btn" style={{ flex: 1, padding: '6px' }}>수정</button>
                            <button onClick={() => handleDeleteEmoticon(emo)} className="secondary-btn" style={{ flex: 1, padding: '6px', color: 'var(--danger-bright)', borderColor: 'var(--danger-bright)' }}>삭제</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
