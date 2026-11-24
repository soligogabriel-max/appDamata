-- Follow-up automático de orçamento: convite para visita, um dia depois.
--
-- Por que existe: nos últimos 180 dias, 69 pessoas vindas de anúncio fizeram
-- orçamento e nenhuma marcou visita, contra 12 em 114 vindas da bio. A equipe
-- abordou 39% dos leads de anúncio e 50% dos da bio — e quem é abordado
-- responde na mesma taxa nos dois grupos. O que falta é o primeiro toque, para
-- todo mundo. Esta função escolhe quem recebe; a Edge Function
-- followup-orcamento manda o template e grava em wpp_mensagens.
--
-- Fica no banco (e não no TypeScript) porque a lista de exclusões é um join
-- em cinco tabelas, e assim dá para rodar a seleção de hoje pela Management
-- API e ver quem sairia, sem mandar nada.

-- ── Quem recebe ───────────────────────────────────────────────────────────
-- Orçamentos criados entre p_max_h e p_min_h horas atrás (padrão: ontem e
-- anteontem — o cron é diário, a janela de 48h cobre um dia que falhe), com
-- WhatsApp válido e token, menos:
--   * aparelho da equipe (identificador com orçamentos de 5+ clientes
--     diferentes — mesmo critério de funil_fechados): a pessoa não chegou
--     pelo site, alguém da casa montou o orçamento para ela
--   * quem já marcou visita (pelo telefone ou pelo aparelho) ou já tem
--     contrato na agenda
--   * quem já trocou mensagem com a equipe nos últimos 14 dias, em qualquer
--     direção: a conversa já existe, mensagem automática no meio atrapalha
--   * quem já recebeu este convite alguma vez, ou respondeu SAIR
--   * quem chegou pelo link 'atendimento' (utm_content que a equipe manda à
--     mão pelo WhatsApp): a conversa já existe no celular da equipe, fora da
--     Cloud API, então o filtro de mensagens recentes não a enxerga
--   * uma mensagem por telefone: vale o orçamento mais recente
-- Chave de telefone: últimos 8 dígitos. É mais frouxo que o número inteiro
-- (ignora DDD e o nono dígito) e por isso exclui mais — aqui errar para o
-- lado de não mandar é o lado certo.
-- Desligar sem deploy: insert into app_config(chave, valor)
--   values ('followup_orcamento', '{"ativo": false}').

create or replace function public.followup_orcamento_candidatos(
  p_min_h int default 24, p_max_h int default 72, p_limite int default 40)
returns table(
  id bigint, token uuid, primeiro_nome text, telefone text, criado_em timestamptz,
  tipo_evento text, valor_total numeric, origem text)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select (valor->>'ativo')::boolean from app_config where chave = 'followup_orcamento'), true) ativo),
  equipe as (
    select o.visitor_id from orcamentos o
     where o.visitor_id is not null
     group by o.visitor_id having count(distinct o.whatsapp) >= 5),
  base as (
    select o.id, o.token, o.visitor_id, o.created_at, o.tipo_evento, o.valor_total,
           coalesce(nullif(trim(o.nome_contratante), ''), nullif(trim(o.nome_noiva), ''), nullif(trim(o.nome_noivo), '')) nome,
           regexp_replace(coalesce(o.whatsapp, ''), '\D', '', 'g') dig
      from orcamentos o
     where o.created_at >= now() - make_interval(hours => greatest(p_max_h, p_min_h + 1))
       and o.created_at <  now() - make_interval(hours => greatest(p_min_h, 0))
       and o.token is not null
       and (select ativo from cfg)),
  validos as (
    select b.*,
           case when b.dig like '55%' and length(b.dig) >= 12 then '+' || b.dig
                else '+55' || b.dig end telefone,
           right(b.dig, 8) chave
      from base b
     where length(b.dig) between 10 and 13
       and not exists (select 1 from equipe e where e.visitor_id = b.visitor_id)),
  um_por_telefone as (
    select distinct on (v.chave) v.* from validos v
     order by v.chave, v.created_at desc),
  atr as (
    select distinct on (s.session_id) s.session_id,
           coalesce(nullif(trim(s.utm_content), ''), nullif(trim(s.utm_campaign), ''), nullif(trim(s.utm_source), '')) chave
      from site_visits s
     where s.visited_at >= now() - interval '180 days'
       and coalesce(nullif(trim(s.utm_content), ''), nullif(trim(s.utm_campaign), ''), nullif(trim(s.utm_source), '')) is not null
     order by s.session_id, s.visited_at asc)
  select u.id, u.token,
         coalesce(split_part(u.nome, ' ', 1), ''),
         u.telefone, u.created_at, u.tipo_evento, u.valor_total,
         a.chave
    from um_por_telefone u
    left join atr a on a.session_id = u.visitor_id
   where a.chave is distinct from 'atendimento'
     and not exists (select 1 from visitas_comerciais v
                      where v.status is distinct from 'cancelada'
                        and (right(regexp_replace(coalesce(v.whatsapp, ''), '\D', '', 'g'), 8) = u.chave
                             or (v.visitor_id is not null and v.visitor_id = u.visitor_id)))
     and not exists (select 1 from agenda g
                      where g.deleted_at is null
                        and right(regexp_replace(coalesce(g.cliente_json->>'whatsapp', ''), '\D', '', 'g'), 8) = u.chave)
     and not exists (select 1 from wpp_mensagens m
                      where right(regexp_replace(m.telefone, '\D', '', 'g'), 8) = u.chave
                        and (m.created_at >= now() - interval '14 days'
                             or m.mensagem like '[Follow-up orçamento]%'
                             or (m.direcao = 'recebida' and trim(m.mensagem) ilike 'sair')))
   order by u.created_at asc
   limit greatest(1, least(coalesce(p_limite, 40), 200));
$$;

revoke all on function public.followup_orcamento_candidatos(int, int, int) from public, anon, authenticated;
grant execute on function public.followup_orcamento_candidatos(int, int, int) to service_role;

-- ── Autenticação do cron ──────────────────────────────────────────────────
-- Mesmo desenho de sync-meta-ads: o segredo nasce no Vault, o job lê de lá na
-- hora do disparo e a função confere por RPC. Nem o job nem o repositório
-- carregam o valor (o job de followup-visita-comercial carrega a service role
-- em texto puro no comando — não repetir isso).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'followup_orcamento') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'followup_orcamento');
  end if;
end $$;

create or replace function public.followup_orcamento_auth(p_token text)
returns boolean language sql stable security definer
set search_path = public, vault as $f$
  select p_token is not null
     and length(p_token) > 20
     and exists (
       select 1 from vault.decrypted_secrets v
        where v.name = 'followup_orcamento' and v.decrypted_secret = p_token)
$f$;

revoke all on function public.followup_orcamento_auth(text) from public, anon, authenticated;
grant execute on function public.followup_orcamento_auth(text) to service_role;

-- Job diário, 11h30 de Brasília: depois do sync da Meta (8h) e fora da hora
-- cheia, em que os outros jobs disparam juntos.
select cron.unschedule('followup-orcamento-diario')
 where exists (select 1 from cron.job where jobname = 'followup-orcamento-diario');
select cron.schedule('followup-orcamento-diario', '30 14 * * *', $job$
  select net.http_post(
    url     := 'https://wwnndsprpofmgbklqdgg.supabase.co/functions/v1/followup-orcamento',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'followup_orcamento' limit 1)),
    body    := '{}'::jsonb,
    -- padrão do pg_net é 5 s; cadastrar o template já estourou isso, e um
    -- dia com 40 envios leva mais
    timeout_milliseconds := 60000)
$job$);
