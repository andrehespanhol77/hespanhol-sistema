// /api/monitor-processos.js
// Executado diariamente pelo Vercel Cron (07:00 BRT = 10:00 UTC)
// Verifica todos os casos ativos com número CNJ no DataJud,
// salva novos andamentos e envia relatório por e-mail ao admin.

const DATAJUD_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';
// Chave anon (pública) — necessária no header apikey para identificar o projeto
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkbWx4Zmd3bGJyb2lnc2lzanBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NjMxOTIsImV4cCI6MjA5MjMzOTE5Mn0.stw8254uQoJGka6jEx0kXQeGWXn_IOTZcyltM6c5UqA';
// Service role key — bypassa RLS completamente (vem de variável de ambiente)
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const BASE_DATAJUD = 'https://api-publica.datajud.cnj.jus.br';
const APP_URL = 'https://hespanhol-sistema.vercel.app';
const FROM_EMAIL = 'Hespanhol Advogados <andrehespanhol@andrehespanhol.com>';

// ── Mapa tribunal CNJ J.TT → índice DataJud ──────────────────────
const TRIBUNAL_MAP = {
  '1.00':'api_publica_stf','2.00':'api_publica_cnj','3.00':'api_publica_stj',
  '4.01':'api_publica_trf1','4.02':'api_publica_trf2','4.03':'api_publica_trf3',
  '4.04':'api_publica_trf4','4.05':'api_publica_trf5','4.06':'api_publica_trf6',
  '5.00':'api_publica_tst',
  '5.01':'api_publica_trt1','5.02':'api_publica_trt2','5.03':'api_publica_trt3',
  '5.04':'api_publica_trt4','5.05':'api_publica_trt5','5.06':'api_publica_trt6',
  '5.07':'api_publica_trt7','5.08':'api_publica_trt8','5.09':'api_publica_trt9',
  '5.10':'api_publica_trt10','5.11':'api_publica_trt11','5.12':'api_publica_trt12',
  '5.13':'api_publica_trt13','5.14':'api_publica_trt14','5.15':'api_publica_trt15',
  '5.16':'api_publica_trt16','5.17':'api_publica_trt17','5.18':'api_publica_trt18',
  '5.19':'api_publica_trt19','5.20':'api_publica_trt20','5.21':'api_publica_trt21',
  '5.22':'api_publica_trt22','5.23':'api_publica_trt23','5.24':'api_publica_trt24',
  '6.00':'api_publica_tse',
  '6.01':'api_publica_tre-ac','6.02':'api_publica_tre-al','6.03':'api_publica_tre-ap',
  '6.04':'api_publica_tre-am','6.05':'api_publica_tre-ba','6.06':'api_publica_tre-ce',
  '6.07':'api_publica_tre-df','6.08':'api_publica_tre-es','6.09':'api_publica_tre-go',
  '6.10':'api_publica_tre-ma','6.11':'api_publica_tre-mt','6.12':'api_publica_tre-ms',
  '6.13':'api_publica_tre-mg','6.14':'api_publica_tre-pa','6.15':'api_publica_tre-pb',
  '6.16':'api_publica_tre-pr','6.17':'api_publica_tre-pe','6.18':'api_publica_tre-pi',
  '6.19':'api_publica_tre-rj','6.20':'api_publica_tre-rn','6.21':'api_publica_tre-rs',
  '6.22':'api_publica_tre-ro','6.23':'api_publica_tre-rr','6.24':'api_publica_tre-sc',
  '6.25':'api_publica_tre-se','6.26':'api_publica_tre-sp','6.27':'api_publica_tre-to',
  '7.00':'api_publica_stm',
  '8.01':'api_publica_tjac','8.02':'api_publica_tjal','8.03':'api_publica_tjap',
  '8.04':'api_publica_tjam','8.05':'api_publica_tjba','8.06':'api_publica_tjce',
  '8.07':'api_publica_tjdft','8.08':'api_publica_tjes','8.09':'api_publica_tjgo',
  '8.10':'api_publica_tjma','8.11':'api_publica_tjmt','8.12':'api_publica_tjms',
  '8.13':'api_publica_tjmg','8.14':'api_publica_tjpa','8.15':'api_publica_tjpb',
  '8.16':'api_publica_tjpr','8.17':'api_publica_tjpe','8.18':'api_publica_tjpi',
  '8.19':'api_publica_tjrj','8.20':'api_publica_tjrn','8.21':'api_publica_tjrs',
  '8.22':'api_publica_tjro','8.23':'api_publica_tjrr','8.24':'api_publica_tjsc',
  '8.25':'api_publica_tjse','8.26':'api_publica_tjsp','8.27':'api_publica_tjto',
};

