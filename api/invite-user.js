const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';
const APP_URL = 'https://hespanhol-sistema.vercel.app';
const FROM_EMAIL = 'Hespanhol Advogados <andrehespanhol@andrehespanhol.com>';
const PERFIS_VALIDOS = ['escritorio', 'autorizado', 'cliente'];
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

  // Verifica perfil admin na tabela usuarios
  const ur = await fetch(`${SB_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(user.email)}&select=perfil`, {
    headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'apikey': serviceRoleKey }
  });
  const usuarios = await ur.json();
  const perfil = Array.isArray(usuarios) && usuarios[0]?.perfil;
  if (perfil !== 'admin') return null;
  return user;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!serviceRoleKey || !resendKey) return res.status(500).json({ error: 'Configuração ausente' });

  // Apenas admin pode convidar usuários
  const admin = await verificarAdminAuth(req, serviceRoleKey);
  if (!admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' });

  const { email, nome, perfil } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });

  // Valida perfil — admin não pode ser criado via convite
  const perfilSeguro = PERFIS_VALIDOS.includes(perfil) ? perfil : 'escritorio';

  const linkRes = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'invite',
      email,
      data: { nome: nome || '', perfil: perfilSeguro },
    }),
  });

  const linkData = await linkRes.json();
  if (!linkRes.ok) return res.status(linkRes.status).json({ error: linkData.msg || 'Erro ao gerar convite' });

  const inviteLink = linkData.action_link;
  if (!inviteLink) return res.status(500).json({ error: 'Link não retornado' });

  const nomePrimeiro = (nome || 'Colaborador').split(' ')[0];
  const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#333;background:#fff">
  <div style="background:#1a2b4a;padding:28px 32px;border-radius:8px 8px 0 0;text-align:center">
    <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:2px">HESPANHOL</div>
    <div style="color:#8aa8d4;font-size:11px;letter-spacing:3px;margin-top:2px">ADVOGADOS</div>
  </div>
  <div style="padding:32px">
    <p style="font-size:15px;margin:0 0 16px">Olá, <strong>${nomePrimeiro}</strong>!</p>
    <p style="font-size:14px;color:#555;margin:0 0 24px">
      Você foi convidado(a) para acessar o sistema de gestão do escritório <strong>Hespanhol Advogados</strong>.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${inviteLink}" style="background:#1a2b4a;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">
        Criar minha senha e acessar
      </a>
    </div>
    <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center">
      Este link é válido por 24 horas e de uso único.<br>
      Se você não esperava este convite, ignore este e-mail.
    </p>
  </div>
</div>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: 'Convite de acesso — Hespanhol Advogados', html }),
  });

  if (!emailRes.ok) {
    const emailErr = await emailRes.json();
    return res.status(500).json({ error: 'Erro ao enviar e-mail: ' + (emailErr.message || emailRes.status) });
  }

  return res.status(200).json({ success: true });
}
