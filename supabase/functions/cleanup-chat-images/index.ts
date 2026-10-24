// chat_images 버킷에서 보존일수(app_settings.chat_image_retention_days)를 넘긴 이미지를 삭제한다.
// 호출 경로:
//   1) 자동: pg_cron → net.http_post 로 x-cleanup-secret 헤더와 함께 호출
//   2) 수동: 관리자 패널 버튼 → supabase.functions.invoke (사이트 관리자 JWT)
// 배포: supabase functions deploy cleanup-chat-images --no-verify-jwt
//   (cron 호출은 유저 JWT가 없으므로 verify_jwt를 끄고 아래에서 직접 인증한다)
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLEANUP_SECRET = Deno.env.get("CLEANUP_SECRET");

const BUCKET = "chat_images";
const DEFAULT_RETENTION_DAYS = 7;
const MAX_BATCH = 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cleanup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// cron 시크릿 헤더 또는 사이트 관리자 JWT 중 하나면 허용.
async function isAuthorized(req: Request): Promise<boolean> {
  if (CLEANUP_SECRET && req.headers.get("x-cleanup-secret") === CLEANUP_SECRET) {
    return true;
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.rpc("is_site_admin");
  if (error) {
    console.error("is_site_admin rpc failed:", error.message);
    return false;
  }
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await isAuthorized(req))) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // 보존일수 읽기(없거나 이상값이면 기본 7일)
  let retentionDays = DEFAULT_RETENTION_DAYS;
  const { data: setting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "chat_image_retention_days")
    .maybeSingle();
  const parsed = Number(setting?.value);
  if (Number.isFinite(parsed) && parsed > 0) retentionDays = parsed;

  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

  // 오래된 객체 경로 조회 (storage.objects)
  const { data: rows, error: qErr } = await admin
    .schema("storage")
    .from("objects")
    .select("name")
    .eq("bucket_id", BUCKET)
    .lt("created_at", cutoff)
    .limit(MAX_BATCH);

  if (qErr) {
    console.error("query old objects failed:", qErr.message);
    return json({ ok: false, error: qErr.message }, 500);
  }

  const paths = (rows ?? []).map((r) => r.name as string).filter(Boolean);
  let removed = 0;
  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
    if (rmErr) {
      console.error("remove failed:", rmErr.message);
      return json({ ok: false, error: rmErr.message }, 500);
    }
    removed = paths.length;
  }

  return json({ ok: true, retentionDays, removed });
});
