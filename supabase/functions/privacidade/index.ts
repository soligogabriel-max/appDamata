const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Política de Privacidade — Fazenda Damata</title>
<style>
  body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.7; }
  h1 { color: #4a7c59; border-bottom: 2px solid #4a7c59; padding-bottom: 10px; }
  h2 { color: #4a7c59; margin-top: 32px; }
  a { color: #4a7c59; }
  .updated { color: #888; font-size: 0.9em; }
</style>
</head>
<body>
<h1>Política de Privacidade</h1>
<p class="updated">Última atualização: julho de 2026</p>
<p>A <strong>Fazenda Damata</strong> valoriza a privacidade dos seus clientes e visitantes.</p>
<h2>1. Dados coletados</h2>
<ul>
  <li>Nome e número de WhatsApp (ao fazer orçamento ou agendar visita)</li>
  <li>Informações do evento (data, tipo, número de convidados)</li>
  <li>Dados de navegação anônimos (visitas ao site)</li>
</ul>
<h2>2. Uso dos dados</h2>
<ul>
  <li>Elaborar e enviar orçamentos personalizados</li>
  <li>Confirmar e lembrar agendamentos de visitas</li>
  <li>Enviar informações sobre o evento contratado</li>
</ul>
<h2>3. WhatsApp e comunicações</h2>
<p>Ao fornecer seu número de WhatsApp, você autoriza o recebimento de mensagens relacionadas ao seu orçamento ou agendamento. Responda "PARAR" para sair.</p>
<h2>4. Compartilhamento de dados</h2>
<p>Não vendemos ou compartilhamos seus dados com terceiros, exceto quando exigido por lei.</p>
<h2>5. Seus direitos (LGPD)</h2>
<p>Conforme a Lei 13.709/2018, você pode acessar, corrigir ou excluir seus dados a qualquer momento.</p>
<h2>6. Contato</h2>
<p>📧 contato@fazendadamata.com<br>📱 (19) 99783-0437</p>
</body>
</html>`;

Deno.serve(() => new Response(HTML, {
  headers: { "Content-Type": "text/html; charset=utf-8" }
}));
