-- appProspect — Schema
-- Execute no Supabase Dashboard > SQL Editor

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS imoveis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo TEXT UNIQUE NOT NULL,
  nome TEXT,
  endereco TEXT NOT NULL,
  bairro TEXT,
  cidade TEXT DEFAULT 'Mogi Mirim',
  tipo TEXT DEFAULT 'comercial',
  area_m2 NUMERIC,
  valor_aluguel_base NUMERIC,
  status TEXT DEFAULT 'disponivel',
  obs TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  imovel_id UUID REFERENCES imoveis(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  andar TEXT,
  area_m2 NUMERIC,
  valor_aluguel NUMERIC,
  tipo_energia TEXT DEFAULT 'individual',
  tipo_agua TEXT DEFAULT 'compartilhado',
  status TEXT DEFAULT 'disponivel',
  obs TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inquilinos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome TEXT NOT NULL,
  cpf_cnpj TEXT,
  rg_ie TEXT,
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  profissao TEXT,
  obs TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contratos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo TEXT DEFAULT 'sublocacao',
  imovel_id UUID REFERENCES imoveis(id),
  inquilino_id UUID REFERENCES inquilinos(id),
  salas_ids JSONB DEFAULT '[]',
  data_inicio DATE NOT NULL,
  data_fim DATE,
  valor_aluguel NUMERIC NOT NULL,
  dia_vencimento INTEGER NOT NULL DEFAULT 10,
  indice_reajuste TEXT DEFAULT 'IGPM',
  garantia_tipo TEXT DEFAULT 'caucao',
  garantia_valor NUMERIC,
  status TEXT DEFAULT 'ativo',
  obs TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contas_receber (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contrato_id UUID REFERENCES contratos(id),
  imovel_id UUID REFERENCES imoveis(id),
  inquilino_id UUID REFERENCES inquilinos(id),
  descricao TEXT NOT NULL,
  tipo TEXT DEFAULT 'aluguel',
  valor NUMERIC NOT NULL,
  data_vencimento DATE NOT NULL,
  data_recebimento DATE,
  valor_recebido NUMERIC,
  status TEXT DEFAULT 'pendente',
  transacao_id UUID,
  obs TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contas_pagar (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  imovel_id UUID REFERENCES imoveis(id),
  descricao TEXT NOT NULL,
  categoria TEXT DEFAULT 'outros',
  valor NUMERIC NOT NULL,
  data_vencimento DATE NOT NULL,
  data_pagamento DATE,
  valor_pago NUMERIC,
  status TEXT DEFAULT 'pendente',
  recorrente BOOLEAN DEFAULT FALSE,
  transacao_id UUID,
  obs TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  data DATE NOT NULL,
  descricao TEXT,
  valor NUMERIC NOT NULL,
  tipo TEXT,
  status_conciliacao TEXT DEFAULT 'pendente',
  conta_receber_id UUID REFERENCES contas_receber(id),
  conta_pagar_id UUID REFERENCES contas_pagar(id),
  obs TEXT,
  importado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Desabilitar RLS (app usa anon key com acesso total)
ALTER TABLE imoveis DISABLE ROW LEVEL SECURITY;
ALTER TABLE salas DISABLE ROW LEVEL SECURITY;
ALTER TABLE inquilinos DISABLE ROW LEVEL SECURITY;
ALTER TABLE contratos DISABLE ROW LEVEL SECURITY;
ALTER TABLE contas_receber DISABLE ROW LEVEL SECURITY;
ALTER TABLE contas_pagar DISABLE ROW LEVEL SECURITY;
ALTER TABLE transacoes DISABLE ROW LEVEL SECURITY;

GRANT ALL ON imoveis TO anon;
GRANT ALL ON salas TO anon;
GRANT ALL ON inquilinos TO anon;
GRANT ALL ON contratos TO anon;
GRANT ALL ON contas_receber TO anon;
GRANT ALL ON contas_pagar TO anon;
GRANT ALL ON transacoes TO anon;

SELECT 'Schema criado com sucesso!' as resultado;
