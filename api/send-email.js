const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';

const ASSINATURA_HTML = `
<div style="font-family:Arial,sans-serif">
  <div style="font-size:20px;font-weight:300;color:#243d62;letter-spacing:2px;margin-top:30px;margin-bottom:32px">ANDRÉ HESPANHOL</div>
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:top;padding-right:28px">
        <div style="width:0;height:0;border-style:solid;border-width:90px 90px 0 0;border-color:#5b9bd5 transparent transparent transparent"></div>
      </td>
      <td style="vertical-align:top;padding-top:0">
        <div style="font-size:26px;font-weight:900;color:#1a2b4a;letter-spacing:1px;line-height:1">HESPANHOL</div>
        <div style="font-size:12px;font-weight:700;color:#1a2b4a;letter-spacing:5px;margin-top:3px">ADVOGADOS</div>
        <div style="margin-top:16px;font-size:13px;color:#444;line-height:1.9">
          SHIS, QI 28, Conjunto 19, casa 2<br>
          Lago Sul, Brasília - DF - CEP 71670-140
        </div>
        <div style="margin-top:10px;font-size:13px;font-weight:700;color:#1a2b4a">
          <a href="https://andrehespanhol.com" style="color:#1a2b4a;text-decoration:none">andrehespanhol.com</a>
        </div>
      </td>
    </tr>
  </table>
</div>`;

async function verificarAuth(req, serviceRoleKey) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceRoleKey }
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!serviceRoleKey || !apiKey) return res.status(500).json({ error: 'Configuração ausente' });

  // Autenticação obrigatória
  const user = await verificarAuth(req, serviceRoleKey);
  if (!user) return res.status(401).json({ error: 'Não autorizado. Faça login novamente.' });

  const { to, subject, text, html } = req.body || {};
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Campos obrigatórios: to, subject, text ou html' });
  }

  // Sanitiza: não aceita HTML externo — apenas text é permitido do frontend
  const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.7;white-space:pre-wrap">${
    String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
  }</div>` + ASSINATURA_HTML;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Hespanhol Advogados <andrehespanhol@andrehespanhol.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        text: text || '',
        html: bodyHtml,
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Erro ao enviar' });
    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
