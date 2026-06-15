export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const querySecret = req.query?.secret;
  if (cronSecret && querySecret !== cronSecret) return res.status(401).json({error:'Não autorizado.'});

  const dataInicio = req.query?.dataInicio || '2026-06-10';
  const dataFim = req.query?.dataFim || '2026-06-15';

  const qs = new URLSearchParams({
    numeroOab: '39645', ufOab: 'DF',
    dataDisponibilizacaoInicio: dataInicio,
    dataDisponibilizacaoFim: dataFim,
    itensPorPagina: '10',
    pagina: '1',
  });
  const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?${qs}`;
  const pjeRes = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await pjeRes.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch(e) { parsed = null; }

  return res.status(200).json({
    pjeStatus: pjeRes.status,
    pjeHeaders: Object.fromEntries(pjeRes.headers.entries()),
    bodyPreview: body.slice(0, 500),
    count: parsed?.count,
    itemsLength: parsed?.items?.length,
    url,
  });
}
