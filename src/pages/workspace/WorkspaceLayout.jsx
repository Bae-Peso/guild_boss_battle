import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { Outlet, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useDemo } from '../../demo/DemoContext';
import { supabase, ensureSession, withRetry, unwrap } from '../../lib/supabase';
import { onGuildChanges, createCatchUp } from '../../lib/realtime';
import { lazyRoute } from '../../lib/lazyRoute';
import NoticeBanner from '../../components/NoticeBanner';
import StatusMessageModal from './StatusMessageModal';
import Toasts from './Toasts';
import { isMentioned } from '../../lib/chatUtils';
import { isManager } from '../../lib/roles';
import { playMentionSound } from '../../lib/sound';
import { registerSW, refreshPushSubscription } from '../../lib/push';
import { fetchReadState, seedReadState, channelScope, bossBattleScope } from '../../lib/chatReadState';
import './Workspace.css';

import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useIsMobile, useElementWidth } from '../../hooks/useMediaQuery';
import MembersPanel from './panels/MembersPanel';
import WorkspaceNavPanel from './panels/WorkspaceNavPanel';
import MockBossNav from './panels/MockBossNav';
import WorkspaceMobileShell from './WorkspaceMobileShell';

// 모달로도 열리고 /workspace/settings 라우트로도 열린다. 정적으로 import하면
// 810줄짜리 설정 화면이 레이아웃 청크에 묶여서 라우트 분할이 무의미해진다.
// App.jsx의 lazy 라우트와 같은 모듈이라 청크도 하나로 공유된다.
const GuildSettings = lazyRoute(() => import('./GuildSettings'));

