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

async function fetchPagina(params, dataInicio, dataFim, pagina) {
  const qs = new URLSearchParams({
    ...params,
    dataDisponibilizacaoInicio: dataInicio,
    dataDisponibilizacaoFim: dataFim,
    itensPorPagina: '100',
    pagina: String(pagina),
  });
  const res = await fetch(`${PJE_BASE}?${qs}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) { console.error('PJe error', res.status); return []; }
  const json = await res.json();
  return Array.isArray(json) ? json : (json.items || json.itens || json.comunicacoes || []);
}

async function fetchTodas(params, dataInicio, dataFim, label) {
  const todas = new Map();
  let pagina = 1;
  while (true) {
    const itens = await fetchPagina(params, dataInicio, dataFim, pagina);
    console.log(`${label} pág ${pagina}: ${itens.length} itens`);
    if (itens.length === 0) break;
    for (const item of itens) {
      const id = String(item.id || item.numeroComunicacao || item.idComunicacao || '');
      if (id && !todas.has(id)) todas.set(id, item);
    }
    if (itens.length < 100) break; // última página
    pagina++;
  }
  return todas;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const querySecret = req.query?.secret || req.body?.secret;
  if (cronSecret && auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY ausente' });

  // Período via query params (padrão: últimos 12 meses)
  const hoje = new Date().toISOString().split('T')[0];
  const umAnoAtras = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const dataInicio = req.query?.dataInicio || umAnoAtras;
  const dataFim = req.query?.dataFim || hoje;

  console.log(`Backfill: ${dataInicio} → ${dataFim}`);

  // Buscar casos para match por número de processo
  const casosRes = await sbFetch('casos?select=id,numero_cnj,numero_processo', key);
  const casos = await casosRes.json();
  const casoMap = {};
  (Array.isArray(casos) ? casos : []).forEach(c => {
    if (c.numero_cnj) casoMap[c.numero_cnj.replace(/\D/g, '').slice(-15)] = c.id;
    if (c.numero_processo) casoMap[c.numero_processo.replace(/\D/g, '').slice(-15)] = c.id;
  });

  // IDs já existentes (dedup completo da tabela)
  const existRes = await sbFetch('publicacoes?select=id_pje', key);
  const existentes = await existRes.json();
  const idsExistentes = new Set((Array.isArray(existentes) ? existentes : []).map(e => e.id_pje));

  const stats = { inseridas: 0, vinculadas: 0, sem_caso: 0, duplicadas: 0, erros: 0 };
  const todasPublicacoes = new Map();

  for (const busca of BUSCAS) {
    try {
      const paginas = await fetchTodas(busca.params, dataInicio, dataFim, busca.label);
      paginas.forEach((item, id) => {
        if (!todasPublicacoes.has(id)) todasPublicacoes.set(id, { item, busca });
      });
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
      else stats.sem_caso++;
    }
  }

  console.log('Stats:', stats);
  return res.status(200).json({ ok: true, periodo: `${dataInicio} → ${dataFim}`, ...stats });
}
