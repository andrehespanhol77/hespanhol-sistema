const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';
const PJE_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

const BUSCAS = [
  { params: { numeroOab: '39645', ufOab: 'DF' }, label: 'OAB/DF 39645' },
  { params: { numeroOab: '109359', ufOab: 'RJ' }, label: 'OAB/RJ 109359' },
];

async function sbFetch(path, key, options = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || '',
      ...(options.headers || {}),
    },
  });
}

async function fetchPublicacoes(params, dataInicio, dataFim) {
  const qs = new URLSearchParams({
    ...params,
    dataDisponibilizacaoInicio: dataInicio,
    dataDisponibilizacaoFim: dataFim,
    itensPorPagina: '100',
  });
  const res = await fetch(`${PJE_BASE}?${qs}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) { console.error('PJe error', res.status); return []; }
  const json = await res.json();
  return Array.isArray(json) ? json : (json.items || json.itens || json.comunicacoes || []);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const querySecret = req.query?.secret || req.body?.secret;
  const isCron = auth === `Bearer ${cronSecret}`;
  const isManual = cronSecret && querySecret === cronSecret;
  if (cronSecret && !isCron && !isManual) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY ausente' });

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - 2);
  const dataInicio = inicio.toISOString().split('T')[0];
  const dataFim = hoje.toISOString().split('T')[0];

  // Buscar casos para match por número de processo
  const casosRes = await sbFetch('casos?select=id,numero_cnj,numero_processo', key);
  const casos = await casosRes.json();
  const casoMap = {};
  (Array.isArray(casos) ? casos : []).forEach(c => {
    if (c.numero_cnj) casoMap[c.numero_cnj.replace(/\D/g, '').slice(-15)] = c.id;
    if (c.numero_processo) casoMap[c.numero_processo.replace(/\D/g, '').slice(-15)] = c.id;
  });

  // IDs já existentes (dedup 7 dias)
  const limiteDedup = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const existRes = await sbFetch(`publicacoes?select=id_pje&created_at=gte.${limiteDedup}`, key);
  const existentes = await existRes.json();
  const idsExistentes = new Set((Array.isArray(existentes) ? existentes : []).map(e => e.id_pje));

  const stats = { inseridas: 0, vinculadas: 0, sem_caso: 0, duplicadas: 0, erros: 0 };
  const semCaso = [];
  const todasPublicacoes = new Map();

  for (const busca of BUSCAS) {
    try {
      const itens = await fetchPublicacoes(busca.params, dataInicio, dataFim);
      console.log(`Busca ${busca.label}: ${itens.length} itens`);
      for (const item of itens) {
        const idPje = String(item.id || item.numeroComunicacao || item.idComunicacao || '');
        if (!idPje) { stats.erros++; continue; }
        if (!todasPublicacoes.has(idPje)) todasPublicacoes.set(idPje, { item, busca });
      }
    } catch (e) {
      console.error('Erro busca ' + busca.label + ':', e.message);
      stats.erros++;
    }
  }

  console.log(`Total único: ${todasPublicacoes.size}`);

  for (const [idPje, { item, busca }] of todasPublicacoes.entries()) {
    if (idsExistentes.has(idPje)) { stats.duplicadas++; continue; }

    const numProc = String(item.numeroProcesso || item.numero_processo || item.numeroprocessocommascara || '');
    const numProcNorm = numProc.replace(/\D/g, '').slice(-15);
    const casoId = casoMap[numProcNorm] || null;
    const status = casoId ? 'vinculada' : 'sem_caso';

    const registro = {
      id_pje: idPje,
      numero_processo: numProc || null,
      tribunal: item.siglaTribunal || item.tribunal || null,
      tipo_comunicacao: item.tipoComunicacao || item.tipo || null,
      orgao: item.nomeOrgao || item.orgao || null,
      data_disponibilizacao: item.data_disponibilizacao || item.dataDisponibilizacao || item.datadisponibilizacao || null,
      conteudo: item.texto || item.conteudo || item.teor || null,
      link: item.link || item.urlIntimacao || null,
      caso_id: casoId,
      status,
      oab_encontrada: busca.label,
      raw_json: item,
    };

    const insertRes = await sbFetch('publicacoes', key, {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify(registro),
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      console.error('Erro insert:', err);
      stats.erros++;
    } else {
      stats.inseridas++;
      if (status === 'vinculada') stats.vinculadas++;
      else { stats.sem_caso++; semCaso.push(registro); }
    }
  }

  // Alerta por e-mail se houver publicações sem caso
  if (semCaso.length > 0 && resendKey) {
    try {
      const linhas = semCaso.slice(0, 10).map(p =>
        `• ${p.data_disponibilizacao || '—'} | ${p.tribunal || '—'} | Proc: ${p.numero_processo || '—'}`
      ).join('\n');
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'sistema@andrehespanhol.com',
          to: 'andrehespanhol@andrehespanhol.com',
          subject: `⚠️ ${semCaso.length} publicação(ões) PJe sem caso vinculado`,
          text: `Dr. André,\n\nForam encontradas ${semCaso.length} publicação(ões) no PJe sem caso correspondente no sistema.\n\nVerifique em:\nhttps://hespanhol-sistema.vercel.app\n\nPublicações:\n${linhas}`,
        }),
      });
    } catch (e) { console.error('Email error:', e.message); }
  }

  console.log('Stats:', stats);
  return res.status(200).json({ ok: true, periodo: `${dataInicio} → ${dataFim}`, ...stats });
}
