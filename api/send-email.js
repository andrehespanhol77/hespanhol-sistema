const ASSINATURA_HTML = `
<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e0e0e0;font-family:Arial,sans-serif">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:top;padding-right:20px">
        <!-- Triângulo azul em CSS -->
        <div style="width:0;height:0;border-style:solid;border-width:0 0 80px 55px;border-color:transparent transparent #5b9bd5 transparent"></div>
      </td>
      <td style="vertical-align:middle">
        <div style="font-size:22px;font-weight:900;color:#1a2b4a;letter-spacing:1px;line-height:1.1">HESPANHOL</div>
        <div style="font-size:13px;font-weight:700;color:#1a2b4a;letter-spacing:4px;margin-top:2px">ADVOGADOS</div>
        <div style="margin-top:14px;font-size:13px;color:#444;line-height:1.8">
          061 3045 4972<br>
          SHIS, QI 26, conjunto 14, casa 4<br>
          Lago Sul, Brasília - DF - CEP 71670-140
        </div>
        <div style="margin-top:10px;font-size:13px;font-weight:700;color:#1a2b4a">
          <a href="https://hespanhol.com" style="color:#1a2b4a;text-decoration:none">hespanhol.com</a>
        </div>
      </td>
    </tr>
  </table>
  <div style="margin-top:6px;font-size:11px;color:#888;font-weight:600;letter-spacing:1px">ANDRÉ HESPANHOL</div>
</div>`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, text, html } = req.body || {};

  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Campos obrigatórios: to, subject, text ou html' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY não configurada no servidor' });
  }

  const bodyHtml = html
    ? html + ASSINATURA_HTML
    : `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.7;white-space:pre-wrap">${(text||'').replace(/\n/g,'<br>')}</div>` + ASSINATURA_HTML;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hespanhol Advogados <andrehespanhol@andrehespanhol.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        text: text || '',
        html: bodyHtml,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || data.name || 'Erro ao enviar e-mail' });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
