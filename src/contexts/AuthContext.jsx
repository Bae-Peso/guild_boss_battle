import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, ensureSession } from '../lib/supabase';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  const [globalBanReason, setGlobalBanReason] = useState(null);

  // "같은 사람이면 같은 객체"를 유지한다.
  // supabase는 auth 이벤트마다 localStorage를 새로 파싱해 매번 **다른** user 객체를 준다.
  // 그대로 setUser하면 TOKEN_REFRESHED(약 50분마다)만으로도 참조가 바뀌어
  // user를 의존성에 둔 effect가 전부 재실행된다 — WorkspaceLayout이 realtime 채널
  // 10여 개를 통째로 해제하고 다시 붙는다. 앱이 실제로 읽는 필드는 user.id 하나뿐이라
  // id가 같으면 이전 객체를 그대로 둔다.
  const applyUser = useCallback((next) => {
    setUser((prev) => (prev?.id === next?.id ? prev : (next ?? null)));
  }, []);

  const fetchUserInfo = useCallback(async (userId) => {
    if (!userId) {
      setIsAdmin(false);
      setGlobalBanReason(null);
      return;
    }

    // 관리자 여부와 글로벌 밴은 서로 독립이라 직렬로 기다릴 이유가 없다.
    const [adminRes, userRes] = await Promise.all([
      supabase.from('site_admins').select('is_active').eq('user_id', userId).maybeSingle(),
      supabase.from('users').select('global_ban_reason').eq('id', userId).maybeSingle(),
    ]);

    // 조회가 실패했는데 조용히 false/null로 떨어지면 권한이 사라진 것처럼 보인다. 최소한 남긴다.
    if (adminRes.error) console.error('[auth] site_admins 조회 실패', adminRes.error);
    if (userRes.error) console.error('[auth] users 조회 실패', userRes.error);

    setIsAdmin(adminRes.data?.is_active || false);
    setGlobalBanReason(userRes.data?.global_ban_reason || null);
  }, []);

  // ── 부트스트랩 ──
  // 예전에는 getSession()과 onAuthStateChange(INITIAL_SESSION)가 각각 세션을 읽고
  // 각각 fetchUserInfo를 돌려서, 같은 조회가 두 번 겹치고 순서도 매번 달랐다.
  // 이제 진입점은 여기 하나뿐이고, ensureSession()이 JWT를 보장한 뒤에만 DB를 친다.
  useEffect(() => {
    let alive = true;

    (async () => {
      setBootError(null);
      try {
        const session = await ensureSession();
        if (!alive) return;
        applyUser(session?.user ?? null);
        await fetchUserInfo(session?.user?.id);
      } catch (err) {
        if (!alive) return;
        console.error('[auth] 세션 복구 실패', err);
        setBootError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [applyUser, fetchUserInfo, bootAttempt]);

  // ── 이후 auth 이벤트 ──
  useEffect(() => {
    let alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // 콜백 본문에서 다른 supabase 함수를 await 하지 않는다(supabase 공식 가이드).
      // 이 콜백은 auth 내부 처리 도중에 호출되므로, 여기서 곧바로 DB를 치면
      // 세션 초기화 작업과 뒤엉켜 실행 순서가 비결정적이 된다. 큐 뒤로 미룬다.
      applyUser(session?.user ?? null);

      // INITIAL_SESSION은 위 부트스트랩이 이미 처리했고,
      // TOKEN_REFRESHED는 사람이 바뀐 게 아니라 토큰만 바뀐 것이라 재조회할 이유가 없다.
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;

      setTimeout(async () => {
        if (!alive) return;
        await fetchUserInfo(session?.user?.id);
        if (event === 'SIGNED_IN' && session?.user?.id) {
          await supabase.from('users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', session.user.id);
        }
      }, 0);
    });

    return () => { alive = false; subscription.unsubscribe(); };
  }, [applyUser, fetchUserInfo]);

  const value = useMemo(() => ({
    signUp: async (username, password) => {
      const dummyEmail = `${username}@nikke.local`;
      const { data, error } = await supabase.auth.signUp({
        email: dummyEmail,
        password,
      });
      if (error) throw error;
      return data;
    },
    signIn: async (username, password) => {
      const dummyEmail = `${username}@nikke.local`;
      const { data, error } = await supabase.auth.signInWithPassword({
        email: dummyEmail,
        password,
      });
      if (error) throw error;
      return data;
    },
    signOut: () => supabase.auth.signOut(),
    user,
    isAdmin,
    globalBanReason,
  }), [user, isAdmin, globalBanReason]);

  if (loading) {
    return <div className="app-boot">접속 중입니다...</div>;
  }

  // 세션을 못 살린 채로 children을 렌더하면 모든 쿼리가 anon으로 나가
  // "에러 없이 빈 화면"이 된다. 그럴 바엔 실패를 드러내고 재시도를 내준다.
  if (bootError) {
    return (
      <div className="app-boot app-boot-error">
        <p className="app-boot-title">서버에 연결하지 못했습니다.</p>
        <p className="app-boot-detail">{bootError.message}</p>
        <button
          type="button"
          className="app-boot-retry"
          onClick={() => { setLoading(true); setBootAttempt((n) => n + 1); }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
