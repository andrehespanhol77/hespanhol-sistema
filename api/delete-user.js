const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id obrigatório' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' });

  // Remove do Supabase Auth
  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${user_id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey,
    },
  });

  if (!r.ok && r.status !== 404) {
    const err = await r.json().catch(() => ({}));
    return res.status(r.status).json({ error: err.msg || err.message || 'Erro ao excluir do Auth' });
  }

  return res.status(200).json({ success: true });
}
