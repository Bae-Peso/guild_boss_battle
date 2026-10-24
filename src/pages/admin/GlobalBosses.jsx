import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import BossImage from '../../components/BossImage';

export default function GlobalBosses() {
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSeasons, setExpandedSeasons] = useState({});

  // Form states
  const [seasonName, setSeasonName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // 5 Bosses (3넴, 5넴은 타일런트급이 디폴트)
  const [bossesForm, setBossesForm] = useState(
    Array.from({ length: 5 }, (_, i) => ({
      boss_number: i + 1,
      name: '',
      element: '작열',
      boss_grade: i === 2 || i === 4 ? '타일런트급' : '로드급',
      image_url: '',
      image_alt: ''
    }))
  );

  // 기존 시즌 수정 상태
  const [editingSeason, setEditingSeason] = useState(null); // 수정 중인 시즌명
  const [editForm, setEditForm] = useState(null);           // { start_date, end_date, bosses: [...] }

  // HP Settings (1자리까지 정확히 입력하도록 디폴트값 세팅)
  const [hpSettingsForm, setHpSettingsForm] = useState([
    { stage_level: 1, lord_hp: '998500000', tyrant_hp: '1508400000' },
    { stage_level: 2, lord_hp: '1498000000', tyrant_hp: '2262000000' },
    { stage_level: 3, lord_hp: '2924500000', tyrant_hp: '3492300000' }
  ]);

  const fetchSeasons = async () => {
    setLoading(true);
    const { data: seasonsData } = await supabase.from('raid_seasons').select('*').order('created_at', { ascending: false });
    const { data: bossesData } = await supabase.from('global_raid_bosses').select('*').order('boss_number', { ascending: true });
    const { data: hpData } = await supabase.from('raid_season_hp_settings').select('*').order('stage_level', { ascending: true });

    if (seasonsData && bossesData && hpData) {
      let formattedSeasons = seasonsData.map(s => ({
        ...s,
        bosses: bossesData.filter(b => b.season_name === s.name),
        hp: hpData.filter(h => h.season_name === s.name)
      }));
      formattedSeasons.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
      setSeasons(formattedSeasons);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSeasons();
  }, []);

  const handleBossChange = (index, field, value) => {
    const newBosses = [...bossesForm];
    newBosses[index][field] = value;
    setBossesForm(newBosses);
  };

  const handleHpChange = (index, field, value) => {
    const newHp = [...hpSettingsForm];
    newHp[index][field] = value;
    setHpSettingsForm(newHp);
  };

  const addHpStage = () => {
    setHpSettingsForm([...hpSettingsForm, { stage_level: hpSettingsForm.length + 1, lord_hp: '', tyrant_hp: '' }]);
  };

  const removeHpStage = (indexToRemove) => {
    if (hpSettingsForm.length <= 1) {
      alert("최소 1단계는 존재해야 합니다.");
      return;
    }
    // 삭제 후 stage_level 재정렬
    const newHp = hpSettingsForm
      .filter((_, idx) => idx !== indexToRemove)
      .map((h, i) => ({ ...h, stage_level: i + 1 }));
    setHpSettingsForm(newHp);
  };

  const handleAddSeason = async (e) => {
    e.preventDefault();
    
    if (!seasonName.trim() || !startDate || !endDate) {
      alert("모든 시즌 정보를 입력해주세요.");
      return;
    }

    // 1. Insert BossBattle Season
    const { error: seasonError } = await supabase.from('raid_seasons').insert({
      name: seasonName,
      start_date: startDate,
      end_date: endDate
    });

    if (seasonError) {
      console.error(seasonError);
      alert('시즌 등록 중 오류가 발생했습니다. (이미 존재하는 시즌 명일 수 있습니다.)');
      return;
    }

    const bossesToInsert = bossesForm.map(b => ({
      season_name: seasonName,
      boss_number: b.boss_number,
      name: b.name,
      element: b.element,
      boss_grade: b.boss_grade,
      image_url: b.image_url?.trim() || null,
      image_alt: b.image_alt?.trim() || null
    }));
    
    const hpToInsert = hpSettingsForm.map(h => ({
      season_name: seasonName,
      stage_level: h.stage_level,
      lord_hp: h.lord_hp.toString(),
      tyrant_hp: h.tyrant_hp.toString()
    }));

    const { error: bossError } = await supabase.from('global_raid_bosses').insert(bossesToInsert);
    const { error: hpError } = await supabase.from('raid_season_hp_settings').insert(hpToInsert);

    if (bossError || hpError) {
      console.error("Insert Error", bossError, hpError);
      alert('보스 정보 등록 중 오류가 발생했습니다.');
    } else {
      alert(`[${seasonName}] 시즌이 성공적으로 일괄 등록되었습니다!`);
      fetchSeasons();
      setSeasonName('');
      setStartDate('');
      setEndDate('');
    }
  };

  const handleDeleteSeason = async (seasonName) => {
    if (window.confirm(`정말 [${seasonName}] 시즌 전체 데이터(보스 5개 및 체력 표)를 완전히 삭제하시겠습니까?`)) {
      await supabase.from('raid_seasons').delete().eq('name', seasonName);
      fetchSeasons();
    }
  };

  // ----- 기존 시즌 수정 -----
  const startEditSeason = (season) => {
    setEditingSeason(season.name);
    setEditForm({
      start_date: season.start_date || '',
      end_date: season.end_date || '',
      bosses: [...season.bosses]
        .sort((a, b) => a.boss_number - b.boss_number)
        .map(b => ({ id: b.id, boss_number: b.boss_number, name: b.name, element: b.element, boss_grade: b.boss_grade, image_url: b.image_url || '', image_alt: b.image_alt || '' })),
    });
  };

  const cancelEditSeason = () => {
    setEditingSeason(null);
    setEditForm(null);
  };

  const handleEditBossChange = (index, field, value) => {
    setEditForm(prev => {
      const bosses = [...prev.bosses];
      bosses[index] = { ...bosses[index], [field]: value };
      return { ...prev, bosses };
    });
  };

  const handleSaveEditSeason = async () => {
    if (!editForm) return;
    try {
      // 시즌 기간 수정 (시즌명은 여러 테이블 FK 키라 변경하지 않음)
      const { error: sErr } = await supabase.from('raid_seasons')
        .update({ start_date: editForm.start_date, end_date: editForm.end_date })
        .eq('name', editingSeason);
      if (sErr) throw sErr;

      // 보스별 수정
      for (const b of editForm.bosses) {
        const { error: bErr } = await supabase.from('global_raid_bosses').update({
          name: b.name,
          element: b.element,
          boss_grade: b.boss_grade,
          image_url: b.image_url?.trim() || null,
          image_alt: b.image_alt?.trim() || null,
        }).eq('id', b.id);
        if (bErr) throw bErr;
      }
      alert('시즌 정보가 수정되었습니다.');
      cancelEditSeason();
      fetchSeasons();
    } catch (err) {
      console.error('시즌 수정 실패:', err);
      alert('시즌 수정 중 오류가 발생했습니다: ' + (err.message || ''));
    }
  };

  return (
    <div>
      <h2>글로벌 보스전 보스 (시즌 전체 세팅)</h2>
      <p>실제 니케 시스템과 동일하게 1~5넴 보스 정보와 단계별 체력 표를 시즌 단위로 구성합니다.</p>
      
      <div className="lobby-card mt-4">
        <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-2)', paddingBottom: '0.5rem' }}>신규 시즌 통째로 등록 폼</h3>
        <form onSubmit={handleAddSeason}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }} className="mb-4">
            <div className="form-group">
              <label>시즌 명</label>
              <input type="text" value={seasonName} onChange={e => setSeasonName(e.target.value)} placeholder="예: 길드 보스전 시즌 1" required />
            </div>
            <div className="form-group">
              <label>시작일</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>종료일</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
            </div>
          </div>

          <h4 className="mt-4 mb-2" style={{ color: 'var(--primary-color)' }}>보스 세팅 (1넴 ~ 5넴)</h4>
          <table className="admin-table mb-4">
            <thead>
              <tr>
                <th style={{ width: '8%' }}>출현 자리</th>
                <th style={{ width: '22%' }}>보스 이름</th>
                <th style={{ width: '12%' }}>약점 속성</th>
                <th style={{ width: '13%' }}>보스 등급</th>
                <th style={{ width: '30%' }}>보스 이미지 URL</th>
                <th style={{ width: '15%' }}>대체 텍스트</th>
              </tr>
            </thead>
            <tbody>
              {bossesForm.map((b, idx) => (
                <tr key={idx}>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{b.boss_number}넴</td>
                  <td><input type="text" value={b.name} onChange={e => handleBossChange(idx, 'name', e.target.value)} required placeholder="보스 이름" style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }} /></td>
                  <td>
                    <select value={b.element} onChange={e => handleBossChange(idx, 'element', e.target.value)} required style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }}>
                      <option value="작열">작열</option>
                      <option value="수냉">수냉</option>
                      <option value="풍압">풍압</option>
                      <option value="전격">전격</option>
                      <option value="철갑">철갑</option>
                    </select>
                  </td>
                  <td>
                    <select value={b.boss_grade} onChange={e => handleBossChange(idx, 'boss_grade', e.target.value)} required style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }}>
                      <option value="로드급">로드급</option>
                      <option value="타일런트급">타일런트급</option>
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <BossImage url={b.image_url} alt={b.image_alt} element={b.element} size={36} />
                      <input type="url" value={b.image_url} onChange={e => handleBossChange(idx, 'image_url', e.target.value)} placeholder="https://... (1024x1024)" style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                  </td>
                  <td><input type="text" value={b.image_alt} onChange={e => handleBossChange(idx, 'image_alt', e.target.value)} placeholder="예: 크라켄" style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="mt-5 mb-2">
            <div>
              <h4 style={{ color: 'var(--info)', margin: 0 }}>단계별 보스 체력 표 설정</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>1의 자리까지 정확한 전체 숫자(예: 998500000)를 직접 입력해 주세요.</p>
            </div>
            <button type="button" onClick={addHpStage} className="secondary-btn" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>+ 단계 추가</button>
          </div>
          
          <table className="admin-table mb-4">
            <thead>
              <tr>
                <th style={{ width: '10%' }}>단계</th>
                <th style={{ width: '40%' }}>로드급 체력</th>
                <th style={{ width: '40%' }}>타일런트급 체력</th>
                <th style={{ width: '10%' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {hpSettingsForm.map((h, idx) => (
                <tr key={idx}>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{h.stage_level}단계</td>
                  <td><input type="number" value={h.lord_hp} onChange={e => handleHpChange(idx, 'lord_hp', e.target.value)} required style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }} /></td>
                  <td><input type="number" value={h.tyrant_hp} onChange={e => handleHpChange(idx, 'tyrant_hp', e.target.value)} required style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }} /></td>
                  <td>
                    <button type="button" onClick={() => removeHpStage(idx)} className="btn-danger w-full" style={{ padding: '4px' }}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button type="submit" className="primary-btn w-full mt-2" style={{ backgroundColor: 'var(--success)', fontSize: '1.2rem', padding: '1rem' }}>✅ 위 정보로 시즌 전체 일괄 등록</button>
        </form>
      </div>

      <h3 className="mt-5 mb-3">등록된 시즌 목록</h3>
      {loading ? <div>데이터베이스에서 시즌 구조를 불러오는 중입니다...</div> : seasons.map((season) => (
        <div key={season.name} className="lobby-card mb-4" style={{ backgroundColor: '#1e2430' }}>
          <div 
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: expandedSeasons[season.name] ? '1px solid var(--border-color)' : 'none', paddingBottom: expandedSeasons[season.name] ? '0.8rem' : '0' }}
            onClick={() => setExpandedSeasons(prev => ({ ...prev, [season.name]: !prev[season.name] }))}
          >
            <div>
              <span style={{ marginRight: '10px', fontSize: '1.2rem' }}>{expandedSeasons[season.name] ? '▼' : '▶'}</span>
              <h4 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--accent-amber)', display: 'inline-block', marginRight: '1rem' }}>{season.name}</h4>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>({season.start_date} ~ {season.end_date})</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  setExpandedSeasons(prev => ({ ...prev, [season.name]: true }));
                  startEditSeason(season);
                }}
                className="secondary-btn"
                style={{ fontSize: '0.8rem', padding: '6px 12px' }}
              >
                수정
              </button>
              <button onClick={() => handleDeleteSeason(season.name)} className="btn-danger" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>시즌 삭제</button>
            </div>
          </div>
          
          {expandedSeasons[season.name] && (
            editingSeason === season.name ? (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label>시작일</label>
                    <input type="date" value={editForm?.start_date || ''} onChange={e => setEditForm(prev => ({ ...prev, start_date: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>종료일</label>
                    <input type="date" value={editForm?.end_date || ''} onChange={e => setEditForm(prev => ({ ...prev, end_date: e.target.value }))} />
                  </div>
                </div>
                <table className="admin-table mb-4">
                  <thead>
                    <tr>
                      <th style={{ width: '7%' }}>자리</th>
                      <th style={{ width: '20%' }}>이름</th>
                      <th style={{ width: '11%' }}>속성</th>
                      <th style={{ width: '12%' }}>등급</th>
                      <th style={{ width: '32%' }}>보스 이미지 URL</th>
                      <th style={{ width: '18%' }}>대체 텍스트</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editForm?.bosses.map((b, idx) => (
                      <tr key={b.id}>
                        <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{b.boss_number}넴</td>
                        <td><input type="text" value={b.name} onChange={e => handleEditBossChange(idx, 'name', e.target.value)} style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }} /></td>
                        <td>
                          <select value={b.element} onChange={e => handleEditBossChange(idx, 'element', e.target.value)} style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }}>
                            <option value="작열">작열</option>
                            <option value="수냉">수냉</option>
                            <option value="풍압">풍압</option>
                            <option value="전격">전격</option>
                            <option value="철갑">철갑</option>
                          </select>
                        </td>
                        <td>
                          <select value={b.boss_grade} onChange={e => handleEditBossChange(idx, 'boss_grade', e.target.value)} style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }}>
                            <option value="로드급">로드급</option>
                            <option value="타일런트급">타일런트급</option>
                          </select>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <BossImage url={b.image_url} alt={b.image_alt} element={b.element} size={36} />
                            <input type="url" value={b.image_url} onChange={e => handleEditBossChange(idx, 'image_url', e.target.value)} placeholder="https://... (1024x1024)" style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }} />
                          </div>
                        </td>
                        <td><input type="text" value={b.image_alt} onChange={e => handleEditBossChange(idx, 'image_alt', e.target.value)} placeholder="예: 크라켄" style={{ padding: '6px', width: '100%', boxSizing: 'border-box' }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>※ 시즌명과 단계별 체력은 여러 데이터의 기준 키/기록이라 이 화면에서 수정하지 않습니다.</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={handleSaveEditSeason} className="primary-btn" style={{ backgroundColor: 'var(--success)' }}>저장</button>
                  <button onClick={cancelEditSeason} className="secondary-btn">취소</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1rem' }}>
                <div>
                  <h5 style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>출현 보스 목록</h5>
                  <ul style={{ listStyle: 'none', paddingLeft: 0, fontSize: '0.95rem', color: '#ddd', marginTop: '0.5rem' }}>
                    {[...season.bosses].sort((a, b) => a.boss_number - b.boss_number).map(b => (
                      <li key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <BossImage url={b.image_url} alt={b.image_alt} element={b.element} size={40} />
                        <span><strong>{b.boss_number}넴</strong>: {b.name} <span style={{ color: 'var(--text-dim)' }}>({b.element} / {b.boss_grade})</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h5 style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>단계별 체력 (1자리 표기)</h5>
                  <ul style={{ paddingLeft: '20px', fontSize: '0.95rem', color: '#ddd', marginTop: '0.5rem', lineHeight: '1.6' }}>
                    {season.hp.map(h => (
                      <li key={h.id}>
                        <strong>{h.stage_level}단계</strong> &rarr;
                        로드: <span style={{ color: 'var(--info)' }}>{Number(h.lord_hp).toLocaleString()}</span> /
                        타일런트: <span style={{ color: 'var(--danger-solid)' }}>{Number(h.tyrant_hp).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )
          )}
        </div>
      ))}
      {seasons.length === 0 && !loading && (
        <div className="text-center mt-4" style={{ color: 'var(--text-muted)', padding: '2rem', backgroundColor: 'var(--bg-color)', borderRadius: '8px' }}>
          현재 등록된 시즌이 하나도 없습니다.<br/>위 폼을 작성하여 첫 번째 시즌을 등록해보세요!
        </div>
      )}
    </div>
  );
}
