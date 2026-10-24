import { useEscapeKey } from '../hooks/useEscapeKey';
import { CONTACT_URL } from '../lib/siteLinks';

// 이용약관 본문. 문구를 고칠 때는 이 배열만 수정하면 되고,
// 내용이 바뀌면 EFFECTIVE_DATE도 같이 올려준다.
export const EFFECTIVE_DATE = '2026년 10월 18일';

const ARTICLES = [
  {
    title: '제1조 (목적)',
    body: [
      '본 약관은 길드 보스전 지휘소(이하 "지휘소")가 제공하는 서비스의 이용 조건과 절차, 지휘소와 회원가입한 사용자(이하 "유저") 사이의 권리와 의무를 정하는 것을 목적으로 합니다.',
    ],
  },
  {
    title: '제2조 (사이트 소개)',
    body: [
      '지휘소는 게임 "승리의 여신: 니케"의 길드 보스전 진행을 돕기 위해 개인이 운영하는 비공식 팬 사이트입니다.',
      '지휘소는 시프트업 주식회사 및 레벨 인피니트와 아무런 제휴 관계가 없으며, 두 회사가 운영하거나 보증하는 서비스가 아닙니다.',
    ],
  },
  {
    title: '제3조 (회원가입과 계정)',
    body: [
      '지휘소는 유저의 개인정보 수집을 최소화하기 위해 아이디와 비밀번호만으로 계정을 개설합니다. 이메일, 전화번호, 실명 등은 받지 않습니다.',
      '이에 따라 비밀번호 찾기, 아이디 찾기와 같은 계정 복구 기능을 제공하지 않습니다. 비밀번호는 유저 본인이 직접 안전하게 보관해야 하며, 분실로 인한 불이익은 지휘소가 책임지지 않습니다.',
      '계정을 잃어버린 경우 지휘소 안내 게시판에 문의할 수 있으나, 본인 확인이 어려운 경우 복구가 불가능할 수 있습니다.',
      '유저는 자신의 계정을 타인에게 양도하거나 대여할 수 없습니다.',
    ],
  },
  {
    title: '제4조 (저장되는 정보)',
    body: [
      '지휘소는 서비스 제공에 필요한 다음 정보만 저장합니다.',
      [
        '계정 정보: 아이디, 비밀번호(암호화되어 저장되며 운영자도 원문을 볼 수 없습니다)',
        '게임 정보: 유저가 직접 입력한 게임 닉네임, UID, 소속 길드',
        '활동 내역: 보스전 기록, 채팅 메시지와 업로드한 이미지, 각종 신청 내역 등 유저가 지휘소에서 작성하거나 입력한 내용',
        '알림 설정: 푸시 알림을 켠 경우, 알림 발송에 필요한 브라우저 구독 정보',
      ],
    ],
  },
  {
    title: '제5조 (활동 내역의 보호)',
    body: [
      '유저의 활동 내역은 어떠한 경우에도 제3자에게 제공되지 않습니다.',
      '다만, 보스전 기록과 채팅처럼 길드 활동을 위해 작성한 내용은 같은 길드의 멤버에게 표시되며, 서비스 운영과 신고 처리를 위해 지휘소 운영자가 열람할 수 있습니다.',
      '지휘소는 서비스 운영을 위해 호스팅 및 데이터베이스 업체(Cloudflare, Supabase)의 서버를 이용하며, 유저의 정보는 이 서버에 저장됩니다. 해당 업체는 저장 공간을 제공할 뿐 유저의 정보를 별도로 이용하지 않습니다.',
    ],
  },
  {
    title: '제6조 (이미지 저작권)',
    body: [
      '사이트 내부의 모든 게임 이미지 소스의 저작권은 시프트업 주식회사, 레벨 인피니트에 있으며 지휘소가 소유하고 있지 않습니다.',
      '저작권과 관련하여 문제가 될 경우, 요청을 받는 즉시 해당 이미지를 삭제 처리하겠습니다.',
      '유저가 채팅 등에 직접 업로드한 이미지의 책임은 업로드한 유저에게 있으며, 타인의 권리를 침해하는 이미지는 예고 없이 삭제될 수 있습니다.',
    ],
  },
  {
    title: '제7조 (유저의 의무)',
    body: [
      '유저는 다음 행위를 해서는 안 됩니다.',
      [
        '타인의 계정을 도용하거나 다른 유저를 사칭하는 행위',
        '지휘소의 정상적인 운영을 방해하거나 보안상 취약점을 악용하는 행위',
      ],
      '위 행위가 확인되면 지휘소는 사전 통보 없이 해당 게시물을 삭제하거나 계정 이용을 제한할 수 있습니다.',
    ],
  },
  {
    title: '제8조 (서비스의 변경과 중단)',
    body: [
      '지휘소는 개인이 운영하는 무료 서비스로, 운영상 필요에 따라 기능을 변경하거나 서비스를 일시 또는 영구적으로 중단할 수 있습니다.',
      '지휘소는 서비스 이용 과정에서 발생한 데이터 손실이나 게임 내 불이익에 대해 책임지지 않습니다.',
    ],
  },
  {
    title: '제9조 (유저 간 분쟁)',
    body: [
      '길드 내부 또는 유저 사이에서 발생한 분란, 다툼, 갈등에 대해 지휘소 운영자는 어떠한 책임도 지지 않으며, 이에 개입하거나 중재할 의무가 없습니다.',
      '길드의 가입, 탈퇴, 강퇴, 권한 부여 등 길드 운영에 관한 결정은 해당 길드의 관리자와 멤버가 스스로 정하며, 이로 인해 생긴 문제 역시 지휘소가 책임지지 않습니다.',
      '다만, 분쟁 과정에서 제7조를 위반하는 행위가 확인되면 지휘소는 해당 게시물을 삭제하거나 계정 이용을 제한할 수 있습니다.',
    ],
  },
  {
    title: '제10조 (계정 삭제)',
    body: [
      '유저는 언제든지 계정 삭제를 요청할 수 있으며, 요청이 확인되면 해당 계정과 관련 정보를 삭제합니다.',
    ],
  },
  {
    title: '제11조 (약관의 변경)',
    body: [
      '지휘소는 필요한 경우 본 약관을 변경할 수 있으며, 변경된 약관은 사이트 공지를 통해 안내합니다. 변경 후에도 서비스를 계속 이용하면 변경된 약관에 동의한 것으로 봅니다.',
    ],
  },
];

