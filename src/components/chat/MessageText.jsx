import React from 'react';
import { isManager } from '../../lib/roles';

// http(s):// 또는 www. 로 시작하는 링크를 감지한다. (공백/꺾쇠 전까지)
const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

// 링크 끝에 붙은 문장부호(예: "...example.com." 의 마지막 점)는 링크에서 제외한다.
// 괄호류는 링크 안에 짝이 되는 여는 괄호가 없을 때만 제외한다.
function splitTrailingPunct(url) {
  let trailing = '';
  while (url.length > 0) {
    const last = url[url.length - 1];
    const isPunct = '.,!?;:\'"'.includes(last);
    const isUnbalanced =
      (last === ')' && !url.includes('(')) ||
      (last === ']' && !url.includes('[')) ||
      (last === '}' && !url.includes('{'));
    if (isPunct || isUnbalanced) {
      trailing = last + trailing;
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return [url, trailing];
}

// 본문을 URL 구간과 일반 텍스트 구간으로 분리한다.
// URL을 멘션 처리보다 먼저 떼어내, URL 내부의 @ 등이 멘션으로 오인되지 않게 한다.
function splitByUrl(text) {
  const segs = [];
  let lastIndex = 0;
  let m;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > lastIndex) segs.push({ type: 'text', text: text.slice(lastIndex, m.index) });
    const [clean, trailing] = splitTrailingPunct(m[0]);
    // www. 링크는 상대경로로 처리되지 않도록 https:// 를 붙여 이동시킨다. (표시 문구는 원문 유지)
    const href = /^www\./i.test(clean) ? `https://${clean}` : clean;
    segs.push({ type: 'url', text: clean, href });
    if (trailing) segs.push({ type: 'text', text: trailing });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) segs.push({ type: 'text', text: text.slice(lastIndex) });
  return segs;
}

// 일반 텍스트 구간에서 멘션을 강조 렌더링한다.
// <@user_id> 토큰과 @!all / @!mod / @닉네임 을 색상 강조한다.
function renderMentions(content, allMembers, currentUserId, currentUserName) {
  return content.split(/(<@[^>]+>|@\S+)/g).map((part, i) => {
    if (part.startsWith('<@') && part.endsWith('>')) {
      const uuid = part.slice(2, -1);
      const mInfo = allMembers.find(m => m.user_id === uuid);
      if (mInfo) {
        const isMeMentioned = currentUserId === uuid;
        return (
          <span key={i} style={{ backgroundColor: isMeMentioned ? 'var(--danger-strong)' : 'transparent', color: isMeMentioned ? 'var(--text-strong)' : 'var(--accent-amber)', padding: isMeMentioned ? '0 4px' : '0', borderRadius: '4px', fontWeight: 'bold' }}>
            @{mInfo.in_game_name}
          </span>
        );
      }
      return <span key={i} style={{ color: 'var(--text-dim)' }}>@알 수 없는 유저</span>;
    }

    if (part.startsWith('@')) {
      const mentionedName = part.substring(1);
      let isMeMentioned = false;
      if (mentionedName === '!all') {
        isMeMentioned = true;
      } else if (mentionedName === '!mod') {
        const myInfo = allMembers.find(m => m.user_id === currentUserId);
        if (myInfo && isManager(myInfo.role)) isMeMentioned = true;
      } else {
        isMeMentioned = !!currentUserName && mentionedName === currentUserName;
      }

      const isSpecial = mentionedName === '!all' || mentionedName === '!mod';
      const bgColor = isMeMentioned ? 'var(--danger-strong)' : 'transparent';
      const txtColor = isMeMentioned ? 'var(--text-strong)' : (isSpecial ? 'var(--accent-amber)' : '#93c5fd');

      return (
        <span key={i} style={{ backgroundColor: bgColor, color: txtColor, padding: isMeMentioned ? '0 4px' : '0', borderRadius: '4px', fontWeight: 'bold' }}>
          {part}
        </span>
      );
    }

    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

// 메시지 본문 텍스트를 URL 자동 링크 + 멘션 하이라이트와 함께 렌더링한다. (일반/지휘 채팅 공용)
export default function MessageText({ content, allMembers, currentUserId, currentUserName }) {
  return splitByUrl(content).map((seg, i) => {
    if (seg.type === 'url') {
      return (
        <a
          key={i}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#b2fa60ff', textDecoration: 'underline dotted', wordBreak: 'break-all' }}
        >
          {seg.text}
        </a>
      );
    }
    return <React.Fragment key={i}>{renderMentions(seg.text, allMembers, currentUserId, currentUserName)}</React.Fragment>;
  });
}
