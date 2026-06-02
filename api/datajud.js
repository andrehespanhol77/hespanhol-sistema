const DATAJUD_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendFbXNpRnJpclBYbFp0SmVDcHRBdFY=';
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br/api-publica';

// Mapa J.TT → índice DataJud (formato CNJ: NNNNNNN-DD.AAAA.J.TT.OOOO)
const TRIBUNAL_MAP = {
  '1.00':'esaj_stf','2.00':'esaj_cnj','3.00':'esaj_stj',
  '4.01':'esaj_trf1','4.02':'esaj_trf2','4.03':'esaj_trf3','4.04':'esaj_trf4','4.05':'esaj_trf5','4.06':'esaj_trf6',
  '5.00':'esaj_tst',
  '5.01':'esaj_trt1','5.02':'esaj_trt2','5.03':'esaj_trt3','5.04':'esaj_trt4','5.05':'esaj_trt5',
  '5.06':'esaj_trt6','5.07':'esaj_trt7','5.08':'esaj_trt8','5.09':'esaj_trt9','5.10':'esaj_trt10',
  '5.11':'esaj_trt11','5.12':'esaj_trt12','5.13':'esaj_trt13','5.14':'esaj_trt14','5.15':'esaj_trt15',
  '5.16':'esaj_trt16','5.17':'esaj_trt17','5.18':'esaj_trt18','5.19':'esaj_trt19','5.20':'esaj_trt20',
  '5.21':'esaj_trt21','5.22':'esaj_trt22','5.23':'esaj_trt23','5.24':'esaj_trt24',
  '6.00':'esaj_tse',
  '6.01':'esaj_tre_ac','6.02':'esaj_tre_al','6.03':'esaj_tre_ap','6.04':'esaj_tre_am','6.05':'esaj_tre_ba',
  '6.06':'esaj_tre_ce','6.07':'esaj_tre_df','6.08':'esaj_tre_es','6.09':'esaj_tre_go','6.10':'esaj_tre_ma',
  '6.11':'esaj_tre_mt','6.12':'esaj_tre_ms','6.13':'esaj_tre_mg','6.14':'esaj_tre_pa','6.15':'esaj_tre_pb',
  '6.16':'esaj_tre_pr','6.17':'esaj_tre_pe','6.18':'esaj_tre_pi','6.19':'esaj_tre_rj','6.20':'esaj_tre_rn',
  '6.21':'esaj_tre_rs','6.22':'esaj_tre_ro','6.23':'esaj_tre_rr','6.24':'esaj_tre_sc','6.25':'esaj_tre_se',
  '6.26':'esaj_tre_sp','6.27':'esaj_tre_to',
  '7.00':'esaj_stm',
  '8.01':'esaj_tjac','8.02':'esaj_tjal','8.03':'esaj_tjap','8.04':'esaj_tjam','8.05':'esaj_tjba',
  '8.06':'esaj_tjce','8.07':'esaj_tjdft','8.08':'esaj_tjes','8.09':'esaj_tjgo','8.10':'esaj_tjma',
  '8.11':'esaj_tjmt','8.12':'esaj_tjms','8.13':'esaj_tjmg','8.14':'esaj_tjpa','8.15':'esaj_tjpb',
  '8.16':'esaj_tjpr','8.17':'esaj_tjpe','8.18':'esaj_tjpi','8.19':'esaj_tjrj','8.20':'esaj_tjrn',
  '8.21':'esaj_tjrs','8.22':'esaj_tjro','8.23':'esaj_tjrr','8.24':'esaj_tjsc','8.25':'esaj_tjse',
  '8.26':'esaj_tjsp','8.27':'esaj_tjto',
};

function getIndex(numero) {
  const clean = numero.replace(/\s/g, '');
  const m = clean.match(/^\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}$/);
  if (!m) return null;
  const key = `${m[1]}.${m[2].padStart(2,'0')}`;
  return TRIBUNAL_MAP[key] || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { numero_cnj } = req.body || {};
  if (!numero_cnj) return res.status(400).json({ error: 'numero_cnj obrigatório' });

  const index = getIndex(numero_cnj);
  if (!index) return res.status(400).json({ error: 'Tribunal não identificado para o número: ' + numero_cnj });

  console.log('Consultando DataJud:', index, numero_cnj);

  try {
    const resp = await fetch(`${BASE_URL}/${index}/_search`, {
      method: 'POST',
      headers: {
        'Authorization': `APIKey ${DATAJUD_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: { term: { numeroProcesso: numero_cnj.replace(/\s/g, '') } },
        _source: ['numeroProcesso','movimentos','tribunal','classe','orgaoJulgador','dataAjuizamento','assuntos'],
        size: 1,
      }),
    });

    const data = await resp.json();
    console.log('DataJud status:', resp.status, 'hits:', data?.hits?.total?.value);

    if (!resp.ok) return res.status(502).json({ error: 'Erro DataJud: ' + JSON.stringify(data) });

    const hits = data?.hits?.hits || [];
    if (hits.length === 0) return res.status(404).json({ error: 'Processo não encontrado no DataJud. Verifique o número CNJ.' });

    const processo = hits[0]._source;
    const movimentos = (processo.movimentos || [])
      .map(function(m) {
        // Monta descrição com complementos se existirem
        var desc = m.nome || '';
        var comps = (m.complementosTabelados || []).map(function(c){ return c.valor||c.nome||''; }).filter(Boolean);
        var compsLivre = (m.complementos || []).map(function(c){ return c.descricao||''; }).filter(Boolean);
        var extra = comps.concat(compsLivre).join(' — ');
        if (extra) desc += ': ' + extra;
        return {
          codigo: m.codigo,
          descricao: desc,
          data: m.dataHora ? m.dataHora.split('T')[0] : null,
        };
      })
      .sort(function(a, b) { return (b.data||'') < (a.data||'') ? -1 : 1; });

    return res.status(200).json({
      tribunal: processo.tribunal || index.replace('esaj_','').toUpperCase(),
      classe: processo.classe?.nome || null,
      orgao: processo.orgaoJulgador?.nome || null,
      ajuizamento: processo.dataAjuizamento ? processo.dataAjuizamento.split('T')[0] : null,
      total_movimentos: movimentos.length,
      movimentos,
    });

  } catch (err) {
    console.error('Erro DataJud:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
