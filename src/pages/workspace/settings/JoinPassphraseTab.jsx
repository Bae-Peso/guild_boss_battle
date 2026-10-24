// 길드 설정 > 가입 암구호 탭.
// 암구호를 설정하면 신규 가입 신청 시 올바른 암구호를 입력해야 신청이 가능하다.
// 기본값은 빈칸(미설정)이며, 미설정 시 누구나 가입 신청할 수 있다.
export default function JoinPassphraseTab({ loading, currentPassphrase, value, onChange, onSave, onClear }) {
  const hasPassphrase = !!(currentPassphrase && currentPassphrase.trim());

  return (
    <div className="settings-panel">
      <h3>가입 암구호 설정</h3>
      <p>
        암구호를 설정하면 새 멤버가 가입 신청할 때 이 암구호를 정확히 입력해야 합니다.<br />
        인게임 닉네임·UID는 누구나 조회할 수 있으므로, 암구호로 UID 긴빠이 행위로 들어온 간사한 새끼를 사전 차단할 수 있습니다.<br />
        <span style={{ color: 'var(--text-dim)' }}>비워두면 암구호 없이 누구나 가입 신청할 수 있습니다. (이미 가입한 멤버에게는 영향 없음)</span>
      </p>

      {loading ? (
        <p style={{ color: 'var(--text-dim)' }}>로딩 중...</p>
      ) : (
        <>
          <div
            className="settings-status-pill"
            style={{
              backgroundColor: hasPassphrase ? 'rgba(40, 167, 69, 0.15)' : 'rgba(108, 117, 125, 0.15)',
              color: hasPassphrase ? 'var(--success)' : 'var(--text-muted)',
              border: `1px solid ${hasPassphrase ? 'var(--success)' : 'var(--border-2)'}`,
            }}
          >
            {hasPassphrase ? `🔒 현재 암구호: ${currentPassphrase}` : '🔓 현재 암구호 없음 (누구나 가입 신청 가능)'}
          </div>

          <form onSubmit={onSave} className="settings-form-row">
            <div className="form-group">
              <label>{hasPassphrase ? '새 암구호' : '암구호'}</label>
              <input
                type="text"
                value={value}
                onChange={onChange}
                maxLength={30}
                autoComplete="off"
                placeholder="최대 30자 (영문/숫자/한글 등)"
              />
            </div>
            <button type="submit" className="primary-btn">
              {hasPassphrase ? '암구호 변경' : '암구호 설정'}
            </button>
            {hasPassphrase && (
              <button type="button" onClick={onClear} className="btn-danger">
                암구호 해제
              </button>
            )}
          </form>
        </>
      )}
    </div>
  );
}
