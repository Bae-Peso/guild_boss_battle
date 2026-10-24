-- 니케 선택 모달의 "자주 쓰인 니케" 정렬을 위한 집계 RPC.
--
-- 배경: NikkeSelectorModal 은 지금까지 이름순으로만 정렬했다. 니케가 190종을 넘어
-- 실제로 자주 쓰는 니케가 목록 중간에 묻히고, 매번 검색어를 쳐야 했다.
--
-- 이 함수는 최근 N개 시즌의 '완료된' 모의전 덱을 훑어 니케별 사용 점수를 돌려준다.
-- 설계에서 신경 쓴 지점 세 가지:
--
--  1) SECURITY DEFINER 인 이유
--     mock_battles 는 mock_battles_union_scope 로 자기 길드에만 열려 있다.
--     클라이언트가 직접 집계하면 표본이 '내 길드'으로 한정되는데, 시즌당 1인 3타 캡이
--     걸려 있어 30인 길드 기준 시즌당 90덱 남짓이다. 3시즌을 합쳐도 대부분의 니케가
--     0으로 동점이 되고, 신생 길드는 아예 정렬이 동작하지 않는다.
--     그래서 정의자 권한으로 RLS를 우회해 전체 길드를 집계한다.
--     밖으로 나가는 값은 니케 ID 와 집계 점수뿐이라 특정 길드·유저는 식별되지 않는다.
--
--  2) 절대 횟수가 아니라 '그 시즌 덱 중 몇 %에 들어갔는가' 로 정규화하는 이유
--     시즌마다 총 덱 수가 다르다(길드 수 변동, 참여율, 클리어 여부). 절대 횟수에
--     가중치를 곱하면 활동량이 많았던 예전 시즌이 최신 시즌을 이겨버린다.
--     시즌 내 사용률을 구한 뒤 최신 시즌일수록 큰 가중치(3시즌이면 3, 2, 1)를 곱해 더한다.
--
--  3) 보스 단위로 좁히는 이유
--     길드 보스전은 보스마다 약점 속성과 기믹이 달라, 전 보스를 뭉뚱그린 랭킹은
--     이번 보스에 안 맞는 니케를 상단에 올린다. 그래서
--       보스명 일치 → 속성 일치 → 전체
--     순으로 훑으면서 표본이 p_min_decks 를 넘는 가장 좁은 범위를 골라 집계한다.
--     (새로 나온 보스처럼 과거 표본이 없으면 자동으로 한 단계씩 넓어진다.)
--
-- p_element 를 element_enum 이 아니라 text 로 받는 것은 의도적이다. 클라이언트가
-- 넘긴 문자열이 enum 에 없을 때 캐스팅 에러로 터지는 대신 '속성 불일치'로 흘러가게 한다.
create or replace function public.get_nikke_usage_ranking(
  p_boss_name text default null,
  p_element text default null,
  p_season_count integer default 3,
  p_min_decks integer default 30
)
returns table (nikke_id integer, score numeric, uses bigint, scope text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with params as (
  select least(greatest(coalesce(p_season_count, 3), 1), 10) as n,
         greatest(coalesce(p_min_decks, 30), 0) as min_decks
),
-- 완료 타수가 하나라도 있는 시즌만 최신순으로 N개. 이제 막 시작해 기록이 없는 시즌이
-- 가장 큰 가중치를 가져가 버리는 것을 막는다.
recent as (
  select s.name as season_name,
         row_number() over (order by s.start_date desc) as rn
  from public.raid_seasons s
  where exists (
    select 1
    from public.global_raid_bosses b
    join public.union_raid_status rs on rs.global_boss_id = b.id
    join public.mock_battles mb on mb.boss_status_id = rs.id and mb.status = 'completed'
    where b.season_name = s.name
  )
  order by s.start_date desc
  limit (select n from params)
),
weighted as (
  select r.season_name,
         ((select n from params) - r.rn + 1)::numeric as weight
  from recent r
),
decks as (
  select mb.id,
         w.season_name,
         w.weight,
         case
           when p_boss_name is not null and b.name = p_boss_name then 1
           when p_element is not null and b.element::text = p_element then 2
           else 3
         end as tier,
         mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id,
         mb.slot_4_nikke_id, mb.slot_5_nikke_id
  from public.mock_battles mb
  join public.union_raid_status rs on rs.id = mb.boss_status_id
  join public.global_raid_bosses b on b.id = rs.global_boss_id
  join weighted w on w.season_name = b.season_name
  where mb.status = 'completed'
),
tier_counts as (
  select t.tier,
         (select count(*) from decks d where d.tier <= t.tier) as decks_at_or_below
  from generate_series(1, 3) as t(tier)
),
-- 표본이 p_min_decks 이상인 가장 좁은 범위. 어느 범위도 못 채우면 가장 넓은 3.
-- greatest(..., 1) 이 필요한 이유: p_min_decks 가 0 이면 덱이 하나도 없는 tier 1 도
-- 조건을 만족해 버려서 빈 결과가 나온다. 범위는 최소 1덱은 있어야 고를 수 있다.
chosen as (
  select coalesce(
    (select min(tc.tier)
       from tier_counts tc
      where tc.decks_at_or_below >= greatest((select min_decks from params), 1)),
    3
  ) as tier
),
sel as (
  select d.*
  from decks d
  cross join chosen c
  where d.tier <= c.tier
),
totals as (
  select s.season_name, s.weight, count(*)::numeric as total
  from sel s
  group by s.season_name, s.weight
),
slots as (
  select s.id, s.season_name, v.nid
  from sel s
  cross join lateral (values
    (s.slot_1_nikke_id), (s.slot_2_nikke_id), (s.slot_3_nikke_id),
    (s.slot_4_nikke_id), (s.slot_5_nikke_id)
  ) as v(nid)
  where v.nid is not null
),
per_season as (
  select sl.season_name, sl.nid, count(distinct sl.id)::numeric as cnt
  from slots sl
  group by sl.season_name, sl.nid
)
select ps.nid::integer as nikke_id,
       round(sum(t.weight * ps.cnt / t.total), 6) as score,
       sum(ps.cnt)::bigint as uses,
       (select case c.tier when 1 then 'boss' when 2 then 'element' else 'all' end
          from chosen c) as scope
from per_season ps
join totals t on t.season_name = ps.season_name
group by ps.nid
order by score desc, uses desc, nikke_id;
$$;

revoke all on function public.get_nikke_usage_ranking(text, text, integer, integer) from public;
grant execute on function public.get_nikke_usage_ranking(text, text, integer, integer) to authenticated;
grant execute on function public.get_nikke_usage_ranking(text, text, integer, integer) to service_role;

comment on function public.get_nikke_usage_ranking(text, text, integer, integer) is
  '최근 시즌의 완료 모의전 덱을 집계해 니케별 사용 점수를 돌려준다. 니케 선택 모달 정렬용.';
