import React, { useState } from 'react';
import NikkeSelectorModal from './NikkeSelectorModal';
import { uploadChatImage } from '../../lib/chatImage';

export default function SquadShareModal({ isOpen, onClose, onShare }) {
  const [selectedNikkes, setSelectedNikkes] = useState([null, null, null, null, null]);
  const [isNikkeModalOpen, setIsNikkeModalOpen] = useState(false);
  const [selectingSlotIndex, setSelectingSlotIndex] = useState(0);
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  // 이미지 공유 입력 방식: 'url'(직접 붙여넣기) | 'file'(파일 업로드 → 호스팅 URL 발급)
  const [imageMode, setImageMode] = useState('url');
  const [uploading, setUploading] = useState(false);

  const [activeTab, setActiveTab] = useState('squad');

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadChatImage(file);
      setImageUrl(url);
    } catch (err) {
      console.error(err);
      alert(err?.message || '이미지 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (!isOpen) return null;

  const openNikkeSelector = () => {
    setIsNikkeModalOpen(true);
  };

  const handleConfirmSquad = (slots) => {
    setSelectedNikkes(slots);
    setIsNikkeModalOpen(false);
  };

  const handleShare = () => {
    if (activeTab === 'squad') {
      const nikkeIds = selectedNikkes.map(n => n ? n.id : null);
      if (nikkeIds.every(id => id === null) && !message.trim()) {
        alert("공유할 내용을 입력해주세요.");
        return;
      }
      onShare(message, { type: 'squad_share', nikke_ids: nikkeIds, image_url: '' });
    } else {
      if (!imageUrl.trim() && !message.trim()) {
        alert("이미지 URL이나 코멘트를 입력해주세요.");
        return;
      }
      onShare(message, { type: 'squad_share', nikke_ids: [null, null, null, null, null], image_url: imageUrl.trim() });
    }
    onClose();
  };

  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
        <div style={{ backgroundColor: 'var(--surface-2)', padding: '20px', borderRadius: '8px', width: '500px', maxWidth: '90%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0, color: 'var(--text-strong)' }}>스쿼드 공유</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>✕</button>
          </div>

          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-1)', marginBottom: '20px' }}>
            <div 
              onClick={() => setActiveTab('squad')}
              style={{ flex: 1, padding: '10px', textAlign: 'center', cursor: 'pointer', borderBottom: activeTab === 'squad' ? '2px solid var(--accent-green)' : 'none', color: activeTab === 'squad' ? 'var(--text-strong)' : 'var(--text-dim)', fontWeight: 'bold' }}
            >
              스쿼드 공유
            </div>
            <div 
              onClick={() => setActiveTab('image')}
              style={{ flex: 1, padding: '10px', textAlign: 'center', cursor: 'pointer', borderBottom: activeTab === 'image' ? '2px solid var(--accent-green)' : 'none', color: activeTab === 'image' ? 'var(--text-strong)' : 'var(--text-dim)', fontWeight: 'bold' }}
            >
              이미지 공유
            </div>
          </div>

          {activeTab === 'squad' ? (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>공유할 스쿼드 (클릭하여 편성)</label>
              <div 
                style={{ display: 'flex', gap: '10px', cursor: 'pointer' }}
                onClick={openNikkeSelector}
              >
                {[0, 1, 2, 3, 4].map(idx => (
                  <div 
                    key={idx} 
                    style={{ flex: 1, aspectRatio: '1/1', backgroundColor: 'var(--surface-1)', border: '1px dashed var(--border-3)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '1.5rem', overflow: 'hidden' }}
                  >
                    {selectedNikkes[idx] ? (
                      selectedNikkes[idx].image_url ? 
                        <img src={selectedNikkes[idx].image_url} alt="nikke" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
                        <span style={{fontSize: '0.75rem'}}>{selectedNikkes[idx].name.substring(0, 3)}</span>
                    ) : '+'}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                <button type="button" onClick={() => setImageMode('file')} style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border-1)', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', background: imageMode === 'file' ? 'var(--accent-green)' : 'var(--surface-1)', color: imageMode === 'file' ? 'var(--text-inverse)' : 'var(--text-dim)' }}>파일 업로드</button>
                <button type="button" onClick={() => setImageMode('url')} style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border-1)', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', background: imageMode === 'url' ? 'var(--accent-green)' : 'var(--surface-1)', color: imageMode === 'url' ? 'var(--text-inverse)' : 'var(--text-dim)' }}>URL 직접 입력</button>
              </div>
              {imageMode === 'file' ? (
                <>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    disabled={uploading}
                    style={{ width: '100%', color: 'var(--text-strong)', fontSize: '0.85rem' }}
                  />
                  {uploading && <div style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--text-dim)' }}>이미지 업로드 중…</div>}
                </>
              ) : (
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/image.png"
                  style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-0)', color: 'var(--text-strong)', boxSizing: 'border-box' }}
                />
              )}
              {imageUrl.trim() && (
                <div style={{ marginTop: '10px', backgroundColor: 'var(--surface-1)', padding: '10px', borderRadius: '4px', textAlign: 'center' }}>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '5px' }}>미리보기</span>
                  <img src={imageUrl.trim()} alt="preview" referrerPolicy="no-referrer" style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: '4px' }} onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML += '<div style="color: var(--danger); font-size: 0.85rem;">이미지를 불러올 수 없습니다.</div>'; }} />
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>코멘트 (선택)</label>
            <input 
              type="text" 
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="코멘트를 입력하세요"
              style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-0)', color: 'var(--text-strong)', boxSizing: 'border-box' }}
              onKeyDown={(e) => { if(e.key === 'Enter') handleShare(); }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '10px 15px', background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              취소
            </button>
            <button onClick={handleShare} style={{ padding: '10px 15px', background: 'var(--accent-green)', color: 'var(--text-inverse)', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
              공유하기
            </button>
          </div>
        </div>
      </div>

      <NikkeSelectorModal 
        isOpen={isNikkeModalOpen} 
        onClose={() => setIsNikkeModalOpen(false)} 
        initialSelected={selectedNikkes}
        onConfirm={handleConfirmSquad}
      />
    </>
  );
}
