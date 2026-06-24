# appDamata — instruções para Claude

## Início de cada sessão

Trabalhar sempre direto no `main`. Sincronizar e ativar o hook de versão:

```bash
git fetch origin
git checkout main
git pull origin main
git config core.hooksPath .githooks
```

O `git config core.hooksPath .githooks` ativa o hook pre-commit que bumpa a versão automaticamente — **rodar sempre no início**, pois `.git/hooks/` não é versionado.

## Deploy

**Toda mudança vai direto ao `main` e entra em produção imediatamente.**
Não usar branches intermediários nem PRs — o usuário testa em produção.

Fluxo após cada alteração:
```bash
git add index.html gerador-contrato-damata.html  # (ou outros arquivos alterados)
git commit -m "fix/feat: descrição"
git push origin main
```

## Arquitetura

App de página única. Toda a lógica está em dois arquivos:
- `index.html` — app principal (admin): CSS, JS, templates base64, integração Supabase
- `gerador-contrato-damata.html` — gerador de contratos (iframe dentro do index)

### Templates embutidos (base64)
- `CLIENT_B64` em `index.html` — template do contrato enviado ao cliente (casamento/evento)
- `HOSPEDAGEM_B64` em `index.html` e no gerador — template do contrato de hospedagem

Para editar um template: decodificar com Python, editar o HTML, re-codificar, substituir a variável.

```python
import base64
# decodificar
html = base64.b64decode(B64_VALUE).decode('utf-8')
# re-codificar
b64 = base64.b64encode(html.encode('utf-8')).decode('ascii')
```

## Backend: Supabase (PostgREST)

- Apenas anon key disponível no código — DDL requer Dashboard > SQL Editor
- Tabela principal: `agenda` (eventos/contratos)
- Campos relevantes: `cod`, `nome_evento`, `data_evento`, `data_fim`, `tipo_evento`,
  `valor_locacao`, `cin`, `cout`, `status`, `payments_json`, `spaces_json`, `obs`

## Versão na landing page

A versão é bumpa **automaticamente** pelo hook `.githooks/pre-commit` a cada commit — não precisa atualizar manualmente.

Formato: `v{ANO}.{MÊS}.{DIA}{letra}` — a letra distingue múltiplos deploys no mesmo dia.

Se por algum motivo o hook não estiver ativo, rodar:
```bash
git config core.hooksPath .githooks
```

## Edições em massa

Usar Python para edições no `index.html` (arquivo muito grande para o editor direto):

```python
with open('index.html', 'r', encoding='utf-8') as f: c = f.read()
c = c.replace(OLD, NEW, 1)
with open('index.html', 'w', encoding='utf-8') as f: f.write(c)
```
