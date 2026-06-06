const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';
const ADMIN_EMAIL = 'andrehespanhol@andrehespanhol.com';

async function sbGet(path, key) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${key}`, 'apikey': key }
  });
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const cronSecret = process.env.CRON_SECRET;
  if (!serviceRoleKey || !resendKey || !anthropicKey) {
    return res.status(500).json({ error: 'Variáveis de ambiente ausentes' });
  }

  const force = req.query?.force === 'true' || req.body?.force === true;

  // Verifica autenticação: cron automático OU admin logado (force/teste) OU CRON_SECRET
  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${cronSecret}`;
  const isForceWithSecret = force && cronSecret && req.body?.secret === cronSecret;

  if (!isCron && !isForceWithSecret) {
    // Permite chamada autenticada de admin para testes
    if (force && serviceRoleKey) {
      const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
        headers: { 'Authorization': authHeader, 'apikey': serviceRoleKey }
      });
      if (!userRes.ok) return res.status(401).json({ error: 'Não autorizado.' });
      const userData = await userRes.json();
      const ur = await fetch(`${SB_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(userData.email)}&select=perfil`, {
        headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'apikey': serviceRoleKey }
      });
      const us = await ur.json();
      if (!Array.isArray(us) || us[0]?.perfil !== 'admin') return res.status(403).json({ error: 'Apenas admin.' });
    } else if (cronSecret) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
  }

  // Verifica se está ativo (a menos que seja force/teste)
  if (!force) {
    const cfg = await sbGet('configuracoes?chave=eq.resumo_semanal_ativo&select=valor', serviceRoleKey);
    const ativo = Array.isArray(cfg) && cfg[0]?.valor === 'true';
    if (!ativo) return res.status(200).json({ ok: true, skipped: true, reason: 'Resumo semanal desativado.' });
  }

  const hoje = new Date();
  const ha7 = new Date(hoje.getTime() - 7 * 86400000);
  const em7 = new Date(hoje.getTime() + 7 * 86400000);

  // Busca clientes com e-mail e casos ativos
  const clientes = await sbGet('clientes?email=not.is.null&select=id,nome,email', serviceRoleKey);
  if (!Array.isArray(clientes) || clientes.length === 0) {
    return res.status(200).json({ ok: true, enviados: 0, motivo: 'Nenhum cliente com e-mail.' });
  }

  let enviados = 0;

  for (const cliente of clientes) {
    // Busca casos ativos do cliente
    const casos = await sbGet(`casos?cliente_id=eq.${cliente.id}&status=eq.ativo&select=id,natureza,tipo_acao,numero_cnj`, serviceRoleKey);
    if (!Array.isArray(casos) || casos.length === 0) continue;

    const casoIds = casos.map(c => c.id);

    // Andamentos da última semana
    const andsPromises = casoIds.map(cid =>
      sbGet(`andamentos?caso_id=eq.${cid}&data_andamento=gte.${ha7.toISOString().slice(0,10)}&order=data_andamento.desc&select=descricao,data_andamento,caso_id`, serviceRoleKey)
    );
    const andsArrays = await Promise.all(andsPromises);
    const ands = andsArrays.flat().filter(Array.isArray(andsArrays[0]) ? a => a : () => true);
    const andsFlat = [].concat(...andsArrays.filter(Array.isArray));

    // Compromissos próximos 7 dias
    const agendaPromises = casoIds.map(cid =>
      sbGet(`agenda?caso_id=eq.${cid}&data_hora=gte.${hoje.toISOString()}&data_hora=lte.${em7.toISOString()}&order=data_hora.asc&select=titulo,tipo,data_hora,local`, serviceRoleKey)
    );
    const agendaArrays = await Promise.all(agendaPromises);
    const agendaFlat = [].concat(...agendaArrays.filter(Array.isArray));

    if (andsFlat.length === 0 && agendaFlat.length === 0) continue; // Nada para reportar

    // Gera resumo via Claude
    const contexto = `Cliente: ${cliente.nome}\nProcessos: ${casos.map(c => c.natureza || c.tipo_acao || 'Processo').join(', ')}\n\nAndamentos desta semana:\n${andsFlat.map(a => `- ${a.data_andamento}: ${a.descricao}`).join('\n') || '(nenhum)'}\n\nCompromissos próximos:\n${agendaFlat.map(a => `- ${new Date(a.data_hora).toLocaleDateString('pt-BR')}: ${a.titulo || a.tipo}`).join('\n') || '(nenhum)'}`;

    let resumoTexto = '';
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251014',
          max_tokens: 400,
          system: 'Você é o assistente do escritório Hespanhol Advogados. Escreva um resumo semanal CURTO e AMIGÁVEL para o cliente sobre o andamento dos seus processos. Use linguagem simples, sem termos jurídicos. Máximo 4 frases. Comece com "Esta semana," ou "Na última semana,". Não use markdown.',
          messages: [{ role: 'user', content: contexto }]
        })
      });
      const aiData = await aiRes.json();
      resumoTexto = aiData?.content?.[0]?.text || '';
    } catch (e) {
      resumoTexto = andsFlat.length > 0
        ? `Esta semana houve ${andsFlat.length} andamento(s) nos seus processos.`
        : `Não há novidades processuais esta semana.`;
    }

    const nomePrimeiro = cliente.nome.split(' ')[0];
    const agendaHTML = agendaFlat.length > 0
      ? `<div style="margin-top:16px;padding:12px;background:#f0f4fa;border-radius:6px"><div style="font-size:12px;font-weight:700;color:#1a2b4a;margin-bottom:8px">📅 PRÓXIMOS COMPROMISSOS</div>${agendaFlat.map(a => `<div style="font-size:13px;color:#444;padding:3px 0">• ${new Date(a.data_hora).toLocaleDateString('pt-BR')} — ${a.titulo || a.tipo}${a.local ? ' (' + a.local + ')' : ''}</div>`).join('')}</div>`
      : '';

    const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#333;background:#fff">
  <div style="background:#1a2b4a;padding:24px 32px;border-radius:8px 8px 0 0;text-align:center">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:2px">HESPANHOL</div>
    <div style="color:#8aa8d4;font-size:11px;letter-spacing:3px;margin-top:2px">ADVOGADOS</div>
    <div style="color:#8aa8d4;font-size:12px;margin-top:8px">Resumo Semanal — ${hoje.toLocaleDateString('pt-BR')}</div>
  </div>
  <div style="padding:28px 32px;border:1px solid #eee;border-top:none">
    <p style="font-size:15px;margin:0 0 16px">Olá, <strong>${nomePrimeiro}</strong>!</p>
    <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 16px">${resumoTexto}</p>
    ${agendaHTML}
    <div style="margin-top:24px;text-align:center">
      <a href="https://hespanhol-sistema.vercel.app" style="background:#1a2b4a;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px">Acessar minha área</a>
    </div>
  </div>
</div>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Hespanhol Advogados <andrehespanhol@andrehespanhol.com>',
        to: [cliente.email],
        subject: `Resumo semanal dos seus processos — ${hoje.toLocaleDateString('pt-BR')}`,
        html
      })
    });

    if (emailRes.ok) enviados++;
  }

  return res.status(200).json({ ok: true, enviados, clientes_verificados: clientes.length });
}
