import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useDemo } from '../../demo/DemoContext';
import SquadShareModal from './SquadShareModal';
import NikkeAvatar from '../../components/NikkeAvatar';
import { CHAT_COOLDOWN_MS, encodeMentions, getMentionTargets, encodeEmoticons, parseEmoticons, isContinuation, findFirstUnreadIndex, groupMessagesByDay } from '../../lib/chatUtils';
import MessageText from '../../components/chat/MessageText';
import MentionAutocomplete from '../../components/chat/MentionAutocomplete';
import MessageContextMenu from '../../components/chat/MessageContextMenu';
import ImageLightbox from '../../components/chat/ImageLightbox';
import ChatScrollControls from '../../components/chat/ChatScrollControls';
import EmojiPicker from '../../components/chat/EmojiPicker';
import EmoticonMessage from '../../components/chat/EmoticonMessage';
import ChatDateDivider from '../../components/chat/ChatDateDivider';
import UnreadDivider from '../../components/chat/UnreadDivider';
import MessageEditModal from '../../components/chat/MessageEditModal';
import MessageReactions from '../../components/chat/MessageReactions';
import { useChatAutoScroll } from '../../hooks/useChatAutoScroll';
import { useMessageWindow } from '../../hooks/useMessageWindow';
import { useMessageReactions } from '../../hooks/useMessageReactions';
import { useChatImageUpload } from '../../hooks/useChatImageUpload';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { isSameDay, formatChatTimeShort } from '../../lib/format';
import { fetchReadAt, markRead, bossBattleScope } from '../../lib/chatReadState';
import '../../components/chat/chat.css';

// 입력창(textarea) 기본 1줄 높이. 전송/공유 버튼 높이를 여기에 맞춰, 입력창이 늘어나도 버튼은 그대로 둔다.
const INPUT_BASE_HEIGHT = '44px';
const INPUT_MAX_HEIGHT = 140;

/**
 * 지휘 채팅.
 * 메시지는 시즌(season_name)에 물려 있어, seasonName이 바뀌면 그 시즌의 대화만 보인다.
 * 지난 시즌은 읽기 전용(readOnly) — 이미 끝난 보스전의 방에 새 글이 끼어들면
 * 안읽음 표시가 현재 시즌 방과 엉키기 때문이다.
 * 보스전 기록을 잠갔거나('locked') 종료일이 지난('ended') 시즌(lockReason)은 현재 시즌이어도 열람만 된다
 * — 일반/관리자 방 모두 글쓰기·수정·삭제·반응 불가.
 */
