-- Funil de vendas: do acesso ao site até o contrato fechado.
--
-- A última etapa conta EVENTO CRIADO NA AGENDA, não o campo desfecho da
-- visita: desfecho depende de marcação manual e vive vazio. Não há vínculo
-- entre agenda e orçamento/visita no banco, o que reforça o funil por
-- contagem de etapa em vez de subconjunto estrito.
--
-- Agregado no banco porque a primeira etapa sozinha passa de 11 mil sessões em
-- 90 dias — trazer linha crua para somar seis números não se paga.
--
-- Cada etapa conta quem CHEGOU nela no período; não é subconjunto estrito da
-- anterior. Motivo: 496 dos 498 orçamentos têm o identificador do navegador,
-- mas só 18 das 25 visitas têm — as outras foram marcadas pela equipe no
-- WhatsApp ou no telefone. Num funil estrito elas sumiriam, e visita marcada
-- por telefone é resultado real. O recorte é sempre por created_at: quando a
-- pessoa entrou naquela etapa, não quando a visita acontece.

create or replace function public.funil_vendas(p_dias int default 90)
returns table(
  acessos bigint, orcamentos bigint, visitas_marcadas bigint,
  visitas_realizadas bigint, em_jogo bigint, fechou_contrato bigint,
  contrato_assinado bigint, fechou_do_site bigint
)
language plpgsql stable security definer set search_path = public as $$
declare ini timestamptz;
begin
  -- 'trafego' entra junto: o funil é contagem, não tem dado de cliente.
  if coalesce(get_my_role(), '') not in ('admin', 'equipe', 'trafego') then
    raise exception 'sem permissão para o funil' using errcode = '42501';
  end if;
  ini := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 365)));

  return query
  with
  -- Pessoa, não linha: o mesmo casal simula várias vezes (498 orçamentos para
  -- 266 pessoas em 90 dias). Mesma chave do relatório de anúncios.
  orc as (
    select distinct case
             when length(regexp_replace(coalesce(o.whatsapp, ''), '\D', '', 'g')) >= 10
               then 'w:' || right(regexp_replace(coalesce(o.whatsapp, ''), '\D', '', 'g'), 11)
             when o.visitor_id is not null then 'v:' || o.visitor_id
             else 'i:' || o.id::text
           end pessoa
      from orcamentos o where o.created_at >= ini),
  vis as (
    select v.status, v.desfecho, v.feedback
      from visitas_comerciais v where v.created_at >= ini)
  select
    (select count(distinct s.session_id) from site_visits s where s.visited_at >= ini),
    (select count(*) from orc),
    (select count(*) from vis),
    (select count(*) from vis where status in ('visitado_alta','visitado_baixa','realizada')),
    -- Ainda em jogo: visitou e não foi descartado. Fechou outro espaço, disse
    -- que não tem interesse e não responde contam como descarte.
    (select count(*) from vis
      where status in ('visitado_alta','visitado_baixa','realizada')
        and coalesce(desfecho, '') not in ('fechou_outro', 'nao_responde')
        and coalesce(feedback, '') <> 'sem_interesse'),
    -- Fechou contrato = evento novo na agenda. A primeira versão lia o campo
    -- desfecho da visita e dava sempre zero: ele depende de alguém marcar à
    -- mão e está preenchido em 3 de 25 visitas (todas como "fechou outro").
    -- Evento na agenda não depende de ninguém lembrar — a data só é bloqueada
    -- quando o negócio foi ganho.
    (select count(*) from agenda a
      where a.deleted_at is null and a.created_at >= ini),
    (select count(*) from agenda a
      where a.deleted_at is null and a.created_at >= ini
        and a.assinatura_status = 'assinado'),
    -- Quantos desses vieram de um orçamento do site: agenda.orc_id, gravado no
    -- "Efetivar orçamento". Nulo = entrou por indicação ou telefone.
    (select count(*) from agenda a
      where a.deleted_at is null and a.created_at >= ini and a.orc_id is not null);
end $$;

-- security definer: contar orçamento não exige poder ler nome, WhatsApp e
-- valor de cliente — é o que deixa o papel 'trafego' ver o funil.
revoke all on function public.funil_vendas(int) from public, anon;
grant execute on function public.funil_vendas(int) to authenticated;
