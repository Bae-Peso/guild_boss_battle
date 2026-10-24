import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { onGuildChanges } from '../../lib/realtime';
import { useAuth } from '../../contexts/AuthContext';
import ReportModal from '../../components/ReportModal';
import NoticeFormModal from './NoticeFormModal';
import RequestsTab from './settings/RequestsTab';
import NicknameRequestsTab from './settings/NicknameRequestsTab';
import BannedMembersTab from './settings/BannedMembersTab';
import NoticesTab from './settings/NoticesTab';
import MembersTab from './settings/MembersTab';
import ChannelsTab from './settings/ChannelsTab';
import BossBattleRecordsTab from './settings/BossBattleRecordsTab';
import JoinPassphraseTab from './settings/JoinPassphraseTab';
import { logAudit } from '../../lib/auditLogger';
import { isManager } from '../../lib/roles';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useDemo } from '../../demo/DemoContext';
import './settings/settings.css';

// 상단 탭 정의. 버튼마다 인라인 치수를 붙이면 탭끼리 높이가 어긋나므로
// 라벨/권한만 여기서 정하고 크기는 .settings-tab-bar 규칙 하나로 통일한다.
const SETTINGS_TABS = [
  { id: 'requests', label: '가입 대기자 관리', badge: 'requests' },
  { id: 'nickname_requests', label: '닉네임 변경 대기자', badge: 'nicknameRequests' },
  { id: 'members', label: '멤버 목록 관리' },
  { id: 'banned', label: '차단 멤버 관리' },
  { id: 'channels', label: '채널 추가/삭제', managerOnly: true },
  { id: 'bossBattle', label: '보스전 기록 관리', managerOnly: true },
  { id: 'notices', label: '공지 관리', managerOnly: true },
  { id: 'passphrase', label: '가입 암구호', managerOnly: true },
];

