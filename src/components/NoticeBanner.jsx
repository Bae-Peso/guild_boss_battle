import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

// 사이트 가장 상단에 표시되는 전역 공지 배너.
// 사이트 공지(상단) → 길드 공지(하단) 순서로 쌓이며, 각 줄은 개인이 닫을 수 있다.
// 닫은 공지는 user_(site_)notice_reads 에 기록되어 본인에게 다시 표시되지 않는다.
// 관리자가 내렸거나(closed_at) 기간이 지난(expires_at) 공지는 누구에게도 표시되지 않는다.
export default function NoticeBanner() {
  const { user, globalBanReason } = useAuth();
  const [siteNotices, setSiteNotices] = useState([]);
  const [guildNotices, setGuildNotices] = useState([]);

  const load = useCallback(async () => {
    if (!user || globalBanReason) {
      setSiteNotices([]);
      setGuildNotices([]);
      return;
    }

    const nowIso = new Date().toISOString();

    // --- 사이트 전역 공지 ---
    const [{ data: sNotices }, { data: sReads }] = await Promise.all([
      supabase
        .from('site_notices')
        .select('id, content, created_at')
        .is('closed_at', null)
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false }),
      supabase
        .from('user_site_notice_reads')
        .select('site_notice_id')
        .eq('user_id', user.id),
    ]);

    const dismissedSite = new Set((sReads || []).map(r => r.site_notice_id));
    setSiteNotices((sNotices || []).filter(n => !dismissedSite.has(n.id)));

    // --- 길드 공지 (승인된 소속 길드가 있을 때만) ---
    const { data: membership } = await supabase
      .from('union_members')
      .select('union_id')
      .eq('user_id', user.id)
      .eq('join_status', 'approved')
      .maybeSingle();

    if (membership?.union_id) {
      const [{ data: uNotices }, { data: uReads }] = await Promise.all([
        supabase
          .from('union_notices')
          .select('id, content, created_at')
          .eq('union_id', membership.union_id)
          .is('closed_at', null)
          .gt('expires_at', nowIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('user_notice_reads')
          .select('notice_id')
          .eq('user_id', user.id),
      ]);

      const dismissedGuild = new Set((uReads || []).map(r => r.notice_id));
      setGuildNotices((uNotices || []).filter(n => !dismissedGuild.has(n.id)));
    } else {
      setGuildNotices([]);
    }
  }, [user, globalBanReason]);

  // 공지는 진입(마운트/페이지 이동) 시 1회 로드한다.
  // 공지는 자주 바뀌지 않으므로 별도 실시간 채널을 두지 않는다.
  // (전역에 항상 떠 있는 고정 이름 채널이 공유 실시간 연결을 교란하던 문제를 제거)
  useEffect(() => {
    load();
  }, [load]);

  const dismissSite = async (id) => {
    setSiteNotices(prev => prev.filter(n => n.id !== id));
    try {
      await supabase.from('user_site_notice_reads').insert({ user_id: user.id, site_notice_id: id });
    } catch (e) {
      console.error('사이트 공지 닫기 실패', e);
    }
  };

  const dismissGuild = async (id) => {
    setGuildNotices(prev => prev.filter(n => n.id !== id));
    try {
      await supabase.from('user_notice_reads').insert({ user_id: user.id, notice_id: id });
    } catch (e) {
      console.error('길드 공지 닫기 실패', e);
    }
  };

  if (!user || globalBanReason) return null;

  const rows = [
    ...siteNotices.map(n => ({ ...n, _type: 'site' })),
    ...guildNotices.map(n => ({ ...n, _type: 'guild' })),
  ];
  if (rows.length === 0) return null;

  return (
    <div style={{ width: '100%', flexShrink: 0, zIndex: 60 }}>
      {rows.map(n => {
        const isSite = n._type === 'site';
        return (
          <div
            key={`${n._type}_${n.id}`}
            style={{
              width: '100%',
              backgroundColor: isSite ? '#3a1d1d' : 'var(--surface-2)',
              color: 'var(--text-strong)',
              padding: '10px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              borderBottom: '1px solid var(--surface-1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span
                style={{
                  flexShrink: 0,
                  backgroundColor: isSite ? 'var(--danger-solid)' : '#f59e0b',
                  color: isSite ? 'var(--text-strong)' : 'var(--text-inverse)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                }}
              >
                {isSite ? '사이트 공지' : '길드 공지'}
              </span>
              <span
                style={{
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={n.content}
              >
                {n.content}
              </span>
            </div>
            <button
              onClick={() => (isSite ? dismissSite(n.id) : dismissGuild(n.id))}
              title="이 공지 닫기 (다시 표시되지 않음)"
              style={{
                flexShrink: 0,
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '1.2rem',
                padding: '0 5px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
