import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// 채팅 이미지 자동 삭제(보존일수) 설정 + 수동 정리 트리거. (사이트 관리자 전용)
const SETTING_KEY = 'chat_image_retention_days';

export default function ChatImageSettings() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', SETTING_KEY)
        .maybeSingle();
      if (error) console.error(error);
      const n = Number(data?.value);
      if (Number.isFinite(n) && n > 0) setDays(n);
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 1) {
      alert('보존일수는 1 이상의 숫자여야 합니다.');
      return;
    }
    setSaving(true);
    setMessage('');
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: SETTING_KEY, value: n, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) {
      console.error(error);
      alert('저장 실패: ' + error.message);
    } else {
      setMessage('저장되었습니다.');
    }
  };

  const handleCleanupNow = async () => {
    if (!window.confirm(`${days}일보다 오래된 채팅 이미지를 지금 삭제합니다. 계속하시겠습니까?`)) return;
    setCleaning(true);
    setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-chat-images', { body: {} });
      if (error) throw error;
      setMessage(`정리 완료: ${data?.removed ?? 0}개 이미지 삭제 (보존 ${data?.retentionDays ?? days}일)`);
    } catch (err) {
      console.error(err);
      alert('정리 실패: ' + (err?.message || '알 수 없는 오류'));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div>
      <h1>채팅 이미지 설정</h1>
      <p>유저가 채팅에 올린 이미지의 자동 삭제 기준을 설정합니다.</p>

      {loading ? (
        <div className="mt-4" style={{ color: 'var(--text-muted)' }}>불러오는 중...</div>
      ) : (
        <div className="dashboard-card" style={{ maxWidth: '520px', borderTop: '4px solid #007bff' }}>
          <h3>이미지 보존 기간</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            설정한 일수보다 오래된 채팅 이미지는 매일 자동으로 삭제됩니다. (삭제된 이미지는 과거 메시지에서 표시되지 않습니다.)
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '12px 0' }}>
            <input
              type="number"
              min="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              style={{ width: '100px', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-0)', color: 'var(--text-strong)' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>일</span>
            <button onClick={handleSave} disabled={saving} className="secondary-btn">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-1)', margin: '16px 0' }} />

          <h3>지금 정리</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            자동 스케줄을 기다리지 않고 즉시 오래된 이미지를 삭제합니다.
          </p>
          <button
            onClick={handleCleanupNow}
            disabled={cleaning}
            className="secondary-btn"
            style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
          >
            {cleaning ? '정리 중...' : '오래된 이미지 정리'}
          </button>

          {message && <div style={{ marginTop: '12px', color: 'var(--success)' }}>{message}</div>}
        </div>
      )}
    </div>
  );
}
