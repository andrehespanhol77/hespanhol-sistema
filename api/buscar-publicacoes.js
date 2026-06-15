const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rdmlxfgwlbroigsisjph.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const PJE_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

const BUSCAS = [
  { tipo: 'oab', params: { numeroOab: '39645', ufOab: 'DF' }, label: 'OAB/DF 39645' },
  { tipo: 'oab', params: { numeroOab: '109359', ufOab: 'RJ' }, label: 'OAB/RJ 109359' },
];

async function fetchPublicacoes(params, dataInicio, dataFim) {
  const qs = new URLSearchParams({
    ...params,
    dataDisponibilizacaoInicio: dataInicio,
    dataDisponibilizacaoFim: dataFim,
    itensPorPagina: '100',
  });
  const url = PJE_BASE + '?' + qs.toString();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    console.error('PJe API error', res.status, url);
    return [];
  }
  const json = await res.json();
  // A API retorna { items: [...] }
  return Array.isArray(json) ? json : (json.items || json.itens || json.comunicacoes || json.content || []);
}

async function sendAlertEmail(publicacoes) {
  if (!RESEND_API_KEY || !publicacoes.length) return;
  const linhas = publicacoes.slice(0, 10).map(function(p) {
    return `• ${p.data_disponibilizacao || '—'} | ${p.tribunal || '—'} | Proc: ${p.numero_processo || '—'}`;
  }).join('\n');
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_API_KEY },
    body: JSON.stringify({
      from: 'sistema@andrehespanhol.com',
      to: 'andrehespanhol@andrehespanhol.com',
      subject: `⚠️ ${publicacoes.length} publicação(ões) PJe sem caso vinculado`,
      text: `Dr. André,\n\nForam encontradas ${publicacoes.length} publicação(ões) no PJe sem caso correspondente no sistema.\n\nVerifique e vincule ou descarte em:\nhttps://hespanhol-sistema.vercel.app\n\nPublicações:\n${linhas}`,
    }),
  });
}

module.exports = async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_KEY);

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - 2);
  const dataInicio = inicio.toISOString().split('T')[0];
  const dataFim = hoje.toISOString().split('T')[0];

  const { data: casos } = await db.from('casos').select('id, numero_cnj, numero_processo');
  const casoMap = {};
  (casos || []).forEach(function(c) {
    if (c.numero_cnj) casoMap[c.numero_cnj.replace(/\D/g,'').slice(-15)] = c.id;
    if (c.numero_processo) casoMap[c.numero_processo.replace(/\D/g,'').slice(-15)] = c.id;
  });

  const { data: existentes } = await db.from('publicacoes').select('id_pje').gte('created_at', new Date(Date.now() - 7*24*60*60*1000).toISOString());
  const idsExistentes = new Set((existentes||[]).map(function(e){return e.id_pje;}));

  const stats = { inseridas: 0, vinculadas: 0, sem_caso: 0, duplicadas: 0, erros: 0 };
  const semCaso = [];

  const todasPublicacoes = new Map();
  for (const busca of BUSCAS) {
    try {
      const itens = await fetchPublicacoes(busca.params, dataInicio, dataFim);
      console.log(`Busca ${busca.label}: ${itens.length} itens`);
      for (const item of itens) {
        const idPje = String(item.id || item.numeroComunicacao || item.idComunicacao || item.numero || '');
        if (!idPje) { stats.erros++; continue; }
        if (!todasPublicacoes.has(idPje)) {
          todasPublicacoes.set(idPje, { item, busca });
        }
      }
    } catch (e) {
      console.error('Erro busca ' + busca.label + ':', e.message);
      stats.erros++;
    }
  }

  console.log(`Total único após dedup: ${todasPublicacoes.size}`);

  for (const [idPje, { item, busca }] of todasPublicacoes.entries()) {
    if (idsExistentes.has(idPje)) { stats.duplicadas++; continue; }

    const numProc = String(item.numeroProcesso || item.numero_processo || item.numeroprocessocommascara || '');
    const numProcNorm = numProc.replace(/\D/g,'').slice(-15);
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

    const { error } = await db.from('publicacoes').insert(registro);
    if (error) {
      console.error('Erro insert:', error.message);
      stats.erros++;
    } else {
      stats.inseridas++;
      if (status === 'vinculada') stats.vinculadas++;
      else { stats.sem_caso++; semCaso.push(registro); }
    }
  }

  if (semCaso.length > 0) {
    try { await sendAlertEmail(semCaso); } catch(e) { console.error('Email error:', e.message); }
  }

  console.log('Stats:', stats);
  return res.status(200).json({ ok: true, periodo: `${dataInicio} → ${dataFim}`, ...stats });
};
