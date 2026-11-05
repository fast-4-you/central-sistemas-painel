/*
 * Central de Sistemas fast4you: camada de dados no GitHub.
 *
 * O painel foi escrito com a interface window.claude.use("db" | "user" | "downloads" | "sample").
 * Este arquivo implementa essa interface usando a API do GitHub:
 *   - os dados ficam no repositório PRIVADO, na branch "dados", em arquivos dados/<colecao>.json
 *   - cada pessoa entra com o próprio token de acesso (fine-grained, só este repositório)
 *   - cada gravação vira um commit, então todo o histórico de alterações fica registrado
 *
 * Nenhum dado fica nesta página: sem token válido, nada é carregado.
 */
(function () {
  "use strict";
  const API = "https://api.github.com";
  const LS = "f4y-central-github";
  const POLL_MS = 30000;
  const COLECOES = ["pdvs", "chamados", "dicas", "snapshots", "problemas", "fornecedores", "procedimentos", "config"];

  /* ---------------- configuração e login ---------------- */
  function lerCfg() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; } }
  function salvarCfg(c) { try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) {} }
  let cfg = lerCfg();
  const padrao = window.CENTRAL_REPO || {}; // opcional: { owner, repo, branch } definido no index.html

  async function gh(path, opts) {
    opts = opts || {};
    const res = await fetch(API + path, {
      method: opts.method || "GET",
      headers: Object.assign({ Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, opts.body ? { "Content-Type": "application/json" } : {}, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    if (opts.raw) return res;
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      let msg = ""; try { msg = (await res.json()).message; } catch (e) {}
      const err = new Error("GitHub " + res.status + (msg ? ": " + msg : ""));
      err.status = res.status;
      err.code = res.status === 401 || res.status === 403 ? "invalid_argument" : res.status === 409 || res.status === 422 ? "conflict" : "unavailable";
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const repoPath = () => "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo);

  function telaLogin(erro) {
    return new Promise(resolve => {
      const c = cfg || {};
      const box = document.createElement("div");
      box.id = "gh-login";
      box.innerHTML = `
      <style>
        #gh-login{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:rgba(40,8,26,.72);padding:16px;font-family:"Archivo",system-ui,sans-serif}
        #gh-login form{background:var(--panel,#fff);color:var(--fg,#241a22);max-width:440px;width:100%;border-radius:16px;padding:22px;border-top:6px solid #ff7700;display:flex;flex-direction:column;gap:10px}
        #gh-login h2{margin:0;color:#8F1C5A;font-size:20px}
        #gh-login label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted,#6d6170)}
        #gh-login input{border:1px solid var(--line-strong,#cfc4d2);border-radius:8px;padding:8px 10px;font:inherit;color:inherit;background:var(--panel,#fff)}
        #gh-login button{background:#ff7700;color:#fff;border:0;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;font:inherit}
        #gh-login .erro{color:#d23642;font-size:13px;min-height:1em}
        #gh-login .row{display:flex;gap:8px}#gh-login .row label{flex:1}
        #gh-login p{margin:0;font-size:13px;color:var(--muted,#6d6170)}
      </style>
      <form>
        <h2>Entrar na Central de Sistemas</h2>
        <p>Use seu token pessoal do GitHub com acesso ao repositório da Central. O token fica salvo só neste navegador.</p>
        <div class="row">
          <label>Organização ou usuário<input name="owner" required value="${esc(c.owner || padrao.owner || "")}"></label>
          <label>Repositório<input name="repo" required value="${esc(c.repo || padrao.repo || "central-sistemas")}"></label>
        </div>
        <label>Token de acesso (fine-grained)<input name="token" type="password" required autocomplete="off" placeholder="github_pat_..."></label>
        <div class="erro">${esc(erro || "")}</div>
        <button type="submit">Entrar</button>
        <p>Como criar o token: GitHub &gt; Settings &gt; Developer settings &gt; Fine-grained tokens. Acesso só a este repositório, permissão “Contents: Read and write”.</p>
      </form>`;
         if (document.body) document.body.appendChild(box); else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(box), { once: true });
      box.querySelector("form").addEventListener("submit", ev => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        cfg = { owner: String(f.get("owner")).trim(), repo: String(f.get("repo")).trim(), token: String(f.get("token")).trim(), branch: (padrao.branch || "dados") };
        box.remove(); resolve();
      });
    });
  }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  let repoInfo = null, usuario = null;
  async function garantirBranch() {
    const ref = await gh(repoPath() + "/git/ref/heads/" + encodeURIComponent(cfg.branch), { allow404: true });
    if (ref) return;
    // cria a branch de dados vazia (sem histórico do código), só com um LEIA-ME
    const tree = await gh(repoPath() + "/git/trees", { method: "POST", body: { tree: [{ path: "dados/LEIA-ME.md", mode: "100644", type: "blob",
      content: "# Dados da Central de Sistemas\n\nArquivos gravados pelo painel e pelo coletor. Não edite à mão sem necessidade e não proteja esta branch.\n" }] } });
    const commit = await gh(repoPath() + "/git/commits", { method: "POST", body: { message: "Central: cria a base de dados", tree: tree.sha, parents: [] } });
    try { await gh(repoPath() + "/git/refs", { method: "POST", body: { ref: "refs/heads/" + cfg.branch, sha: commit.sha } }); }
    catch (e) { if (e.status !== 422) throw e; } // outra pessoa criou ao mesmo tempo
  }
  const conectado = (async function conectar() {
    let erro = "";
    for (;;) {
      if (!cfg || !cfg.token || erro) await telaLogin(erro);
      try {
        repoInfo = await gh(repoPath());
        if (repoInfo.private === false) throw Object.assign(new Error("Este repositório é público. Os dados da Central só podem ficar em repositório privado."), { fatal: true });
        usuario = await gh("/user");
        await garantirBranch();
        salvarCfg(cfg);
        return true;
      } catch (e) {
        erro = e.fatal ? e.message : e.status === 401 ? "Token inválido ou expirado." : e.status === 404 ? "Repositório não encontrado ou o token não tem acesso a ele." : e.status === 403 ? "O token não tem permissão. Confira “Contents: Read and write”." : "Não foi possível conectar: " + e.message;
        cfg = Object.assign({}, cfg, { token: "" });
      }
    }
  })();

  window.centralGithub = {
    sair() { const c = lerCfg() || {}; delete c.token; salvarCfg(c); location.reload(); },
    repositorio() { return cfg ? cfg.owner + "/" + cfg.repo : ""; },
  };

  /* ---------------- leitura e escrita dos arquivos ---------------- */
  const cache = {}; // col -> { sha, docs }
  const b64decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));
  const b64encode = s => { const bytes = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  // formato estável (chaves ordenadas, uma propriedade por linha) para o git conseguir mesclar
  function ordenar(v) { if (Array.isArray(v)) return v.map(ordenar); if (v && typeof v === "object") { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = ordenar(v[k]); }); return o; } return v; }
  const serializar = docs => JSON.stringify(ordenar(docs), null, 1) + "\n";

  async function lerArquivo(col) {
    const path = repoPath() + "/contents/dados/" + col + ".json?ref=" + encodeURIComponent(cfg.branch);
    const meta = await gh(path, { allow404: true });
    if (!meta) return { sha: null, docs: {} };
    let texto;
    if (meta.content && meta.encoding === "base64") texto = b64decode(meta.content);
    else { const blob = await gh(repoPath() + "/git/blobs/" + meta.sha); texto = b64decode(blob.content); } // arquivos acima de 1 MB
    let docs = {}; try { docs = JSON.parse(texto) || {}; } catch (e) { console.error("Arquivo inválido: dados/" + col + ".json", e); }
    return { sha: meta.sha, docs };
  }

  // Fila por coleção: várias gravações seguidas viram um único commit
  const filas = {};
  function enfileirar(col, op) {
    const f = filas[col] = filas[col] || { ops: [], timer: null };
    return new Promise((resolve, reject) => {
      f.ops.push(Object.assign(op, { resolve, reject }));
      clearTimeout(f.timer);
      f.timer = setTimeout(() => descarregar(col), 250);
    });
  }
  async function descarregar(col) {
    const f = filas[col]; if (!f || !f.ops.length) return;
    if (f.rodando) { f.timer = setTimeout(() => descarregar(col), 300); return; }
    f.rodando = true;
    const ops = f.ops.splice(0);
    let ultimoErro = null;
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      try {
        const atual = await lerArquivo(col);
        const docs = Object.assign({}, atual.docs);
        ops.forEach(o => {
          if (o.tipo === "set") docs[o.id] = o.data;
          else if (o.tipo === "update") { if (!docs[o.id]) throw Object.assign(new Error("documento inexistente"), { code: "invalid_argument" }); docs[o.id] = Object.assign({}, docs[o.id], o.data); }
          else if (o.tipo === "delete") delete docs[o.id];
        });
        const msg = "Central: " + (usuario ? usuario.login : "usuário") + " atualizou " + col + (ops.length > 1 ? " (" + ops.length + " registros)" : ": " + ops[0].id);
        const body = { message: msg, content: b64encode(serializar(docs)), branch: cfg.branch };
        if (atual.sha) body.sha = atual.sha;
        const r = await gh(repoPath() + "/contents/dados/" + col + ".json", { method: "PUT", body });
        cache[col] = { sha: r.content.sha, docs };
        ops.forEach(o => o.resolve());
        f.rodando = false;
        notificar(col);
        return;
      } catch (e) {
        ultimoErro = e;
        if (e.code !== "conflict" && e.status !== 409) break; // conflito: alguém gravou junto, relê e tenta de novo
        await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
      }
    }
    f.rodando = false;
    ops.forEach(o => o.reject(ultimoErro));
  }

  /* ---------------- atualização periódica ---------------- */
  const ouvintesCol = {}, ouvintesDoc = {};
  let headSha = null;
  const snapDoc = (id, data) => ({ id, exists: data != null, data: () => data == null ? undefined : data, metadata: { fromCache: false, hasPendingWrites: false } });
  function snapCol(col) {
    const docs = Object.entries((cache[col] || {}).docs || {}).map(([id, d]) => snapDoc(id, d));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] };
  }
  function notificar(col) {
    (ouvintesCol[col] || new Set()).forEach(l => { try { l.next(snapCol(col)); } catch (e) { console.error(e); } });
    Object.keys(ouvintesDoc).filter(k => k.startsWith(col + "/")).forEach(k => {
      const id = k.slice(col.length + 1), d = ((cache[col] || {}).docs || {})[id];
      ouvintesDoc[k].forEach(l => { try { l.next(snapDoc(id, d == null ? null : d)); } catch (e) { console.error(e); } });
    });
  }
  async function carregar(col) {
    try { cache[col] = await lerArquivo(col); notificar(col); }
    catch (e) { (ouvintesCol[col] || new Set()).forEach(l => l.error && l.error({ code: e.code || "unavailable", message: e.message })); }
  }
  async function verificarMudancas() {
    if (document.visibilityState === "hidden") return;
    try {
      const ref = await gh(repoPath() + "/git/ref/heads/" + encodeURIComponent(cfg.branch));
      if (ref.object.sha === headSha) return;
      headSha = ref.object.sha;
      const usadas = new Set([...Object.keys(ouvintesCol), ...Object.keys(ouvintesDoc).map(k => k.split("/")[0])]);
      for (const col of usadas) await carregar(col);
    } catch (e) { console.warn("Falha ao verificar atualizações", e); }
  }
  conectado.then(() => { setInterval(verificarMudancas, POLL_MS); document.addEventListener("visibilitychange", verificarMudancas); });

  /* ---------------- interface usada pelo painel ---------------- */
  function validar(col) { if (!COLECOES.includes(col)) throw new TypeError("Coleção desconhecida: " + col); }
  function docRef(col, id) {
    validar(col);
    const key = col + "/" + id;
    return {
      id, path: key,
      async get() { if (!cache[col]) await carregar(col); const d = cache[col].docs[id]; return snapDoc(id, d == null ? null : d); },
      set(data) { return enfileirar(col, { tipo: "set", id, data: JSON.parse(JSON.stringify(data)) }); },
      update(data) { return enfileirar(col, { tipo: "update", id, data: JSON.parse(JSON.stringify(data)) }); },
      delete() { return enfileirar(col, { tipo: "delete", id }); },
      onSnapshot(next, error) {
        const l = { next, error }; (ouvintesDoc[key] = ouvintesDoc[key] || new Set()).add(l);
        if (cache[col]) { const d = cache[col].docs[id]; next(snapDoc(id, d == null ? null : d)); } else carregar(col);
        return () => ouvintesDoc[key].delete(l);
      },
    };
  }
  function colRef(col) {
    validar(col);
    return {
      path: col,
      doc(id) { return docRef(col, id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8))); },
      async add(data) { const r = this.doc(); await r.set(data); return r; },
      onSnapshot(next, error) {
        const l = { next, error }; (ouvintesCol[col] = ouvintesCol[col] || new Set()).add(l);
        if (cache[col]) next(snapCol(col)); else carregar(col);
        return () => ouvintesCol[col].delete(l);
      },
      async get() { if (!cache[col]) await carregar(col); return snapCol(col); },
    };
  }
  const db = { collection: colRef, doc(p) { const [c, id] = String(p).split("/"); return docRef(c, id); } };

  const user = {
    async isOwner() { await conectado; return !!(repoInfo.permissions && repoInfo.permissions.admin); },
    async canEdit() { await conectado; return !!(repoInfo.permissions && repoInfo.permissions.push); },
    async can() { return this.canEdit(); },
    async id() { await conectado; return usuario ? String(usuario.id) : null; },
    async me() { await conectado; return { id: usuario ? String(usuario.id) : null, name: usuario ? (usuario.name || usuario.login) : "", email: null }; },
    async profiles() { return {}; },
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { status: "saved" };
    },
  };

  window.claude = {
    async use(name) {
      if (name === "db") { await conectado; return db; }
      if (name === "user") return user;
      if (name === "downloads") return downloads;
      return null; // análise com IA não disponível sem servidor (a chave ficaria exposta)
    },
  };
})();
