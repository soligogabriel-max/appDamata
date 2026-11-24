-- Performance por criativo: do clique no Instagram ao contrato fechado.
--
-- relatorio_anuncios só enxerga utm_content numérico (ad.id da Meta), então
-- post, story, reels e link da bio — que saem com utm_content nomeado — ficavam
-- de fora, e nenhum relatório chegava até a agenda. Esta função agrupa por
-- qualquer utm_content e vai até o contrato, pelo mesmo caminho do
-- funil_fechados: agenda.orc_id -> orcamentos.visitor_id -> site_visits.session_id.
--
-- Chave do criativo, do mais específico para o mais genérico:
--   utm_content -> utm_campaign -> utm_source. Sessão sem nenhum dos três não
--   entra: é tráfego direto ou referral, que já aparece em "Origem dos Acessos".
--
-- Atribuição por PRIMEIRO toque com UTM no período: um aparelho que chegou
-- pelo reels e voltou pelo anúncio conta para o reels. É a convenção oposta à
-- de relatorio_anuncios (que ignora o orgânico anterior), e por isso os dois
-- relatórios não precisam bater — cada um responde a uma pergunta.
--
-- security definer: quem chama não precisa ler orcamentos, visitas_comerciais,
-- wpp_mensagens nem agenda. O papel 'trafego' recebe contagens; o valor fechado
-- é faturamento e sai só para admin.

drop function if exists public.relatorio_criativos(int);
create function public.relatorio_criativos(p_dias int default 90)
returns table(
  criativo text, fonte text, meio text, campanha text, ad_nome text,
  gasto numeric, impressoes bigint, cliques bigint,
  disp bigint, acessos bigint, orc bigint, vis bigint, wpp bigint,
  fechados bigint, valor_fechado numeric,
  primeiro timestamptz, ultimo timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  ini   timestamptz;
  papel text := coalesce(get_my_role(), '');
begin
  if papel not in ('admin', 'trafego') then
    raise exception 'sem permissão para o relatório de criativos' using errcode = '42501';
  end if;
  ini := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 365)));

  return query
  with marcadas as (
    select s.session_id, s.visited_at,
           coalesce(nullif(trim(s.utm_content), ''), nullif(trim(s.utm_campaign), ''),
                    nullif(trim(s.utm_source), '')) chave,
           nullif(trim(s.utm_source), '')   fonte,
           nullif(trim(s.utm_medium), '')   meio,
           nullif(trim(s.utm_campaign), '') campanha
      from site_visits s
     where s.visited_at >= ini and s.session_id is not null),
  -- primeiro acesso com UTM de cada aparelho: é o clique que trouxe a pessoa
  atr as (
    select distinct on (m.session_id) m.session_id, m.chave, m.fonte, m.meio, m.campanha, m.visited_at
      from marcadas m where m.chave is not null
     order by m.session_id, m.visited_at asc),
  -- todos os acessos do aparelho no período, não só o marcado
  n as (
    select s.session_id, count(*) acessos from site_visits s
     where s.visited_at >= ini group by s.session_id),
  d as (
    select a.chave, count(*) disp, sum(n.acessos)::bigint acessos,
           max(a.fonte) fonte, max(a.meio) meio, max(a.campanha) campanha,
           min(a.visited_at) primeiro, max(a.visited_at) ultimo
      from atr a left join n on n.session_id = a.session_id
     group by a.chave),
  o as (
    select a.chave, count(*) orc from orcamentos x join atr a on a.session_id = x.visitor_id
     where x.created_at >= ini group by a.chave),
  v as (
    select a.chave, count(*) vis from visitas_comerciais x join atr a on a.session_id = x.visitor_id
     where x.created_at >= ini and x.status is distinct from 'cancelada' group by a.chave),
  -- contrato na agenda ligado ao orçamento daquele aparelho
  f as (
    select a.chave, count(*) fechados, sum(coalesce(ag.valor_locacao, 0)) valor
      from agenda ag
      join orcamentos x on x.id = ag.orc_id
      join atr a on a.session_id = x.visitor_id
     where ag.deleted_at is null and ag.created_at >= ini
     group by a.chave),
  -- clique-para-WhatsApp: a Meta manda o ad.id no referral da primeira mensagem
  w as (
    select m.referral->>'source_id' chave,
           count(distinct regexp_replace(m.telefone, '\D', '', 'g')) wpp
      from wpp_mensagens m
     where m.direcao = 'recebida' and m.created_at >= ini and m.referral->>'source_id' is not null
     group by 1),
  -- gasto só existe para chave numérica = ad.id
  g as (
    select i.ad_id chave, max(i.ad_nome) ad_nome, max(i.campaign_nome) campanha,
           sum(i.gasto) gasto, sum(i.impressoes)::bigint impressoes, sum(i.cliques_link)::bigint cliques
      from ads_insights i where i.dia >= ini::date group by i.ad_id),
  ids as (select d.chave from d union select w.chave from w union select g.chave from g)
  select i.chave,
         coalesce(d.fonte, case when g.chave is not null then 'meta' end),
         coalesce(d.meio,  case when g.chave is not null then 'paid' end),
         coalesce(d.campanha, g.campanha),
         g.ad_nome,
         coalesce(g.gasto, 0), coalesce(g.impressoes, 0), coalesce(g.cliques, 0),
         coalesce(d.disp, 0), coalesce(d.acessos, 0), coalesce(o.orc, 0), coalesce(v.vis, 0), coalesce(w.wpp, 0),
         coalesce(f.fechados, 0),
         case when papel = 'admin' then coalesce(f.valor, 0) end,
         d.primeiro, d.ultimo
    from ids i
    left join d on d.chave = i.chave
    left join o on o.chave = i.chave
    left join v on v.chave = i.chave
    left join f on f.chave = i.chave
    left join w on w.chave = i.chave
    left join g on g.chave = i.chave
   order by coalesce(f.fechados, 0) desc, coalesce(o.orc, 0) desc, coalesce(d.disp, 0) desc;
end $$;

revoke all on function public.relatorio_criativos(int) from public, anon;
grant execute on function public.relatorio_criativos(int) to authenticated;