function getIndex(numero) {
  const clean = numero.replace(/\s/g, '');
  const m = clean.match(/^\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}$/);
  if (!m) return null;
  return TRIBUNAL_MAP[`${m[1]}.${m[2].padStart(2,'0')}`] || null;
}

function getTribunalUrl(numero) {
  if (!numero) return null;
  const clean = numero.replace(/\s/g,'');
  const m = clean.match(/^\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}$/);
  const digits = clean.replace(/\D/g,'');
  const enc = encodeURIComponent(clean);
  if (!m) return `https://www.google.com/search?q=%22${enc}%22+site:jus.br`;
  const key = `${m[1]}.${m[2]}`;
  const map = {
    '1.00': `https://portal.stf.jus.br/processos/listarPartes.asp?termo=${enc}`,
    '3.00': `https://processo.stj.jus.br/processo/pesquisa/?tipoPesquisa=tipoPesquisaNumeroUnico&termo=${enc}`,
    '4.01': `https://processual.trf1.jus.br/consultaProcessual/processo.php?proc=${digits}`,
    '4.02': `https://consultas.trf2.jus.br/consultas/processo/consultaprocesso.php?NuProcesso=${digits}`,
    '4.04': `https://eproc.trf4.jus.br/eproc2trf4/controlador.php?acao=processo_selecionar&num_processo=${digits}`,
    '5.00': `https://consultaprocessual.tst.jus.br/consultaProcessual/consultaTst.do?consulta=consultar&numeroInt=${digits}`,
    '8.02': `https://www2.tjal.jus.br/cpopg/show.do?processo.numero=${enc}`,
    '8.19': `https://www4.tjrj.jus.br/consultaProcessoWebV2/consultaMov.do?v=2&FLAGNOME=&back=1&tipoConsulta=publica&numProcesso=${enc}`,
    '8.26': `https://esaj.tjsp.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&numeroDigitoAnoUnificado=${enc}&foroNumeroUnificado=0000&dadosConsulta.valorConsultaNuUnificado=${digits}`,
  };
  return map[key] || `https://www.google.com/search?q=%22${enc}%22+site:jus.br`;
}

// ── Supabase REST helper ──────────────────────────────────────────
async function sb(path, options = {}) {
  if (!SB_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel');
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SB_ANON,          // identifica o projeto (chave pública)
      'Authorization': `Bearer ${SB_KEY}`,  // service role bypassa RLS
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase ${r.status}: ${txt}`);
  }
  return r.json();
}

// ── Consulta DataJud para um número CNJ ──────────────────────────
async function consultarDataJud(numero_cnj) {
  const index = getIndex(numero_cnj);
  if (!index) return null;

  const resp = await fetch(`${BASE_DATAJUD}/${index}/_search`, {
    method: 'POST',
    headers: {
      'Authorization': `APIKey ${DATAJUD_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: { term: { numeroProcesso: numero_cnj.replace(/\D/g, '') } },
      _source: ['movimentos'],
      size: 1,
    }),
  });

  if (!resp.ok) return null;
  const text = await resp.text();
  if (!text || !text.trim()) return null;
  let data;
  try { data = JSON.parse(text); } catch(e) { return null; }
  const hits = data?.hits?.hits || [];
  if (!hits.length) return null;

  return (hits[0]._source.movimentos || []).map(function(m) {
    var comps = (m.complementosTabelados || []).map(function(c){ return c.nome||''; }).filter(Boolean);
    var compsLivre = (m.complementos || []).map(function(c){ return c.descricao||''; }).filter(Boolean);
    var orgao = m.orgaoJulgador && m.orgaoJulgador.nome ? m.orgaoJulgador.nome : '';
    var partes = [];
    if (comps.length) partes.push((m.nome||'') + ' — ' + comps.join(', '));
    else partes.push(m.nome || '');
    if (compsLivre.length) partes.push(compsLivre.join(' | '));
    if (orgao) partes.push('[' + orgao + ']');
    return {
      descricao: partes.filter(Boolean).join(' · '),
      data: m.dataHora ? m.dataHora.split('T')[0] : null,
    };
  });
}

