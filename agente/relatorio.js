const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const EMAIL_DEST = 'andrehespanhol@andrehespanhol.com';

async function gerarRelatorio() {
  const db = createClient(SB_URL, SB_KEY);

  const { data: casos } = await db.from('casos').select('*, clientes(nome)').eq('status', 'ativo');

  if (!casos || casos.length === 0) {
    console.log('Nenhum caso ativo.');
    return;
  }

  const linhas = casos.map(c =>
    `• ${c.clientes?.nome || '—'} | ${c.tipo_acao || '—'} | ${c.tribunal || '—'} | Fase: ${c.fase || '—'}`
  ).join('\n');

  const corpo = `Bom dia, Dr. Andre.\n\nRelatório diário — Hespanhol Advogados\n\nCasos ativos: ${casos.length}\n\n${linhas}\n\nAgente Hespanhol`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`
    },
    body: JSON.stringify({
      from: 'hespanhol@andrehespanhol.com',
      to: EMAIL_DEST,
      subject: `Relatório Diário — ${new Date().toLocaleDateString('pt-BR')}`,
      text: corpo
    })
  });

  console.log('Relatório enviado com sucesso.');
}

gerarRelatorio().catch(console.error);
