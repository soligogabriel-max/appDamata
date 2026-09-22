-- Feed iCalendar da ocupação da agenda, para o Airbnb importar.
--
-- O bucket é PÚBLICO de propósito: o Airbnb busca a URL sem autenticação
-- nenhuma. Por isso o agenda-ical não escreve nome de cliente nem tipo de
-- evento no arquivo — só "Ocupado" e as datas.
--
-- O objeto é sempre o mesmo (damata.ics), sobrescrito a cada regeração, e a
-- URL termina em .ics porque o Airbnb recusa URL com outra extensão.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ical',
  'ical',
  true,
  1048576, -- 1 MB, muito acima do que um feed de agenda ocupa
  ARRAY['text/calendar']
)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Leitura anônima só deste bucket. A escrita fica com a service role, que
-- ignora RLS — o agenda-ical é quem grava.
DROP POLICY IF EXISTS "ical_public_read" ON storage.objects;
CREATE POLICY "ical_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'ical');

-- ── Segredo do cron ──────────────────────────────────────────────────
-- Mesmo desenho do sync-meta-ads: o segredo vive no Vault, o job o lê na hora
-- do disparo e a function confere por RPC. Assim o texto do job não carrega
-- chave nenhuma e a function nunca precisa saber o valor.
select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'agenda_ical', 'Segredo do cron que regenera o feed iCal do Airbnb')
where not exists (select 1 from vault.secrets where name = 'agenda_ical');

create or replace function public.agenda_ical_auth(p_token text)
returns boolean language sql stable security definer
set search_path = public, vault as $f$
  select p_token is not null
     and length(p_token) > 20
     and exists (
       select 1 from vault.decrypted_secrets v
        where v.name = 'agenda_ical' and v.decrypted_secret = p_token)
$f$;

revoke all on function public.agenda_ical_auth(text) from public, anon, authenticated;
grant execute on function public.agenda_ical_auth(text) to service_role;

-- ── Regeração periódica ──────────────────────────────────────────────
-- O admin já regenera o feed a cada gravação na agenda; este cron é a rede de
-- segurança para o que escapar (escrita fora do app, aba fechada no meio da
-- requisição). A cada 3 horas acompanha o ritmo com que o Airbnb lê o feed.
select cron.unschedule('agenda-ical-refresh')
 where exists (select 1 from cron.job where jobname = 'agenda-ical-refresh');

select cron.schedule('agenda-ical-refresh', '0 */3 * * *', $job$
  select net.http_post(
    url     := 'https://wwnndsprpofmgbklqdgg.supabase.co/functions/v1/agenda-ical',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'agenda_ical' limit 1)),
    body    := '{}'::jsonb)
$job$);
