const CREDENTIALS = {
  client_email: "hespanhol-sistema@hespanhol-advogados.iam.gserviceaccount.com",
  private_key: process.env.GOOGLE_PRIVATE_KEY,
};

const SCOPES = ["https://www.googleapis.com/auth/drive"];

function parsePrivateKey(raw) {
  if (!raw) throw new Error("GOOGLE_PRIVATE_KEY está vazia");

  // Normaliza todos os estilos de \n
  let key = raw.replace(/\\n/g, "\n").replace(/\\r/g, "").trim();
  // Remove aspas externas se coladas com elas
  if (key.startsWith('"') || key.startsWith("'")) key = key.slice(1);
  if (key.endsWith('"') || key.endsWith("'")) key = key.slice(0, -1);
  key = key.replace(/\\n/g, "\n").trim();

  // Extrai apenas o conteúdo base64 entre os headers PEM
  const b64 = key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
    .replace(/-----END RSA PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  if (!b64 || b64.length < 100) {
    throw new Error("GOOGLE_PRIVATE_KEY inválida: conteúdo base64 muito curto ou ausente (len=" + b64.length + ")");
  }

  // Reconstrói o PEM com formatação correta (64 chars por linha)
  const chunks = b64.match(/.{1,64}/g) || [];
  const header = key.includes("BEGIN RSA PRIVATE KEY") ? "RSA PRIVATE KEY" : "PRIVATE KEY";
  const pem = `-----BEGIN ${header}-----\n${chunks.join("\n")}\n-----END ${header}-----\n`;

  console.log("PEM reconstruído: header='" + header + "' | b64 len=" + b64.length + " | linhas=" + chunks.length);
  return pem;
}

async function getAccessToken() {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: CREDENTIALS.client_email,
    scope: SCOPES.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const base64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const signingInput = `${base64url(header)}.${base64url(payload)}`;

  const { createSign, createPrivateKey } = await import("crypto");

  const pem = parsePrivateKey(CREDENTIALS.private_key);
  const keyObj = createPrivateKey({ key: pem, format: "pem" });
  console.log("createPrivateKey OK, tipo:", keyObj.asymmetricKeyType);

  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign
    .sign(keyObj)
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
  console.log("OAuth response:", JSON.stringify(data));
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