export default function BossBattleChatPanel({ guild, user, isAdmin, allMembers, bossBattleUnread, setBossBattleUnread, inGameName, profileImagesMap, seasonName, readOnly: readOnlyProp = false, lockReason = null, onMemberClick, hitStatusByUserId, subscribeBossBattleMessages }) {
  const demo = useDemo();
  // 쓰기 차단 여부. 읽음 위치 기록(fetchReadAt 등)은 잠긴 현재 시즌에서도 그대로 해야 하므로 readOnlyProp 으로 따로 본다.
  const locked = !!lockReason;
  const readOnly = readOnlyProp || locked;
  const [activeTab, setActiveTab] = useState('general');
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // 방 진입 시점의 마지막 읽음 시각 — '새로운 메시지' 구분선 기준. 지난 시즌(열람 전용) 방에서는 쓰지 않는다.
  const [bookmarkDate, setBookmarkDate] = useState(null);
  // 메시지 조회가 끝난 방(roomKey). 읽음 처리는 지금 방의 조회가 끝난 뒤에만 한다 —
  // 방을 바꾼 직후 바로 읽음 처리하면, 진입 시 읽어 오는 '마지막 읽음 시각'이 now 로 덮여 구분선이 사라진다.
  const [loadedRoomKey, setLoadedRoomKey] = useState(null);
  // Anti-spam (도배 방지) — 전 채팅 공통 쿨다운
  const lastSentRef = useRef(0);

  const roomKey = `${activeTab}:${seasonName || ''}`;

  // 메시지 목록(최대 개수 유지 — 과거로 가면 최신 쪽을, 다시 내려오면 과거 쪽을 잘라낸다)
  const containerRef = useRef(null);
  const guildId = guild?.id;
  const fetchPage = useCallback(async ({ before, after, limit }) => {
    let q = supabase
      .from('raid_messages')
      .select('*')
      .eq('union_id', guildId)
      .eq('room_type', activeTab)
      .eq('season_name', seasonName)
      .is('deleted_at', null);
    if (after) q = q.gt('created_at', after).order('created_at', { ascending: true });
    else {
      if (before) q = q.lt('created_at', before);
      q = q.order('created_at', { ascending: false });
    }
    const { data, error } = await q.limit(limit);
    if (error) throw error;
    return after ? data : data.reverse();
  }, [guildId, activeTab, seasonName]);
  const {
    messages, setMessages, replace: replaceMessages,
    hasMore, hasNewer, missedNew, loadingOlder, loadingNewer,
    loadLatest, appendLive, onScrollEdges, pagingRef
  } = useMessageWindow({ containerRef, resetKey: roomKey, fetchPage });

  // '새로운 메시지' 구분선 위치. 첫 진입 때는 이 메시지가 화면 위쪽에 오도록 연다.
  const firstUnreadIndex = findFirstUnreadIndex(messages, bookmarkDate, user.id);
  const firstUnreadId = firstUnreadIndex >= 0 ? messages[firstUnreadIndex].id : null;

  // 스크롤 동작(최초 하단·안읽음 위치 이동 / 과거 로딩 유지 / 새 메시지 배지·버튼) 공통 훅
  const {
    onScroll: onContainerScroll,
    scrollToBottom,
    stickToBottom,
    atBottom,
    showNewBadge,
    initialScrolled
  } = useChatAutoScroll({ messages, currentUserId: user.id, loading: isLoading, resetKey: roomKey, containerRef, pagingRef, initialTargetId: firstUnreadId });

  // 메시지 반응(✅/❤️/❌). 지난 시즌 방은 열람만이므로 반응도 달 수 없다(이미 있는 것은 보인다).
  const canReact = !readOnly && !!seasonName;
  const { reactionsByMessage, toggle: toggleReaction, markFresh } = useMessageReactions({
    targetColumn: 'raid_message_id',
    messages,
    userId: user.id,
    resetKey: roomKey,
    demo,
  });
  // 실시간 수신 / 방금 보낸 메시지를 붙인다. 새 메시지는 반응 조회가 필요 없다.
  const pushLive = useCallback((row, own = false) => {
    if (appendLive(row, { own })) markFresh(row.id);
  }, [appendLive, markFresh]);
  // 내가 이미 단 반응 — 우클릭 메뉴에서 눌린 상태로 보여주기 위함
  const myReactionsOf = (msgId) => new Set(
    (reactionsByMessage[msgId] || []).filter(r => r.user_id === user.id).map(r => r.emoji)
  );

  // Mention Autocomplete States
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isSquadShareModalOpen, setIsSquadShareModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  // 채팅 입력창 이미지 붙여넣기(자동 업로드 → 미리보기 → 전송)
  const { pendingImageUrl, uploading: imageUploading, handlePaste, clearPending } = useChatImageUpload();

  // 이모티콘 선택창 상태
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiBtnRef = useRef(null);
  
  // Context Menu & Edit State
  const [contextMenu, setContextMenu] = useState(null);
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editText, setEditText] = useState('');

  // 입력창 자동 높이 조절 (Shift+Enter 줄바꿈으로 여러 줄이 되면 늘어난다)
  const inputRef = useAutoResizeTextarea(inputText, { maxHeight: INPUT_MAX_HEIGHT, onResize: stickToBottom });

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    if (!guild) return;
    setBookmarkDate(null);

    // 시즌이 정해지기 전에는 어떤 방을 열어야 할지 알 수 없다 (시즌이 아예 없는 길드 포함).
    if (!seasonName) {
      replaceMessages([]);
      setIsLoading(false);
      setLoadedRoomKey(roomKey);
      return;
    }

    // 체험 모드: 목업 스토어에서 지휘 메시지를 읽고 realtime 구독은 생략
    if (demo.isDemo) {
      const list = (demo.data?.bossBattleMessages || [])
        .filter(m => m.room_type === activeTab && m.season_name === seasonName && !m.deleted_at)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      replaceMessages(list);
      setIsLoading(false);
      setLoadedRoomKey(roomKey);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    (async () => {
      // 읽음 위치는 방 단위 하나뿐(시즌 구분 없음)이라, 지난 시즌 방에는 구분선을 두지 않는다.
      // 아래 읽음 처리 effect 가 now 로 갱신하기 전의 값이어야 하므로 메시지보다 먼저 받는다.
      const saved = readOnlyProp ? null : await fetchReadAt(user.id, bossBattleScope(activeTab, guild.id));
      if (cancelled) return;
      setBookmarkDate(saved ? new Date(saved) : null);
      // 안읽은 메시지가 많으면 최신 대신 첫 안읽은 메시지 주변부터 불러온다.
      await loadLatest({ unreadAfter: saved });
    })().finally(() => {
      if (cancelled) return;
      setIsLoading(false);
      setLoadedRoomKey(roomKey);
    });
    return () => { cancelled = true; };
  }, [guild, activeTab, seasonName]);

  // 실시간 메시지 — 레이아웃이 길드 단위로 유지하는 구독에서 이 방/시즌 것만 받는다.
  useEffect(() => {
    if (demo.isDemo || !guildId || !seasonName || !subscribeBossBattleMessages) return;
    return subscribeBossBattleMessages((eventType, row) => {
      if (!row || row.union_id !== guildId) return;
      if (eventType === 'INSERT') {
        if (row.room_type === activeTab && row.season_name === seasonName) pushLive(row);
      } else if (eventType === 'UPDATE') {
        setMessages(prev => {
          if (row.deleted_at) return prev.filter(m => m.id !== row.id);
          return prev.some(m => m.id === row.id) ? prev.map(m => m.id === row.id ? { ...m, ...row } : m) : prev;
        });
      }
    });
  }, [guildId, activeTab, seasonName, subscribeBossBattleMessages, demo.isDemo, pushLive, setMessages]);

  const handleScroll = () => {
    onContainerScroll();
    onScrollEdges();
  };

  const getMemberInfo = (userId) => {
    const m = allMembers.find(x => x.user_id === userId);
    return m ? m : { in_game_name: '알 수 없음', role: 'member' };
  };

  const filteredMembers = mentionQuery !== null
    ? allMembers.filter(m => m.in_game_name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : [];

  const pickMention = (m) => {
    const lastAt = inputText.lastIndexOf('@');
    setInputText(inputText.slice(0, lastAt) + '@' + m.in_game_name + ' ');
    setMentionQuery(null);
  };

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
    handleSendMessage(e);
  };

  const handleSendMessage = async (e) => {
    // keydown으로 들어온 경우 Enter(쉬프트 제외)만 처리. 버튼 클릭(e 없음)은 그대로 전송.
    if (e?.key && (e.key !== 'Enter' || e.shiftKey)) return;
    if (e?.preventDefault) e.preventDefault();
    if (readOnly || !seasonName) return;
    {
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

      const text = inputText.trim();
      setInputText('');

      const parsedContent = encodeMentions(text, allMembers);

      try {
        let inserted, error;
        if (demo.isDemo) {
          inserted = demo.insertBossBattleMessage({ room_type: activeTab, content: parsedContent, season_name: seasonName });
        } else {
          ({ data: inserted, error } = await supabase
            .from('raid_messages')
            .insert({
              union_id: guild.id,
              user_id: user.id,
              room_type: activeTab,
              season_name: seasonName,
              content: parsedContent
            })
            .select()
            .single());
        }

        if (error) throw error;

        // 낙관적 반영: 실시간 echo를 기다리지 않고 즉시 표시 (중복은 INSERT 핸들러에서 가드)
        // 내가 보낸 메시지이므로 useChatAutoScroll 이 자동으로 맨 아래로 이동시킴
        if (inserted && inserted.room_type === activeTab) pushLive(inserted, true);

        if (demo.isDemo) return; // 체험 모드: 알림 발송 없음

        // Notification processing (멘션 대상은 표시와 동일한 경계 규칙으로 추출)
        const { ids: notifyIds } = getMentionTargets(text, allMembers, user.id);
        const channelLabel = activeTab === 'admin' ? '지휘-관리자' : '지휘-일반';

        if (notifyIds.size > 0) {
          const notifs = Array.from(notifyIds).map(uid => ({
            user_id: uid,
            union_id: guild.id,
            message: `[${channelLabel}] ${inGameName}: ${text}`
          }));
          await supabase.from('user_notifications').insert(notifs);
        }

      } catch (err) {
        console.error(err);
        alert('메시지 전송 실패');
      }
    }
  };

  const handleSquadShare = async (msgText, payload) => {
    if (readOnly || !seasonName) return;
    const jsonStr = JSON.stringify({ message: msgText, nikkes: payload.nikke_ids, image_url: payload.image_url });
    const content = `$$SQUAD$$${jsonStr}`;

    try {
      let inserted, error;
      if (demo.isDemo) {
        inserted = demo.insertBossBattleMessage({ room_type: activeTab, content, season_name: seasonName });
      } else {
        ({ data: inserted, error } = await supabase
          .from('raid_messages')
          .insert({
            union_id: guild.id,
            user_id: user.id,
            room_type: activeTab,
            season_name: seasonName,
            content: content
          })
          .select()
          .single());
      }
      if (error) throw error;
      if (inserted && inserted.room_type === activeTab) pushLive(inserted, true);
    } catch (err) {
      console.error(err);
      alert('스쿼드 공유 실패');
    }
  };

  const handleSendEmoticons = async (list) => {
    if (!list || list.length === 0) return;
    if (readOnly || !seasonName) return;

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
        inserted = demo.insertBossBattleMessage({ room_type: activeTab, content, season_name: seasonName });
      } else {
        ({ data: inserted, error } = await supabase
          .from('raid_messages')
          .insert({ union_id: guild.id, user_id: user.id, room_type: activeTab, season_name: seasonName, content })
          .select()
          .single());
      }
      if (error) throw error;
      if (inserted && inserted.room_type === activeTab) pushLive(inserted, true);
    } catch (err) {
      console.error(err);
      alert('이모티콘 전송 실패');
    }
  };

  // 지난 시즌 방을 들여다본 것으로 현재 시즌의 안읽음까지 지워지면 안 된다
  // (읽음 위치는 방 단위 하나뿐이라 시즌을 구분하지 않는다).
  // 안읽음 점 지우기와 읽음 시각 저장은 따로 둔다 — 한 effect 에 두면 점을 지우는 것만으로
  // effect 가 다시 돌아 메시지 1건에 읽음 저장이 여러 번 나갔다.
  useEffect(() => {
    if (readOnlyProp) return;
    if (bossBattleUnread?.[activeTab]) {
      setBossBattleUnread(prev => ({ ...prev, [activeTab]: false }));
    }
  }, [activeTab, bossBattleUnread, setBossBattleUnread, readOnlyProp]);

  // 활성 탭의 읽음 시각을 DB에 갱신 (브라우저 간 공유).
  // 최신 쪽이 잘려 있는(과거를 보는) 동안에는 하지 않는다 — 그동안 온 메시지는 아직 안 본 것이다.
  // 이번 시즌 방이 비어 있어도 연 것만으로 읽음 처리한다. 메시지가 있을 때만 하면, 빈 방에서는
  // 읽음 시각이 영영 갱신되지 않아 다른 시즌/지워진 메시지 때문에 켜진 안읽음 점이 접속할 때마다 다시 뜬다.
  useEffect(() => {
    if (readOnlyProp || hasNewer || !seasonName || loadedRoomKey !== roomKey) return;
    if (user && guild) {
      markRead(user.id, bossBattleScope(activeTab, guild.id));
    }
  }, [activeTab, messages, user, guild, readOnlyProp, hasNewer, seasonName, loadedRoomKey, roomKey]);

  const renderDot = (type) => {
    const status = bossBattleUnread?.[type];
    if (!status) return null;
    return <span className="dot" style={{ backgroundColor: status === 'mention' ? 'var(--danger-strong)' : 'var(--text-strong)' }}></span>;
  };

  const handleDeleteMessage = async (msgId) => {
    if (!confirm('메시지를 삭제하시겠습니까?')) return;
    try {
      if (demo.isDemo) {
        demo.deleteBossBattleMessage(msgId);
      } else {
        const { error } = await supabase.from('raid_messages')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', msgId);
        if (error) throw error;
      }
      // 로컬 state 즉시 업데이트 (실시간 이벤트에 의존하지 않음)
      setMessages(prev => prev.filter(m => m.id !== msgId));
      setContextMenu(null);
    } catch (err) {
      console.error(err);
      alert('메시지 삭제 실패');
    }
  };

  const startEditing = (msg) => {
    setEditingMsgId(msg.id);
    let originalText = msg.content;
    const matches = originalText.match(/<@([^>]+)>/g);
    if (matches) {
      matches.forEach(m => {
        const uid = m.slice(2, -1);
        const userMem = allMembers.find(x => x.user_id === uid);
        if (userMem) {
          originalText = originalText.replace(m, `@${userMem.in_game_name}`);
        }
      });
    }
    setEditText(originalText);
  };

  const handleEditSubmit = async () => {
    if (!editText.trim()) return;

    const parsedContent = encodeMentions(editText.trim(), allMembers);
    try {
      const updatedAt = new Date().toISOString();
      if (demo.isDemo) {
        demo.updateBossBattleMessage(editingMsgId, { content: parsedContent, updated_at: updatedAt });
      } else {
        const { error } = await supabase
          .from('raid_messages')
          .update({ content: parsedContent, updated_at: updatedAt })
          .eq('id', editingMsgId);
        if (error) throw error;
      }
      // 로컬 state 즉시 업데이트 (실시간 이벤트에 의존하지 않음)
      setMessages(prev => prev.map(m => m.id === editingMsgId ? { ...m, content: parsedContent, updated_at: updatedAt } : m));
      setEditingMsgId(null);
      setEditText('');
    } catch (err) {
      console.error(err);
      alert('메시지 수정 실패');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-1)', minHeight: '300px', overflow: 'hidden' }}>
        {/* 방 전환(일반/관리자)은 한 줄을 통째로 쓰지 않도록 우측 상단 반투명 pill로 띄운다.
            안읽음이 있으면 흐린 상태로 두지 않는다 — 접힌 채로는 점을 못 보고 지나치기 때문. */}
        {isAdmin && (
          <div className={`boss-battle-room-switch${(bossBattleUnread?.general || bossBattleUnread?.admin) ? ' has-unread' : ''}`}>
            <button
              type="button"
              className={activeTab === 'general' ? 'active' : ''}
              onClick={() => setActiveTab('general')}
            >
              일반
              {activeTab !== 'general' && renderDot('general')}
            </button>
            <button
              type="button"
              className={activeTab === 'admin' ? 'active' : ''}
              onClick={() => setActiveTab('admin')}
            >
              관리자
              {activeTab !== 'admin' && renderDot('admin')}
            </button>
          </div>
        )}
        {/* 위쪽 여백은 컨테이너가 아니라 날짜 묶음이 갖는다 — 컨테이너에 padding-top 이 있으면
            고정(sticky)된 날짜 구분선 위로 메시지가 비어져 나온다 */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '0 15px 15px', opacity: (isLoading || !initialScrolled) ? 0 : 1, transition: 'opacity 0.1s' }}
        >
          {/* 과거가 더 있으면 '불러오는 중' 줄 자리를 늘 비워 둔다 — 불러오기 시작할 때 줄이 새로 끼어들면,
              scrollTop 0 에서는 브라우저가 위치를 보정하지 않아 보던 메시지가 그만큼 밀려 내려간다 */}
          {hasMore && <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '10px 0', fontSize: '0.85rem', visibility: loadingOlder ? 'visible' : 'hidden' }}>이전 메시지 불러오는 중...</div>}
          {!hasMore && messages.length > 0 && <div style={{ textAlign: 'center', color: '#666', padding: '10px 0', fontSize: '0.85rem' }}>모든 메시지를 불러왔습니다.</div>}
          {messages.length === 0 && !isLoading && (
            <div style={{ textAlign: 'center', color: '#666', fontSize: '0.85rem', marginTop: '20px' }}>메시지가 없습니다.</div>
          )}
          {groupMessagesByDay(messages).map(group => (
            // 날짜 묶음 단위로 감싸야 안의 날짜 구분선이 그 날짜 동안만 상단에 고정된다.
            <div key={group.key}>
              <ChatDateDivider date={group.items[0].msg.created_at} background="var(--surface-1)" />
              {group.items.map(({ msg, index }, indexInDay) => {
                const mInfo = getMemberInfo(msg.user_id);
                const isMe = msg.user_id === user.id;
                const senderProfileImageId = allMembers.find(m => m.user_id === msg.user_id)?.users?.profile_image_id;
                const profileImageUrl = senderProfileImageId ? profileImagesMap?.[senderProfileImageId] : null;
                const isNewDay = index === 0 || !isSameDay(new Date(msg.created_at), new Date(messages[index - 1].created_at));

                // 본인이 보낸 메시지는 '새로운 메시지'(안읽음) 구분선의 기준이 되지 않는다.
                const isFirstUnread = index === firstUnreadIndex;

                // 같은 사람이 짧은 시간 안에 연달아 보낸 메시지는 프로필/닉네임/시간 없이 이어 붙인다.
                // 구분선(날짜 / 새로운 메시지)이 끼면 헤더를 다시 보여준다.
                const isCont = !isNewDay && !isFirstUnread && isContinuation(messages[index - 1], msg);

                return (
                  <div
                    key={msg.id}
                    data-msg-id={msg.id}
                    style={{ marginTop: indexInDay === 0 ? 0 : (isCont ? '2px' : '15px') }}
                    onContextMenu={(e) => {
                      // 수정/삭제 권한이 없어도 메뉴는 연다 — 반응은 누구나 달 수 있기 때문.
                      if (!locked && (isMe || isAdmin || canReact)) {
                        e.preventDefault();
                        setContextMenu({ x: e.pageX, y: e.pageY, msg });
                      }
                    }}
                  >
                    {isFirstUnread && <UnreadDivider style={{ margin: '10px 0 15px 0' }} />}
                    <div className="chat-msg-row" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      {isCont ? (
                        // 연속 메시지: 프로필 자리를 비우고, hover 했을 때만 그 자리에 시간을 띄운다.
                        <div style={{ flexShrink: 0, width: '32px', display: 'flex', justifyContent: 'flex-end', paddingTop: '3px' }}>
                          <span className="chat-hover-time" style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                            {formatChatTimeShort(msg.created_at)}
                          </span>
                        </div>
                      ) : (
                        // 초상화 클릭 → 그 사람의 이 시즌 보스전 기록 (닉네임도 같은 동작)
                        <div
                          style={{ flexShrink: 0, cursor: onMemberClick ? 'pointer' : 'default' }}
                          onClick={() => onMemberClick?.(msg.user_id)}
                          title={onMemberClick ? `${mInfo.in_game_name} 님의 이번 시즌 보스전 기록 보기` : undefined}
                        >
                          {profileImageUrl ? (
                            <img src={profileImageUrl} alt={mInfo.in_game_name} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--border-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-strong)', fontWeight: 'bold', fontSize: '0.9rem' }}>
                              {mInfo.in_game_name ? mInfo.in_game_name.charAt(0).toUpperCase() : '?'}
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        {!isCont && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span
                              style={{ fontWeight: 'bold', color: '#93c5fd', fontSize: '0.95rem', cursor: onMemberClick ? 'pointer' : 'default' }}
                              onClick={() => onMemberClick?.(msg.user_id)}
                              title={onMemberClick ? `${mInfo.in_game_name} 님의 이번 시즌 보스전 기록 보기` : undefined}
                            >
                              {mInfo.in_game_name}
                            </span>
                            {mInfo.role === 'admin' && (
                              <span style={{ fontSize: '0.95rem' }}>🟧</span>
                            )}
                            {mInfo.role === 'sub_admin' && (
                              <span style={{ fontSize: '0.95rem' }}>🟦</span>
                            )}
                            {/* 이번 시즌 소모 타수 — "2 / 3" 뒤에 때린 보스의 약점 속성을 순서대로 */}
                            {(() => {
                              const hs = hitStatusByUserId?.[msg.user_id];
                              if (!hs) return null;
                              return (
                                <span
                                  className="boss-battle-hit-chip"
                                  title={`${mInfo.in_game_name} 님의 소모 타수 ${hs.hits} / ${hs.cap}${hs.elements.length > 0 ? ` (${hs.elements.map(e => e.name).join(', ')})` : ''}`}
                                >
                                  <span className={hs.hits >= hs.cap ? 'boss-battle-hit-chip__count is-spent' : 'boss-battle-hit-chip__count'}>
                                    {hs.hits} / {hs.cap}
                                  </span>
                                  {hs.elements.map((el, i) => (
                                    el.url
                                      ? <img key={i} src={el.url} alt={el.name} />
                                      : <span key={i}>{el.emoji}</span>
                                  ))}
                                </span>
                              );
                            })()}
                            <span style={{ color: '#666', fontSize: '0.75rem' }}>
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        )}
                        <div style={{ marginTop: isCont ? 0 : '4px', fontSize: '1rem', lineHeight: '1.4', wordBreak: 'break-word', whiteSpace: 'pre-wrap', color: '#e4e4e7' }}>
                          {(() => {
                            const emoticonList = parseEmoticons(msg.content);
                            if (emoticonList) {
                              return <EmoticonMessage emojis={emoticonList} compact onImageLoad={stickToBottom} />;
                            }
                            if (msg.content.startsWith('$$SQUAD$$')) {
                              try {
                                const payload = JSON.parse(msg.content.substring(9));
                                return (
                                  <div style={{ marginTop: '5px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {payload.message && <div>{payload.message}</div>}
                                    {payload.nikkes && payload.nikkes.some(n => n !== null) && (
                                      <div style={{ display: 'flex', gap: '6px', backgroundColor: 'var(--surface-2)', padding: '8px', borderRadius: '8px', maxWidth: '400px', boxSizing: 'border-box' }}>
                                        {payload.nikkes.map((nid, i) => (
                                          <div key={i} style={{ flex: '1 1 0', minWidth: 0, aspectRatio: '1 / 1' }}>
                                            {nid
                                              ? <NikkeAvatar nikkeId={nid} size="100%" style={{ width: '100%', height: '100%' }} />
                                              : <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--surface-1)', borderRadius: '4px' }}></div>
                                            }
                                          </div>
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
                                  currentUserName={inGameName}
                                />
                              );
                            }
                          })()}
                          {msg.updated_at && <span style={{ fontSize: '0.7rem', color: isMe ? '#cce5ff' : 'var(--text-dim)', marginLeft: '6px' }}>(수정됨)</span>}
                        </div>
                        <MessageReactions
                          rows={reactionsByMessage[msg.id]}
                          currentUserId={user.id}
                          getName={(uid) => getMemberInfo(uid).in_game_name}
                          onToggle={canReact ? (emoji) => toggleReaction(msg.id, emoji) : undefined}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {loadingNewer && <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '10px 0', fontSize: '0.85rem' }}>최신 메시지 불러오는 중...</div>}
        </div>
        <div style={{ padding: '10px', borderTop: '1px solid var(--border-1)', flexShrink: 0, position: 'relative' }}>
          <ChatScrollControls
            atBottom={atBottom && !hasNewer}
            showNewBadge={showNewBadge || missedNew}
            onScrollToBottom={() => (hasNewer ? loadLatest({ scrollToBottom: true }) : scrollToBottom('smooth'))}
          />
          {(readOnly || !seasonName) ? (
            <div style={{ padding: '10px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
              {lockReason === 'locked' ? '🔒 보스전 기록이 잠긴 시즌입니다 — 새 메시지는 보낼 수 없습니다.' : lockReason === 'ended' ? '종료된 시즌의 지휘방입니다 — 새 메시지는 보낼 수 없습니다.' : seasonName ? '지난 시즌의 지휘방입니다 — 새 메시지는 보낼 수 없습니다.' : '시즌이 없어 지휘 채팅을 사용할 수 없습니다.'}
            </div>
          ) : (
            <>
            {mentionQuery !== null && (
              <MentionAutocomplete
                members={filteredMembers}
                activeIndex={mentionIndex}
                onPick={pickMention}
                onHover={setMentionIndex}
                profileImagesMap={profileImagesMap}
                leftOffset="10px"
              />
            )}
            {showEmojiPicker && (
              <EmojiPicker
                anchorRef={emojiBtnRef}
                onClose={() => setShowEmojiPicker(false)}
                onSend={(list) => { handleSendEmoticons(list); setShowEmojiPicker(false); }}
                style={{ position: 'absolute', right: '10px', bottom: '60px', zIndex: 50, width: '260px' }}
              />
            )}
            {(imageUploading || pendingImageUrl) && (
              <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'var(--surface-4)', padding: '8px', borderRadius: '4px', width: 'fit-content', maxWidth: '100%' }}>
                {imageUploading ? (
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>이미지 업로드 중…</span>
                ) : (
                  <>
                    <img src={pendingImageUrl} alt="첨부 미리보기" referrerPolicy="no-referrer" style={{ height: '48px', maxWidth: '100px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-1)' }} />
                    <button type="button" onClick={clearPending} title="첨부 제거" style={{ background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '0.85rem' }}>✕</button>
                  </>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder={pendingImageUrl ? '코멘트 입력 (선택)...' : '메시지 입력...'}
                  title="Enter 전송 / Shift+Enter 줄바꿈"
                  value={inputText}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  style={{ flex: 1, minWidth: 0, height: INPUT_BASE_HEIGHT, backgroundColor: 'var(--surface-0)', border: '1px solid var(--border-1)', color: 'white', padding: '10px', paddingRight: '40px', borderRadius: '4px', fontFamily: 'inherit', fontSize: '1rem', lineHeight: '1.4', resize: 'none', overflowY: 'hidden' }}
                />
                <button
                  type="button"
                  ref={emojiBtnRef}
                  onClick={() => setShowEmojiPicker(v => !v)}
                  title="이모티콘"
                  style={{ position: 'absolute', right: '6px', bottom: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '2px' }}
                >
                  😀
                </button>
              </div>
              <button
                onClick={() => handleSendMessage()}
                style={{ flexShrink: 0, backgroundColor: 'var(--accent-blurple)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', height: INPUT_BASE_HEIGHT, padding: '0 16px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' }}
              >
                전송
              </button>
              <button
                onClick={() => setIsSquadShareModalOpen(true)}
                style={{ flexShrink: 0, backgroundColor: 'var(--border-1)', color: 'var(--text-strong)', border: '1px solid var(--border-3)', borderRadius: '4px', height: INPUT_BASE_HEIGHT, padding: '0 15px', cursor: 'pointer', fontWeight: 'bold' }}
                title="스쿼드 공유"
              >
                +
              </button>
            </div>
            </>
          )}
        </div>
      </div>

      <MessageEditModal
        isOpen={!!editingMsgId}
        value={editText}
        onChange={setEditText}
        onSubmit={handleEditSubmit}
        onClose={() => { setEditingMsgId(null); setEditText(''); }}
      />

      <SquadShareModal
        isOpen={isSquadShareModalOpen}
        onClose={() => setIsSquadShareModalOpen(false)}
        onShare={handleSquadShare}
      />

      {/* Context Menu for Edit / Delete */}
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canEdit={contextMenu.msg.user_id === user.id}
          canDelete={contextMenu.msg.user_id === user.id || isAdmin}
          onEdit={() => { startEditing(contextMenu.msg); setContextMenu(null); }}
          onDelete={() => { handleDeleteMessage(contextMenu.msg.id); setContextMenu(null); }}
          onReact={canReact ? (emoji) => { toggleReaction(contextMenu.msg.id, emoji); setContextMenu(null); } : undefined}
          myReactions={myReactionsOf(contextMenu.msg.id)}
        />
      )}

      <ImageLightbox src={selectedImage} onClose={() => setSelectedImage(null)} />
    </div>
  );
}
