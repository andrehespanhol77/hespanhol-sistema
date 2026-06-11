const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rdmlxfgwlbroigsisjph.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const PJE_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const OABS = [{ numero: '39645', uf: 'DF' },{ numero: '109359', uf: 'RJ' }];

async function fetchPublicacoes(numeroOab, ufOab, dataInicio, dataFim) {
  const url = PJE_BASE+'?numeroOab='+numeroOab+'&ufOab='+ufOab+'&dataDisponibilizacaoInicio='+dataInicio+'&dataDisponibilizacaoFim='+dataFim+'&size=100';
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('PJe API '+ufOab+': HTTP '+res.status);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.content || json.items || json.data || []);
}

async function sendAlertEmail(p) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer '+RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'sistema@andrehespanhol.com', to: 'andrehespanhol@andrehespanhol.com',
      subject: 'Publicacao sem caso: '+(p.numero_processo||p.tribunal)+' ('+p.data_disponibilizacao+')',
      html: '<h2>Publicacao sem caso vinculado</h2><p>Processo: '+(p.numero_processo||'(nao identificado)')+'</p><p>Tribunal: '+p.tribunal+'</p><p>Data: '+p.data_disponibilizacao+'</p><p>OAB: '+p.oab_encontrada+'</p><hr><p>'+(p.conteudo||'').slice(0,500)+'</p><p><a href="https://hespanhol-sistema.vercel.app">Acessar sistema</a></p>' })
  });
}

module.exports = async (req, res) => {
  if (req.headers['authorization'] !== 'Bearer '+CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const hoje = new Date();
  const dataFim = hoje.toISOString().slice(0,10);
  const dataInicio = new Date(hoje.getTime()-2*24*60*60*1000).toISOString().slice(0,10);
  const stats = { inseridas:0, vinculadas:0, sem_caso:0, duplicadas:0, erros:[] };

  for (const oab of OABS) {
    let items = [];
    try { items = await fetchPublicacoes(oab.numero, oab.uf, dataInicio, dataFim); }
    catch(e) { stats.erros.push('OAB '+oab.uf+': '+e.message); continue; }
    for (const item of items) {
      const idPje = String(item.id||item.idComunicacao||((item.numero_processo||'')+'_'+(item.dataDisponibilizacao||'')));
      const numeroProcesso = item.numeroProcessoComMascara||item.numero_processo||item.numeroProcesso||null;
      const dataDisp = item.dataDisponibilizacao?item.dataDisponibilizacao.slice(0,10):dataFim;
      const tribunal = item.siglaTribunal||item.tribunal||'Desconhecido';
      const tipo = item.tipoComunicacao||item.tipo||'Publicacao';
      const { data: existing } = await supabase.from('publicacoes').select('id').eq('id_pje',idPje).single();
      if (existing) { stats.duplicadas++; continue; }
      let casoId = null;
      if (numeroProcesso) {
        const numLimpo = numeroProcesso.replace(/[^0-9]/g,'');
        const { data: casos } = await supabase.from('casos').select('id').or('numero_cnj.ilike.%'+numLimpo+'%,numero_processo.ilike.%'+numLimpo+'%').limit(1);
        if (casos&&casos.length>0) casoId = casos[0].id;
      }
      const status = casoId?'vinculada':'sem_caso';
      const { error: insertErr } = await supabase.from('publicacoes').insert({
        id_pje:idPje, numero_processo:numeroProcesso, tribunal, tipo_comunicacao:tipo,
        orgao:item.nomeOrgao||null, data_disponibilizacao:dataDisp,
        conteudo:item.texto||item.conteudo||'', link:item.link||null,
        caso_id:casoId, status, oab_encontrada:oab.uf, raw_json:item
      });
      if (insertErr) { stats.erros.push(insertErr.message); continue; }
      stats.inseridas++;
      if (status==='vinculada') stats.vinculadas++;
      else { stats.sem_caso++; try { await sendAlertEmail({numero_processo:numeroProcesso,tribunal,tipo_comunicacao:tipo,data_disponibilizacao:dataDisp,conteudo:item.texto||'',oab_encontrada:oab.uf}); } catch(e2){stats.erros.push('email:'+e2.message);} }
    }
  }
  return res.status(200).json({ ok:true, periodo:dataInicio+' a '+dataFim, ...stats });
};
