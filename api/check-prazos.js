const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';
const ADMIN_EMAIL = 'andrehespanhol@andrehespanhol.com';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Proteção: apenas Vercel Cron (header automático) ou chamada com CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  const providedSecret = req.query?.secret || (req.body?.secret);
  const isCronRequest = authHeader === `Bearer ${cronSecret}`;
  const isManualWithSecret = cronSecret && providedSecret === cronSecret;
  if (cronSecret && !isCronRequest && !isManualWithSecret) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!serviceRoleKey || !resendKey) {
    return res.status(500).json({ error: 'Variáveis de ambiente ausentes' });
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  // Busca compromissos futuros com alerta configurado
  const agendaRes = await fetch(
    `${SB_URL}/rest/v1/agenda?select=*,casos(natureza,numero_cnj,cliente:cliente_id(nome))&data_hora=gte.${hoje.toISOString()}&alertar_dias_antes=not.is.null&alerta_enviado=not.is.true&order=data_hora.asc`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      }
    }
  );

  const compromissos = await agendaRes.json();
  if (!Array.isArray(compromissos)) {
    return res.status(500).json({ error: 'Erro ao buscar agenda', detail: compromissos });
  }

  const tipoLabel = { audiencia: 'Audiência', prazo: 'Prazo', julgamento: 'Julgamento', reuniao: 'Reunião', lembrete: 'Lembrete' };
  const enviados = [];

  for (const c of compromissos) {
    const dataEvento = new Date(c.data_hora);
    dataEvento.setHours(0, 0, 0, 0);
    const diasRestantes = Math.round((dataEvento - hoje) / 86400000);
    const alertarEm = Number(c.alertar_dias_antes);

    if (diasRestantes !== alertarEm) continue; // só dispara no dia exato

    const tipo = tipoLabel[c.tipo] || c.tipo;
    const titulo = c.titulo || tipo;
    const cliente = c.casos?.cliente?.nome || '';
    const cnj = c.casos?.numero_cnj || '';
    const dataFmt = dataEvento.toLocaleDateString('pt-BR');
    const horaFmt = new Date(c.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const assunto = `⏰ Prazo em ${alertarEm} dia(s): ${titulo}`;
    const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#333">
  <div style="background:#1a2b4a;padding:24px 32px;border-radius:8px 8px 0 0;text-align:center">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:2px">HESPANHOL</div>
    <div style="color:#8aa8d4;font-size:11px;letter-spacing:3px;margin-top:2px">ADVOGADOS</div>
  </div>
  <div style="padding:28px 32px;background:#fff;border:1px solid #eee;border-top:none">
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin-bottom:20px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">⏰</div>
      <div style="font-size:16px;font-weight:700;color:#856404">Prazo em <span style="font-size:22px">${alertarEm}</span> dia(s)</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:8px 0;color:#666;width:40%">Tipo</td><td style="padding:8px 0;font-weight:600">${tipo}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Título</td><td style="padding:8px 0;font-weight:600">${titulo}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;font-weight:600">${dataFmt} às ${horaFmt}</td></tr>
      ${cliente ? `<tr><td style="padding:8px 0;color:#666">Cliente</td><td style="padding:8px 0">${cliente}</td></tr>` : ''}
      ${cnj ? `<tr><td style="padding:8px 0;color:#666">Nº CNJ</td><td style="padding:8px 0;font-family:monospace;font-size:12px">${cnj}</td></tr>` : ''}
      ${c.local ? `<tr><td style="padding:8px 0;color:#666">Local</td><td style="padding:8px 0">${c.local}</td></tr>` : ''}
      ${c.observacoes ? `<tr><td style="padding:8px 0;color:#666">Obs.</td><td style="padding:8px 0;font-size:13px;color:#555">${c.observacoes}</td></tr>` : ''}
    </table>
    <div style="margin-top:20px;text-align:center">
      <a href="https://hespanhol-sistema.vercel.app" style="background:#1a2b4a;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px">Abrir o Sistema</a>
    </div>
  </div>
</div>`;

    // Destinatários: admin + quem criou (se diferente)
    const destinatarios = [ADMIN_EMAIL];
    if (c.criado_por_email && c.criado_por_email !== ADMIN_EMAIL) {
      destinatarios.push(c.criado_por_email);
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Hespanhol Advogados <andrehespanhol@andrehespanhol.com>',
        to: destinatarios,
        subject: assunto,
        html,
      })
    });

    if (emailRes.ok) {
      // Marca alerta como enviado
      await fetch(`${SB_URL}/rest/v1/agenda?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ alerta_enviado: true })
      });
      enviados.push({ id: c.id, titulo, diasRestantes, destinatarios });
    }
  }

  return res.status(200).json({ ok: true, verificados: compromissos.length, enviados });
}
