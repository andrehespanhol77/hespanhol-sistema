import forge from "node-forge";

const CLIENT_EMAIL = "hespanhol-sistema@hespanhol-advogados.iam.gserviceaccount.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

function base64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePem(raw) {
  if (!raw) throw new Error("GOOGLE_PRIVATE_KEY não configurada");
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\\n/g, "\n");
}

async function getAccessToken() {
  const pem = normalizePem(process.env.GOOGLE_PRIVATE_KEY);
  console.log("PEM len:", pem.length, "starts:", pem.slice(0, 27));

  const privateKey = forge.pki.privateKeyFromPem(pem);
  console.log("node-forge: chave importada OK");

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: DRIVE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;

  const md = forge.md.sha256.create();
  md.update(signingInput, "utf8");
  const signatureBytes = privateKey.sign(md);
  const signature = Buffer.from(signatureBytes, "binary")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signingInput}.${signature}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  console.log("OAuth:", JSON.stringify(data));
  if (!data.access_token) throw new Error("Falha ao obter token: " + JSON.stringify(data));
  return data.access_token;
}

async function criarPasta(token, nome, parentId) {
  const resp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: nome,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const data = await resp.json();
  if (!data.id) throw new Error("Erro ao criar pasta '" + nome + "': " + JSON.stringify(data));
  console.log("Pasta criada:", nome);
  return data.id;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { acao, nome_cliente, nome_processo, cliente_pasta_id } = req.body || {};
  const PASTA_CLIENTES_ID = process.env.GOOGLE_DRIVE_CLIENTES_ID || "13TDhMv7UEguo6NbkzHGQJbt1jAyNs82m";

  if (!process.env.GOOGLE_PRIVATE_KEY) {
    return res.status(500).json({ error: "GOOGLE_PRIVATE_KEY não configurada" });
  }

  try {
    const token = await getAccessToken();

    if (acao === "criar_cliente") {
      if (!nome_cliente) return res.status(400).json({ error: "nome_cliente obrigatório" });
      const clienteId = await criarPasta(token, nome_cliente, PASTA_CLIENTES_ID);
      await criarPasta(token, "Documentos Pessoais", clienteId);
      await criarPasta(token, "Processos", clienteId);
      return res.status(200).json({
        success: true,
        pasta_id: clienteId,
        pasta_url: `https://drive.google.com/drive/folders/${clienteId}`,
      });
    }

    if (acao === "criar_processo") {
      if (!nome_processo || !cliente_pasta_id) {
        return res.status(400).json({ error: "nome_processo e cliente_pasta_id obrigatórios" });
      }
      const listResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${cliente_pasta_id}'+in+parents+and+name='Processos'+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const listData = await listResp.json();
      const processosPaiId = listData.files && listData.files[0] ? listData.files[0].id : cliente_pasta_id;
      const processoId = await criarPasta(token, nome_processo, processosPaiId);
      await criarPasta(token, "Petições e Docs Instrutórios", processoId);
      await criarPasta(token, "Peças Importantes", processoId);
      await criarPasta(token, "Relatórios, Planilhas e Estudos", processoId);
      return res.status(200).json({
        success: true,
        pasta_id: processoId,
        pasta_url: `https://drive.google.com/drive/folders/${processoId}`,
      });
    }

    return res.status(400).json({ error: "acao inválida. Use: criar_cliente ou criar_processo" });
  } catch (err) {
    console.error("Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
