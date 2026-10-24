// 외부 이미지 CORS 프록시.
// 결산표 '이미지로 저장'(html-to-image)에서, CORS 헤더를 주지 않는 외부 호스트의 이미지를
// 캔버스(PNG)에 담기 위해, 서버가 대신 받아 CORS 헤더를 붙여 재전송한다.
//
// 배포: supabase functions deploy image-proxy --no-verify-jwt
//   (브라우저의 <img>/fetch 요청은 유저 JWT를 실어보내지 못하므로 verify_jwt를 끈다.
//    대신 아래 호스트 allowlist로 오남용(SSRF)을 막는다 — 이 프록시는 이미지 리소스만,
//    지정된 호스트에서만 가져올 수 있다.)

// 프록시를 허용할 호스트(정확히 일치하거나 서브도메인). 게임 에셋 CDN만 허용.
const ALLOWED_HOST_SUFFIXES = [
  "blablalink.com",
  "wikia.nocookie.net",
];

const MAX_BYTES = 15 * 1024 * 1024; // 응답 이미지 상한 15MB
const MAX_REDIRECTS = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suf) => h === suf || h.endsWith("." + suf));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  const target = new URL(req.url).searchParams.get("url");
  if (!target) {
    return new Response("missing url", { status: 400, headers: corsHeaders });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("invalid url", { status: 400, headers: corsHeaders });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return new Response("unsupported protocol", { status: 400, headers: corsHeaders });
  }
  if (!isAllowedHost(parsed.hostname)) {
    return new Response("host not allowed", { status: 403, headers: corsHeaders });
  }

  // 리다이렉트는 직접 따라가며 매 단계 호스트를 다시 확인한다. (자동 follow 는 허용 호스트의
  // 오픈 리다이렉트를 거쳐 임의 주소로 나갈 수 있다)
  let upstream: Response | null = null;
  let current = parsed;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      upstream = await fetch(current.toString(), {
        headers: { "Accept": "image/*,*/*;q=0.8" },
        redirect: "manual",
      });
    } catch (_e) {
      return new Response("fetch failed", { status: 502, headers: corsHeaders });
    }
    const location = upstream.headers.get("Location");
    if (upstream.status < 300 || upstream.status >= 400 || !location) break;
    try {
      current = new URL(location, current);
    } catch {
      return new Response("invalid redirect", { status: 502, headers: corsHeaders });
    }
    if ((current.protocol !== "https:" && current.protocol !== "http:") || !isAllowedHost(current.hostname)) {
      return new Response("redirect host not allowed", { status: 403, headers: corsHeaders });
    }
    if (hop === MAX_REDIRECTS) {
      return new Response("too many redirects", { status: 502, headers: corsHeaders });
    }
  }
  if (!upstream) {
    return new Response("fetch failed", { status: 502, headers: corsHeaders });
  }

  if (!upstream.ok) {
    return new Response(`upstream ${upstream.status}`, { status: 502, headers: corsHeaders });
  }

  const contentType = upstream.headers.get("Content-Type") || "";
  if (!contentType.startsWith("image/")) {
    return new Response("not an image", { status: 415, headers: corsHeaders });
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return new Response("image too large", { status: 413, headers: corsHeaders });
  }

  return new Response(buf, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      // SVG 는 스크립트를 담을 수 있어서, 이 함수 주소를 브라우저로 직접 열면 실행될 수 있다.
      // <img>/캔버스로 쓰는 데는 영향이 없고, 직접 열었을 때만 스크립트를 막는다.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
