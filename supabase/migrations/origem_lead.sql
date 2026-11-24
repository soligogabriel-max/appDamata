-- Origem do lead, declarada pela equipe.
--
-- Hoje a origem de um contrato é deduzida (funil_fechados): orçamento do site
-- com utm numérico = anúncio, sem utm = site, sem orçamento = "fora do site".
-- Metade dos contratos desde junho cai em "fora do site" e cliente_json.origem
-- guarda quem preencheu os dados, não de onde a pessoa veio. A pergunta "como
-- conheceu a fazenda" não era registrada em lugar nenhum.
--
-- Duas colunas com a mesma lista fechada:
--   orcamentos.origem_lead — a equipe responde no wizard quando orça para alguém
--   agenda.origem_lead     — obrigatória no gerador de contrato; vem sugerida
--                            do orçamento (declarada ou deduzida do UTM) e a
--                            equipe só confirma
-- Lista fechada para dar para agrupar: texto livre vira "insta", "Instagram",
-- "ig" e nunca soma.

do $$
begin
  alter table agenda add column if not exists origem_lead text;
  alter table orcamentos add column if not exists origem_lead text;
  if not exists (select 1 from pg_constraint where conname = 'agenda_origem_lead_chk') then
    alter table agenda add constraint agenda_origem_lead_chk
      check (origem_lead is null or origem_lead in
        ('instagram','anuncio','google','indicacao','assessoria','cliente_antigo','outro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orcamentos_origem_lead_chk') then
    alter table orcamentos add constraint orcamentos_origem_lead_chk
      check (origem_lead is null or origem_lead in
        ('instagram','anuncio','google','indicacao','assessoria','cliente_antigo','outro'));
  end if;
end $$;

-- Sugestão para o gerador, quando o contrato nasce de um orçamento:
--   1. o que a equipe declarou no orçamento
--   2. senão, o primeiro acesso com UTM do aparelho que orçou
--   3. senão, null — a equipe escolhe
-- security definer porque lê site_visits, que o admin não precisa enxergar
-- inteira para isto. Devolve uma palavra da lista, nada mais.
create or replace function public.sugerir_origem_lead(p_orc_id bigint)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v record;
begin
  if coalesce(get_my_role(), '') not in ('admin', 'equipe') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select o.origem_lead, o.visitor_id into r from orcamentos o where o.id = p_orc_id;
  if not found then return null; end if;
  if r.origem_lead is not null then return r.origem_lead; end if;
  if r.visitor_id is null then return null; end if;

  select s.utm_source, s.utm_medium, s.utm_content, s.referrer into v
    from site_visits s
   where s.session_id = r.visitor_id
     and (s.utm_source is not null or s.utm_content is not null)
   order by s.visited_at asc limit 1;
  if not found then
    -- sem UTM nunca: olha o referrer do primeiro acesso
    select s.referrer into v from site_visits s where s.session_id = r.visitor_id order by s.visited_at asc limit 1;
    if found and v.referrer ~* 'google\.' then return 'google'; end if;
    return null;
  end if;

  if v.utm_content ~ '^[0-9]+$' or lower(coalesce(v.utm_medium, '')) in ('cpc', 'paid') then return 'anuncio'; end if;
  if lower(coalesce(v.utm_source, '')) in ('instagram', 'ig', 'fb', 'facebook', 'meta') then return 'instagram'; end if;
  if lower(coalesce(v.utm_source, '')) ~ 'google' or coalesce(v.referrer, '') ~* 'google\.' then return 'google'; end if;
  return null;
end $$;

revoke all on function public.sugerir_origem_lead(bigint) from public, anon;
grant execute on function public.sugerir_origem_lead(bigint) to authenticated;

-- funil_fechados passa a devolver também a origem declarada. Muda o tipo de
-- retorno, então é drop + create. A classificação deduzida continua, para os
-- contratos de antes do campo existir.
drop function if exists public.funil_fechados(int);
create function public.funil_fechados(p_dias int default 90)
returns table(
  cod text, nome_evento text, fechado_em date, dias_ate_fechar int,
  origem text, ad_nome text, origem_lead text
)
language plpgsql stable security definer set search_path = public as $$
declare ini timestamptz;
begin
  if coalesce(get_my_role(), '') not in ('admin', 'equipe') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  ini := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 365)));

  return query
  with equipe as (
    select o.visitor_id from orcamentos o
     where o.visitor_id is not null
     group by o.visitor_id having count(distinct o.whatsapp) >= 5),
  atr as (
    select distinct on (s.session_id) s.session_id, s.utm_content ad
      from site_visits s where s.utm_content ~ '^[0-9]+$'
     order by s.session_id, s.visited_at asc)
  select a.cod,
         a.nome_evento,
         a.created_at::date,
         (a.created_at::date - o.created_at::date)::int,
         case
           when a.orc_id is null then 'fora do site'
           when e.visitor_id is not null then 'orçamento feito pela equipe'
           when atr.ad is not null then 'anúncio'
           else 'site, sem anúncio'
         end,
         (select max(i.ad_nome) from ads_insights i where i.ad_id = atr.ad),
         a.origem_lead
    from agenda a
    left join orcamentos o on o.id = a.orc_id
    left join equipe e on e.visitor_id = o.visitor_id
    left join atr on atr.session_id = o.visitor_id
   where a.deleted_at is null and a.created_at >= ini
   order by a.created_at desc;
end $$;

revoke all on function public.funil_fechados(int) from public, anon;
grant execute on function public.funil_fechados(int) to authenticated;
