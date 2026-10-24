import { Link, useNavigate } from 'react-router-dom';
import { TermsContent } from '../components/TermsModal';

export default function Terms() {
  const navigate = useNavigate();

  return (
    <div className="auth-wrapper" style={{ padding: '2rem 1rem', alignItems: 'flex-start' }}>
      <div className="auth-container" style={{ maxWidth: 720 }}>
        <h2>이용약관</h2>
        <TermsContent />
        <div className="auth-links">
          {window.history.length > 1
            ? <button type="button" className="primary-btn" onClick={() => navigate(-1)}>돌아가기</button>
            : <Link to="/">처음으로</Link>}
        </div>
      </div>
    </div>
  );
}
