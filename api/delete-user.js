const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verificarAdminAuth(req, serviceRoleKey) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceRoleKey }
  });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.email) return null;

  const ur = await fetch(`${SB_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(user.email)}&select=perfil,supabase_user_id`, {
    headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'apikey': serviceRoleKey }
  });
  const usuarios = await ur.json();
  const u = Array.isArray(usuarios) && usuarios[0];
  if (!u || u.perfil !== 'admin') return null;
  return { ...user, supabase_user_id: u.supabase_user_id };
}

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: 'Configuração ausente' });

  // Apenas admin pode excluir usuários
  const admin = await verificarAdminAuth(req, serviceRoleKey);
  if (!admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' });

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id obrigatório' });

  // Valida formato UUID
  if (!UUID_REGEX.test(user_id)) return res.status(400).json({ error: 'user_id inválido' });

  // Admin não pode se auto-excluir
  if (user_id === admin.id) return res.status(400).json({ error: 'Não é possível excluir o próprio usuário.' });

  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${user_id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'apikey': serviceRoleKey },
  });

  if (!r.ok && r.status !== 404) {
    const err = await r.json().catch(() => ({}));
    return res.status(r.status).json({ error: err.msg || err.message || 'Erro ao excluir' });
  }

  return res.status(200).json({ success: true });
}
