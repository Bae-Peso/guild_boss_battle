import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useDemo } from '../../demo/DemoContext';
import NikkeAvatar from '../../components/NikkeAvatar';
import SquadShareModal from './SquadShareModal';
import { CHAT_COOLDOWN_MS, encodeMentions, getMentionTargets, encodeEmoticons, parseEmoticons, isContinuation, findFirstUnreadIndex, groupMessagesByDay } from '../../lib/chatUtils';
import { isManager } from '../../lib/roles';
import MessageText from '../../components/chat/MessageText';
import MentionAutocomplete from '../../components/chat/MentionAutocomplete';
import MessageContextMenu from '../../components/chat/MessageContextMenu';
import ImageLightbox from '../../components/chat/ImageLightbox';
import ChatScrollControls from '../../components/chat/ChatScrollControls';
import UnreadDivider from '../../components/chat/UnreadDivider';
import EmojiPicker from '../../components/chat/EmojiPicker';
import EmoticonMessage from '../../components/chat/EmoticonMessage';
import ChatDateDivider from '../../components/chat/ChatDateDivider';
import MessageEditModal from '../../components/chat/MessageEditModal';
import MessageReactions from '../../components/chat/MessageReactions';
import { useChatAutoScroll } from '../../hooks/useChatAutoScroll';
import { useMessageWindow } from '../../hooks/useMessageWindow';
import { useMessageReactions } from '../../hooks/useMessageReactions';
import { useChatImageUpload } from '../../hooks/useChatImageUpload';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { isSameDay, formatChatTimeShort } from '../../lib/format';
import { fetchReadAt, markRead, channelScope } from '../../lib/chatReadState';
import '../../components/chat/chat.css';

// 입력창(textarea) 기본 1줄 높이. 전송/공유 버튼 높이를 여기에 맞춰, 입력창이 늘어나도 버튼은 그대로 둔다.
const INPUT_BASE_HEIGHT = '48px';
const INPUT_MAX_HEIGHT = 160;