export default function GuildSettings({ guild, role, user, onClose }) {
  const demo = useDemo();
  const [activeTab, setActiveTab] = useState('requests');

  useEscapeKey(true, onClose);

  // States
  const [requests, setRequests] = useState([]);
  const [nicknameRequests, setNicknameRequests] = useState([]);

  const [reportModalData, setReportModalData] = useState({ isOpen: false, targetUserId: null, targetUsername: '' });
  const [members, setMembers] = useState([]);
  // 멤버 관리 커스텀 비고 컬럼(정의) + 멤버별 값 (관리자 전용)
  const [noteFields, setNoteFields] = useState([]);
  const [memberNotes, setMemberNotes] = useState({}); // member_id -> { field_id: value }
  const canManageNotes = role === 'admin' || role === 'sub_admin';
  const [bannedMembers, setBannedMembers] = useState([]);
  const [guildChannels, setGuildChannels] = useState([]);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState('general');
  const [bossBattleSeasons, setBossBattleSeasons] = useState([]);
  const [guildSeasonNames, setGuildSeasonNames] = useState(new Set());
  const [lockedSeasons, setLockedSeasons] = useState(new Set());
  
  const [notices, setNotices] = useState([]);
  const [newNoticeContent, setNewNoticeContent] = useState('');
  const [newNoticeExpiresAt, setNewNoticeExpiresAt] = useState('');
  const [isNoticeModalOpen, setIsNoticeModalOpen] = useState(false);

  const [passphrase, setPassphrase] = useState('');        // 현재 저장된 암구호
  const [newPassphrase, setNewPassphrase] = useState('');  // 입력 중인 새 암구호

  const [loading, setLoading] = useState(true);

  const fetchNicknameRequests = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('union_nickname_requests')
      .select('*, users(username, uid)')
      .eq('union_id', guild.id)
      .eq('status', 'pending');
      
    if (error) console.error("fetchNicknameRequests error:", error);
    if (data) setNicknameRequests(data);
    setLoading(false);
  };
  
  const fetchRequests = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('union_members')
      .select('*, users(username, uid)')
      .eq('union_id', guild.id)
      .eq('join_status', 'pending');
    
    if (error) console.error("fetchRequests error:", error);
    if (data) setRequests(data);
    setLoading(false);
  };

  const fetchMembers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('union_members')
      .select('*, users(username, uid, last_login_at)')
      .eq('union_id', guild.id)
      .eq('join_status', 'approved')
      .order('role', { ascending: true }); 
    
    if (error) {
      console.error("fetchMembers error:", error);
      alert("멤버 목록 조회 오류: " + error.message);
    }
    
    if (data) {
      // 기본 정렬: 직책(길드장→부→원) → 가입순(created_at 오름차순)
      const roleOrder = { admin: 1, sub_admin: 2, member: 3 };
      data.sort((a, b) => {
        const r = roleOrder[a.role] - roleOrder[b.role];
        if (r !== 0) return r;
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      });
      setMembers(data);
      fetchNoteData(data);
    }
    setLoading(false);
  };

  // 커스텀 비고 컬럼 정의 + 값 조회 (관리자 전용; RLS로도 이중 보호)
  const fetchNoteData = async (memberList) => {
    if (!canManageNotes || demo.isDemo) return;
    try {
      const memberIds = (memberList || []).map(m => m.id);
      const [fieldsRes, notesRes] = await Promise.all([
        supabase.from('union_member_note_fields').select('*').eq('union_id', guild.id).order('sort_order', { ascending: true }),
        memberIds.length
          ? supabase.from('union_member_notes').select('member_id, notes').in('member_id', memberIds)
          : Promise.resolve({ data: [] }),
      ]);
      setNoteFields(fieldsRes.data || []);
      const nmap = {};
      (notesRes.data || []).forEach(n => { nmap[n.member_id] = n.notes || {}; });
      setMemberNotes(nmap);
    } catch (err) {
      console.error('비고 데이터 조회 실패:', err);
    }
  };

  // 가입 일시 수정 (정렬 정확도용)
  const handleUpdateJoinDate = async (member, isoString) => {
    if (!isoString) return;
    const { error } = await supabase.from('union_members').update({ created_at: isoString }).eq('id', member.id);
    if (error) { alert('가입 일시 수정 실패: ' + error.message); return; }
    setMembers(prev => prev.map(m => (m.id === member.id ? { ...m, created_at: isoString } : m)));
  };

  // 멤버별 비고 값 저장
  const handleSaveMemberNote = async (memberId, fieldId, value) => {
    const current = memberNotes[memberId] || {};
    if ((current[fieldId] || '') === (value || '')) return;
    const nextNotes = { ...current, [fieldId]: value };
    const { error } = await supabase.from('union_member_notes')
      .upsert({ member_id: memberId, notes: nextNotes, updated_at: new Date().toISOString() }, { onConflict: 'member_id' });
    if (error) { alert('비고 저장 실패: ' + error.message); return; }
    setMemberNotes(prev => ({ ...prev, [memberId]: nextNotes }));
  };

  // 비고 컬럼 추가
  const handleAddNoteField = async (label) => {
    const trimmed = (label || '').trim();
    if (!trimmed) return;
    const { data, error } = await supabase.from('union_member_note_fields')
      .insert({ union_id: guild.id, label: trimmed, sort_order: noteFields.length })
      .select().single();
    if (error) { alert('비고 컬럼 추가 실패: ' + error.message); return; }
    setNoteFields(prev => [...prev, data]);
  };

  // 비고 컬럼 삭제
  const handleDeleteNoteField = async (fieldId) => {
    if (!window.confirm('이 비고 컬럼을 삭제할까요? (입력된 값은 표시되지 않습니다)')) return;
    const { error } = await supabase.from('union_member_note_fields').delete().eq('id', fieldId);
    if (error) { alert('비고 컬럼 삭제 실패: ' + error.message); return; }
    setNoteFields(prev => prev.filter(f => f.id !== fieldId));
  };

  const fetchBannedMembers = async () => {
    const { data, error } = await supabase
      .from('union_members')
      .select('*, users(username, uid)')
      .eq('union_id', guild.id)
      .eq('join_status', 'banned')
      .order('in_game_name', { ascending: true });

    if (error) console.error("fetchBannedMembers error:", error);
    if (data) setBannedMembers(data);
  };

  const fetchChannels = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .eq('union_id', guild.id)
      .is('deleted_at', null);
      
    if (data) {
      data.sort((a,b) => {
        if (a.is_fixed && !b.is_fixed) return -1;
        if (!a.is_fixed && b.is_fixed) return 1;
        return a.name.localeCompare(b.name);
      });
      setGuildChannels(data);
    }
    setLoading(false);
  };

  const fetchNotices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('union_notices')
      .select('*')
      .eq('union_id', guild.id)
      .order('created_at', { ascending: false });
    
    if (data) {
      setNotices(data);
    }
    setLoading(false);
  };

  const handleCreateNotice = async (e) => {
    e.preventDefault();
    if (!newNoticeContent.trim()) return;
    if (!newNoticeExpiresAt) {
      alert('공지를 자동으로 내릴 일시를 입력해주세요.');
      return;
    }
    const expiresIso = new Date(newNoticeExpiresAt).toISOString();
    if (new Date(expiresIso) <= new Date()) {
      alert('공지를 내릴 일시는 현재 시각보다 이후여야 합니다.');
      return;
    }
    const { error } = await supabase.from('union_notices').insert({
      union_id: guild.id,
      content: newNoticeContent.trim(),
      created_by: user.id,
      expires_at: expiresIso,
    });
    if (error) {
      alert('공지 작성 중 오류가 발생했습니다: ' + error.message);
      return;
    }
    setNewNoticeContent('');
    setNewNoticeExpiresAt('');
    setIsNoticeModalOpen(false);
    fetchNotices();
  };

  const handleCloseNotice = async (noticeId) => {
    if (!window.confirm('이 공지를 내리시겠습니까?\n내린 공지는 이후 어떤 유저에게도 표시되지 않습니다.')) return;
    const { error } = await supabase
      .from('union_notices')
      .update({ closed_at: new Date().toISOString() })
      .eq('id', noticeId);
    if (error) {
      alert('공지 내리기 중 오류가 발생했습니다: ' + error.message);
      return;
    }
    fetchNotices();
  };

  const fetchPassphrase = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('union_join_passphrases')
      .select('passphrase')
      .eq('union_id', guild.id)
      .maybeSingle();
    if (error) console.error('fetchPassphrase error:', error);
    setPassphrase(data?.passphrase || '');
    setNewPassphrase('');
    setLoading(false);
  };

  const handleSavePassphrase = async (e) => {
    e.preventDefault();
    const trimmed = newPassphrase.trim();
    if (!trimmed) {
      alert('암구호를 입력해주세요. (암구호를 없애려면 \'암구호 해제\'를 사용하세요.)');
      return;
    }
    const { error } = await supabase
      .from('union_join_passphrases')
      .upsert({ union_id: guild.id, passphrase: trimmed, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'union_id' });
    if (error) {
      alert('암구호 저장 중 오류가 발생했습니다: ' + error.message);
      return;
    }
    await logAudit(guild.id, user.id, 'passphrase_update', '가입 암구호가 설정/변경됨.');
    alert('가입 암구호가 저장되었습니다. 이제 신규 가입 신청 시 이 암구호가 필요합니다.');
    fetchPassphrase();
  };

  const handleClearPassphrase = async () => {
    if (!window.confirm('가입 암구호를 해제하시겠습니까?\n해제하면 누구나 암구호 없이 가입 신청할 수 있게 됩니다.')) return;
    const { error } = await supabase
      .from('union_join_passphrases')
      .delete()
      .eq('union_id', guild.id);
    if (error) {
      alert('암구호 해제 중 오류가 발생했습니다: ' + error.message);
      return;
    }
    await logAudit(guild.id, user.id, 'passphrase_update', '가입 암구호가 해제됨.');
    alert('가입 암구호가 해제되었습니다.');
    fetchPassphrase();
  };

  useEffect(() => {
    let isMounted = true;

    if (demo.isDemo) { setLoading(false); return () => { isMounted = false; }; }

    // Always fetch these to keep red dots accurate
    fetchRequests();
    fetchNicknameRequests();
    
    // Fetch others based on active tab
    if (activeTab === 'members' && members.length === 0) fetchMembers();
    if (activeTab === 'channels' && guildChannels.length === 0) fetchChannels();
    if (activeTab === 'bossBattle' && bossBattleSeasons.length === 0) fetchBossBattleSeasons();

    const channel = supabase.channel(`guild_settings_${guild.id}`);
    onGuildChanges(channel, 'union_members', guild.id, payload => {
      if (!isMounted) return;
      const rec = payload.new || payload.old;
      if (rec && rec.union_id && rec.union_id !== guild.id) return;
      fetchRequests();
      fetchMembers(); // Refresh members as well
      fetchBannedMembers(); // Keep banned list in sync (ban/unban)
    });
    onGuildChanges(channel, 'union_nickname_requests', guild.id, payload => {
      if (!isMounted) return;
      const rec = payload.new || payload.old;
      if (rec && rec.union_id && rec.union_id !== guild.id) return;
      fetchNicknameRequests();
    });
    channel.subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [guild.id]);

  useEffect(() => {
    if (demo.isDemo) return;
    // Only fetch tab-specific data when tab changes and data is empty
    if (activeTab === 'members' && members.length === 0) fetchMembers();
    else if (activeTab === 'banned') {
      fetchBannedMembers();
    } else if (activeTab === 'channels') {
      fetchChannels();
    } else if (activeTab === 'bossBattle') {
      fetchBossBattleSeasons();
    } else if (activeTab === 'notices') {
      fetchNotices();
    } else if (activeTab === 'passphrase') {
      fetchPassphrase();
    }
  }, [activeTab, guild.id]);

  const handleNicknameRequest = async (reqId, status, userId, newNickname) => {
    const { error } = await supabase
      .from('union_nickname_requests')
      .update({ status, resolved_at: new Date() })
      .eq('id', reqId);
      
    if (!error) {
      if (status === 'approved') {
        await supabase
          .from('union_members')
          .update({ in_game_name: newNickname })
          .eq('union_id', guild.id)
          .eq('user_id', userId);
      }
      alert(`닉네임 변경 요청이 ${status === 'approved' ? '승인' : '거절'}되었습니다.`);
      fetchNicknameRequests();
    } else {
      alert(`처리 중 오류가 발생했습니다: ${error.message}`);
    }
  };

  const handleRequest = async (id, status) => {
    const { data: req } = await supabase.from('union_members').select('user_id, pending_uid').eq('id', id).maybeSingle();

    // 승인 시: 신청자의 인게임 UID가 이미 다른 계정에서 사용 중이면 승인 불가.
    // (그대로 진행하면 users.uid UNIQUE 제약 때문에 승인 트리거가 실패하고, 신청은 계속 대기 상태로 남아
    //  관리자가 승인을 눌러도 아무 반응이 없는 '무한 승인 대기' 현상이 발생함)
    if (status === 'approved' && req?.pending_uid) {
      const { data: uidTaken } = await supabase.rpc('is_uid_taken', { p_uid: req.pending_uid, p_exclude_user: req.user_id });
      if (uidTaken) {
        alert(`이 신청자의 인게임 UID(${req.pending_uid})는 이미 다른 계정이 사용 중이라 승인할 수 없습니다.\n신청자에게 올바른 UID로 다시 신청하도록 안내해주세요.`);
        return;
      }
    }

    const { error } = await supabase
      .from('union_members')
      .update({ join_status: status })
      .eq('id', id);

    if (error) {
      alert(`처리 중 오류가 발생했습니다: ${error.message}`);
      return;
    }
    if (status === 'approved') {
      await logAudit(guild.id, user.id, 'member_join', `유저 ID [${req?.user_id}] 가입 승인됨.`);
    }
    alert(`가입이 ${status === 'approved' ? '승인' : '거절'}되었습니다.`);
    fetchRequests();
  };

  const handleRoleChange = async (member, newRole) => {
    if (role !== 'admin') {
      alert('길드장만 직책을 변경할 수 있습니다.');
      return;
    }
    
    if (newRole === 'transfer_admin') {
      if (window.confirm(`정말 [${member.in_game_name}] 님에게 길드장을 위임하시겠습니까?\n위임 즉시 본인은 일반 멤버로 강등되며 모든 설정 권한을 잃습니다.`)) {
        // 1. Update unions owner_id
        await supabase.from('unions').update({ owner_id: member.user_id }).eq('id', guild.id);
        // 2. Make them admin
        await supabase.from('union_members').update({ role: 'admin' }).eq('id', member.id);
        // 3. Make self member
        await supabase.from('union_members').update({ role: 'member' }).eq('union_id', guild.id).eq('user_id', user.id);
        
        await logAudit(guild.id, user.id, 'role_change', `[${member.in_game_name}] 멤버 길드장으로 위임됨.`);
        alert('길드장 권한이 위임되었습니다. 본인은 일반 멤버로 강등됩니다.');
        fetchMembers();
        window.location.reload();
      }
      return;
    }

    const { error } = await supabase
      .from('union_members')
      .update({ role: newRole })
      .eq('id', member.id);
    if (!error) {
      await logAudit(guild.id, user.id, 'role_change', `[${member.in_game_name}] 멤버 직책이 [${newRole}]로 변경됨.`);
      alert('직책이 변경되었습니다.');
      fetchMembers();
    }
  };

  const handleKick = async (member) => {
    if (window.confirm(`정말 [${member.in_game_name}] 멤버를 길드에서 강제 퇴장(추방)시키겠습니까? (추방된 유저는 재가입 신청이 가능합니다)`)) {
      const { error } = await supabase
        .from('union_members')
        .delete()
        .eq('id', member.id);
      if (!error) {
        await logAudit(guild.id, user.id, 'member_kick', `[${member.in_game_name}] 멤버 강제 추방됨.`);
        alert('멤버가 추방되었습니다.');
        fetchMembers();
      }
    }
  };

  const handleBanMember = async (memberId, memberName) => {
    if (window.confirm(`정말 [${memberName}] 멤버를 영구 차단하시겠습니까?\n차단된 유저는 다시 가입 신청을 할 수 없습니다.`)) {
      const { error } = await supabase
        .from('union_members')
        .update({ join_status: 'banned', role: 'member' })
        .eq('id', memberId);
      if (!error) {
        await logAudit(guild.id, user.id, 'member_ban', `[${memberName}] 멤버 영구 차단됨.`);
        alert('해당 멤버가 길드에서 영구 차단되었습니다.');
        fetchMembers();
        fetchBannedMembers();
      }
    }
  };

  const handleUnbanMember = async (memberId, memberName) => {
    if (window.confirm(`[${memberName}] 님의 차단을 해제하시겠습니까?\n해제 시 해당 유저는 이 길드에 다시 가입 신청을 할 수 있게 됩니다.`)) {
      // 차단 기록을 삭제하여 재가입을 허용 (UNIQUE 제약 해소 + 깨끗한 재신청)
      const { error } = await supabase
        .from('union_members')
        .delete()
        .eq('id', memberId);
      if (!error) {
        await logAudit(guild.id, user.id, 'member_unban', `[${memberName}] 멤버 차단 해제됨.`);
        alert('차단이 해제되었습니다.');
        fetchBannedMembers();
      } else {
        alert('차단 해제 중 오류가 발생했습니다: ' + error.message);
      }
    }
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    
    const { error } = await supabase.from('channels').insert({
      union_id: guild.id,
      name: newChannelName.trim(),
      type: newChannelType
    });
    
    if (error) alert("채널 생성 실패: " + error.message);
    else {
      setNewChannelName('');
      setNewChannelType('general');
      fetchChannels();
    }
  };

  const fetchBossBattleSeasons = async () => {
    setLoading(true);
    const { data: seasons, error: sErr } = await supabase.from('raid_seasons').select('*').order('start_date', { ascending: false });
    if (sErr) console.error(sErr);
    
    const { data: statusData, error: stErr } = await supabase
      .from('union_raid_status')
      .select('global_raid_bosses!inner(season_name)')
      .eq('union_id', guild.id);
      
    if (stErr) console.error(stErr);
    
    const hasSeasons = new Set(statusData?.map(d => d.global_raid_bosses.season_name) || []);
    setBossBattleSeasons(seasons || []);
    setGuildSeasonNames(hasSeasons);
    
    // Fetch lock status
    const { data: lockData } = await supabase
      .from('union_raid_season_settings')
      .select('season_name, is_locked')
      .eq('union_id', guild.id)
      .eq('is_locked', true);
      
    setLockedSeasons(new Set(lockData?.map(d => d.season_name) || []));
    setLoading(false);
  };

  const handleToggleLock = async (seasonName, isCurrentlyLocked) => {
    try {
      const { error } = await supabase
        .from('union_raid_season_settings')
        .upsert({ union_id: guild.id, season_name: seasonName, is_locked: !isCurrentlyLocked }, { onConflict: 'union_id,season_name' });
      if (error) throw error;
      await fetchBossBattleSeasons();
    } catch (err) {
      alert("잠금 설정 변경 실패: " + err.message);
    }
  };

  const handleInitBossBattleData = async (seasonName) => {
    if (!window.confirm(`정말 [${seasonName}] 시즌의 지휘 데이터를 생성하시겠습니까?`)) return;
    try {
      setLoading(true);
      const { error } = await supabase.rpc('init_union_raid_status', {
        p_union_id: guild.id,
        p_season_name: seasonName
      });
      if (error) throw error;
      await fetchBossBattleSeasons();
      window.dispatchEvent(new Event('bossBattleDataChanged'));
      alert(`[${seasonName}] 시즌 지휘 데이터 생성이 완료되었습니다.`);
    } catch (e) {
      console.error(e);
      alert('오류 발생');
      setLoading(false);
    }
  };

  const handleDeleteBossBattleData = async (seasonName) => {
    if (!window.confirm(`정말 [${seasonName}] 시즌의 모든 지휘 데이터(기록 포함)를 삭제하시겠습니까?\n이 작업은 복구할 수 없습니다.`)) return;
    try {
      setLoading(true);
      const { data: bosses } = await supabase.from('global_raid_bosses').select('id').eq('season_name', seasonName);
      if (bosses && bosses.length > 0) {
        const bossIds = bosses.map(b => b.id);
        // .select()로 실제 삭제된 행을 받아 RLS 등으로 0행 삭제된 '거짓 성공'을 방지
        const { data: deleted, error } = await supabase.from('union_raid_status').delete().eq('union_id', guild.id).in('global_boss_id', bossIds).select('id');
        if (error) throw error;
        if (!deleted || deleted.length === 0) {
          throw new Error('삭제된 데이터가 없습니다. 권한(RLS) 설정을 확인해주세요.');
        }
      }
      await fetchBossBattleSeasons();
      window.dispatchEvent(new Event('bossBattleDataChanged'));
      alert(`[${seasonName}] 시즌 데이터가 영구적으로 삭제되었습니다.`);
    } catch (err) {
      console.error(err);
      alert('데이터 삭제 실패: ' + err.message);
      setLoading(false);
    }
  };

  const handleDeleteChannel = async (channelId) => {
    if (!window.confirm("정말 이 채널을 삭제하시겠습니까?\n채널 내의 모든 메시지가 더 이상 보이지 않습니다.")) return;
    
    const { error } = await supabase.from('channels').update({ deleted_at: new Date() }).eq('id', channelId);
    if (error) alert("삭제 실패: " + error.message);
    else fetchChannels();
  };

  if (role !== 'admin' && role !== 'sub_admin') {
    return null; // Don't render modal for non-admins
  }

  // 체험 모드: 길드 설정(멤버/가입승인/채널/시즌 관리 등)은 실제 데이터 변경이 필요해 체험 대상에서 제외
  if (demo.isDemo) {
    return (
      <div
        className="guild-settings-overlay"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div style={{ backgroundColor: 'var(--surface-1)', width: '100%', maxWidth: '440px', borderRadius: '12px', padding: '2rem', textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚙️</div>
          <h2 style={{ color: 'var(--text-strong)', margin: '0 0 0.75rem 0' }}>길드 설정</h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 1.5rem 0' }}>
            멤버 관리·가입 승인·채널/시즌 설정 등은 실제 길드 데이터를 변경하는 기능이라
            체험 모드에서는 제공되지 않습니다.<br />길드에 가입하면 이용할 수 있어요!
          </p>
          <button
            onClick={onClose}
            className="primary-btn"
            style={{ padding: '10px 24px' }}
          >
            확인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="guild-settings-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="guild-settings-modal">
        <div className="guild-settings-header">
          <h2>길드 설정</h2>
          <button type="button" className="guild-settings-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <div className="guild-settings-body">
          <div className="settings-tab-bar">
            {SETTINGS_TABS.map(tab => {
              if (tab.managerOnly && !isManager(role)) return null;
              const pending = tab.badge === 'requests' ? requests.length
                : tab.badge === 'nicknameRequests' ? nicknameRequests.length
                  : 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTab === tab.id ? 'primary-btn' : 'secondary-btn'}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  {pending > 0 && <span className="settings-tab-dot" />}
                </button>
              );
            })}
          </div>

          <div className="guild-settings-scroll">
          {activeTab === 'requests' && (
            <RequestsTab loading={loading} requests={requests} onRequest={handleRequest} />
          )}

          {activeTab === 'nickname_requests' && (
            <NicknameRequestsTab loading={loading} nicknameRequests={nicknameRequests} onResolve={handleNicknameRequest} />
          )}

          {activeTab === 'members' && (
            <MembersTab
              loading={loading}
              members={members}
              role={role}
              currentUserId={user.id}
              onRoleChange={handleRoleChange}
              onKick={handleKick}
              onBan={handleBanMember}
              onReport={(targetUserId, targetUsername) => setReportModalData({ isOpen: true, targetUserId, targetUsername })}
              canManageNotes={canManageNotes}
              noteFields={noteFields}
              memberNotes={memberNotes}
              onUpdateJoinDate={handleUpdateJoinDate}
              onSaveNote={handleSaveMemberNote}
              onAddNoteField={handleAddNoteField}
              onDeleteNoteField={handleDeleteNoteField}
            />
          )}

          {activeTab === 'banned' && (
            <BannedMembersTab bannedMembers={bannedMembers} onUnban={handleUnbanMember} />
          )}

          {activeTab === 'channels' && (
            <ChannelsTab
              loading={loading}
              channels={guildChannels}
              name={newChannelName}
              onNameChange={e => setNewChannelName(e.target.value)}
              type={newChannelType}
              onTypeChange={e => setNewChannelType(e.target.value)}
              onCreate={handleCreateChannel}
              onDelete={handleDeleteChannel}
            />
          )}

          {activeTab === 'bossBattle' && (
            <BossBattleRecordsTab
              loading={loading}
              bossBattleSeasons={bossBattleSeasons}
              guildSeasonNames={guildSeasonNames}
              lockedSeasons={lockedSeasons}
              onInit={handleInitBossBattleData}
              onDelete={handleDeleteBossBattleData}
              onToggleLock={handleToggleLock}
            />
          )}

          {activeTab === 'notices' && (
            <NoticesTab
              loading={loading}
              notices={notices}
              onNewNotice={() => {
                const d = new Date();
                d.setDate(d.getDate() + 7);
                const pad = (n) => String(n).padStart(2, '0');
                setNewNoticeExpiresAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                setNewNoticeContent('');
                setIsNoticeModalOpen(true);
              }}
              onCloseNotice={handleCloseNotice}
            />
          )}

          {activeTab === 'passphrase' && (
            <JoinPassphraseTab
              loading={loading}
              currentPassphrase={passphrase}
              value={newPassphrase}
              onChange={e => setNewPassphrase(e.target.value)}
              onSave={handleSavePassphrase}
              onClear={handleClearPassphrase}
            />
          )}

          </div>
        </div>
      </div>
      
      <ReportModal
        isOpen={reportModalData.isOpen}
        onClose={() => setReportModalData({ isOpen: false, targetUserId: null, targetUsername: '' })}
        reporterId={user?.id}
        targetUserId={reportModalData.targetUserId}
        targetUsername={reportModalData.targetUsername}
      />

      <NoticeFormModal
        isOpen={isNoticeModalOpen}
        content={newNoticeContent}
        onContentChange={e => setNewNoticeContent(e.target.value)}
        expiresAt={newNoticeExpiresAt}
        onExpiresAtChange={e => setNewNoticeExpiresAt(e.target.value)}
        onSubmit={handleCreateNotice}
        onCancel={() => setIsNoticeModalOpen(false)}
      />
    </div>
  );
}
