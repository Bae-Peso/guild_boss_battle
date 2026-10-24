import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { REPORT_URL } from '../lib/siteLinks';

export default function ReportModal({ isOpen, onClose, reporterId, targetUserId, targetUsername, defaultType = 'report' }) {
  useEscapeKey(isOpen, onClose);
  const [type, setType] = useState(defaultType);
  const [category, setCategory] = useState(targetUserId ? '불량 유저' : (defaultType === 'report' ? '버그 제보' : '기능 건의'));
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return alert('내용을 입력해주세요.');
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('reports').insert({
        reporter_id: reporterId,
        target_user_id: targetUserId || null,
        type: targetUserId ? 'report' : type,
        category,
        content
      });
      if (error) throw error;
      alert('정상적으로 접수되었습니다. 관리자가 확인 후 처리할 예정입니다.');
      setContent('');
      onClose();
    } catch (err) {
      console.error(err);
      alert('오류가 발생했습니다.');
    }
    setIsSubmitting(false);
  };

  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--surface-2)', padding: '20px', borderRadius: '8px', width: '90%', maxWidth: '500px' }}>
        <h3 style={{ marginTop: 0, color: 'var(--text-strong)', borderBottom: '1px solid var(--border-2)', paddingBottom: '10px' }}>
          {targetUsername ? `[${targetUsername}] 유저 신고` : '버그 제보 및 시스템 건의'}
        </h3>
        <div><p style={{ fontSize: '1.0rem', marginTop: '5px', marginBottom: '1.0rem', gap: '20px' }}>
          <a href={REPORT_URL} target="_blank">해당 게시글</a>에도 제보 가능합니다.<br /></p></div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {!targetUserId && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '5px', display: 'block' }}>유형</label>
              <select value={type} onChange={e => {
                setType(e.target.value);
                setCategory(e.target.value === 'report' ? '버그 제보' : '기능 건의');
              }} style={{ width: '100%', padding: '10px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px' }}>
                <option value="report">버그 제보</option>
                <option value="suggestion">시스템 건의</option>
              </select>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '5px', display: 'block' }}>상세 분류</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px' }}>
              {targetUserId ? (
                <>
                  <option value="불량 유저">불량 유저 / 분쟁 유발</option>
                  <option value="고의 트롤링">고의 트롤링 / 비매너</option>
                  <option value="기타">기타 사유</option>
                </>
              ) : type === 'report' ? (
                <>
                  <option value="버그 제보">기능 오류 / 버그 제보</option>
                  <option value="데이터 오류">표시/데이터 오류</option>
                </>
              ) : (
                <>
                  <option value="기능 건의">새로운 기능 추가 건의</option>
                  <option value="UI 개선">UI / UX 개선 건의</option>
                  <option value="기타">기타</option>
                </>
              )}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '5px', display: 'block' }}>내용</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={5}
              placeholder="상세한 내용을 적어주세요..."
              style={{ width: '100%', padding: '10px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button type="button" onClick={onClose} style={{ padding: '10px 20px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-3)', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
            <button type="submit" disabled={isSubmitting} style={{ padding: '10px 20px', background: targetUserId ? 'var(--danger)' : 'var(--accent-green)', color: 'var(--text-inverse)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
              {isSubmitting ? '접수 중...' : '접수하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
