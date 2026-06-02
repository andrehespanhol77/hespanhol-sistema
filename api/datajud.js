const DATAJUD_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

// Mapa J.TT → índice DataJud (formato CNJ: NNNNNNN-DD.AAAA.J.TT.OOOO)
const TRIBUNAL_MAP = {
  '1.00':'api_publica_stf','2.00':'api_publica_cnj','3.00':'api_publica_stj',
  '4.01':'api_publica_trf1','4.02':'api_publica_trf2','4.03':'api_publica_trf3','4.04':'api_publica_trf4','4.05':'api_publica_trf5','4.06':'api_publica_trf6',
  '5.00':'api_publica_tst',
  '5.01':'api_publica_trt1','5.02':'api_publica_trt2','5.03':'api_publica_trt3','5.04':'api_publica_trt4','5.05':'api_publica_trt5',
  '5.06':'api_publica_trt6','5.07':'api_publica_trt7','5.08':'api_publica_trt8','5.09':'api_publica_trt9','5.10':'api_publica_trt10',
  '5.11':'api_publica_trt11','5.12':'api_publica_trt12','5.13':'api_publica_trt13','5.14':'api_publica_trt14','5.15':'api_publica_trt15',
  '5.16':'api_publica_trt16','5.17':'api_publica_trt17','5.18':'api_publica_trt18','5.19':'api_publica_trt19','5.20':'api_publica_trt20',
  '5.21':'api_publica_trt21','5.22':'api_publica_trt22','5.23':'api_publica_trt23','5.24':'api_publica_trt24',
  '6.00':'api_publica_tse',
  '6.01':'api_publica_tre-ac','6.02':'api_publica_tre-al','6.03':'api_publica_tre-ap','6.04':'api_publica_tre-am','6.05':'api_publica_tre-ba',
  '6.06':'api_publica_tre-ce','6.07':'api_publica_tre-df','6.08':'api_publica_tre-es','6.09':'api_publica_tre-go','6.10':'api_publica_tre-ma',
  '6.11':'api_publica_tre-mt','6.12':'api_publica_tre-ms','6.13':'api_publica_tre-mg','6.14':'api_publica_tre-pa','6.15':'api_publica_tre-pb',
  '6.16':'api_publica_tre-pr','6.17':'api_publica_tre-pe','6.18':'api_publica_tre-pi','6.19':'api_publica_tre-rj','6.20':'api_publica_tre-rn',
  '6.21':'api_publica_tre-rs','6.22':'api_publica_tre-ro','6.23':'api_publica_tre-rr','6.24':'api_publica_tre-sc','6.25':'api_publica_tre-se',
  '6.26':'api_publica_tre-sp','6.27':'api_publica_tre-to',
  '7.00':'api_publica_stm',
  '8.01':'api_publica_tjac','8.02':'api_publica_tjal','8.03':'api_publica_tjap','8.04':'api_publica_tjam','8.05':'api_publica_tjba',
  '8.06':'api_publica_tjce','8.07':'api_publica_tjdft','8.08':'api_publica_tjes','8.09':'api_publica_tjgo','8.10':'api_publica_tjma',
  '8.11':'api_publica_tjmt','8.12':'api_publica_tjms','8.13':'api_publica_tjmg','8.14':'api_publica_tjpa','8.15':'api_publica_tjpb',
  '8.16':'api_publica_tjpr','8.17':'api_publica_tjpe','8.18':'api_publica_tjpi','8.19':'api_publica_tjrj','8.20':'api_publica_tjrn',
  '8.21':'api_publica_tjrs','8.22':'api_publica_tjro','8.23':'api_publica_tjrr','8.24':'api_publica_tjsc','8.25':'api_publica_tjse',
  '8.26':'api_publica_tjsp','8.27':'api_publica_tjto',
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
        query: { term: { "numeroProcesso": numero_cnj.replace(/\D/g, '') } },
        _source: ['numeroProcesso','movimentos','tribunal','classe','orgaoJulgador','dataAjuizamento','assuntos'],
        size: 1,
      }),
    });

    const data = await resp.json();
    console.log('DataJud status:', resp.status, 'hits:', data?.hits?.total?.value);

    if (!resp.ok) return res.status(502).json({ error: 'Erro DataJud: ' + JSON.stringify(data) });

    const hits = data?.hits?.hits || [];
    if (hits.length === 0) return res.status(404).json({
      error: 'Processo não encontrado no DataJud.',
      debug: {
        index_usado: index,
        url: `${BASE_URL}/${index}/_search`,
        numero_buscado: numero_cnj.replace(/\D/g, ''),
        numero_original: numero_cnj,
        total_hits: data?.hits?.total?.value ?? 0,
      }
    });

    const processo = hits[0]._source;
    const movimentos = (processo.movimentos || [])
      .map(function(m) {
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
      tribunal: processo.tribunal || index.replace('api_publica_','').toUpperCase(),
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
