-- Cria bucket privado para armazenar o certificado e-CNPJ A1 (.pfx) da NFS-e.
-- Apenas o servidor (service role) pode ler/escrever. Anon key sem acesso.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nfse-certs',
  'nfse-certs',
  false,
  5242880, -- 5 MB
  ARRAY['application/x-pkcs12', 'application/octet-stream', 'application/octet']
)
ON CONFLICT (id) DO NOTHING;

-- Sem policies de acesso público — service role tem acesso irrestrito por padrão.
