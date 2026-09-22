-- Métricas diárias por anúncio, puxadas da Marketing API da Meta.
-- Existe porque o funil até o contrato mora aqui e o gasto mora lá: sem juntar
-- os dois não dá para dizer o custo por orçamento de cada anúncio.
--
-- Chave em (dia, ad_id): a função reprocessa os últimos dias a cada execução,
-- porque a Meta revisa números por alguns dias depois do fato.

create table if not exists ads_insights (
  dia             date    not null,
  ad_id           text    not null,
  account_id      text    not null,
  campaign_id     text,
  campaign_nome   text,
  adset_id        text,
  adset_nome      text,
  ad_nome         text,
  gasto           numeric(12,2) not null default 0,
  impressoes      integer not null default 0,
  alcance         integer not null default 0,
  cliques         integer not null default 0,
  cliques_link    integer not null default 0,
  sincronizado_em timestamptz not null default now(),
  primary key (dia, ad_id)
);

create index if not exists idx_ads_insights_dia on ads_insights(dia desc);
create index if not exists idx_ads_insights_campaign on ads_insights(campaign_id);

-- Sem política para anon: nenhum fluxo público lê custo de anúncio.
-- A função de sincronismo escreve com service role, que não passa por RLS.
alter table ads_insights enable row level security;

drop policy if exists ads_insights_admin on ads_insights;
create policy ads_insights_admin on ads_insights
  for all to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');

revoke all on ads_insights from anon;

-- Autenticação do cron para a função sync-meta-ads.
-- O segredo vive no Vault (nome 'sync_meta_ads') e é gerado dentro do banco:
--   select vault.create_secret(
--     replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
--     'sync_meta_ads');
-- Nem o job do cron nem o repositório carregam o valor. Não é ALTER DATABASE SET
-- porque no Supabase o papel postgres não é superusuário e isso é negado.
-- security definer: só o dono (postgres) enxerga vault.decrypted_secrets.
create or replace function public.sync_meta_ads_auth(p_token text)
returns boolean language sql stable security definer
set search_path = public, vault as $f$
  select p_token is not null
     and length(p_token) > 20
     and exists (
       select 1 from vault.decrypted_secrets v
        where v.name = 'sync_meta_ads' and v.decrypted_secret = p_token)
$f$;

revoke all on function public.sync_meta_ads_auth(text) from public, anon, authenticated;
grant execute on function public.sync_meta_ads_auth(text) to service_role;

-- Job diário, 8h de Brasília. O segredo é lido do Vault na hora do disparo.
select cron.schedule('sync-meta-ads-diario', '0 11 * * *', $job$
  select net.http_post(
    url     := 'https://wwnndsprpofmgbklqdgg.supabase.co/functions/v1/sync-meta-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'sync_meta_ads' limit 1)))
$job$);
-- Agregado por anúncio para o painel de custo por orçamento.
-- security definer: quem chama não precisa de leitura em orcamentos nem em
-- visitas_comerciais (nome, WhatsApp, valor) — recebe só contagens. É o que
-- permite o papel 'trafego' ver o relatório sem enxergar dado de cliente.
create or replace function public.relatorio_anuncios(p_dias int default 90)
returns table(ad_id text, ad_nome text, campanha text, gasto numeric,
              impressoes bigint, cliques bigint, disp bigint, orc bigint, vis bigint)
language plpgsql stable security definer set search_path = public as $$
declare ini timestamptz;
begin
  if coalesce(get_my_role(), '') not in ('admin', 'trafego') then
    raise exception 'sem permissão para o relatório de anúncios' using errcode = '42501';
  end if;
  ini := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 365)));
  return query
  with gasto as (
    select i.ad_id, max(i.ad_nome) ad_nome, max(i.campaign_nome) campanha,
           sum(i.gasto) gasto, sum(i.impressoes)::bigint impressoes, sum(i.cliques_link)::bigint cliques
      from ads_insights i where i.dia >= ini::date group by i.ad_id),
  -- primeiro acesso NUMÉRICO de cada dispositivo no período: utm_content = ad.id
  -- da Meta. Orgânico antes (link_in_bio) não bloqueia; anúncio depois não troca.
  atr as (
    select distinct on (s.session_id) s.session_id, s.utm_content ad_id
      from site_visits s
     where s.visited_at >= ini and s.utm_content ~ '^[0-9]+$'
     order by s.session_id, s.visited_at asc),
  d as (select a.ad_id, count(*) disp from atr a group by a.ad_id),
  o as (select a.ad_id, count(*) orc from orcamentos x join atr a on a.session_id = x.visitor_id
         where x.created_at >= ini group by a.ad_id),
  v as (select a.ad_id, count(*) vis from visitas_comerciais x join atr a on a.session_id = x.visitor_id
         where x.created_at >= ini and x.status is distinct from 'cancelada' group by a.ad_id),
  ids as (select g.ad_id from gasto g union select d.ad_id from d)
  select i.ad_id, g.ad_nome, g.campanha,
         coalesce(g.gasto, 0), coalesce(g.impressoes, 0), coalesce(g.cliques, 0),
         coalesce(d.disp, 0), coalesce(o.orc, 0), coalesce(v.vis, 0)
    from ids i
    left join gasto g on g.ad_id = i.ad_id
    left join d on d.ad_id = i.ad_id
    left join o on o.ad_id = i.ad_id
    left join v on v.ad_id = i.ad_id
   order by coalesce(g.gasto, 0) desc;
end $$;

revoke all on function public.relatorio_anuncios(int) from public, anon;
grant execute on function public.relatorio_anuncios(int) to authenticated;