// 약관 본문만 렌더링한다. /terms 페이지와 TermsModal이 같이 쓴다.
export function TermsContent() {
  return (
    <div style={{ lineHeight: 1.7 }}>
      <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
        본 사이트는 길드 보스전 지휘소(이하 "지휘소")입니다. 지휘소를 이용하기 전에 아래 약관을 확인해주세요.
      </p>

      {ARTICLES.map((article) => (
        <section key={article.title} style={{ marginTop: '1.5rem' }}>
          <h3 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>{article.title}</h3>
          {article.body.map((item, i) =>
            Array.isArray(item) ? (
              <ul key={i} style={{ paddingLeft: '1.25rem', margin: '0.25rem 0 0.5rem' }}>
                {item.map((li) => <li key={li}>{li}</li>)}
              </ul>
            ) : (
              <p key={i} style={{ margin: '0 0 0.5rem' }}>{item}</p>
            )
          )}
        </section>
      ))}

      <section style={{ marginTop: '1.5rem' }}>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>문의</h3>
        <p style={{ margin: 0 }}>
          계정 분실, 계정 삭제, 저작권 관련 요청 등은{' '}
          <a href={CONTACT_URL} target="_blank" rel="noreferrer">이곳</a>
          에 게시글을 작성해주세요.
        </p>
      </section>

      <p style={{ marginTop: '2rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        시행일: {EFFECTIVE_DATE}
      </p>
    </div>
  );
}

export default function TermsModal({ isOpen, onClose }) {
  useEscapeKey(isOpen, onClose);
  if (!isOpen) return null;

  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', width: '92%', maxWidth: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-2)' }}>
          <h3 style={{ margin: 0, color: 'var(--text-strong)' }}>이용약관</h3>
          <button type="button" className="secondary-btn" onClick={onClose}>닫기</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 20px 20px', fontSize: '0.95rem' }}>
          <TermsContent />
        </div>
      </div>
    </div>
  );
}
