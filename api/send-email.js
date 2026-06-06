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
