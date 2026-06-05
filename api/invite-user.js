const SB_URL = 'https://rdmlxfgwlbroigsisjph.supabase.co';
const APP_URL = 'https://hespanhol-sistema.vercel.app';
const FROM_EMAIL = 'Hespanhol Advogados <andrehespanhol@andrehespanhol.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, nome, perfil } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!serviceRoleKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' });
  if (!resendKey) return res.status(500).json({ error: 'RESEND_API_KEY não configurada' });

  // 1. Gera o link de convite via Supabase Admin (sem enviar e-mail)
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
      data: { nome: nome || '', perfil: perfil || 'escritorio' },
    }),
  });

  const linkData = await linkRes.json();
  if (!linkRes.ok) {
    return res.status(linkRes.status).json({ error: linkData.msg || linkData.error_description || 'Erro ao gerar link de convite' });
  }

  const inviteLink = linkData.action_link;
  if (!inviteLink) return res.status(500).json({ error: 'Link de convite não retornado pelo Supabase' });

  // 2. Envia e-mail via Resend com template personalizado
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
  <div style="background:#f5f7fa;padding:16px 32px;border-radius:0 0 8px 8px;text-align:center;font-size:11px;color:#999;border-top:1px solid #eee">
    Hespanhol Advogados · Formosa/GO ·
    <a href="${APP_URL}" style="color:#4a7fc1;text-decoration:none">Acessar o sistema</a>
  </div>
</div>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Convite de acesso — Hespanhol Advogados',
      html,
    }),
  });

  if (!emailRes.ok) {
    const emailErr = await emailRes.json();
    return res.status(500).json({ error: 'Erro ao enviar e-mail: ' + (emailErr.message || emailRes.status) });
  }

  return res.status(200).json({ success: true });
}
