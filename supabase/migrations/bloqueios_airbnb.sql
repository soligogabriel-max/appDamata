-- Datas que o Airbnb reporta como indisponíveis no anúncio, importadas do feed
-- de exportação do próprio Airbnb. É o sentido inverso do agenda-ical: lá a
-- agenda do Damata bloqueia o anúncio, aqui o anúncio bloqueia o Damata.
--
-- O que entra aqui NÃO vira evento da agenda de propósito: reserva de Airbnb
-- não tem contrato, não gera conta a receber e não deve contar como ocupação
-- nos relatórios. Serve para dois usos: avisar quem for salvar um evento em
-- cima, e sumir com os horários de visita comercial da data.

CREATE TABLE IF NOT EXISTS bloqueios_airbnb (
  uid           text PRIMARY KEY,          -- UID do VEVENT, chave natural do feed
  data_ini      date NOT NULL,
  data_fim      date NOT NULL,             -- inclusivo (o DTEND do iCal é exclusivo)
  titulo        text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bloqueios_airbnb_intervalo_chk CHECK (data_fim >= data_ini)
);

CREATE INDEX IF NOT EXISTS bloqueios_airbnb_periodo_idx
  ON bloqueios_airbnb (data_ini, data_fim);

ALTER TABLE bloqueios_airbnb ENABLE ROW LEVEL SECURITY;

-- Leitura liberada inclusive para anon: a tela pública de agendamento de visita
-- precisa esconder os horários dessas datas. São só datas — a mesma informação
-- que qualquer pessoa vê no calendário do anúncio. Nada de hóspede aqui.
DROP POLICY IF EXISTS "bloqueios_airbnb_leitura" ON bloqueios_airbnb;
CREATE POLICY "bloqueios_airbnb_leitura"
  ON bloqueios_airbnb FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON bloqueios_airbnb TO anon, authenticated;
-- Escrita é só da service role (o airbnb-ical-import), que ignora RLS.

-- ── Importação periódica ─────────────────────────────────────────────
-- Mesmo ritmo do feed de saída, deslocado 20 min para os dois jobs não
-- dividirem a mesma janela. Reaproveita o segredo e a RPC do agenda_ical: é a
-- mesma integração e o mesmo nível de confiança.
select cron.unschedule('airbnb-ical-import')
 where exists (select 1 from cron.job where jobname = 'airbnb-ical-import');

select cron.schedule('airbnb-ical-import', '20 */3 * * *', $job$
  select net.http_post(
    url     := 'https://wwnndsprpofmgbklqdgg.supabase.co/functions/v1/airbnb-ical-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'agenda_ical' limit 1)),
    body    := '{}'::jsonb)
$job$);
