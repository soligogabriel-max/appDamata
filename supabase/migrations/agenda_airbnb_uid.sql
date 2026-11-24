-- Liga o evento da agenda a reserva do Airbnb que o gerou.
--
-- Sem esta coluna o airbnb-ical-import nao sabe distinguir "evento que eu
-- criei desta reserva" de "evento que ja existia nestas datas". A diferenca
-- importa: a regra de ignorar reserva quando ha evento na agenda, seguida do
-- DELETE do que nao entrou, tiraria da bloqueios_airbnb justamente a reserva
-- cujo evento o import acabou de criar. E a disponibilidade do site sai SO da
-- bloqueios_airbnb (index.html), nao da agenda: a data voltaria a aceitar
-- agendamento de visita com hospede na casa.
--
-- Indice parcial: evento que nao vem do Airbnb fica com NULL, e NULL repetido
-- nao conflita em indice unico.
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS airbnb_uid text;

CREATE UNIQUE INDEX IF NOT EXISTS agenda_airbnb_uid_idx
  ON agenda (airbnb_uid) WHERE airbnb_uid IS NOT NULL;

-- Diaria usada no a receber gerado da reserva. Em app_config para mudar sem
-- deploy; o import cai em 4000 se a chave nao existir.
INSERT INTO app_config (chave, valor) VALUES ('airbnb_diaria', to_jsonb(4000))
  ON CONFLICT (chave) DO NOTHING;