export default function WorkspaceLayout() {
  const isMobile = useIsMobile(820);
  // 콘텐츠 세로 스택/단일 포커스 기준. 창 폭이 아니라 '가운데 콘텐츠 영역'의 실제 폭에 반응
  // (좌·우 패널 접기/펴기로 가용 폭이 바뀌므로). 모바일 셸에선 .workspace-content가 없어 폭이 null → isMobile로 커버.
  const [mainRef, mainWidth] = useElementWidth();
  // 가운데 폭이 측정되기 전(첫 렌더) 초기값은 창 폭으로 근사 → 좁은 화면 첫 페인트 깜빡임 방지.
  const isNarrow = isMobile || (mainWidth != null
    ? mainWidth < 720
    : (typeof window !== 'undefined' && window.innerWidth < 1200));
  const { user, signOut } = useAuth();
  const demo = useDemo();
  const { guildId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentChannelRef = useRef(null);
  // 현재 열람 중인 채팅 채널 id (실시간 안읽음 처리에서 '보는 채널'은 제외하기 위함)
  const viewingChannelIdRef = useRef(null);
  const [guild, setGuild] = useState(null);
  const [role, setRole] = useState('member');
  const [inGameName, setInGameName] = useState('');
  const inGameNameRef = useRef('');
  const roleRef = useRef('');
  const systemRoomRef = useRef(null);
  const chatChannelsRef = useRef([]);
  const bossBattleCatchUpRef = useRef(null);
  const presenceEnsureRef = useRef(null);
  const presenceCleanupRef = useRef(null);
  const disconnectTimeoutsRef = useRef({});

  // 채팅 메시지 실시간 구독은 레이아웃이 사용자당 하나씩만 들고, 열려 있는 채팅 화면에 이벤트를 나눠준다.
  // (예전에는 레이아웃이 채널마다 하나 + 채팅 화면이 또 하나를 구독해서, 같은 메시지를 여러 번 받고
  //  Realtime 이 구독 수만큼 RLS 검사를 돌렸다.)
  // 리스너 시그니처: (eventType: 'INSERT' | 'UPDATE', row) => void
  const messageListenersRef = useRef(new Set());
  const bossBattleListenersRef = useRef(new Set());
  const subscribeMessages = useCallback((fn) => {
    messageListenersRef.current.add(fn);
    return () => { messageListenersRef.current.delete(fn); };
  }, []);
  const subscribeBossBattleMessages = useCallback((fn) => {
    bossBattleListenersRef.current.add(fn);
    return () => { bossBattleListenersRef.current.delete(fn); };
  }, []);

  useEffect(() => {
    inGameNameRef.current = inGameName;
  }, [inGameName]);

  // 현재 URL에서 열람 중인 채널 id를 추적 (예: /workspace/channel/:id)
  useEffect(() => {
    const m = location.pathname.match(/\/workspace\/channel\/([^/]+)/);
    viewingChannelIdRef.current = m ? m[1] : null;
  }, [location.pathname]);

  const [statusMessage, setStatusMessage] = useState('');
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  useEscapeKey(isStatusModalOpen, () => setIsStatusModalOpen(false));

  // Right Sidebar Tab State ('bossBattle' = 지휘 툴 + 텍스트 채널 통합 네비)
  const [rightTab, setRightTab] = useState('bossBattle');

  // Panel collapse state (모바일/공간 최적화)
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [newStatusMessage, setNewStatusMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState({});
  const [allMembers, setAllMembers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [unreadChannels, setUnreadChannels] = useState({});
  const [syncLoading, setSyncLoading] = useState(false);
  const [profileImagesMap, setProfileImagesMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // 브라우저 알림 권한 상태
  const [notificationPermission, setNotificationPermission] = useState(Notification.permission);

  useEffect(() => {
    if (demo.isDemo) return; // 체험 모드: 알림 권한 요청/푸시 구독(DB) 생략
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        setNotificationPermission(permission);
      });
    }
    // Web Push용 서비스 워커 등록(idempotent) + 기존 구독 기기의 last_seen_at 갱신
    registerSW().catch(() => {});
    if (user?.id) refreshPushSubscription(user.id).catch(() => {});
  }, [user?.id, demo.isDemo]);

  // New States
  const [synchroLevel, setSynchroLevel] = useState(1);
  const [bossBattleUnread, setBossBattleUnread] = useState({ general: false, admin: false });
  const [toasts, setToasts] = useState([]);

  // Unread logic helper
  const isAnyChatUnread = Object.values(unreadChannels).some(Boolean);
  const isAnyChatMentioned = Object.values(unreadChannels).includes('mention');
  const isBossBattleUnread = bossBattleUnread.general || (role !== 'member' && bossBattleUnread.admin);
  const isBossBattleMention = bossBattleUnread.general === 'mention' || (role !== 'member' && bossBattleUnread.admin === 'mention');

  // Resizing State
  const [leftWidth, setLeftWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(300);
  const isResizingLeft = useRef(false);
  const isResizingRight = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingLeft.current) {
        setLeftWidth(Math.max(200, Math.min(e.clientX, 500)));
      } else if (isResizingRight.current) {
        setRightWidth(Math.max(250, Math.min(window.innerWidth - e.clientX, 600)));
      }
    };

    const handleMouseUp = () => {
      isResizingLeft.current = false;
      isResizingRight.current = false;
      document.body.style.cursor = 'default';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    setFetchError(null);

    // ── 체험 모드: DB 대신 목업 스토어로 워크스페이스를 구성하고 realtime/presence/push는 전부 생략 ──
    if (demo.isDemo) {
      if (!demo.data) { setLoading(true); return; } // 니케 데이터 준비 후 재시드될 때까지 대기(effect 재실행)
      const d = demo.data;
      const me = d.members.find(m => m.user_id === user.id) || d.members[0];
      setGuild(d.guild);
      setRole('admin');
      roleRef.current = 'admin';
      setInGameName(me?.in_game_name || '나(체험)');
      inGameNameRef.current = me?.in_game_name || '나(체험)';
      setStatusMessage(me?.status_message || '');
      setAllMembers(d.members);
      setChannels(d.channels);
      setSynchroLevel(me?.users?.synchro_level || 1);
      setProfileImagesMap({});
      setUnreadChannels({});
      setBossBattleUnread({});
      setPendingRequestsCount(0);
      // 데모: 일부 멤버를 온라인으로 표시(생동감)
      const online = {};
      d.members.slice(0, 4).forEach(m => { online[m.user_id] = { user_id: m.user_id, in_game_name: m.in_game_name }; });
      setOnlineUsers(online);
      setLoading(false);
      return () => { isMounted = false; };
    }

    const fetchWorkspaceInfo = async () => {
      if (!user) return;
      try {
        // 소속 길드 조회가 실패하면 아래 `if (!guild) return <Navigate to="/" />`에 걸려
        // 로비로 튕긴다. 즉 이 한 번의 조회가 실패하면 사용자에겐 "길드가 없는 것"처럼 보인다.
        // 세션(JWT)을 먼저 보장하고, 단발성 네트워크 실패는 재시도로 흡수한다.
        await ensureSession();

        const data = await withRetry(async () => unwrap(
          await supabase
            .from('union_members')
            .select(`
              role,
              in_game_name,
              status_message,
              unions ( id, name, union_code, owner_id )
            `)
            .eq('user_id', user.id)
            .eq('join_status', 'approved')
            .maybeSingle(),
          'union_members',
        ), { label: 'workspace-bootstrap' });

        if (!isMounted) return;

        if (data && data.unions) {
          setGuild(data.unions);
          setRole(data.role);
          roleRef.current = data.role;
          setInGameName(data.in_game_name || '');
          inGameNameRef.current = data.in_game_name || '';
          setStatusMessage(data.status_message || '');

          // 1. Fetch channels, members, and notice, and profile images
          const [channelRes, memRes, userRes, pendingRes, nicknameReqRes, profileImgsRes, readMap] = await Promise.all([
            supabase.from('channels').select('*').eq('union_id', data.unions.id).is('deleted_at', null),
            supabase.from('union_members').select('user_id, in_game_name, role, status_message, users(synchro_level, profile_image_id)').eq('union_id', data.unions.id).eq('join_status', 'approved'),
            supabase.from('users').select('synchro_level, profile_image_id').eq('id', user.id).maybeSingle(),
            supabase.from('union_members').select('id', { count: 'exact', head: true }).eq('union_id', data.unions.id).eq('join_status', 'pending'),
            supabase.from('union_nickname_requests').select('id', { count: 'exact', head: true }).eq('union_id', data.unions.id).eq('status', 'pending'),
            supabase.from('profile_images').select('id, image_url'),
            fetchReadState(user.id)
          ]);

          if (!isMounted) return;

          if (profileImgsRes.data) {
            const pMap = {};
            profileImgsRes.data.forEach(img => { pMap[img.id] = img.image_url; });
            setProfileImagesMap(pMap);
          }

          const totalPending = (pendingRes.count || 0) + (nicknameReqRes.count || 0);
          setPendingRequestsCount(totalPending);

          if (userRes.data?.synchro_level) {
            setSynchroLevel(userRes.data.synchro_level);
          }

          if (memRes.data) {
            setAllMembers(memRes.data);
          }

          const channelData = channelRes.data;
          let finalChannelData = channelData || [];

          if (finalChannelData.length === 0 && data.role === 'admin') {
            // Auto-create default channels if missing (avoids RLS site-admin insert issues)
            const { data: newChannels } = await supabase.from('channels').insert([
              { union_id: data.unions.id, name: '일반', type: 'general', is_fixed: true },
              { union_id: data.unions.id, name: '공지사항', type: 'notice', is_fixed: true }
            ]).select();

            if (newChannels && newChannels.length > 0) {
              finalChannelData = newChannels;
            }
          }

          if (finalChannelData.length > 0) {
            finalChannelData.sort((a, b) => {
              if (a.type === 'notice') return -1;
              if (b.type === 'notice') return 1;
              if (a.name === '일반') return -1;
              if (b.name === '일반') return 1;
              return a.name.localeCompare(b.name);
            });
            setChannels(finalChannelData);

            // 읽음 기록이 없는 채널은 now를 baseline으로 잡고, 모아서 한 번에 seed (과거 메시지 폭탄 방지)
            const nowIso = new Date().toISOString();
            const channelSeedScopes = [];

            const unreadPromises = finalChannelData.map(async (ch) => {
              const scope = channelScope(ch.id);
              let lastRead = readMap[scope];
              if (!lastRead) {
                lastRead = nowIso;
                channelSeedScopes.push(scope);
                return { id: ch.id, status: false };
              }
              // 지워진 메시지와 내가 보낸 메시지는 안읽음이 아니다(실시간 수신 쪽 판정과 같게).
              const { data: unreadMsgs } = await supabase.from('messages')
                .select('content')
                .eq('channel_id', ch.id)
                .is('deleted_at', null)
                .neq('user_id', user.id)
                .gt('created_at', lastRead)
                .limit(50);

              if (unreadMsgs && unreadMsgs.length > 0) {
                const isMod = isManager(data.role);
                const hasMention = unreadMsgs.some(m => isMentioned(m.content, { userId: user.id, inGameName: data.in_game_name, isMod }));
                return { id: ch.id, status: hasMention ? 'mention' : 'unread' };
              }
              return { id: ch.id, status: false };
            });

            const unreadResults = await Promise.all(unreadPromises);
            const initialUnread = {};
            unreadResults.forEach(res => {
              if (res.status) initialUnread[res.id] = res.status;
            });
            setUnreadChannels(initialUnread);
            if (channelSeedScopes.length > 0) seedReadState(user.id, channelSeedScopes, nowIso);
          }

          // Initial fetch for raid_messages unread status
          const bossBattleRooms = ['general', 'admin'];
          const initialBossBattleUnread = {};
          const bossBattleNowIso = new Date().toISOString();
          const bossBattleSeedScopes = [];
          const bossBattleUnreadPromises = bossBattleRooms.map(async (room) => {
            const scope = bossBattleScope(room, data.unions.id);
            let lastRead = readMap[scope];
            if (!lastRead) {
              lastRead = bossBattleNowIso;
              bossBattleSeedScopes.push(scope);
              return { room, status: false };
            }
            // 지워진 메시지와 내가 보낸 메시지는 안읽음이 아니다(실시간 수신 쪽 판정과 같게).
            const { data: unreadMsgs } = await supabase.from('raid_messages')
              .select('content')
              .eq('union_id', data.unions.id)
              .eq('room_type', room)
              .is('deleted_at', null)
              .neq('user_id', user.id)
              .gt('created_at', lastRead)
              .limit(50);

            if (unreadMsgs && unreadMsgs.length > 0) {
              const isMod = isManager(data.role);
              const hasMention = unreadMsgs.some(m => isMentioned(m.content, { userId: user.id, inGameName: data.in_game_name, isMod }));
              return { room, status: hasMention ? 'mention' : 'unread' };
            }
            return { room, status: false };
          });

          const bossBattleUnreadResults = await Promise.all(bossBattleUnreadPromises);
          bossBattleUnreadResults.forEach(res => {
            if (res.status) initialBossBattleUnread[res.room] = res.status;
          });
          setBossBattleUnread(initialBossBattleUnread);
          if (bossBattleSeedScopes.length > 0) seedReadState(user.id, bossBattleSeedScopes, bossBattleNowIso);

          if (!isMounted) return;

          const channelName = `presence:guild_${data.unions.id}`;
          const existingChannels = supabase.getChannels();
          const existing = existingChannels.find(c => c.topic === `realtime:${channelName}`);
          if (existing) {
            await supabase.removeChannel(existing);
          }

          if (!isMounted) return;

          const presenceRoom = supabase.channel(channelName, {
            config: { presence: { key: user.id } }
          });

          currentChannelRef.current = presenceRoom;

          presenceRoom.on('presence', { event: 'sync' }, () => {
            if (!isMounted) return;
            const newState = presenceRoom.presenceState();
            const presenceMap = {};
            for (const key in newState) {
              const items = newState[key];
              if (items && items.length > 0) {
                presenceMap[items[0].user_id] = items[0];
              }
            }

            // 서버 상태에 내가 빠져 있으면(track 실패 등) 다시 건다.
            if (!presenceMap[user.id]) presenceEnsureRef.current?.();

            setOnlineUsers(prev => {
              const nextOnline = { ...prev };

              Object.keys(presenceMap).forEach(userId => {
                nextOnline[userId] = presenceMap[userId];
                if (disconnectTimeoutsRef.current[userId]) {
                  clearTimeout(disconnectTimeoutsRef.current[userId]);
                  delete disconnectTimeoutsRef.current[userId];
                }
              });

              Object.keys(prev).forEach(userId => {
                if (!presenceMap[userId] && !disconnectTimeoutsRef.current[userId]) {
                  disconnectTimeoutsRef.current[userId] = setTimeout(() => {
                    setOnlineUsers(curr => {
                      const updated = { ...curr };
                      delete updated[userId];
                      return updated;
                    });
                    delete disconnectTimeoutsRef.current[userId];
                  }, 10000);
                }
              });

              return nextOnline;
            });
          });

          const refetchPendingCounts = async () => {
            const [pendingRes, nicknameReqRes] = await Promise.all([
              supabase.from('union_members').select('id', { count: 'exact', head: true }).eq('union_id', data.unions.id).eq('join_status', 'pending'),
              supabase.from('union_nickname_requests').select('id', { count: 'exact', head: true }).eq('union_id', data.unions.id).eq('status', 'pending')
            ]);
            if (isMounted) {
              setPendingRequestsCount((pendingRes.count || 0) + (nicknameReqRes.count || 0));
            }
          };

          // 재접속으로 구독이 끊겼던 동안 놓친 멤버/채널 변경을 다시 맞춘다.
          const refetchGuildState = async () => {
            const [chRes, mRes] = await Promise.all([
              supabase.from('channels').select('*').eq('union_id', data.unions.id).is('deleted_at', null),
              supabase.from('union_members').select('user_id, in_game_name, role, status_message, users(synchro_level, profile_image_id)').eq('union_id', data.unions.id).eq('join_status', 'approved'),
            ]);
            if (!isMounted) return;
            if (chRes.data) {
              setChannels([...chRes.data].sort((a, b) => {
                if (a.type === 'notice') return -1;
                if (b.type === 'notice') return 1;
                if (a.name === '일반') return -1;
                if (b.name === '일반') return 1;
                return a.name.localeCompare(b.name);
              }));
            }
            if (mRes.data) setAllMembers(mRes.data);
            refetchPendingCounts();
          };

          // 멤버/채널 변경 구독은 presence와 다른 채널에 둔다.
          // presence 샤드 장애로 presence 채널이 죽어도 강퇴·역할·채널 변경 반영은 유지된다.
          const guildRoom = supabase.channel(`sys_guild_${data.unions.id}_${user.id}`);

          onGuildChanges(guildRoom, 'union_members', data.unions.id, payload => {
            if (!isMounted) return;
            const rec = payload.new || payload.old;
            if (rec && rec.union_id && rec.union_id !== data.unions.id) return;

            refetchPendingCounts();

            if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
              const updatedMember = payload.new;
              if (updatedMember && updatedMember.join_status === 'approved') {
                setAllMembers(prev => {
                  const exists = prev.find(m => m.user_id === updatedMember.user_id);
                  if (exists) return prev.map(m => m.user_id === updatedMember.user_id ? { ...m, ...updatedMember } : m);
                  return [...prev, updatedMember];
                });
                if (updatedMember.user_id === user.id) {
                  setStatusMessage(updatedMember.status_message || '');
                  setInGameName(updatedMember.in_game_name || '');
                  inGameNameRef.current = updatedMember.in_game_name || '';
                  setRole(updatedMember.role || 'member');
                  roleRef.current = updatedMember.role || 'member';
                }
              } else if (updatedMember && updatedMember.join_status !== 'approved') {
                setAllMembers(prev => {
                  const targetMember = prev.find(m => m.user_id === updatedMember.user_id);
                  if (targetMember && targetMember.user_id === user.id) {
                    alert('길드에서 추방되거나 차단되었습니다.');
                    navigate('/');
                  }
                  return prev.filter(m => m.user_id !== updatedMember.user_id);
                });
              }
            } else if (payload.eventType === 'DELETE') {
              setAllMembers(prev => {
                const deletedMember = prev.find(m => m.id === payload.old.id);
                if (deletedMember && deletedMember.user_id === user.id) {
                  alert('길드에서 추방되거나 차단되었습니다.');
                  navigate('/');
                }
                return prev.filter(m => m.id !== payload.old.id);
              });
            }
          });

          guildRoom.on('postgres_changes', { event: '*', schema: 'public', table: 'channels', filter: `union_id=eq.${data.unions.id}` }, payload => {
            if (!isMounted) return;
            if (payload.eventType === 'INSERT') {
              setChannels(prev => [...prev, payload.new].sort((a, b) => {
                if (a.is_fixed !== b.is_fixed) return b.is_fixed ? 1 : -1;
                return new Date(a.created_at) - new Date(b.created_at);
              }));
            } else if (payload.eventType === 'UPDATE') {
              setChannels(prev => prev.map(c => c.id === payload.new.id ? payload.new : c).sort((a, b) => {
                if (a.is_fixed !== b.is_fixed) return b.is_fixed ? 1 : -1;
                return new Date(a.created_at) - new Date(b.created_at);
              }));
            } else if (payload.eventType === 'DELETE') {
              setChannels(prev => prev.filter(c => c.id !== payload.old.id));
            }
          });

          // 첫 SUBSCRIBED는 초기 로드 직후라 건너뛰고, 재접속(두 번째 이후)일 때만 다시 맞춘다.
          let guildRoomSubscribedOnce = false;
          guildRoom.subscribe((status) => {
            if (!isMounted || status !== 'SUBSCRIBED') return;
            if (guildRoomSubscribedOnce) refetchGuildState();
            guildRoomSubscribedOnce = true;
          });

          // 2. Nickname Requests Realtime
          const nickRoom = supabase.channel(`sys_nick_${data.unions.id}_${user.id}`);
          onGuildChanges(nickRoom, 'union_nickname_requests', data.unions.id, payload => {
            if (!isMounted) return;
            const rec = payload.new || payload.old;
            if (rec && rec.union_id && rec.union_id !== data.unions.id) return;
            refetchPendingCounts();
          }).subscribe();
          systemRoomRef.current = nickRoom; // We can repurpose this ref for cleanup

          // 3. BossBattle Messages Realtime
          const bossBattleGuildId = data.unions.id;
          const bossBattleCatchUp = createCatchUp({
            label: 'raid_messages',
            fetchRows: async ({ since, limit }) => {
              let q = supabase.from('raid_messages').select('*').eq('union_id', bossBattleGuildId).is('deleted_at', null);
              if (since) q = q.gte('created_at', since);
              const { data: rows, error } = await q.order('created_at', { ascending: false }).limit(limit);
              if (error) throw error;
              return (rows || []).reverse();
            },
            onRow: msg => {
              if (!isMounted) return;
              bossBattleListenersRef.current.forEach(fn => fn('INSERT', msg));
              if (msg.user_id === user.id) return;

              const isMod = isManager(roleRef.current);
              const hasMention = isMentioned(msg.content, { userId: user.id, inGameName: inGameNameRef.current, isMod });

              setBossBattleUnread(prev => {
                if (prev[msg.room_type] === 'mention') return prev;
                return { ...prev, [msg.room_type]: hasMention ? 'mention' : 'unread' };
              });
            },
          });
          bossBattleCatchUpRef.current = bossBattleCatchUp;
          const bossBattleSysRoom = supabase.channel(`sys_boss_battle_${data.unions.id}_${user.id}`);
          bossBattleSysRoom.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'raid_messages', filter: `union_id=eq.${data.unions.id}` }, payload => bossBattleCatchUp.handle(payload.new));
          bossBattleSysRoom.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'raid_messages', filter: `union_id=eq.${data.unions.id}` }, payload => {
            if (!isMounted) return;
            bossBattleListenersRef.current.forEach(fn => fn('UPDATE', payload.new));
          }).subscribe(bossBattleCatchUp.onStatus);

          // 4. User Notifications Realtime
          const notifSysRoom = supabase.channel(`sys_notif_${user.id}`);
          notifSysRoom.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, payload => {
            if (!isMounted) return;
            const notif = payload.new;
            setToasts(prev => [...prev, notif]);
            setTimeout(() => {
              setToasts(prev => prev.filter(t => t.id !== notif.id));
            }, 5000);

            // 브라우저 알림 (조건 완화: 권한 있으면 무조건 발송)
            if (Notification.permission === 'granted') {
              new Notification('길드 보스전 지휘소', {
                body: notif.message,
                icon: '/favicon.ico',
                tag: `notif-${notif.id}` // Web Push(sw.js)와 같은 tag → 중복 도착 시 하나로 병합
              });
            }

            // 오디오 알림 (localStorage에서 설정 확인)
            const soundEnabled = localStorage.getItem('mentionSoundEnabled') !== 'false';
            if (soundEnabled) {
              playMentionSound({ volume: 0.8 }).catch(e => console.log('Audio play failed:', e));
            }
          }).subscribe();

          // 5. Users Realtime (프로필 이미지 / 동기화 레벨 실시간 반영)
          //    users 테이블 UPDATE를 구독해, 우리 길드 멤버의 변경이면 allMembers를 즉시 갱신.
          //    realtime 필터는 단순 등식만 지원하므로 guild 단위 필터는 불가 → 클라이언트에서 멤버 여부로 판별.
          const usersRoom = supabase.channel(`sys_users_${data.unions.id}_${user.id}`);
          usersRoom.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, payload => {
            if (!isMounted) return;
            const updated = payload.new;
            if (!updated || !updated.id) return;

            setAllMembers(prev => {
              let changed = false;
              const next = prev.map(m => {
                if (m.user_id !== updated.id) return m;
                changed = true;
                return {
                  ...m,
                  users: {
                    ...(m.users || {}),
                    profile_image_id: updated.profile_image_id,
                    synchro_level: updated.synchro_level
                  }
                };
              });
              return changed ? next : prev;
            });

            // 본인 변경이면 동기화 레벨도 즉시 반영
            if (updated.id === user.id && updated.synchro_level) {
              setSynchroLevel(updated.synchro_level);
            }
          }).subscribe();

          // 정리(cleanup)용으로 모아둔다
          chatChannelsRef.current = [guildRoom, nickRoom, bossBattleSysRoom, notifSysRoom, usersRoom];

          // 내 접속 표시(track)가 서버 presence 상태에 실제로 들어가 있는지 확인하고, 없으면 다시 건다.
          // 예전에는 SUBSCRIBED 때 한 번만 track 하고 실패(timed out / rate limited 등)해도 다시 걸지 않아서,
          // 소켓은 멀쩡한데 그 사람만 다른 사람 화면에서 계속 '오프라인'으로 남는 경우가 있었다.
          // 재접속이 일어나야만 풀렸다. 이제 sync 때, 화면 복귀 때, 1분마다 내 항목이 빠져 있으면 다시 건다.
          // (내 항목이 있으면 아무것도 보내지 않는다 — presence 메시지 한도를 쓰지 않는다)
          let presenceJoined = false;
          let tracking = false;
          let trackFailures = 0;
          let retryTimer = null;
          const ensureTracked = async ({ force = false } = {}) => {
            if (!isMounted || !presenceJoined || tracking || retryTimer) return;
            if (!force && presenceRoom.presenceState()[user.id]?.length) { trackFailures = 0; return; }
            tracking = true;
            let ok = false;
            try {
              const result = await presenceRoom.track({
                user_id: user.id,
                in_game_name: inGameNameRef.current
              });
              ok = result === 'ok';
              if (!ok) console.warn('[presence] track 실패:', result);
            } catch (e) {
              console.warn('[presence] track 실패:', e);
            } finally {
              tracking = false;
            }
            if (ok) { trackFailures = 0; return; }
            // 실패하면 2초, 4초, 8초 … 최대 60초 뒤 다시 시도한다.
            const delay = Math.min(60000, 2000 * 2 ** trackFailures);
            trackFailures += 1;
            retryTimer = setTimeout(() => { retryTimer = null; ensureTracked(); }, delay);
          };
          presenceEnsureRef.current = ensureTracked;

          const onPresenceVisible = () => { if (document.visibilityState === 'visible') ensureTracked(); };
          document.addEventListener('visibilitychange', onPresenceVisible);
          const presenceCheck = setInterval(ensureTracked, 60000);
          presenceCleanupRef.current = () => {
            document.removeEventListener('visibilitychange', onPresenceVisible);
            clearInterval(presenceCheck);
            if (retryTimer) clearTimeout(retryTimer);
            presenceEnsureRef.current = null;
          };

          presenceRoom.subscribe((status, err) => {
            if (!isMounted) return;
            if (status === 'SUBSCRIBED') {
              presenceJoined = true;
              // 재접속이면 서버에서 내 항목이 지워졌으므로, 확인 없이 바로 다시 건다.
              if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
              trackFailures = 0;
              ensureTracked({ force: true });
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              presenceJoined = false;
              if (status !== 'CLOSED') console.warn(`[presence] ${status}`, err || '');
            }
          });
        }
      } catch (err) {
        if (!isMounted) return;
        console.error("Layout fetch error:", err);
        // 조용히 넘기면 guild이 null인 채로 로비로 튕겨서 "길드가 없다"고 오인하게 된다.
        setFetchError(err.message || JSON.stringify(err));
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchWorkspaceInfo();

    return () => {
      isMounted = false;
      if (currentChannelRef.current) {
        supabase.removeChannel(currentChannelRef.current);
      }
      if (systemRoomRef.current) {
        supabase.removeChannel(systemRoomRef.current);
      }
      if (chatChannelsRef.current) {
        chatChannelsRef.current.forEach(c => supabase.removeChannel(c));
      }
      bossBattleCatchUpRef.current?.dispose();
      bossBattleCatchUpRef.current = null;
      presenceCleanupRef.current?.();
      presenceCleanupRef.current = null;
    };
  }, [user, demo.isDemo, demo.ready, retryNonce]);

  // 일반 채팅 메시지 실시간 구독 — 길드의 모든 채널을 `channel_id=in.(...)` 필터 하나로 받는다.
  // 채널이 생기거나 지워질 때만 다시 구독한다. (in 필터는 값 100개까지라 그 이상이면 나눠서 건다)
  const channelIdsKey = channels.map(c => c.id).sort().join(',');
  useEffect(() => {
    if (demo.isDemo || !guild?.id || !user?.id || !channelIdsKey) return;
    let active = true;

    const onInsert = (msg) => {
      if (!active) return;
      messageListenersRef.current.forEach(fn => fn('INSERT', msg));
      if (msg.user_id === user.id) return;

      // 지금 보고 있는 채널이면 안읽음으로 표시하지 않는다(읽음 처리는 채팅 화면이 한다)
      if (msg.channel_id === viewingChannelIdRef.current) return;

      const isMod = isManager(roleRef.current);
      const hasMention = isMentioned(msg.content, { userId: user.id, inGameName: inGameNameRef.current, isMod });

      setUnreadChannels(prev => {
        if (prev[msg.channel_id] === 'mention') return prev;
        return { ...prev, [msg.channel_id]: hasMention ? 'mention' : 'unread' };
      });
    };
    const onUpdate = (payload) => {
      if (!active) return;
      messageListenersRef.current.forEach(fn => fn('UPDATE', payload.new));
    };

    const ids = channelIdsKey.split(',');
    // 끊겼다 다시 붙는 동안 놓친 메시지는 재접속/화면 복귀 때 직접 조회해 메운다(src/lib/realtime.js).
    const catchUp = createCatchUp({
      label: 'messages',
      fetchRows: async ({ since, limit }) => {
        let q = supabase.from('messages').select('*').in('channel_id', ids).is('deleted_at', null);
        if (since) q = q.gte('created_at', since);
        const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
        if (error) throw error;
        return (data || []).reverse();
      },
      onRow: onInsert,
    });
    const room = supabase.channel(`sys_msg_${guild.id}_${user.id}_${Date.now()}`);
    for (let i = 0; i < ids.length; i += 100) {
      const filter = `channel_id=in.(${ids.slice(i, i + 100).join(',')})`;
      room
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, payload => catchUp.handle(payload.new))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, onUpdate);
    }
    room.subscribe(catchUp.onStatus);

    return () => {
      active = false;
      catchUp.dispose();
      supabase.removeChannel(room);
    };
  }, [demo.isDemo, guild?.id, user?.id, channelIdsKey]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleUpdateStatus = async (e) => {
    e.preventDefault();
    if (demo.isDemo) {
      demo.setStatusMessage(newStatusMessage);
      setStatusMessage(newStatusMessage);
      setIsStatusModalOpen(false);
      setAllMembers(prev => prev.map(m => m.user_id === user.id ? { ...m, status_message: newStatusMessage } : m));
      return;
    }
    try {
      const { error } = await supabase.rpc('update_status_message', {
        p_union_id: guild.id,
        p_message: newStatusMessage
      });
      if (error) throw error;

      setStatusMessage(newStatusMessage);
      setIsStatusModalOpen(false);

      setAllMembers(prev => prev.map(m => m.user_id === user.id ? { ...m, status_message: newStatusMessage } : m));
    } catch (err) {
      console.error(err);
      alert('상태 메시지 업데이트 실패: ' + err.message);
    }
  };

  if (loading) return <div className="workspace-loading">워크스페이스 서버에 접속 중입니다...</div>;
  if (fetchError) {
    return (
      <div className="app-boot app-boot-error">
        <p className="app-boot-title">워크스페이스에 진입하지 못했습니다.</p>
        <p className="app-boot-detail">{fetchError}</p>
        <button
          type="button"
          className="app-boot-retry"
          onClick={() => { setLoading(true); setRetryNonce((n) => n + 1); }}
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (!guild) return <Navigate to="/" />;

  const outletContext = {
    guild,
    role,
    user,
    inGameName,
    channels,
    allMembers,
    synchroLevel,
    setSynchroLevel,
    onlineUsers,
    isAdmin: isManager(role),
    profileImagesMap,
    leftCollapsed,
    rightCollapsed,
    isMobile,
    isNarrow,
    // 지휘 채팅방(/workspace/boss-battle-chat)이 안읽음 상태를 읽고 지운다.
    bossBattleUnread,
    setBossBattleUnread,
    // 채팅 화면이 메시지 실시간 이벤트를 받는 통로 (구독은 레이아웃이 하나만 유지)
    subscribeMessages,
    subscribeBossBattleMessages,
    isDemo: demo.isDemo
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <NoticeBanner />
      {demo.isDemo && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', padding: '8px 12px', backgroundColor: 'var(--accent-blurple)', color: 'var(--text-strong)', fontSize: '0.9rem', fontWeight: 'bold', flexShrink: 0 }}>
          <span>🧪 체험 모드입니다 — 입력한 내용은 저장되지 않으며 새로고침 시 초기화됩니다.</span>
          <button
            onClick={demo.exitDemo}
            style={{ backgroundColor: 'var(--text-strong)', color: 'var(--accent-blurple)', border: 'none', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' }}
          >
            체험 종료 / 가입하러 가기
          </button>
        </div>
      )}
      {isMobile ? (
        <WorkspaceMobileShell
          guild={guild}
          role={role}
          user={user}
          inGameName={inGameName}
          statusMessage={statusMessage}
          synchroLevel={synchroLevel}
          channels={channels}
          allMembers={allMembers}
          onlineUsers={onlineUsers}
          profileImagesMap={profileImagesMap}
          unreadChannels={unreadChannels}
          setUnreadChannels={setUnreadChannels}
          bossBattleUnread={bossBattleUnread}
          pendingRequestsCount={pendingRequestsCount}
          isAnyChatUnread={isAnyChatUnread}
          isAnyChatMentioned={isAnyChatMentioned}
          isBossBattleUnread={isBossBattleUnread}
          isBossBattleMention={isBossBattleMention}
          outletContext={outletContext}
          onStatusClick={() => { setNewStatusMessage(statusMessage); setIsStatusModalOpen(true); }}
          onSettingsClick={() => setIsSettingsModalOpen(true)}
          onSignOut={handleSignOut}
        />
      ) : (
      <div className="workspace-layout" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {!leftCollapsed && (
          <>
            <aside className="workspace-sidebar" style={{ width: leftWidth, flexShrink: 0 }}>
              <header className="workspace-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <button
                    onClick={() => setLeftCollapsed(true)}
                    className="panel-toggle-btn"
                    title="유저 현황 패널 접기"
                    aria-label="유저 현황 패널 접기"
                  >
                    ‹
                  </button>
                  <h2>{guild.name}</h2>
                </div>
                <span className="guild-code">#{guild.union_code}</span>
              </header>

              <MembersPanel
                user={user}
                role={role}
                inGameName={inGameName}
                statusMessage={statusMessage}
                synchroLevel={synchroLevel}
                allMembers={allMembers}
                onlineUsers={onlineUsers}
                profileImagesMap={profileImagesMap}
                pendingRequestsCount={pendingRequestsCount}
                onStatusClick={() => { setNewStatusMessage(statusMessage); setIsStatusModalOpen(true); }}
                onSettingsClick={() => setIsSettingsModalOpen(true)}
                onSignOut={handleSignOut}
              />
            </aside>

            <div
              style={{ width: '4px', cursor: 'col-resize', backgroundColor: 'rgba(0,0,0,0)', zIndex: 10 }}
              onMouseDown={() => { isResizingLeft.current = true; document.body.style.cursor = 'col-resize'; }}
              onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--accent-blurple)'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(0,0,0,0)'}
            />
          </>
        )}

        {leftCollapsed && (
          <button
            onClick={() => setLeftCollapsed(false)}
            className="panel-expand-btn left"
            title="유저 현황 패널 펼치기"
            aria-label="유저 현황 패널 펼치기"
          >
            ›
          </button>
        )}

        <main ref={mainRef} className="workspace-content" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* 경계가 여기(레이아웃 안쪽)에 있어야 탭을 옮길 때 가운데만 교체된다.
              바깥에 두면 셸이 통째로 언마운트돼서 realtime 구독이 매번 끊긴다. */}
          <Suspense fallback={<div className="route-fallback">불러오는 중...</div>}>
            <Outlet context={outletContext} />
          </Suspense>
        </main>

        {rightCollapsed && (
          <button
            onClick={() => setRightCollapsed(false)}
            className="panel-expand-btn right"
            title="패널 펼치기"
            aria-label="패널 펼치기"
          >
            ‹
          </button>
        )}

        {!rightCollapsed && (
          <>
            <div
              style={{ width: '4px', cursor: 'col-resize', backgroundColor: 'rgba(0,0,0,0)', zIndex: 10 }}
              onMouseDown={() => { isResizingRight.current = true; document.body.style.cursor = 'col-resize'; }}
              onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--accent-blurple)'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(0,0,0,0)'}
            />

            <aside className="workspace-right-sidebar" style={{ display: 'flex', flexDirection: 'column', width: rightWidth, flexShrink: 0, height: '100%', minHeight: 0 }}>
              <div style={{ display: 'flex', borderBottom: '1px solid var(--surface-2)', padding: '10px 10px 0 10px', gap: '5px', backgroundColor: 'var(--surface-1)', flexShrink: 0 }}>
                {/* 지휘 탭 하나에 지휘 툴 + 텍스트 채널이 다 들어가므로, 점도 양쪽 안읽음을 합쳐서 본다. */}
                <div className={`right-tab ${rightTab === 'bossBattle' ? 'active' : ''}`} onClick={() => { setRightTab('bossBattle'); }} style={{ position: 'relative', flex: 1, padding: '10px 0', background: rightTab === 'bossBattle' ? 'var(--surface-3)' : 'transparent', color: rightTab === 'bossBattle' ? 'var(--text-strong)' : 'var(--text-faint)', border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer', fontWeight: 'bold', textAlign: 'center' }}>
                  지휘
                  {((isBossBattleUnread || isAnyChatUnread) && rightTab !== 'bossBattle') && (
                    <div style={{ position: 'absolute', top: '10px', right: '10px', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: (isBossBattleMention || isAnyChatMentioned) ? 'var(--danger-strong)' : 'var(--text-strong)' }}></div>
                  )}
                </div>
                <div className={`right-tab ${rightTab === 'mock' ? 'active' : ''}`} onClick={() => setRightTab('mock')} style={{ flex: 1, padding: '10px 0', background: rightTab === 'mock' ? 'var(--surface-3)' : 'transparent', color: rightTab === 'mock' ? 'var(--text-strong)' : 'var(--text-faint)', border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer', fontWeight: 'bold', textAlign: 'center' }}>
                  모의전
                </div>
                <button
                  onClick={() => setRightCollapsed(true)}
                  className="panel-toggle-btn"
                  title="패널 접기"
                  aria-label="패널 접기"
                  style={{ alignSelf: 'center', marginBottom: '8px' }}
                >
                  ›
                </button>
              </div>

              <nav className="workspace-nav" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 }}>
                {rightTab === 'bossBattle' && (
                  <WorkspaceNavPanel
                    guild={guild}
                    role={role}
                    bossBattleUnread={bossBattleUnread}
                    channels={channels}
                    unreadChannels={unreadChannels}
                    onSelectChannel={(id) => setUnreadChannels(prev => ({ ...prev, [id]: false }))}
                  />
                )}

                {rightTab === 'mock' && (
                  <MockBossNav guild={guild} onSelectBoss={(bossNum) => navigate(`/workspace/mock-battles?bossNum=${bossNum}`)} />
                )}
              </nav>
            </aside>
          </>
        )}

      </div>
      )}

      <StatusMessageModal
        isOpen={isStatusModalOpen}
        value={newStatusMessage}
        onChange={e => setNewStatusMessage(e.target.value)}
        onSubmit={handleUpdateStatus}
        onClose={() => setIsStatusModalOpen(false)}
      />

      {isSettingsModalOpen && (
        <Suspense fallback={null}>
          <GuildSettings
            guild={guild}
            role={role}
            user={user}
            onClose={() => setIsSettingsModalOpen(false)}
          />
        </Suspense>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
