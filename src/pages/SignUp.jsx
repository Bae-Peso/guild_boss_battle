import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import TermsModal from '../components/TermsModal';

export default function SignUp() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // 아이디는 내부적으로 `${username}@nikke.local` 더미 이메일이 되므로,
    // 공백/특수문자가 들어가면 이메일이 무효가 되어 가입이 실패한다. 영문/숫자/_/- 만 허용.
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      return setError('아이디는 영문/숫자/-/_ 조합 3~20자로 입력해주세요.');
    }

    if (password !== confirmPassword) {
      return setError('비밀번호가 일치하지 않습니다.');
    }

    if (password.length < 6) {
      return setError('비밀번호는 최소 6자리 이상이어야 합니다.');
    }

    if (!agreed) {
      return setError('이용약관에 동의해주세요.');
    }

    try {
      setError('');
      setLoading(true);
      await signUp(username, password);
      navigate('/');
    } catch (err) {
      console.error("Signup Error:", err);
      setError(`회원가입 실패: ${err.message || '이미 존재하는 아이디일 수 있습니다.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-container">
        <h2>회원가입</h2>
        {error && <div className="error-alert">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>아이디</label>
            <input 
              type="text" 
              required 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>비밀번호</label>
            <input 
              type="password" 
              required 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>비밀번호 확인</label>
            <input 
              type="password" 
              required 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
            비밀번호 찾기 기능이 없으니 비밀번호를 꼭 따로 보관해주세요.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.2rem', fontSize: '0.9rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span><button type="button" onClick={(e) => { e.preventDefault(); setTermsOpen(true); }} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary-color)', cursor: 'pointer', font: 'inherit' }}>이용약관</button>에 동의합니다. (필수)</span>
          </label>
          <button disabled={loading} className="primary-btn w-full" type="submit">
            가입하기
          </button>
        </form>
        <div className="auth-links">
          이미 계정이 있으신가요? <Link to="/login">로그인</Link>
        </div>
        <TermsModal isOpen={termsOpen} onClose={() => setTermsOpen(false)} />
      </div>
    </div>
  );
}