export default function WorkspaceChat() {
  const { channelId } = useParams();
  const { user } = useAuth();
  const demo = useDemo();
  const { guild, role, onlineUsers, setUnreadChannels, allMembers, profileImagesMap, leftCollapsed, rightCollapsed, isMobile, subscribeMessages } = useOutletContext();
  const [channelInfo, setChannelInfo] = useState(null);
  const [membersMap, setMembersMap] = useState({});
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Mention states
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Bookmark state
  const [bookmarkDate, setBookmarkDate] = useState(null);

  // Anti-spam (도배 방지) — 전 채팅 공통 쿨다운. 리렌더가 필요 없으므로 ref 사용.
  const lastSentRef = useRef(0);
  
  // Image Modal state
  const [selectedImage, setSelectedImage] = useState(null);
  
  // Context Menu & Edit State
  const [contextMenu, setContextMenu] = useState(null);
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editText, setEditText] = useState('');
  
  // Squad Share Modal State
  const [isSquadShareModalOpen, setIsSquadShareModalOpen] = useState(false);

  // 채팅 입력창 이미지 붙여넣기(자동 업로드 → 미리보기 → 전송)
  const { pendingImageUrl, uploading: imageUploading, handlePaste, clearPending } = useChatImageUpload();

  // 이모티콘 선택창 상태
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiBtnRef = useRef(null);

  // 메시지 목록(최대 개수 유지 — 과거로 가면 최신 쪽을, 다시 내려오면 과거 쪽을 잘라낸다)
  const containerRef = useRef(null);
  const fetchPage = useCallback(async ({ before, after, limit }) => {
    let q = supabase.from('messages').select('*').eq('channel_id', channelId).is('deleted_at', null);
    if (after) q = q.gt('created_at', after).order('created_at', { ascending: true });
    else {
      if (before) q = q.lt('created_at', before);
      q = q.order('created_at', { ascending: false });
    }
    const { data, error } = await q.limit(limit);
    if (error) throw error;
    return after ? data : data.reverse();
  }, [channelId]);
  const {
    messages, setMessages, replace: replaceMessages,
    hasMore, hasNewer, missedNew, loadingOlder, loadingNewer,
    loadLatest, appendLive, onScrollEdges, pagingRef
  } = useMessageWindow({ containerRef, resetKey: channelId, fetchPage });

  // '새로운 메시지' 구분선 위치. 첫 진입 때는 이 메시지가 화면 위쪽에 오도록 연다.
  const firstUnreadIndex = findFirstUnreadIndex(messages, bookmarkDate, user?.id);
  const firstUnreadId = firstUnreadIndex >= 0 ? messages[firstUnreadIndex].id : null;

  // 스크롤 동작(최초 하단·안읽음 위치 이동 / 과거 로딩 유지 / 새 메시지 배지·버튼) 공통 훅
  const {
    onScroll: onContainerScroll,
    scrollToBottom,
    stickToBottom,
    atBottom,
    showNewBadge,
    initialScrolled
  } = useChatAutoScroll({ messages, currentUserId: user?.id, loading, resetKey: channelId, containerRef, pagingRef, initialTargetId: firstUnreadId });

  // 메시지 반응(✅/❤️/❌). 글을 못 쓰는 채널(공지 등)에서도 반응은 달 수 있다 —
  // 대화에 끼어드는 게 아니라 읽었다는 표시에 가깝기 때문.
  const { reactionsByMessage, toggle: toggleReaction, markFresh } = useMessageReactions({
    targetColumn: 'message_id',
    messages,
    userId: user?.id,
    resetKey: channelId,
    demo,
  });
  // 내가 이미 단 반응 — 우클릭 메뉴에서 눌린 상태로 보여주기 위함
  const myReactionsOf = (msgId) => new Set(
    (reactionsByMessage[msgId] || []).filter(r => r.user_id === user?.id).map(r => r.emoji)
  );

  // 실시간 수신 / 방금 보낸 메시지를 붙인다. 새 메시지는 반응 조회가 필요 없다.
  const pushLive = useCallback((row, own = false) => {
    if (appendLive(row, { own })) markFresh(row.id);
  }, [appendLive, markFresh]);

  // 입력창 자동 높이 조절 (Shift+Enter 줄바꿈으로 여러 줄이 되면 늘어난다)
  const inputRef = useAutoResizeTextarea(inputText, { maxHeight: INPUT_MAX_HEIGHT, onResize: stickToBottom });

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    if (!channelId || !user) return;
    
    let isMounted = true;

    // 체험 모드: 목업 스토어에서 채널/메시지를 읽고 realtime 구독은 생략
    if (demo.isDemo) {
      const ch = (demo.data?.channels || []).find(c => c.id === channelId);
      setChannelInfo(ch || null);
      setBookmarkDate(new Date());
      replaceMessages((demo.data?.messages || []).filter(m => m.channel_id === channelId && !m.deleted_at));
      setLoading(false);
      return () => { isMounted = false; };
    }

    const initChat = async () => {
      try {
        setLoading(true);
        setBookmarkDate(null);

        // 1. 채널 정보 + 진입 시점의 '마지막 읽음 시각'(새로운 메시지 구분선 기준)
        //    읽음 시각은 아래 읽음 처리 effect 가 now 로 갱신하기 전의 값이어야 하므로 메시지보다 먼저 받는다.
        const [{ data: chData, error: chErr }, saved] = await Promise.all([
          supabase.from('channels').select('*, unions(id)').eq('id', channelId).single(),
          fetchReadAt(user.id, channelScope(channelId)),
        ]);
        if (chErr) {
          console.error(chErr);
          throw chErr;
        }
        if (!isMounted) return;
        setBookmarkDate(saved ? new Date(saved) : new Date());

        if (chData) {
          setChannelInfo(chData);
          // 2. 메시지 가져오기 — 안읽은 메시지가 많으면 최신 대신 첫 안읽은 메시지 주변부터
          //    (실시간 이벤트는 아래 effect 가 레이아웃 구독에서 받는다)
          await loadLatest({ unreadAfter: saved });
        }
      } catch (err) {
        console.error("Chat init error:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initChat();

    return () => {
      isMounted = false;
    };
  }, [channelId, user]);

  // 실시간 메시지 — 레이아웃이 유지하는 구독에서 이 채널 것만 받는다.
  // 목록 조회보다 먼저 붙여두고, 조회 중에 도착한 메시지는 useMessageWindow 가 합친다.
  useEffect(() => {
    if (demo.isDemo || !channelId || !subscribeMessages) return;
    return subscribeMessages((eventType, row) => {
      if (!row || row.channel_id !== channelId) return;
      if (eventType === 'INSERT') {
        pushLive(row);
      } else if (eventType === 'UPDATE') {
        setMessages(prev => {
          if (row.deleted_at) return prev.filter(m => m.id !== row.id);
          return prev.some(m => m.id === row.id) ? prev.map(m => m.id === row.id ? row : m) : prev;
        });
      }
    });
  }, [channelId, subscribeMessages, demo.isDemo, pushLive, setMessages]);

  useEffect(() => {
    if (allMembers && allMembers.length > 0) {
      const map = {};
      allMembers.forEach(m => {
        map[m.user_id] = { name: m.in_game_name, role: m.role, statusMessage: m.status_message };
      });
      setMembersMap(map);
    }
  }, [allMembers]);

  const handleScroll = () => {
    onContainerScroll();
    onScrollEdges();
  };

  // 읽음 처리 (스크롤은 useChatAutoScroll 이 담당)
  // 최신 쪽이 잘려 있는(과거를 보는) 동안에는 읽음 처리하지 않는다 — 그동안 온 메시지는 아직 안 본 것이다.
  useEffect(() => {
    if (channelId && user && messages.length > 0 && !hasNewer) {
      markRead(user.id, channelScope(channelId));
      if (setUnreadChannels) {
        setUnreadChannels(prev => {
          if (prev[channelId]) return { ...prev, [channelId]: false };
          return prev;
        });
      }
    }
  }, [messages, channelId, user, setUnreadChannels, hasNewer]);

  const filteredMembers = mentionQuery !== null 
    ? allMembers.filter(m => m.in_game_name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : [];

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);

    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0) {
      const textAfterAt = val.slice(lastAt + 1);
      if (!textAfterAt.includes(' ')) {
        setMentionQuery(textAfterAt);
        setMentionIndex(0);
        return;
      }
    }
    setMentionQuery(null);
  };

  const handleKeyDown = (e) => {
    // 한글 등 IME 조합 중의 Enter는 '글자 확정'이므로 전송/자동완성으로 가로채지 않는다.
    if (e.nativeEvent?.isComposing) return;

    if (mentionQuery !== null && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(prev => (prev + 1) % filteredMembers.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(prev => (prev - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const member = filteredMembers[mentionIndex];
        const lastAt = inputText.lastIndexOf('@');
        const newText = inputText.slice(0, lastAt) + '@' + member.in_game_name + ' ';
        setInputText(newText);
        setMentionQuery(null);
        return;
      } else if (e.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }

    // Enter = 전송 / Shift+Enter = 줄바꿈 (textarea 기본 동작에 맡긴다)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (editingMsgId) {
      if (!editText.trim()) return;
      try {
        const parsedContent = encodeMentions(editText.trim(), allMembers);
        const updatedAt = new Date().toISOString();
        if (demo.isDemo) {
          demo.updateMessage(editingMsgId, { content: parsedContent, updated_at: updatedAt });
        } else {
          const { error } = await supabase.from('messages')
            .update({ content: parsedContent, updated_at: updatedAt })
            .eq('id', editingMsgId);
          if (error) throw error;
        }
        // 낙관적 반영: 실시간 echo 없이 즉시 수정 표시
        setMessages(prev => prev.map(m => m.id === editingMsgId ? { ...m, content: parsedContent, updated_at: updatedAt } : m));
        setEditingMsgId(null);
        setEditText('');
      } catch (err) {
        console.error(err);
        alert('메시지 수정 실패: ' + err.message);
      }
      return;
    }
    
    if (mentionQuery !== null && filteredMembers.length > 0) return; // Enter caught by mention

    // 첨부 이미지가 있으면 이미지 메시지로 전송(입력 텍스트는 캡션). 기존 $$SQUAD$$ 경로 재사용.
    if (pendingImageUrl) {
      const now = Date.now();
      if (now - lastSentRef.current < CHAT_COOLDOWN_MS) {
        alert(`도배 방지를 위해 ${CHAT_COOLDOWN_MS / 1000}초 후에 다시 전송할 수 있습니다.`);
        return;
      }
      lastSentRef.current = now;
      const caption = inputText.trim();
      const url = pendingImageUrl;
      setInputText('');
      setMentionQuery(null);
      clearPending();
      await handleSquadShare(caption, { type: 'squad_share', nikke_ids: [null, null, null, null, null], image_url: url });
      return;
    }

    if (!inputText.trim()) return;

    const now = Date.now();
    if (now - lastSentRef.current < CHAT_COOLDOWN_MS) {
      alert(`도배 방지를 위해 ${CHAT_COOLDOWN_MS / 1000}초 후에 다시 전송할 수 있습니다.`);
      return;
    }
    lastSentRef.current = now;

    const content = inputText.trim();
    setInputText('');
    setMentionQuery(null);

    const parsedContent = encodeMentions(content, allMembers);

    let inserted = null;
    let error = null;
    if (demo.isDemo) {
      inserted = demo.insertMessage({ channel_id: channelId, content: parsedContent });
    } else {
      ({ data: inserted, error } = await supabase.from('messages').insert({
        channel_id: channelId,
        user_id: user.id,
        content: parsedContent
      }).select().single());
    }

    if (error) {
      console.error(error);
      alert('메시지 전송 실패: ' + error.message);
      setInputText(content); // 복구
    } else {
      // 낙관적 반영: 실시간 echo를 기다리지 않고 즉시 표시 (중복은 appendLive 에서 가드)
      if (inserted) pushLive(inserted, true);
      // Notification processing (멘션 대상은 표시와 동일한 경계 규칙으로 추출)
      try {
        if (demo.isDemo) return; // 체험 모드: 알림 발송 없음
        const myInfo = allMembers.find(m => m.user_id === user.id);
        const inGameName = myInfo ? myInfo.in_game_name : '알 수 없음';
        const { ids: notifyIds } = getMentionTargets(content, allMembers, user.id);

        if (notifyIds.size > 0) {
          const notifs = Array.from(notifyIds).map(uid => ({
            user_id: uid,
            union_id: guild.id,
            message: `[${channelInfo.name}] ${inGameName}: ${content}`
          }));
          await supabase.from('user_notifications').insert(notifs);
        }
      } catch (e) {
        console.error("알림 발송 실패", e);
      }
    }
  };

  const handleSquadShare = async (msgText, payload) => {
    const jsonStr = JSON.stringify({ message: msgText, nikkes: payload.nikke_ids, image_url: payload.image_url });
    const content = `$$SQUAD$$${jsonStr}`;

    try {
      let inserted, error;
      if (demo.isDemo) {
        inserted = demo.insertMessage({ channel_id: channelId, content });
      } else {
        ({ data: inserted, error } = await supabase
          .from('messages')
          .insert({ channel_id: channelId, user_id: user.id, content })
          .select()
          .single());
      }
      if (error) throw error;
      if (inserted) pushLive(inserted, true);
    } catch (err) {
      console.error(err);
      alert('스쿼드 공유 실패');
    }
  };

  const handleSendEmoticons = async (list) => {
    if (!list || list.length === 0) return;

    const now = Date.now();
    if (now - lastSentRef.current < CHAT_COOLDOWN_MS) {
      alert(`도배 방지를 위해 ${CHAT_COOLDOWN_MS / 1000}초 후에 다시 전송할 수 있습니다.`);
      return;
    }
    lastSentRef.current = now;

    const content = encodeEmoticons(list);
    try {
      let inserted, error;
      if (demo.isDemo) {
        inserted = demo.insertMessage({ channel_id: channelId, content });
      } else {
        ({ data: inserted, error } = await supabase
          .from('messages')
          .insert({ channel_id: channelId, user_id: user.id, content })
          .select()
          .single());
      }
      if (error) throw error;
      if (inserted) pushLive(inserted, true);
    } catch (err) {
      console.error(err);
      alert('이모티콘 전송 실패');
    }
  };

  const handleDeleteMessage = async (msgId) => {
    if (!window.confirm('이 메시지를 정말 삭제하시겠습니까?')) return;
    try {
      if (demo.isDemo) {
        demo.deleteMessage(msgId);
      } else {
        const { error } = await supabase.from('messages')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', msgId);
        if (error) throw error;
      }
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch (err) {
      console.error(err);
      alert('메시지 삭제 실패: ' + err.message);
    }
  };

  const startEditing = (msg) => {
    setEditingMsgId(msg.id);
    const regex = /<@([^>]+)>/g;
    const parsedText = msg.content.replace(regex, (match, uuid) => {
      const m = allMembers.find(member => member.user_id === uuid);
      return m ? `@${m.in_game_name}` : match;
    });
    setEditText(parsedText);
    // 입력창 포커스는 나중에 처리
  };

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-dim)' }}>로딩 중...</div>;
  if (!channelInfo) return <div style={{ padding: '2rem', color: 'var(--error)' }}>채널을 찾을 수 없거나 접근 권한이 없습니다.</div>;
  const canWrite = !['notice', 'admin_only', 'raid_order'].includes(channelInfo.type) || isManager(role);
  const currentUserName = allMembers.find(m => m.user_id === user?.id)?.in_game_name || null;

  const pickMention = (m) => {
    const lastAt = inputText.lastIndexOf('@');
    setInputText(inputText.slice(0, lastAt) + '@' + m.in_game_name + ' ');
    setMentionQuery(null);
  };

  return (
    <div style={{ flex: 1, display: 'flex', backgroundColor: 'var(--surface-3)', borderRadius: '8px', overflow: 'hidden', minHeight: 0 }}>
      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.5rem', paddingLeft: leftCollapsed ? 'var(--panel-collapse-inset)' : undefined, paddingRight: rightCollapsed ? 'var(--panel-collapse-inset)' : undefined, borderBottom: '1px solid var(--surface-1)', display: 'flex', alignItems: 'center', backgroundColor: 'var(--surface-2)' }}>
          <h2 style={{ color: 'var(--text-strong)', margin: 0, fontSize: '1.2rem' }}>
            # {channelInfo.name}
            {channelInfo.type === 'notice' && <span style={{ marginLeft: '10px', fontSize: '0.9rem', color: 'var(--accent-amber)' }}>📢 공지사항</span>}
            {channelInfo.type === 'admin_only' && <span style={{ marginLeft: '10px', fontSize: '0.9rem', color: 'var(--error)' }}>관리자 전용</span>}
          </h2>
        </div>

        {/* Message List
            - 메시지 간격은 연속 메시지 여부에 따라 달라지므로 gap 대신 각 메시지의 marginTop 으로 준다
            - 위쪽 여백은 컨테이너가 아니라 날짜 묶음이 갖는다: sticky 구분선은 컨테이너의 padding 아래에 고정돼서,
              컨테이너에 padding-top 이 있으면 고정된 구분선 위로 메시지가 비어져 나온다 */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '0 1.5rem 1rem', display: 'flex', flexDirection: 'column', opacity: (loading || !initialScrolled) ? 0 : 1, transition: 'opacity 0.1s' }}
        >
          {/* 과거가 더 있으면 '불러오는 중' 줄 자리를 늘 비워 둔다 — 불러오기 시작할 때 줄이 새로 끼어들면,
              scrollTop 0 에서는 브라우저가 위치를 보정하지 않아 보던 메시지가 그만큼 밀려 내려간다 */}
          {hasMore && <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '10px 0', visibility: loadingOlder ? 'visible' : 'hidden' }}>이전 메시지 불러오는 중...</div>}
          {!hasMore && messages.length > 0 && <div style={{ textAlign: 'center', color: '#666', padding: '10px 0', fontSize: '0.85rem' }}>모든 메시지를 불러왔습니다.</div>}
          {messages.length === 0 && initialScrolled && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: '2rem' }}>
              아직 메시지가 없습니다. 첫 메시지를 보내보세요!
            </div>
          )}
          {groupMessagesByDay(messages).map(group => (
            // 날짜 묶음 단위로 감싸야 안의 날짜 구분선이 그 날짜 동안만 상단에 고정된다.
            <div key={group.key} style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
              <ChatDateDivider date={group.items[0].msg.created_at} background="var(--surface-3)" />
              {group.items.map(({ msg, index }, indexInDay) => {
                const isMe = msg.user_id === user.id;
                const sender = membersMap[msg.user_id] || { name: '알 수 없는 유저', role: 'member' };
                const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                // 스쿼드 공유/이모티콘 메시지는 말풍선 배경 없이 카드 형태로 표시
                const emoticonList = parseEmoticons(msg.content);
                const isCard = msg.content.startsWith('$$SQUAD$$') || !!emoticonList;

                const senderProfileImageId = allMembers.find(m => m.user_id === msg.user_id)?.users?.profile_image_id;
                const profileImageUrl = senderProfileImageId ? profileImagesMap?.[senderProfileImageId] : null;

                const nameWithRole = (
                  <span style={{ fontWeight: 'bold', color: isMe ? 'var(--accent-blue)' : 'var(--text-strong)', fontSize: '0.95rem' }}>
                    {sender.name}
                    {sender.role === 'admin' && <span style={{ marginLeft: '4px' }}>🟧</span>}
                    {sender.role === 'sub_admin' && <span style={{ marginLeft: '4px' }}>🟦</span>}
                  </span>
                );

                // 본인이 보낸 메시지는 '새로운 메시지'(안읽음) 구분선의 기준이 되지 않는다.
                const isFirstUnread = index === firstUnreadIndex;
                const isNewDay = index === 0 || !isSameDay(new Date(msg.created_at), new Date(messages[index - 1].created_at));

                // 같은 사람이 짧은 시간 안에 연달아 보낸 메시지는 프로필/닉네임/시간 없이 이어 붙인다.
                // 구분선(날짜 / 새로운 메시지)이 끼면 헤더를 다시 보여준다.
                const isCont = !isNewDay && !isFirstUnread && isContinuation(messages[index - 1], msg);

                return (
                  <div
                    key={msg.id}
                    data-msg-id={msg.id}
                    style={{ display: 'flex', flexDirection: 'column', width: '100%', marginTop: indexInDay === 0 ? 0 : (isCont ? '2px' : '1rem') }}
                    onContextMenu={(e) => {
                      // 수정/삭제 권한이 없어도 메뉴는 연다 — 반응은 누구나 달 수 있기 때문.
                      e.preventDefault();
                      setContextMenu({ x: e.pageX, y: e.pageY, msg });
                    }}
                  >
                    {isFirstUnread && <UnreadDivider />}
                    <div className="chat-msg-row" style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: '10px', width: '100%' }}>
                      {isCont ? (
                        // 연속 메시지: 프로필 자리를 비우고, hover 했을 때만 그 자리에 시간을 띄운다.
                        <div style={{ flexShrink: 0, width: '40px', display: 'flex', justifyContent: isMe ? 'flex-start' : 'flex-end', paddingTop: '12px' }}>
                          <span className="chat-hover-time" style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                            {formatChatTimeShort(msg.created_at)}
                          </span>
                        </div>
                      ) : (
                        <div style={{ flexShrink: 0 }}>
                          {profileImageUrl ? (
                            <img src={profileImageUrl} alt={sender.name} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: isMe ? 'var(--accent-blue)' : 'var(--border-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-strong)', fontWeight: 'bold', fontSize: '1.2rem' }}>
                              {sender.name ? sender.name.charAt(0).toUpperCase() : '?'}
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', maxWidth: 'calc(100% - 50px)' }}>
                        {!isCont && (
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                            {isMe ? (
                              <>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{timeStr}</span>
                                {nameWithRole}
                              </>
                            ) : (
                              <>
                                {nameWithRole}
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{timeStr}</span>
                              </>
                            )}
                          </div>
                        )}
                        <div style={{
                          backgroundColor: isCard ? 'transparent' : (isMe ? 'var(--accent-blue)' : 'var(--surface-2)'),
                          color: isMe ? 'var(--text-strong)' : '#ddd',
                          padding: isCard ? '0' : '0.6rem 1rem',
                          borderRadius: '8px',
                          maxWidth: '100%',
                          wordBreak: 'break-word',
                          whiteSpace: 'pre-wrap', // Shift+Enter 로 넣은 줄바꿈을 그대로 보여준다
                          lineHeight: '1.4'
                        }}>
                          {(() => {
                            if (emoticonList) {
                              return <EmoticonMessage emojis={emoticonList} onImageLoad={stickToBottom} />;
                            }
                            if (msg.content.startsWith('$$SQUAD$$')) {
                              try {
                                const payload = JSON.parse(msg.content.substring(9));
                                return (
                                  <div style={{ marginTop: '5px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                                    {payload.message && (
                                      <div style={{ backgroundColor: isMe ? 'var(--accent-blue)' : 'var(--surface-2)', color: isMe ? 'var(--text-strong)' : '#ddd', padding: '0.6rem 1rem', borderRadius: '8px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                                        {payload.message}
                                      </div>
                                    )}
                                    {payload.nikkes && payload.nikkes.some(n => n !== null) && (
                                      <div style={{ display: 'flex', gap: '8px', backgroundColor: 'var(--surface-2)', padding: '12px', borderRadius: '8px' }}>
                                        {payload.nikkes.map((nid, i) => (
                                          nid ? <NikkeAvatar key={i} nikkeId={nid} size="72px" /> : <div key={i} style={{ width: '72px', height: '72px', backgroundColor: 'var(--surface-1)', borderRadius: '4px' }}></div>
                                        ))}
                                      </div>
                                    )}
                                    {payload.image_url && (
                                      <div>
                                        <img
                                          src={payload.image_url}
                                          alt="attached"
                                          referrerPolicy="no-referrer"
                                          loading="lazy"
                                          onLoad={stickToBottom}
                                          style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--border-1)', backgroundColor: 'var(--surface-1)' }}
                                          onClick={() => setSelectedImage(payload.image_url)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              } catch (e) {
                                return msg.content;
                              }
                            } else {
                              return (
                                <MessageText
                                  content={msg.content}
                                  allMembers={allMembers}
                                  currentUserId={user.id}
                                  currentUserName={currentUserName}
                                />
                              );
                            }
                          })()}
                          {msg.updated_at && <span style={{ fontSize: '0.7rem', color: isMe ? '#cce5ff' : 'var(--text-dim)', marginLeft: '6px' }}>(수정됨)</span>}
                        </div>
                        <MessageReactions
                          rows={reactionsByMessage[msg.id]}
                          currentUserId={user.id}
                          getName={(uid) => membersMap[uid]?.name || '알 수 없는 유저'}
                          onToggle={(emoji) => toggleReaction(msg.id, emoji)}
                          align={isMe ? 'right' : 'left'}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {loadingNewer && <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '10px 0' }}>최신 메시지 불러오는 중...</div>}
        </div>

        {/* Input Area */}
        <div style={{ padding: isMobile ? '0.6rem 0.75rem' : '1rem 1.5rem', backgroundColor: 'var(--surface-3)', position: 'relative' }}>
          <ChatScrollControls
            atBottom={atBottom && !hasNewer}
            showNewBadge={showNewBadge || missedNew}
            onScrollToBottom={() => (hasNewer ? loadLatest({ scrollToBottom: true }) : scrollToBottom('smooth'))}
          />
          {mentionQuery !== null && (
            <MentionAutocomplete
              members={filteredMembers}
              activeIndex={mentionIndex}
              onPick={pickMention}
              onHover={setMentionIndex}
              profileImagesMap={profileImagesMap}
              leftOffset={isMobile ? '0.75rem' : '1.5rem'}
            />
          )}
          {showEmojiPicker && canWrite && (
            <EmojiPicker
              anchorRef={emojiBtnRef}
              onClose={() => setShowEmojiPicker(false)}
              onSend={(list) => { handleSendEmoticons(list); setShowEmojiPicker(false); }}
              style={{ position: 'absolute', right: isMobile ? '0.75rem' : '1.5rem', bottom: '70px', zIndex: 50 }}
            />
          )}
          {canWrite && (imageUploading || pendingImageUrl) && (
            <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'var(--surface-4)', padding: '8px', borderRadius: '8px', width: 'fit-content', maxWidth: '100%' }}>
              {imageUploading ? (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>이미지 업로드 중…</span>
              ) : (
                <>
                  <img src={pendingImageUrl} alt="첨부 미리보기" referrerPolicy="no-referrer" style={{ height: '56px', maxWidth: '120px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-1)' }} />
                  <button type="button" onClick={clearPending} title="첨부 제거" style={{ background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '0.85rem' }}>✕</button>
                </>
              )}
            </div>
          )}
          {canWrite ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <form onSubmit={handleSendMessage} style={{ flex: 1, minWidth: 0, display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={inputText}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={pendingImageUrl
                      ? '코멘트 입력 (선택) — Enter로 전송'
                      : (isMobile ? `#${channelInfo.name}에 메시지 보내기` : `#${channelInfo.name}에 메시지 보내기 (Shift+Enter 줄바꿈)`)}
                    title="Enter 전송 / Shift+Enter 줄바꿈"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: INPUT_BASE_HEIGHT,
                      padding: '0.8rem 1rem',
                      paddingRight: '46px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: 'var(--surface-4)',
                      color: 'var(--text-strong)',
                      fontFamily: 'inherit',
                      fontSize: '1rem',
                      lineHeight: '1.4',
                      resize: 'none',
                      overflowY: 'hidden',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    ref={emojiBtnRef}
                    onClick={() => setShowEmojiPicker(v => !v)}
                    title="이모티콘"
                    style={{ position: 'absolute', right: '8px', bottom: '11px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, padding: '2px' }}
                  >
                    😀
                  </button>
                </div>
                <button
                  type="submit"
                  style={{ backgroundColor: 'var(--accent-blurple)', color: 'var(--text-strong)', border: 'none', borderRadius: '8px', height: INPUT_BASE_HEIGHT, padding: isMobile ? '0 12px' : '0 18px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  전송
                </button>
              </form>
              <button
                onClick={() => setIsSquadShareModalOpen(true)}
                style={{ backgroundColor: 'var(--border-1)', color: 'var(--text-strong)', border: '1px solid var(--border-3)', borderRadius: '8px', height: INPUT_BASE_HEIGHT, padding: isMobile ? '0' : '0 15px', width: isMobile ? '44px' : undefined, flexShrink: 0, cursor: 'pointer', fontWeight: 'bold', fontSize: isMobile ? '1.5rem' : undefined, lineHeight: 1 }}
                title="스쿼드 공유"
              >
                +
              </button>
            </div>
          ) : (
            <div style={{
              padding: '0.8rem 1rem',
              borderRadius: '8px',
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text-dim)',
              textAlign: 'center',
              fontSize: '0.95rem'
            }}>
              이 채널은 관리자만 메시지를 보낼 수 있습니다.
            </div>
          )}
        </div>
      </div>

      {/* Context Menu for Edit / Delete */}
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canEdit={contextMenu.msg.user_id === user.id}
          canDelete={contextMenu.msg.user_id === user.id || isManager(role)}
          onEdit={() => { startEditing(contextMenu.msg); setContextMenu(null); }}
          onDelete={() => { handleDeleteMessage(contextMenu.msg.id); setContextMenu(null); }}
          onReact={(emoji) => { toggleReaction(contextMenu.msg.id, emoji); setContextMenu(null); }}
          myReactions={myReactionsOf(contextMenu.msg.id)}
        />
      )}

      <MessageEditModal
        isOpen={!!editingMsgId}
        value={editText}
        onChange={setEditText}
        onSubmit={handleSendMessage}
        onClose={() => { setEditingMsgId(null); setEditText(''); }}
      />

      <SquadShareModal
        isOpen={isSquadShareModalOpen}
        onClose={() => setIsSquadShareModalOpen(false)}
        onShare={handleSquadShare}
      />

      <ImageLightbox src={selectedImage} onClose={() => setSelectedImage(null)} />
    </div>
  );
}
