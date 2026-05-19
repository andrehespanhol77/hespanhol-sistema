export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, nome, perfil } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'E-mail obrigatório' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || 'https://rdmlxfgwlbroigsisjph.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' });
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/invite`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        data: { nome: nome || '', perfil: perfil || 'escritorio' },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.msg || data.message || data.error_description || 'Erro ao enviar convite'
      });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
