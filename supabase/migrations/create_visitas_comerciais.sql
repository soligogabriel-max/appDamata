-- Horários disponíveis para visita comercial (criados pelo admin)
CREATE TABLE IF NOT EXISTS slots_visita (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data       date NOT NULL,
  hora       time NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(data, hora)
);

-- Visitas agendadas (clientes ou admin)
CREATE TABLE IF NOT EXISTS visitas_comerciais (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id    uuid REFERENCES slots_visita(id) ON DELETE SET NULL,
  orc_id     uuid,           -- FK lógica para orcamentos.id
  visitor_id text,           -- dmv_sid do localStorage (rastreamento)
  nome       text NOT NULL,
  whatsapp   text,
  email      text,
  status     text NOT NULL DEFAULT 'agendada',  -- agendada | realizada | cancelada | nao_compareceu
  obs        text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE slots_visita      ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitas_comerciais ENABLE ROW LEVEL SECURITY;

-- Anon pode ver slots (para o widget de agendamento no site)
DROP POLICY IF EXISTS "anon_read_slots" ON slots_visita;
CREATE POLICY "anon_read_slots" ON slots_visita FOR SELECT TO anon USING (true);

-- Staff gerencia slots
DROP POLICY IF EXISTS "staff_all_slots" ON slots_visita;
CREATE POLICY "staff_all_slots" ON slots_visita FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon pode inserir visita (cliente agendando após orçamento)
DROP POLICY IF EXISTS "anon_insert_visita_comercial" ON visitas_comerciais;
CREATE POLICY "anon_insert_visita_comercial" ON visitas_comerciais FOR INSERT TO anon WITH CHECK (true);

-- Staff lê e gerencia todas as visitas
DROP POLICY IF EXISTS "staff_all_visita_comercial" ON visitas_comerciais;
CREATE POLICY "staff_all_visita_comercial" ON visitas_comerciais FOR ALL TO authenticated USING (true) WITH CHECK (true);