// ── Handler principal ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Segurança: se CRON_SECRET configurado, verificar token
  const secret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  // Aceita CRON_SECRET (cron automático) OU JWT de admin (acionamento manual)
  const isCron = secret && auth === `Bearer ${secret}`;
  if (!isCron) {
    const token = auth.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    // Valida JWT via Supabase Auth REST (sem cliente supabase-js)
    const userResp = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${token}` },
    });
    if (!userResp.ok) return res.status(401).json({ error: 'Unauthorized' });
    const userData = await userResp.json();
    const userId = userData?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const perfis = await sb(`usuarios?select=perfil&id=eq.${userId}&limit=1`);
    if (!perfis?.[0] || perfis[0].perfil !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  }

  console.log('Monitor DataJud iniciado:', new Date().toISOString());

  try {
    // 1. Busca todos os casos ativos com número CNJ + nome do cliente
    const casos = await sb(
      'casos?select=id,numero_cnj,natureza,tipo_acao,clientes!casos_cliente_id_fkey(nome)&status=eq.ativo&numero_cnj=not.is.null'
    );

    if (!casos.length) {
      return res.status(200).json({ message: 'Nenhum caso ativo com número CNJ.' });
    }

    console.log(`Verificando ${casos.length} casos no DataJud...`);

    // Data de corte: movimentos dos últimos 30 dias
    // (evita importar todo o histórico no primeiro uso)
    const corte = new Date();
    corte.setDate(corte.getDate() - 30);
    const dataCorte = corte.toISOString().split('T')[0];

    const novidades = [];
    const erros = [];

    for (const caso of casos) {
      try {
        // Rate limiting básico entre requisições
        await new Promise(r => setTimeout(r, 300));

        const movimentos = await consultarDataJud(caso.numero_cnj);
        if (!movimentos || !movimentos.length) continue;

        // Filtra apenas movimentos recentes (últimos 30 dias)
        const recentes = movimentos.filter(m => m.data && m.data >= dataCorte);
        if (!recentes.length) continue;

        // Busca andamentos já importados do DataJud para este caso
        const existentes = await sb(
          `andamentos?select=data_andamento,descricao&caso_id=eq.${caso.id}&fonte=eq.datajud`
        );
        const existSet = new Set(
          (existentes || []).map(a => `${a.data_andamento}|${(a.descricao||'').substring(0,80)}`)
        );

        // Filtra apenas os novos
        const novos = recentes.filter(m => {
          const key = `${m.data}|${(m.descricao||'').substring(0,80)}`;
          return !existSet.has(key);
        });

        if (!novos.length) continue;

        // Salva novos andamentos no Supabase
        await sb('andamentos', {
          method: 'POST',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify(novos.map(m => ({
            caso_id: caso.id,
            descricao: m.descricao,
            data_andamento: m.data || new Date().toISOString().split('T')[0],
            fonte: 'datajud',
          }))),
        });

        novidades.push({ caso, novos });

      } catch (err) {
        console.error('Erro no caso', caso.id, caso.numero_cnj, err.message);
        erros.push({ numero: caso.numero_cnj, erro: err.message });
      }
    }

    const totalNovos = novidades.reduce((s, n) => s + n.novos.length, 0);
    console.log(`Resultado: ${novidades.length} casos com novidade, ${totalNovos} andamentos salvos`);

    // Envia e-mail se houver novidades (ou erros)
    if (novidades.length > 0 || erros.length > 0) {
      await enviarRelatorio(novidades, erros, casos.length, totalNovos);
    }

    return res.status(200).json({
      casos_verificados: casos.length,
      casos_com_novidade: novidades.length,
      total_novos_andamentos: totalNovos,
      erros: erros.length,
    });

  } catch (err) {
    console.error('Erro geral no monitor:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Monta e envia e-mail de relatório ────────────────────────────
async function enviarRelatorio(novidades, erros, totalCasos, totalNovos) {
  // Busca e-mail do admin
  let adminEmail = null;
  try {
    const admins = await sb('usuarios?select=email,nome&perfil=eq.admin&limit=1');
    adminEmail = admins?.[0]?.email;
  } catch(e) {
    console.error('Erro ao buscar admin:', e.message);
  }
  if (!adminEmail) { console.error('E-mail do admin não encontrado'); return; }

  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const subject = `[Hespanhol] ${totalNovos} novo${totalNovos !== 1 ? 's' : ''} andamento${totalNovos !== 1 ? 's' : ''} — ${hoje}`;

  // ── HTML do e-mail ──
  let html = `
<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#333;background:#fff">
  <div style="background:#1a2b4a;padding:22px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Relatório Diário de Andamentos</h1>
    <p style="color:#8aa8d4;margin:5px 0 0;font-size:13px">Hespanhol Advogados — ${hoje}</p>
  </div>
  <div style="background:#eef3fb;padding:14px 32px;border-bottom:2px solid #d0ddf0">
    <p style="margin:0;font-size:14px;color:#1a2b4a">
      <strong>${totalNovos} novo${totalNovos !== 1 ? 's' : ''} andamento${totalNovos !== 1 ? 's' : ''}</strong>
      em <strong>${novidades.length}</strong> processo${novidades.length !== 1 ? 's' : ''}
      <span style="color:#888;font-weight:normal">(${totalCasos} verificados)</span>
    </p>
  </div>
  <div style="padding:24px 32px">`;

  for (const { caso, novos } of novidades) {
    const nomeCaso = caso.natureza || caso.tipo_acao || 'Processo';
    const cliente = caso.clientes?.nome || '';
    const tribunalUrl = getTribunalUrl(caso.numero_cnj);

    html += `
    <div style="margin-bottom:20px;border:1px solid #d8e4f5;border-radius:8px;overflow:hidden">
      <div style="background:#f4f8ff;padding:12px 16px;border-bottom:1px solid #d8e4f5">
        <div style="font-weight:700;font-size:15px;color:#1a2b4a">${nomeCaso}</div>
        ${cliente ? `<div style="font-size:12px;color:#666;margin-top:2px">Cliente: ${cliente}</div>` : ''}
        <div style="font-size:12px;margin-top:4px">
          <span style="color:#4a7fc1;font-family:monospace">${caso.numero_cnj}</span>
          ${tribunalUrl ? `&nbsp;·&nbsp;<a href="${tribunalUrl}" style="color:#4a7fc1;text-decoration:none;font-weight:600">Ver no tribunal →</a>` : ''}
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse">`;

    for (const mov of novos) {
      const dt = mov.data
        ? new Date(mov.data + 'T12:00:00').toLocaleDateString('pt-BR')
        : '—';
      html += `
        <tr style="border-bottom:1px solid #f0f4fb">
          <td style="padding:9px 16px;font-size:12px;color:#888;white-space:nowrap;width:90px;vertical-align:top">${dt}</td>
          <td style="padding:9px 16px;font-size:13px;color:#333;vertical-align:top">${mov.descricao}</td>
        </tr>`;
    }

    html += `</table></div>`;
  }

  if (erros.length > 0) {
    html += `
    <div style="margin-top:16px;padding:12px 16px;background:#fff3f3;border:1px solid #fcc;border-radius:8px;font-size:12px;color:#c00">
      <strong>⚠ Erros na verificação (${erros.length}):</strong><br>
      ${erros.map(e => `<span style="font-family:monospace">${e.numero}</span>: ${e.erro}`).join('<br>')}
    </div>`;
  }

  html += `
  </div>
  <div style="padding:16px 32px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#999">
    Relatório gerado automaticamente ·
    <a href="${APP_URL}" style="color:#4a7fc1;text-decoration:none">Acessar o sistema</a>
  </div>
</div>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [adminEmail],
      subject,
      html,
    }),
  });

  console.log('Relatório enviado para:', adminEmail);
}

