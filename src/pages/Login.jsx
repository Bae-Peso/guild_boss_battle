import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import TermsModal from '../components/TermsModal';
import { CONTACT_URL } from '../lib/siteLinks';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError('');
      setLoading(true);
      await signIn(username, password);
      navigate('/');
    } catch (err) {
      setError('로그인에 실패했습니다. 아이디와 비밀번호를 확인해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-container">
        <h2>로그인</h2>
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
          <button disabled={loading} className="primary-btn w-full" type="submit">
            로그인
          </button>
        </form>
        <div className="auth-links">
          계정이 없으신가요? <Link to="/signup">회원가입</Link>
        </div>
        <div className='auth-links'>계정을 잃어버리셨나요? <br /> <a href={CONTACT_URL} target='_blank'>이곳에</a> 게시글을 작성해주세요.</div>
        <div className="auth-links"><button type="button" onClick={() => setTermsOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary-color)', cursor: 'pointer', font: 'inherit' }}>이용약관</button></div>
        <TermsModal isOpen={termsOpen} onClose={() => setTermsOpen(false)} />
      </div>
    </div>
  );
}
