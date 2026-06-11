import forge from "node-forge";

const CLIENT_EMAIL = "hespanhol-sistema@hespanhol-advogados.iam.gserviceaccount.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

function base64url(str) {
  return Buffer.from(str).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}

function normalizePem(raw) {
  if (!raw) throw new Error("GOOGLE_PRIVATE_KEY não configurada");
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1,-1).trim();
  return s.replace(/\\n/g,"\n");
}

async function getAccessToken() {
  const pem = normalizePem(process.env.GOOGLE_PRIVATE_KEY);
  const privateKey = forge.pki.privateKeyFromPem(pem);
  const now = Math.floor(Date.now()/1000);
  const header = base64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const payload = base64url(JSON.stringify({iss:CLIENT_EMAIL,scope:DRIVE_SCOPE,aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
  const signingInput = `${header}.${payload}`;
  const md = forge.md.sha256.create();
  md.update(signingInput,"utf8");
  const sig = Buffer.from(privateKey.sign(md),"binary").toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  const jwt = `${signingInput}.${sig}`;
  const resp = await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`});
  const data = await resp.json();
  if (!data.access_token) throw new Error("Falha ao obter token: "+JSON.stringify(data));
  return data.access_token;
}

async function criarPasta(token, nome, parentId) {
  const resp = await fetch("https://www.googleapis.com/drive/v3/files",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({name:nome,mimeType:"application/vnd.google-apps.folder",parents:[parentId]})});
  const data = await resp.json();
  if (!data.id) throw new Error("Erro ao criar pasta '"+nome+"': "+JSON.stringify(data));
  return data.id;
}

async function buscarOuCriarPasta(token, nome, parentId) {
  const q = encodeURIComponent(`'${parentId}' in parents and name='${nome}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,{headers:{Authorization:`Bearer ${token}`}});
  const data = await resp.json();
  if (data.files && data.files[0]) return data.files[0].id;
  return await criarPasta(token, nome, parentId);
}

async function uploadArquivo(token, nome, mimeType, conteudoB64, parentId) {
  const fileContent = Buffer.from(conteudoB64,"base64");
  const metadata = JSON.stringify({name:nome,parents:[parentId]});
  const boundary = "boundary_hespanhol";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`),
    Buffer.from(conteudoB64),
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":`multipart/related; boundary=${boundary}`},body});
  const data = await resp.json();
  if (!data.id) throw new Error("Erro ao subir arquivo: "+JSON.stringify(data));
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({role:"reader",type:"anyone"})});
  return {file_id:data.id, url:data.webViewLink||`https://drive.google.com/file/d/${data.id}/view`};
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({error:"Method not allowed"});
  const {acao, nome_cliente, nome_processo, cliente_pasta_id, pasta_id, nome, mime, conteudo_b64, tipo_comprovante} = req.body || {};
  const PASTA_CLIENTES_ID = process.env.GOOGLE_DRIVE_CLIENTES_ID || "13TDhMv7UEguo6NbkzHGQJbt1jAyNs82m";
  if (!process.env.GOOGLE_PRIVATE_KEY) return res.status(500).json({error:"GOOGLE_PRIVATE_KEY não configurada"});

  try {
    const token = await getAccessToken();

    if (acao === "criar_cliente") {
      if (!nome_cliente) return res.status(400).json({error:"nome_cliente obrigatório"});
      const clienteId = await criarPasta(token, nome_cliente, PASTA_CLIENTES_ID);
      await criarPasta(token, "Documentos Pessoais", clienteId);
      await criarPasta(token, "Processos", clienteId);
      return res.status(200).json({success:true,pasta_id:clienteId,pasta_url:`https://drive.google.com/drive/folders/${clienteId}`});
    }

    if (acao === "criar_processo") {
      if (!nome_processo || !cliente_pasta_id) return res.status(400).json({error:"nome_processo e cliente_pasta_id obrigatórios"});
      const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q='${cliente_pasta_id}'+in+parents+and+name='Processos'+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id)`,{headers:{Authorization:`Bearer ${token}`}});
      const listData = await listResp.json();
      const processosPaiId = listData.files && listData.files[0] ? listData.files[0].id : cliente_pasta_id;
      const processoId = await criarPasta(token, nome_processo, processosPaiId);
      await Promise.all([
        criarPasta(token, "Petições e Docs Instrutórios", processoId),
        criarPasta(token, "Peças Importantes", processoId),
        criarPasta(token, "Relatórios, Planilhas e Estudos", processoId),
        criarPasta(token, "Comprovantes de Despesas", processoId),
        criarPasta(token, "Comprovantes de Honorários", processoId),
      ]);
      return res.status(200).json({success:true,pasta_id:processoId,pasta_url:`https://drive.google.com/drive/folders/${processoId}`});
    }

    if (acao === "criar_subpastas_financeiras") {
      if (!pasta_id) return res.status(400).json({error:"pasta_id obrigatório"});
      const [despId, honId] = await Promise.all([
        buscarOuCriarPasta(token, "Comprovantes de Despesas", pasta_id),
        buscarOuCriarPasta(token, "Comprovantes de Honorários", pasta_id),
      ]);
      return res.status(200).json({success:true,pasta_despesas_id:despId,pasta_honorarios_id:honId,pasta_despesas_url:`https://drive.google.com/drive/folders/${despId}`,pasta_honorarios_url:`https://drive.google.com/drive/folders/${honId}`});
    }

    if (acao === "upload_comprovante") {
      if (!pasta_id || !nome || !mime || !conteudo_b64) return res.status(400).json({error:"pasta_id, nome, mime e conteudo_b64 obrigatórios"});
      const subpasta = tipo_comprovante === "honorario" ? "Comprovantes de Honorários" : "Comprovantes de Despesas";
      const subpastaId = await buscarOuCriarPasta(token, subpasta, pasta_id);
      const result = await uploadArquivo(token, nome, mime, conteudo_b64, subpastaId);
      return res.status(200).json({success:true,...result});
    }

    if (acao === "upload_documento") {
      const { pasta_cliente_id, tipo, caso_pasta_id } = req.body;
      if (!pasta_cliente_id || !tipo || !nome || !mime || !conteudo_b64) return res.status(400).json({error:"pasta_cliente_id, tipo, nome, mime e conteudo_b64 obrigatórios"});
      let pastaDestinoId;
      if (tipo === "procuracao") {
        pastaDestinoId = await buscarOuCriarPasta(token, "Documentos Pessoais", pasta_cliente_id);
      } else if (tipo === "contrato") {
        const q2 = encodeURIComponent(`'${pasta_cliente_id}' in parents and name='Financeiro' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
        const resp2 = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q2}&fields=files(id)`,{headers:{Authorization:`Bearer ${token}`}});
        const data2 = await resp2.json();
        pastaDestinoId = (data2.files && data2.files[0]) ? data2.files[0].id : await buscarOuCriarPasta(token, "Documentos Pessoais", pasta_cliente_id);
      } else if (tipo === "peticao" && caso_pasta_id) {
        pastaDestinoId = await buscarOuCriarPasta(token, "Petições e Docs Instrutórios", caso_pasta_id);
      } else {
        pastaDestinoId = pasta_cliente_id;
      }
      const result = await uploadArquivo(token, nome, mime, conteudo_b64, pastaDestinoId);
      return res.status(200).json({success:true,url:result.url,file_id:result.file_id});
    }

    return res.status(400).json({error:"acao inválida. Use: criar_cliente, criar_processo, criar_subpastas_financeiras, upload_comprovante, upload_documento"});
  } catch (err) {
    console.error("Erro:", err.message);
    return res.status(500).json({error:err.message});
  }
}
