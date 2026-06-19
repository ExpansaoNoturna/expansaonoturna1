const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KEY_FILE = path.resolve(__dirname, "data", ".enc_key");

function _getKey() {
  const dir = path.resolve(__dirname, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(KEY_FILE)) return Buffer.from(fs.readFileSync(KEY_FILE, "utf-8").trim(), "hex");
  const k = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, k.toString("hex"), "utf-8");
  return k;
}

const ENC_KEY = _getKey();

function encryptSenha(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function decryptSenha(value) {
  if (!value || typeof value !== "string") return value;
  const parts = value.split(":");
  if (parts.length !== 3) return value;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, Buffer.from(parts[0], "hex"));
    decipher.setAuthTag(Buffer.from(parts[1], "hex"));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], "hex")), decipher.final()]).toString("utf-8");
  } catch (e) {
    return value;
  }
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const SF_BASE = "https://saladofuturo.educacao.sp.gov.br";
const EXPANSAO_BASE = "https://expansao.educacao.sp.gov.br";

const DATA_DIR = path.resolve(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

function carregarDados() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(ACCOUNTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf-8"));
  } catch (e) {
    return {};
  }
}

function salvarDados(dados) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(dados, null, 2), "utf-8");
  } catch (e) {}
}

let dados = carregarDados();

function getSessaoAtiva(userId) {
  return dados[userId]?.sessaoAtiva || null;
}

function getContas(userId) {
  return (dados[userId]?.contas || []).map(c => ({ ...c, senha: decryptSenha(c.senha) }));
}

function salvarConta(userId, conta) {
  if (!dados[userId]) dados[userId] = { sessaoAtiva: null, contas: [] };
  const contaParaSalvar = { ...conta, senha: encryptSenha(conta.senha) };
  const idx = dados[userId].contas.findIndex(c => c.ra === conta.ra && c.dg === conta.dg);
  if (idx >= 0) dados[userId].contas[idx] = contaParaSalvar;
  else dados[userId].contas.push(contaParaSalvar);
  dados[userId].sessaoAtiva = conta;
  salvarDados(dados);
}

function setSessaoAtiva(userId, conta) {
  if (!dados[userId]) dados[userId] = { sessaoAtiva: null, contas: [] };
  dados[userId].sessaoAtiva = conta;
  salvarDados(dados);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: espera genérica
// ─────────────────────────────────────────────────────────────────────────────
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: tenta clicar num seletor com múltiplos fallbacks
// ─────────────────────────────────────────────────────────────────────────────
async function clicarComFallback(page, seletores, descricao) {
  for (const seletor of seletores) {
    try {
      const el = await page.$(seletor);
      if (el) {
        await el.click();
        return true;
      }
    } catch (_) {}
  }
  // Fallback final: avalia no contexto da página
  const clicou = await page.evaluate((sels) => {
    for (const s of sels) {
      try {
        const el = document.querySelector(s);
        if (el) { el.click(); return true; }
      } catch (_) {}
    }
    return false;
  }, seletores).catch(() => false);
  if (!clicou) throw new Error(`Elemento não encontrado: ${descricao}`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: extrai sesskey do Moodle com múltiplos métodos
// ─────────────────────────────────────────────────────────────────────────────
async function extrairSesskey(page) {
  // Método 1: window.M.cfg.sesskey (padrão Moodle)
  try {
    const sk = await page.evaluate(() => window.M?.cfg?.sesskey || null);
    if (sk) return sk;
  } catch (_) {}

  // Método 2: meta tag
  try {
    const sk = await page.evaluate(() => {
      const m = document.querySelector('meta[name="sesskey"]') || document.querySelector('input[name="sesskey"]');
      return m ? (m.content || m.value || null) : null;
    });
    if (sk) return sk;
  } catch (_) {}

  // Método 3: YUI_config
  try {
    const sk = await page.evaluate(() => window.YUI_config?.Moodle?.cfg?.sesskey || null);
    if (sk) return sk;
  } catch (_) {}

  // Método 4: extrair da URL de algum link na página
  try {
    const sk = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="sesskey="]')];
      if (!links.length) return null;
      const match = links[0].href.match(/sesskey=([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    });
    if (sk) return sk;
  } catch (_) {}

  // Método 5: extrair do HTML bruto
  try {
    const html = await page.content();
    const match = html.match(/"sesskey"\s*:\s*"([a-zA-Z0-9]+)"/);
    if (match) return match[1];
    const match2 = html.match(/sesskey=([a-zA-Z0-9]+)/);
    if (match2) return match2[1];
  } catch (_) {}

  throw new Error("Não foi possível extrair o sesskey do Moodle");
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: extrai userId do Moodle com múltiplos métodos
// ─────────────────────────────────────────────────────────────────────────────
async function extrairMoodleUserId(page) {
  try {
    const id = await page.evaluate(() => {
      if (window.M?.cfg?.userid) return window.M.cfg.userid;
      if (window.YUI_config?.Moodle?.cfg?.userid) return window.YUI_config.Moodle.cfg.userid;
      const meta = document.querySelector('meta[name="userId"]') || document.querySelector('meta[name="user-id"]');
      if (meta) return meta.getAttribute("content");
      const bodyClass = document.body?.className || "";
      const uidMatch = bodyClass.match(/user-(\d+)/);
      if (uidMatch) return uidMatch[1];
      if (document.body?.dataset?.userid) return document.body.dataset.userid;
      // Tenta achar em links de perfil
      const profileLink = document.querySelector('a[href*="user/profile.php?id="]');
      if (profileLink) {
        const m = profileLink.href.match(/id=(\d+)/);
        if (m) return m[1];
      }
      return null;
    });
    if (id) return id;
  } catch (_) {}

  // Fallback: tentar via HTML bruto
  try {
    const html = await page.content();
    const patterns = [
      /"userid"\s*:\s*(\d+)/,
      /userid=(\d+)/,
      /user-(\d+)/,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return m[1];
    }
  } catch (_) {}

  return null; // não é crítico
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: aguarda o Moodle carregar com múltiplas estratégias
// ─────────────────────────────────────────────────────────────────────────────
async function aguardarMoodleCarregar(page, timeoutMs = 90000) {
  const inicio = Date.now();

  // Estratégia 1: aguarda window.M.cfg.sesskey
  try {
    await page.waitForFunction(() => window.M?.cfg?.sesskey, { timeout: timeoutMs });
    return "M.cfg";
  } catch (_) {}

  // Estratégia 2: aguarda MoodleSession aparecer nos cookies
  try {
    const cookies = await page.cookies();
    if (cookies.find(c => c.name === "MoodleSession")) return "cookie";
  } catch (_) {}

  // Estratégia 3: aguarda algum elemento típico do Moodle
  const seletoresMoodle = [
    '#page-wrapper',
    '.usermenu',
    '#nav-drawer',
    '.navbar',
    'body.moodle-has-zindex',
    '#page',
    '.course-content',
    '.course-info-container',
  ];
  for (const sel of seletoresMoodle) {
    try {
      const restante = timeoutMs - (Date.now() - inicio);
      if (restante <= 0) break;
      await page.waitForSelector(sel, { timeout: Math.min(restante, 15000) });
      return sel;
    } catch (_) {}
  }

  // Estratégia 4: aguarda a URL mudar para algo do expansao
  try {
    const url = page.url();
    if (url && url !== "about:blank" && url.includes("expansao")) return "url";
  } catch (_) {}

  // Estratégia 5: aguarda networkidle
  try {
    const restante = timeoutMs - (Date.now() - inicio);
    if (restante > 0) {
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: Math.min(restante, 20000) }).catch(() => {});
      return "networkidle";
    }
  } catch (_) {}

  // Se chegou aqui, tentamos mesmo assim
  return "timeout_fallback";
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: aguarda nova aba abrir com múltiplos fallbacks
// ─────────────────────────────────────────────────────────────────────────────
async function aguardarNovaAba(browser, paginasAntes, timeoutMs = 30000) {
  const inicio = Date.now();

  // Método 1: polling de novas páginas
  while (Date.now() - inicio < timeoutMs) {
    await espera(800);
    const paginas = await browser.pages();
    const novas = paginas.filter(p => !paginasAntes.includes(p));
    if (novas.length > 0) return novas[novas.length - 1];
  }

  // Método 2: verifica todas as páginas abertas (talvez a aba já tenha aberto antes de registrar)
  const todasPaginas = await browser.pages();
  if (todasPaginas.length > paginasAntes.length) {
    return todasPaginas[todasPaginas.length - 1];
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: aguarda card da Expansão Noturno aparecer com múltiplos seletores
// ─────────────────────────────────────────────────────────────────────────────
async function aguardarCardExpansao(page, timeoutMs = 40000) {
  const inicio = Date.now();

  // Estratégia 1: texto exato h5
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('h5.MuiTypography-h5, h5, h4, h3')]
        .some(el => el.textContent.trim().toUpperCase().includes("EXPANS")),
      { timeout: Math.min(timeoutMs, 20000) }
    );
    return "h5-texto";
  } catch (_) {}

  const restante1 = timeoutMs - (Date.now() - inicio);
  if (restante1 <= 0) return "timeout";

  // Estratégia 2: imagem conhecida
  try {
    await page.waitForFunction(
      () => document.querySelector('img[src*="mairaeliasman3315708-sp"]') ||
            document.querySelector('img[src*="xR5olQ4KQUkyIA4sAYOucKMX8d3GYu.png"]') ||
            document.querySelector('img[alt*="Expans"]') ||
            document.querySelector('img[alt*="Noturno"]'),
      { timeout: Math.min(restante1, 15000) }
    );
    return "img";
  } catch (_) {}

  const restante2 = timeoutMs - (Date.now() - inicio);
  if (restante2 <= 0) return "timeout";

  // Estratégia 3: qualquer card MUI disponível
  try {
    await page.waitForSelector('.MuiCard-root', { timeout: Math.min(restante2, 10000) });
    return "any-card";
  } catch (_) {}

  return "timeout";
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: clica no card da Expansão Noturno com múltiplos fallbacks
// ─────────────────────────────────────────────────────────────────────────────
async function clicarCardExpansao(page) {
  return page.evaluate(() => {
    // Tentativa 1: imagem específica conhecida
    const imgEspecifica =
      document.querySelector('img[src*="mairaeliasman3315708-sp"]') ||
      document.querySelector('img[src*="xR5olQ4KQUkyIA4sAYOucKMX8d3GYu.png"]');
    if (imgEspecifica) {
      const card = imgEspecifica.closest('.MuiCard-root') ||
                   imgEspecifica.closest('button') ||
                   imgEspecifica.closest('div[role="button"]') ||
                   imgEspecifica;
      card.click();
      return "img-especifica";
    }

    // Tentativa 2: texto exato h5 "Expansão Noturno"
    const h5Exato = [...document.querySelectorAll('h5.MuiTypography-h5')]
      .find(el => el.textContent.trim() === "Expansão Noturno");
    if (h5Exato) {
      const card = h5Exato.closest('.MuiCard-root');
      if (card) { card.click(); return "h5-exato-card"; }
      h5Exato.click();
      return "h5-exato-click";
    }

    // Tentativa 3: qualquer elemento com "Expansão" no texto
    const qualquerExpansao = [...document.querySelectorAll('h5, h4, h3, p, span')]
      .find(el => el.textContent.trim().toUpperCase().includes("EXPANS") &&
                  el.textContent.trim().toUpperCase().includes("NOTURNO"));
    if (qualquerExpansao) {
      const card = qualquerExpansao.closest('.MuiCard-root') ||
                   qualquerExpansao.closest('button') ||
                   qualquerExpansao.closest('div[role="button"]') ||
                   qualquerExpansao.closest('[class*="card"]') ||
                   qualquerExpansao.closest('[class*="Card"]');
      if (card) { card.click(); return "texto-noturno-card"; }
      qualquerExpansao.click();
      return "texto-noturno-click";
    }

    // Tentativa 4: só "EXPANSÃO" (sem "Noturno")
    const somenteExpansao = [...document.querySelectorAll('h5, h4, h3, p, span')]
      .find(el => el.textContent.trim().toUpperCase().includes("EXPANS"));
    if (somenteExpansao) {
      const card = somenteExpansao.closest('.MuiCard-root') ||
                   somenteExpansao.closest('button') ||
                   somenteExpansao.closest('div[role="button"]') ||
                   somenteExpansao;
      card.click();
      return "texto-expansao-only";
    }

    // Tentativa 5: imagem com alt contendo "expans"
    const imgAlt = [...document.querySelectorAll('img')]
      .find(img => (img.alt || "").toUpperCase().includes("EXPANS"));
    if (imgAlt) {
      const card = imgAlt.closest('.MuiCard-root') || imgAlt.closest('button') || imgAlt;
      card.click();
      return "img-alt";
    }

    // Tentativa 6: primeiro card disponível (último recurso)
    const primeiroCard = document.querySelector('.MuiCard-root');
    if (primeiroCard) {
      primeiroCard.click();
      return "primeiro-card-fallback";
    }

    return null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: aguarda aba sair de about:blank com retries
// ─────────────────────────────────────────────────────────────────────────────
async function aguardarAbaCarregar(aba, timeoutMs = 30000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    try {
      const url = aba.url();
      if (url && url !== "about:blank" && url !== "") return url;
    } catch (_) {}
    await espera(1000);
  }
  return aba.url().catch(() => "desconhecida");
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL DE LOGIN
// ─────────────────────────────────────────────────────────────────────────────
async function moodleLogin(ra, digito, senha, onProgresso = () => {}) {
  const puppeteer = require("puppeteer");

  const status = {
    chrome: "loading", sala: "waiting", perfil: "waiting",
    ra: "waiting", senha: "waiting", acessar: "waiting",
    plataforma: "waiting", expansao: "waiting", moodle: "waiting", cursos: "waiting"
  };

  onProgresso(status);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote",
        "--single-process", "--disable-gpu",
      ],
    });

    status.chrome = "ok";
    status.sala = "loading";
    onProgresso(status);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(UA);

    // ── Acessa a Sala do Futuro ──────────────────────────────────────────────
    await page.goto(`${SF_BASE}/escolha-de-perfil`, { waitUntil: "networkidle2", timeout: 30000 });
    await espera(2000);

    status.sala = "ok";
    status.perfil = "loading";
    onProgresso(status);

    // ── Seleciona perfil Estudante ───────────────────────────────────────────
    // Tenta aguardar o seletor por múltiplos caminhos
    const seletoresPerfil = [
      'p.MuiTypography-root',
      '[class*="MuiTypography"]',
      'button',
      'div[role="button"]',
      'span',
    ];
    let encontrouPerfil = false;
    for (const sel of seletoresPerfil) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        encontrouPerfil = true;
        break;
      } catch (_) {}
    }
    if (!encontrouPerfil) await espera(3000); // espera cega

    await espera(1000);

    const clicouEstudante = await page.evaluate(() => {
      // Tentativa 1: p.MuiTypography exato
      let el = [...document.querySelectorAll('p.MuiTypography-root')]
        .find(e => e.textContent.trim() === "Estudante");
      if (el) { el.click(); return "p-mui"; }

      // Tentativa 2: qualquer elemento com texto "Estudante"
      el = [...document.querySelectorAll('p, span, div, button')]
        .find(e => e.textContent.trim() === "Estudante");
      if (el) { el.click(); return "generico"; }

      // Tentativa 3: contém "Estudante"
      el = [...document.querySelectorAll('p, span, div, button')]
        .find(e => e.textContent.trim().toLowerCase().includes("estudante"));
      if (el) { el.click(); return "contains"; }

      return null;
    });
    if (!clicouEstudante) throw new Error("Botão 'Estudante' não encontrado");

    status.perfil = "ok";
    status.ra = "loading";
    onProgresso(status);

    // ── Preenche RA ──────────────────────────────────────────────────────────
    const seletoresRA = ['#input-usuario-sed', '[name="usuario-sed"]', 'input[placeholder*="RA"]', 'input[type="text"]'];
    let inputRA = null;
    for (const sel of seletoresRA) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        inputRA = sel;
        break;
      } catch (_) {}
    }
    if (!inputRA) throw new Error("Campo de RA não encontrado");

    await espera(2000);
    await page.click(inputRA, { clickCount: 3 });
    await espera(300);
    await page.type(inputRA, String(ra).trim(), { delay: 50 });
    await espera(500);

    // ── Preenche Dígito ──────────────────────────────────────────────────────
    const seletoresDG = ['[name="digito-ra"]', 'input[placeholder*="ígito"]', 'input[maxlength="1"]'];
    let inputDG = null;
    for (const sel of seletoresDG) {
      try {
        const el = await page.$(sel);
        if (el) { inputDG = sel; break; }
      } catch (_) {}
    }
    if (inputDG) {
      await page.click(inputDG, { clickCount: 3 });
      await espera(300);
      await page.type(inputDG, String(digito).trim(), { delay: 50 });
      await espera(500);
    }

    status.ra = "ok";
    status.senha = "loading";
    onProgresso(status);

    // ── Preenche Senha ───────────────────────────────────────────────────────
    const seletoresSenha = ['#input-senha', 'input[type="password"]', '[name="senha"]', 'input[placeholder*="enha"]'];
    let inputSenha = null;
    for (const sel of seletoresSenha) {
      try {
        const el = await page.$(sel);
        if (el) { inputSenha = sel; break; }
      } catch (_) {}
    }
    if (!inputSenha) throw new Error("Campo de senha não encontrado");

    await page.click(inputSenha, { clickCount: 3 });
    await espera(300);
    await page.type(inputSenha, String(senha).trim(), { delay: 50 });
    await espera(500);

    status.senha = "ok";
    status.acessar = "loading";
    onProgresso(status);

    // ── Clica em Acessar ─────────────────────────────────────────────────────
    const clicouAcessar = await page.evaluate(() => {
      let btn = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'Acessar');
      if (!btn) btn = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim().toLowerCase().includes('acessar'));
      if (!btn) btn = document.querySelector('button[type="submit"]');
      if (!btn) btn = [...document.querySelectorAll('button')].find(b => !b.disabled);
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    });
    if (!clicouAcessar) throw new Error("Botão Acessar não encontrado");

    // Aguarda navegação com múltiplos fallbacks
    try {
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 });
    } catch (_) {
      // Fallback: espera cega
      await espera(5000);
    }
    await espera(2000);

    if (page.url().includes("login") || page.url().includes("escolha")) {
      throw new Error("RA, dígito ou senha incorretos.");
    }

    const nome = await page.evaluate(() => {
      const el = document.querySelector('[class*="nome"], [class*="Name"], h1, h2');
      return el ? el.textContent.trim() : null;
    }).catch(() => null);

    status.acessar = "ok";
    status.plataforma = "loading";
    onProgresso(status);

    // ── Carrega Plataformas ──────────────────────────────────────────────────
    await page.goto(`${SF_BASE}/plataformas`, { waitUntil: "networkidle2", timeout: 30000 });
    await espera(4000);

    // Screenshot de debug
    await page.screenshot({ path: path.join(DATA_DIR, "debug_plataformas.png"), fullPage: true }).catch(() => {});

    // ── PASSO 1: Sempre abre o dropdown e seleciona a opção com "EXPANSÃO" ───
    // A página pode carregar com qualquer turma selecionada (ex: "3ª D - EM EXATAS")
    // então SEMPRE precisamos trocar para a opção que contenha "EXPANSÃO"

    // Aguarda o dropdown aparecer
    const seletoresDropdown = [
      '[class*="MuiSelect-select"]',
      '[aria-haspopup="listbox"]',
      '[role="combobox"]',
      'select',
    ];
    let dropdownEl = null;
    for (const sel of seletoresDropdown) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        dropdownEl = sel;
        break;
      } catch (_) {}
    }

    // Verifica se o dropdown atual já está na opção correta
    const opcaoAtualTexto = await page.evaluate((sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) return el.textContent.trim().toUpperCase();
      }
      return "";
    }, seletoresDropdown);

    const jaEstaEmExpansao = opcaoAtualTexto.includes("EXPANS") || opcaoAtualTexto.includes("NOTURNO");

    if (!jaEstaEmExpansao && dropdownEl) {
      // Clica no dropdown para abrir
      await page.click(dropdownEl).catch(() => {});
      await espera(1500);

      // Aguarda as opções aparecerem
      try {
        await page.waitForSelector('[role="option"], li[role="option"]', { timeout: 8000 });
      } catch (_) {
        await espera(2000);
      }

      // Clica na opção que contém "EXPANSÃO" (qualquer série)
      const selecionou = await page.evaluate(() => {
        const candidatos = [
          ...document.querySelectorAll('[role="option"]'),
          ...document.querySelectorAll('li[role="option"]'),
          ...document.querySelectorAll('option'),
          ...document.querySelectorAll('li'),
        ];
        // Prioridade 1: contém EXPANSÃO E NOTURNO
        let op = candidatos.find(o =>
          o.textContent.toUpperCase().includes("EXPANS") &&
          o.textContent.toUpperCase().includes("NOTURNO")
        );
        // Prioridade 2: só EXPANSÃO
        if (!op) op = candidatos.find(o => o.textContent.toUpperCase().includes("EXPANS"));
        // Prioridade 3: NOITE (turno noturno)
        if (!op) op = candidatos.find(o => o.textContent.toUpperCase().includes("NOITE"));
        if (op) { op.click(); return op.textContent.trim(); }
        return null;
      });

      if (!selecionou) {
        // Fecha o dropdown se abriu e não achou a opção
        await page.keyboard.press('Escape').catch(() => {});
      }

      // Aguarda a página atualizar os cards após a seleção
      await espera(3000);
    }

    // Screenshot após seleção do dropdown
    await page.screenshot({ path: path.join(DATA_DIR, "debug_apos_dropdown.png"), fullPage: true }).catch(() => {});

    // ── PASSO 2: Aguarda o card "Expansão Noturno" aparecer ──────────────────
    // Usa o mesmo waitForFunction do código antigo que funcionava
    await page.waitForFunction(() => {
      const all = [...document.querySelectorAll('*')];
      return all.some(el =>
        el.childNodes.length === 1 &&
        el.childNodes[0]?.nodeType === Node.TEXT_NODE &&
        el.textContent.includes("Expansão Noturno")
      );
    }, { timeout: 25000 }).catch(async () => {
      // Fallback: aguarda qualquer card MUI ou texto com "expansão"
      await page.waitForFunction(() => {
        const all = [...document.querySelectorAll('*')];
        return all.some(el => el.textContent.toUpperCase().includes("EXPANS") && el.children.length === 0);
      }, { timeout: 10000 }).catch(() => {});
    });

    await espera(1000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await espera(800);

    // Dump dos textos visíveis para debug
    const textosVisiveis = await page.evaluate(() => {
      return [...document.querySelectorAll('h5, h4, h3, p, span, div')]
        .map(el => el.textContent.trim())
        .filter(t => t.length > 3 && t.length < 60)
        .slice(0, 30);
    }).catch(() => []);
    console.log("📋 Textos visíveis na página:", textosVisiveis);

    status.plataforma = "ok";
    status.expansao = "loading";
    onProgresso(status);

    // ── PASSO 3: Registra targetcreated ANTES de clicar (crítico!) ───────────
    let resolveNovaAba, rejectNovaAba;
    const promiseNovaAba = new Promise((res, rej) => {
      resolveNovaAba = res;
      rejectNovaAba = rej;
    });
    const timerNovaAba = setTimeout(() => rejectNovaAba(new Error("timeout")), 25000);
    browser.once("targetcreated", t => { clearTimeout(timerNovaAba); resolveNovaAba(t); });

    // ── PASSO 4: Clica no card usando método do código antigo (subir DOM) ────
    const clicouCard = await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')];

      // Método 1: texto exato "Expansão Noturno" — sobe na árvore até clicável
      const textNode = all.find(el =>
        el.childNodes.length === 1 &&
        el.childNodes[0]?.nodeType === Node.TEXT_NODE &&
        el.textContent.trim() === "Expansão Noturno"
      );
      if (textNode) {
        let el = textNode;
        for (let i = 0; i < 12; i++) {
          if (!el) break;
          const tag = el.tagName;
          const style = window.getComputedStyle(el);
          if (tag === 'A' || tag === 'BUTTON' || style.cursor === 'pointer') {
            el.click(); return "text-exato-cursor";
          }
          el = el.parentElement;
        }
        textNode.click();
        return "text-exato-fallback";
      }

      // Método 2: contém "Expansão Noturno" (texto parcial)
      const parcial = all.find(el =>
        el.children.length === 0 &&
        el.textContent.trim().includes("Expansão Noturno")
      );
      if (parcial) {
        const card = parcial.closest('.MuiCard-root') ||
                     parcial.closest('button') ||
                     parcial.closest('[role="button"]') ||
                     parcial.parentElement;
        (card || parcial).click();
        return "text-parcial";
      }

      // Método 3: imagem com src/alt
      const img = document.querySelector('img[src*="expansao"], img[alt*="Expans"], img[alt*="Noturno"]');
      if (img) {
        const card = img.closest('.MuiCard-root') || img.closest('button') || img.parentElement;
        (card || img).click();
        return "img";
      }

      // Método 4: qualquer elemento com EXPANSÃO no texto e cursor pointer
      const qualquer = all.find(el =>
        el.textContent.toUpperCase().includes("EXPANS") &&
        window.getComputedStyle(el).cursor === 'pointer'
      );
      if (qualquer) { qualquer.click(); return "cursor-pointer"; }

      return null;
    });

    console.log(`🖱️ Clique no card: ${clicouCard}`);

    // ── PASSO 5: Captura a nova aba ───────────────────────────────────────────
    let novaAba = null;

    if (clicouCard) {
      // Aguarda targetcreated (registrado antes do clique)
      try {
        const target = await promiseNovaAba;
        novaAba = await target.page();
      } catch (_) {}
    } else {
      // Cancela o listener pendente
      clearTimeout(timerNovaAba);
      browser.removeAllListeners("targetcreated");
    }

    // Fallback 1: procura aba do Expansão já aberta por URL
    if (!novaAba) {
      const todasPaginas = await browser.pages();
      for (const p of todasPaginas) {
        try {
          const u = p.url();
          if (u && u.includes("expansao") && u !== "about:blank") { novaAba = p; break; }
        } catch (_) {}
      }
    }

    // Fallback 2: polling
    if (!novaAba) {
      novaAba = await aguardarNovaAba(browser, await browser.pages(), 15000);
    }

    // Fallback 3: abre diretamente via SSO (sessão já está ativa)
    if (!novaAba) {
      const novaPage = await browser.newPage();
      await novaPage.setUserAgent(UA);
      await novaPage.goto(EXPANSAO_BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
      await espera(3000);
      const urlDireta = novaPage.url();
      if (urlDireta.includes("login")) {
        await novaPage.close().catch(() => {});
        throw new Error(`Card não clicado (${clicouCard || 'null'}) e SSO não autenticou. Textos na página: ${textosVisiveis.join(', ')}`);
      }
      novaAba = novaPage;
    }

    await novaAba.setUserAgent(UA);
    await aguardarAbaCarregar(novaAba, 20000);
    await espera(1500);

    status.expansao = "ok";
    status.moodle = "loading";
    onProgresso(status);

    return await finalizarLoginMoodle(novaAba, browser, nome, status, onProgresso);

  } catch (err) {
    for (const key of Object.keys(status)) {
      if (status[key] === "loading") status[key] = "erro";
    }
    onProgresso(status);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Finaliza o login no Moodle após a aba abrir
// ─────────────────────────────────────────────────────────────────────────────
async function finalizarLoginMoodle(novaAba, browser, nome, status, onProgresso) {
  // Aguarda sesskey via waitForFunction (método confiável do código antigo)
  // com fallback para as estratégias múltiplas
  try {
    await novaAba.waitForFunction(() => window.M?.cfg?.sesskey, { timeout: 45000 });
  } catch (_) {
    // Fallback: estratégias múltiplas
    await aguardarMoodleCarregar(novaAba, 45000);
  }

  // Extrai sesskey com fallbacks
  const sesskey = await extrairSesskey(novaAba);

  // Extrai userId com fallbacks
  const moodleUserId = await extrairMoodleUserId(novaAba);

  // Cookies do Moodle
  const rawCookies = await novaAba.cookies();
  const moodleCookies = rawCookies.map(c => `${c.name}=${c.value}`);
  if (!moodleCookies.find(c => c.startsWith("MoodleSession="))) {
    throw new Error("MoodleSession não encontrado nos cookies");
  }

  status.moodle = "ok";
  status.cursos = "loading";
  onProgresso(status);

  // Scraping dos cursos
  await novaAba.waitForSelector('.course-info-container', { timeout: 10000 }).catch(() => null);

  const cursosScraped = await novaAba.evaluate(() => {
    const cards = document.querySelectorAll('.course-info-container');
    const result = [];
    cards.forEach(card => {
      const linkEl = card.querySelector('a.coursename');
      if (!linkEl) return;
      const href = linkEl.href || "";
      const idMatch = href.match(/id=(\d+)/);
      if (!idMatch) return;
      const id = parseInt(idMatch[1]);
      let fullname = "";
      const multilineEl = linkEl.querySelector('.multiline');
      if (multilineEl) {
        fullname = multilineEl.textContent.trim();
      } else {
        const clone = linkEl.cloneNode(true);
        const srOnlyEl = clone.querySelector('.sr-only');
        if (srOnlyEl) srOnlyEl.remove();
        fullname = clone.textContent.trim();
      }
      const statsSpans = [...card.querySelectorAll('.course-stats')];
      let bimestre = "";
      let atividades = null;
      statsSpans.forEach(span => {
        const text = span.textContent.trim();
        if (text.toLowerCase().includes("bimestre")) {
          const match = text.match(/(\d+)/);
          bimestre = match ? `${match[1]}°` : text;
        } else if (text.toLowerCase().includes("atividades")) {
          const match = text.match(/(\d+)/);
          atividades = match ? parseInt(match[1]) : null;
        }
      });
      const summaryEl = card.querySelector('.summary-card');
      const summary = summaryEl ? summaryEl.textContent.trim() : "";
      result.push({ id, fullname, summary, bimestre, atividades });
    });
    return result;
  }).catch(() => []);

  status.cursos = "ok";
  onProgresso(status);

  return { sesskey, moodleCookies, nome, moodleUserId, cursosScraped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Restante das funções (sem alteração)
// ─────────────────────────────────────────────────────────────────────────────

async function moodleService(sesskey, moodleCookies, calls) {
  const res = await fetch(
    `${EXPANSAO_BASE}/lib/ajax/service.php?sesskey=${sesskey}&info=${calls.map(c => c.methodname).join(",")}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": UA,
        "cookie": moodleCookies.join("; "),
        "origin": EXPANSAO_BASE,
        "referer": `${EXPANSAO_BASE}/`,
      },
      body: JSON.stringify(calls.map((c, i) => ({ index: i, methodname: c.methodname, args: c.args }))),
    }
  );
  return res.json();
}

async function obterSecoesCurso(sesskey, moodleCookies, courseId) {
  const result = await moodleService(sesskey, moodleCookies, [
    { methodname: "core_courseformat_get_state", args: { courseid: courseId } },
  ]);
  const raw = result?.[0]?.data;
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function buscarCursosDoUsuario(sesskey, moodleCookies, moodleUserId) {
  try {
    const result = await moodleService(sesskey, moodleCookies, [
      { methodname: "core_enrol_get_users_courses", args: { userid: Number(moodleUserId), returnusercount: 0 } },
    ]);

    const cursosRaw = result?.[0]?.data || result?.[0];

    if (!cursosRaw || cursosRaw.error || cursosRaw.exception) {
      const fallbackRes = await fetch(
        `${EXPANSAO_BASE}/lib/ajax/service.php?sesskey=${sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": UA,
            "cookie": moodleCookies.join("; "),
            "origin": EXPANSAO_BASE,
            "referer": `${EXPANSAO_BASE}/my/`,
          },
          body: JSON.stringify([{
            index: 0,
            methodname: "core_course_get_enrolled_courses_by_timeline_classification",
            args: { offset: 0, limit: 0, classification: "all", sort: "fullname", customfieldname: "", customfieldvalue: "" },
          }]),
        }
      );
      const fallbackData = await fallbackRes.json();
      const fallbackCursos = fallbackData?.[0]?.data?.courses || fallbackData?.[0]?.data || [];
      const parsed = typeof fallbackCursos === "string" ? JSON.parse(fallbackCursos) : fallbackCursos;
      const lista = Array.isArray(parsed) ? parsed : (parsed?.courses || []);

      return lista.map(c => {
        const nome = (c.fullname || c.shortname || `Curso ${c.id}`).replace(/\s+/g, " ").trim();
        const resumo = (c.summary || "").replace(/<[^>]*>/g, "").trim().slice(0, 200);
        const bimMatch = (nome + " " + resumo).match(/(\d)[°º]\s*[Bb]imestre/) || (nome + " " + resumo).match(/[Bb]imestre\s*(\d)/);
        const bimestre = bimMatch ? `${bimMatch[1]}°` : "";
        return { id: c.id, fullname: nome, summary: resumo, atividades: null, bimestre };
      }).filter(c => c.id > 1);
    }

    let lista = typeof cursosRaw === "string" ? JSON.parse(cursosRaw) : cursosRaw;
    if (!Array.isArray(lista)) lista = lista?.courses || [];

    return lista.map(c => {
      const nome = (c.fullname || c.shortname || `Curso ${c.id}`).replace(/\s+/g, " ").trim();
      const resumo = (c.summary || "").replace(/<[^>]*>/g, "").trim().slice(0, 200);
      const bimMatch = (nome + " " + resumo).match(/(\d)[°º]\s*[Bb]imestre/) || (nome + " " + resumo).match(/[Bb]imestre\s*(\d)/);
      const bimestre = bimMatch ? `${bimMatch[1]}°` : "";
      return { id: c.id, fullname: nome, summary: resumo, atividades: null, bimestre };
    }).filter(c => c.id > 1);
  } catch (e) {
    return [];
  }
}

function getCurso(sessao, courseId) {
  if (sessao?.cursos?.length) {
    const c = sessao.cursos.find(c => Number(c.id) === Number(courseId));
    if (c) return { id: c.id, nome: c.fullname || `Curso ${c.id}`, bimestre: c.bimestre || "" };
  }
  return { id: courseId, nome: `Curso ${courseId}`, bimestre: "" };
}

function montarOpcoesSelect(sessao) {
  if (sessao?.cursos?.length) {
    return sessao.cursos.slice(0, 25).map(c => {
      const bim = c.bimestre ? ` — ${c.bimestre} Bimestre` : "";
      const label = `${c.fullname || `Curso ${c.id}`}${bim}`.slice(0, 100);
      const desc = c.summary ? c.summary.slice(0, 100) : (c.atividades ? `${c.atividades} atividades` : "Clique para ver as aulas");
      return { label, description: desc, value: String(c.id), emoji: "📚" };
    });
  }
  return [{ label: "Nenhum curso encontrado — faça login novamente", value: "0", emoji: "⚠️" }];
}

async function rodarAtividadesSecao(sessao, itens, onProgresso) {
  const puppeteer = require("puppeteer");

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote",
      "--single-process", "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(UA);

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "media"].includes(type)) req.abort();
      else req.continue();
    });

    const dominio = new URL(EXPANSAO_BASE).hostname;
    const cookiesToSet = sessao.moodleCookies.map(raw => {
      const eqIdx = raw.indexOf("=");
      return { name: raw.slice(0, eqIdx), value: raw.slice(eqIdx + 1), domain: dominio, path: "/" };
    });
    await page.setCookie(...cookiesToSet);

    const itensComUrl = itens.filter(cm => cm.url);
    let concluidos = 0;

    for (let i = 0; i < itensComUrl.length; i++) {
      const cm = itensComUrl[i];
      const nome = cm.name || cm.module;

      await onProgresso({ index: i, total: itensComUrl.length, nome, status: "abrindo", concluidos });

      try {
        await page.goto(cm.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await espera(1200);

        await page.evaluate(async () => {
          await new Promise(resolve => {
            const total = document.body.scrollHeight;
            let pos = 0;
            const passo = Math.max(180, Math.floor(total / 12));
            const id = setInterval(() => {
              pos += passo;
              window.scrollTo(0, pos);
              if (pos >= total) { clearInterval(id); resolve(); }
            }, 320);
          });
        });

        await espera(1800);
        concluidos++;
        await onProgresso({ index: i, total: itensComUrl.length, nome, status: "ok", concluidos });
      } catch (err) {
        await onProgresso({ index: i, total: itensComUrl.length, nome, status: "erro", concluidos });
      }

      if (i < itensComUrl.length - 1) await espera(600);
    }

    return { concluidos, total: itensComUrl.length };
  } finally {
    await browser.close();
  }
}

function moduloIcone(mod) {
  const icones = {
    quiz: "📝", page: "📄", resource: "📎", url: "🔗",
    label: "🏷️", assign: "📑", forum: "💬", lesson: "📖",
    h5pactivity: "🎮", video: "🎬",
  };
  return icones[mod] || "📌";
}

function moduloNomeAmigavel(mod) {
  const nomes = {
    quiz: "Questionário", page: "Página", resource: "Material de leitura",
    url: "Link externo", label: "Texto", assign: "Atividade",
    forum: "Fórum", lesson: "Lição", h5pactivity: "Atividade interativa",
    video: "Vídeo",
  };
  return nomes[mod] || mod;
}

function listarSecoes(data) {
  return (data.section || [])
    .filter(s => s.number > 0 && s.title)
    .sort((a, b) => a.number - b.number);
}

function listarAtividadesDaSecao(data, sectionId) {
  const secao = (data.section || []).find(s => Number(s.id) === Number(sectionId));
  if (!secao) return [];
  const cmPorId = new Map((data.cm || []).map(cm => [Number(cm.id), cm]));
  return (secao.cmlist || []).map(cmId => cmPorId.get(Number(cmId))).filter(Boolean);
}

function montarEmbedAtividade(curso, secaoNome, itens, index) {
  const cm = itens[index];
  if (!cm) return null;

  const status = cm.completionstate === 1 ? "✅ Concluído" : "⬜ Não concluído";
  const link = cm.url ? `\n\n🔗 [Abrir no navegador](${cm.url})` : "";

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${index + 1}. ${cm.name || cm.module}`)
    .setDescription(`${moduloIcone(cm.module)} **${moduloNomeAmigavel(cm.module)}**\nStatus: ${status}${link}`)
    .setFooter({ text: `${curso?.nome || ""} — ${curso?.bimestre || ""} Bimestre • ${secaoNome} • Atividade ${index + 1} de ${itens.length}` });
}

const autoAdvanceTimers = new Map();

function cancelarAutoAdvance(userId) {
  const entry = autoAdvanceTimers.get(userId);
  if (entry) {
    clearTimeout(entry.timer);
    autoAdvanceTimers.delete(userId);
  }
}

const activeSlots = [];
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");

function carregarFila() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
  } catch (e) {
    return [];
  }
}

function salvarFila() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
  } catch (e) {}
}

const queue = carregarFila();
const userActivity = new Map();
const userBusy = new Set();
const userChannels = new Map();

function obterTextoFila(userId) {
  if (queue.length === 0) return "Fila vazia.";
  const posicao = queue.indexOf(userId) + 1;
  const listaMencionada = queue.map((id, index) => `${index + 1}. <@${id}>`).join("\n");
  return `📋 **Fila de Espera:**\n${listaMencionada}\n\nSua posição na fila: **${posicao}°**`;
}

function formatarProgressoLogin(progresso) {
  const passos = [
    { key: "chrome", label: "Abrir Chrome" },
    { key: "sala", label: "Acessar Sala do Futuro" },
    { key: "perfil", label: "Selecionar perfil Estudante" },
    { key: "ra", label: "Preencher RA" },
    { key: "senha", label: "Preencher Senha" },
    { key: "acessar", label: "Autenticar login" },
    { key: "plataforma", label: "Carregar Plataformas" },
    { key: "expansao", label: "Abrir Expansão Noturno" },
    { key: "moodle", label: "Conectar ao Moodle" },
    { key: "cursos", label: "Carregar cursos" }
  ];

  return passos.map(p => {
    let icon = "⬜";
    const status = progresso[p.key];
    if (status === "ok") icon = "✔️";
    else if (status === "loading") icon = "🔄";
    else if (status === "erro") icon = "❌";
    return `${icon} ${p.label}`;
  }).join("\n");
}

function gerenciarFila(client) {
  const agora = Date.now();
  const limiteInatividade = 60000;

  for (let i = activeSlots.length - 1; i >= 0; i--) {
    const userId = activeSlots[i];

    if (userBusy.has(userId)) {
      userActivity.set(userId, agora);
      continue;
    }

    const ultimaAtividade = userActivity.get(userId) || 0;
    if (agora - ultimaAtividade > limiteInatividade) {
      activeSlots.splice(i, 1);
      userActivity.delete(userId);

      if (client) {
        client.users.fetch(userId).then(user => {
          user.send({ content: `⚠️ Você foi desconectado por inatividade de 1 minuto no bot Expansão Noturno para dar vaga ao próximo da fila.` }).catch(() => {});
        }).catch(() => {});
      }
    }
  }

  while (activeSlots.length < 1 && queue.length > 0) {
    const proximoUserId = queue.shift();
    salvarFila();
    activeSlots.push(proximoUserId);
    userActivity.set(proximoUserId, Date.now());

    if (client) {
      client.users.fetch(proximoUserId).then(async (user) => {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🔐 Expansão Noturno — Sua Vez!")
          .setDescription(`O bot está livre para você agora!\n\nAdicione uma nova conta ou selecione uma conta salva para começar.`)
          .setFooter({ text: "Expansão Noturno • Seduc-SP" });

        const botoes = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("sf_nova_conta").setLabel("➕ Nova Conta").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("sf_contas_salvas").setLabel("📂 Contas Salvas").setStyle(ButtonStyle.Secondary)
        );

        await user.send({ content: `🎉 É a sua vez!`, embeds: [embed], components: [botoes] }).catch(() => {});
      }).catch(() => {});
    }
  }
}

module.exports = (client) => {

  setInterval(() => { gerenciarFila(client); }, 10000);

  client.on("error", (err) => console.error("❌ Discord client error:", err.message));

  async function mostrarTelaInicial(channel) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🔐 Expansão Noturno")
      .setDescription("Bem-vindo ao **Expansão Noturno**!\n\nAdicione uma nova conta ou entre com uma conta já salva.")
      .setFooter({ text: "Expansão Noturno • Seduc-SP" });

    const botoes = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sf_nova_conta").setLabel("➕ Nova Conta").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("sf_contas_salvas").setLabel("📂 Contas Salvas").setStyle(ButtonStyle.Secondary)
    );

    await channel.send({ embeds: [embed], components: [botoes] });
  }

  async function mostrarCursos(interaction, sessao) {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Login realizado com sucesso!")
      .setDescription(`Bem-vindo, **${sessao.nome || sessao.ra}**!\n\nEscolha qual curso deseja ver:`)
      .setFooter({ text: "Expansão Noturno • Seduc-SP" })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId("select_curso")
      .setPlaceholder("📚 Selecione um curso...")
      .addOptions(montarOpcoesSelect(sessao));

    const sairBotao = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sf_sair_fila").setLabel("🚪 Sair do Bot").setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select), sairBotao],
    });
  }

  async function mostrarSecoes(interaction, courseId) {
    const sessao = getSessaoAtiva(interaction.user.id);
    if (!sessao) {
      return interaction.editReply({ content: "❌ Sessão expirada. Use `!expansao` para logar novamente.", embeds: [], components: [] });
    }

    const curso = getCurso(sessao, courseId);
    const data = await obterSecoesCurso(sessao.sesskey, sessao.moodleCookies, courseId);
    if (!data) throw new Error("Não foi possível carregar as aulas do curso");

    const secoes = listarSecoes(data);
    if (!secoes.length) throw new Error("Nenhuma aula encontrada neste curso");

    function detectarBimestreSecao(titulo) {
      const m = titulo.match(/(\d)[°º]\s*[Bb]imestre/) || titulo.match(/[Bb]imestre\s*(\d)/) || titulo.match(/B(\d)/i);
      return m ? `${m[1]}° Bimestre` : "";
    }

    function contarAtividades(secao) {
      const cmPorId = new Map((data.cm || []).map(cm => [Number(cm.id), cm]));
      const itens = (secao.cmlist || []).map(cmId => cmPorId.get(Number(cmId))).filter(Boolean);
      return { total: itens.length };
    }

    const listaLinks = secoes.map(s => {
      const url = `${EXPANSAO_BASE}/course/section.php?id=${s.id}`;
      const bim = detectarBimestreSecao(s.title);
      const { total } = contarAtividades(s);
      const bimTag = bim ? ` 🗓️ ${bim}` : "";
      const atividadesTag = total > 0 ? ` • 📝 ${total} atividades` : "";
      return `• [${s.title}](${url})${bimTag}${atividadesTag}`;
    }).join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📚 ${curso?.nome || ""} — ${curso?.bimestre || ""} Bimestre`)
      .setDescription(`Escolha uma aula:\n\n${listaLinks}`)
      .setFooter({ text: `Expansão Noturno • Seduc-SP • ${secoes.length} aulas` });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`sf_select_secao_${courseId}`)
      .setPlaceholder("📖 Selecione uma aula...")
      .addOptions(secoes.slice(0, 25).map(s => {
        const bim = detectarBimestreSecao(s.title);
        const { total } = contarAtividades(s);
        const desc = [bim, total > 0 ? `${total} atividades` : ""].filter(Boolean).join(" • ") || "Clique para ver";
        return { label: s.title.slice(0, 100), description: desc.slice(0, 100), value: String(s.id), emoji: "📖" };
      }));

    const botoes = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("voltar_cursos").setLabel("📚 Voltar aos cursos").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("sf_sair_fila").setLabel("🚪 Sair do Bot").setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select), botoes],
    });
  }

  async function mostrarAtividadesSecao(interaction, courseId, sectionId) {
    const sessao = getSessaoAtiva(interaction.user.id);
    if (!sessao) {
      return interaction.editReply({ content: "❌ Sessão expirada. Use `!expansao` para logar novamente.", embeds: [], components: [] });
    }

    const data = await obterSecoesCurso(sessao.sesskey, sessao.moodleCookies, courseId);
    if (!data) throw new Error("Não foi possível carregar as atividades");

    const secao = (data.section || []).find(s => Number(s.id) === Number(sectionId));
    if (!secao) throw new Error("Seção não encontrada");

    const itens = listarAtividadesDaSecao(data, sectionId);
    if (!itens.length) throw new Error("Nenhuma atividade encontrada nesta aula");

    await renderAtividade(interaction, courseId, sectionId, 0, data);
  }

  async function renderAtividade(interaction, courseId, sectionId, index, dataCache) {
    const sessao = getSessaoAtiva(interaction.user.id);
    if (!sessao) {
      return interaction.editReply({ content: "❌ Sessão expirada. Use `!expansao` para logar novamente.", embeds: [], components: [] });
    }

    const curso = getCurso(sessao, courseId);
    const data = dataCache || await obterSecoesCurso(sessao.sesskey, sessao.moodleCookies, courseId);
    if (!data) throw new Error("Não foi possível carregar as atividades");

    const secao = (data.section || []).find(s => Number(s.id) === Number(sectionId));
    const itens = listarAtividadesDaSecao(data, sectionId);
    const embed = montarEmbedAtividade(curso, secao?.title || "", itens, index);
    if (!embed) throw new Error("Atividade não encontrada");

    const temProximo = index + 1 < itens.length;
    const temAnterior = index > 0;

    const botoesRow = new ActionRowBuilder().addComponents(
      ...(temAnterior ? [
        new ButtonBuilder().setCustomId(`sf_ativ_${courseId}_${sectionId}_${index - 1}`).setLabel("⬅️ Anterior").setStyle(ButtonStyle.Secondary),
      ] : []),
      ...(temProximo ? [
        new ButtonBuilder().setCustomId(`sf_ativ_${courseId}_${sectionId}_${index + 1}`).setLabel("➡️ Próxima atividade").setStyle(ButtonStyle.Primary),
      ] : []),
      new ButtonBuilder().setCustomId(`sf_voltar_secao_${courseId}_${sectionId}`).setLabel("🔁 Outras atividades").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`sf_voltar_secoes_${courseId}`).setLabel("📖 Outras aulas").setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [botoesRow] });

    cancelarAutoAdvance(interaction.user.id);
    if (temProximo) {
      const _userId = interaction.user.id;
      const timer = setTimeout(async () => {
        autoAdvanceTimers.delete(_userId);
        try { await renderAtividade(interaction, courseId, sectionId, index + 1, data); } catch (err) {}
      }, 4000);
      autoAdvanceTimers.set(_userId, { timer });
    }
  }

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    if (message.content.toLowerCase() === "!expansao") {
      try { await message.delete(); } catch (_) {}

      const userId = message.author.id;
      userChannels.set(userId, message.channel.id);
      gerenciarFila(client);

      if (!activeSlots.includes(userId)) {
        if (activeSlots.length < 1) {
          activeSlots.push(userId);
          userActivity.set(userId, Date.now());
        } else {
          if (!queue.includes(userId)) { queue.push(userId); salvarFila(); }
          await message.channel.send({ content: `<@${userId}> ❌ O bot está cheio (limite de 1 usuário simultâneo).\n\n${obterTextoFila(userId)}` }).catch(() => {});
          return;
        }
      }

      await mostrarTelaInicial(message.channel);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    const userId = interaction.user.id;
    userChannels.set(userId, interaction.channelId);
    gerenciarFila(client);

    if (!activeSlots.includes(userId)) {
      if (activeSlots.length < 1) {
        activeSlots.push(userId);
        userActivity.set(userId, Date.now());
      } else {
        if (!queue.includes(userId)) { queue.push(userId); salvarFila(); }
        try {
          await interaction.reply({ flags: 64, content: `❌ O bot está cheio (limite de 1 usuário simultâneo).\n\n${obterTextoFila(userId)}` });
        } catch (_) {
          try { await interaction.followUp({ flags: 64, content: `❌ O bot está cheio.\n\n${obterTextoFila(userId)}` }); } catch (__) {}
        }
        return;
      }
    }

    userActivity.set(userId, Date.now());

    if (interaction.isButton() && interaction.customId === "sf_sair_fila") {
      const idx = activeSlots.indexOf(userId);
      if (idx >= 0) { activeSlots.splice(idx, 1); userActivity.delete(userId); }
      const qIdx = queue.indexOf(userId);
      if (qIdx >= 0) { queue.splice(qIdx, 1); salvarFila(); }
      gerenciarFila(client);
      try {
        await interaction.update({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🚪 Sessão Encerrada").setDescription("Você saiu do bot e liberou a vaga para o próximo da fila. Até mais!").setFooter({ text: "Expansão Noturno • Seduc-SP" })],
          components: []
        });
      } catch (_) {}
      return;
    }

    if (interaction.isButton() && interaction.customId === "sf_nova_conta") {
      try {
        const modal = new ModalBuilder().setCustomId("sf_modal_login").setTitle("Login — Nova Conta");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("ra").setLabel("RA (só números)").setStyle(TextInputStyle.Short).setPlaceholder("Ex: 186735683").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("dg").setLabel("Dígito do RA").setStyle(TextInputStyle.Short).setPlaceholder("Ex: 0").setMaxLength(1).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("senha").setLabel("Senha").setStyle(TextInputStyle.Short).setPlaceholder("Sua senha da plataforma").setRequired(true))
        );
        await interaction.showModal(modal);
      } catch (e) {}
      return;
    }

    if (interaction.isButton() && interaction.customId === "sf_contas_salvas") {
      const contas = getContas(userId);
      if (!contas.length) return interaction.reply({ flags: 64, content: "❌ Nenhuma conta salva. Use **➕ Nova Conta**." });

      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📂 Contas Salvas").setDescription("Selecione uma conta para entrar:").setFooter({ text: "Expansão Noturno • Seduc-SP" });
      const select = new StringSelectMenuBuilder().setCustomId("sf_select_conta").setPlaceholder("Selecione uma conta...").addOptions(
        contas.map((c, i) => ({ label: c.nome || `${c.ra}-${c.dg}`, description: `RA: ${c.ra}-${c.dg}`, value: String(i), emoji: "👤" }))
      );

      await interaction.reply({ flags: 64, embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "sf_select_conta") {
      const contas = getContas(userId);
      const idx = parseInt(interaction.values[0]);
      const conta = contas[idx];
      if (!conta) return interaction.update({ content: "❌ Conta não encontrada.", embeds: [], components: [] });

      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Entrando...").setDescription(`🔄 Logando com a conta **${conta.nome || conta.ra}**...`).setFooter({ text: "Expansão Noturno • Seduc-SP" })],
        components: [],
      });

      userBusy.add(userId);
      try {
        const { sesskey, moodleCookies, nome, moodleUserId, cursosScraped } = await moodleLogin(conta.ra, conta.dg, conta.senha, async (progresso) => {
          try {
            await interaction.editReply({
              embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Entrando...").setDescription(`🔄 Logando com a conta **${conta.nome || conta.ra}**...\n\n${formatarProgressoLogin(progresso)}`).setFooter({ text: "Expansão Noturno • Seduc-SP" })],
              components: [],
            });
          } catch (_) {}
        });
        const cursos = (cursosScraped && cursosScraped.length) ? cursosScraped : await buscarCursosDoUsuario(sesskey, moodleCookies, moodleUserId);
        const contaAtualizada = { ...conta, sesskey, moodleCookies, nome: nome || conta.nome, moodleUserId, cursos, loginAt: Date.now() };
        salvarConta(userId, contaAtualizada);
        setSessaoAtiva(userId, contaAtualizada);
        await mostrarCursos(interaction, contaAtualizada);
      } catch (err) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Falha no acesso").setDescription(
            err.message.includes("incorretos") || err.message.includes("senha")
              ? "Credenciais inválidas. A senha pode ter sido alterada. Use **➕ Nova Conta** para atualizar."
              : `Erro inesperado: \`${err.message}\``
          )],
          components: [],
        });
      } finally {
        userBusy.delete(userId);
        userActivity.set(userId, Date.now());
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "sf_modal_login") {
      const ra    = interaction.fields.getTextInputValue("ra").trim();
      const dg    = interaction.fields.getTextInputValue("dg").trim();
      const senha = interaction.fields.getTextInputValue("senha").trim();

      await interaction.reply({
        flags: 64,
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Autenticando...").setDescription("🔄 Abrindo Sala do Futuro...").setFooter({ text: "Expansão Noturno • Seduc-SP" })],
      });

      userBusy.add(userId);
      try {
        const { sesskey, moodleCookies, nome, moodleUserId, cursosScraped } = await moodleLogin(ra, dg, senha, async (progresso) => {
          try {
            await interaction.editReply({
              embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Autenticando...").setDescription(`🔄 Abrindo Sala do Futuro...\n\n${formatarProgressoLogin(progresso)}`).setFooter({ text: "Expansão Noturno • Seduc-SP" })]
            });
          } catch (_) {}
        });
        const cursos = (cursosScraped && cursosScraped.length) ? cursosScraped : await buscarCursosDoUsuario(sesskey, moodleCookies, moodleUserId);
        const conta = { ra, dg, senha, sesskey, moodleCookies, nome: nome || `${ra}-${dg}`, moodleUserId, cursos, loginAt: Date.now() };
        salvarConta(interaction.user.id, conta);
        setSessaoAtiva(interaction.user.id, conta);
        await mostrarCursos(interaction, conta);
      } catch (err) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Falha no acesso").setDescription(
            err.message.includes("incorretos") || err.message.includes("senha")
              ? "RA, dígito ou senha incorretos. Tente novamente com `!expansao`."
              : `Erro inesperado: \`${err.message}\``
          )],
        });
      } finally {
        userBusy.delete(userId);
        userActivity.set(userId, Date.now());
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "select_curso") {
      const sessao = getSessaoAtiva(interaction.user.id);
      if (!sessao) return interaction.reply({ flags: 64, content: "❌ Sessão expirada. Use `!expansao` para logar novamente." });

      cancelarAutoAdvance(interaction.user.id);
      const courseId = parseInt(interaction.values[0]);

      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Carregando...").setDescription("🔄 Buscando aulas...").setFooter({ text: "Expansão Noturno • Seduc-SP" })],
        components: [],
      });

      try {
        await mostrarSecoes(interaction, courseId);
      } catch (err) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Erro").setDescription(`Não foi possível carregar as aulas: \`${err.message}\``)],
          components: [],
        });
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("sf_select_secao_")) {
      const sessao = getSessaoAtiva(interaction.user.id);
      if (!sessao) return interaction.reply({ flags: 64, content: "❌ Sessão expirada. Use `!expansao` para logar novamente." });

      cancelarAutoAdvance(interaction.user.id);
      const courseId = parseInt(interaction.customId.replace("sf_select_secao_", ""));
      const sectionId = parseInt(interaction.values[0]);

      let data, itens, secaoObj;
      try {
        data = await obterSecoesCurso(sessao.sesskey, sessao.moodleCookies, courseId);
        if (!data) throw new Error("API não respondeu");
        secaoObj = (data.section || []).find(s => Number(s.id) === Number(sectionId));
        if (!secaoObj) throw new Error("Seção não encontrada");
        itens = listarAtividadesDaSecao(data, sectionId);
        if (!itens.length) throw new Error("Nenhuma atividade nesta seção");
      } catch (err) {
        await interaction.update({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Erro").setDescription(`\`${err.message}\``)], components: [] });
        return;
      }

      const secaoNome = secaoObj.title || "Aula";
      const curso = getCurso(sessao, courseId);
      const itensComUrl = itens.filter(cm => cm.url);

      function barraProgresso(feitos, total) {
        const pct = total > 0 ? Math.floor((feitos / total) * 10) : 0;
        return `\`${"█".repeat(pct) + "░".repeat(10 - pct)}\` ${feitos}/${total}`;
      }

      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📖 ${secaoNome}`).setDescription(`🔄 Iniciando execução automática...\n\n${barraProgresso(0, itensComUrl.length)}`).setFooter({ text: `${curso?.nome || ""}${curso?.bimestre ? ` — ${curso?.bimestre} Bimestre` : ""} • Expansão Noturno` })],
        components: [],
      });

      userBusy.add(userId);
      rodarAtividadesSecao(sessao, itens, async ({ index, total, nome, status, concluidos }) => {
        const icons = { abrindo: "🔄", ok: "✅", erro: "⚠️" };
        const colors = { abrindo: 0x5865f2, ok: 0x2ecc71, erro: 0xe67e22 };
        const desc = status === "ok"
          ? `✅ **${nome}**\n\n${barraProgresso(concluidos, total)}`
          : `${icons[status]} **${nome}**\n\n${barraProgresso(concluidos, total)}`;
        try {
          await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(colors[status] || 0x5865f2).setTitle(`📖 ${secaoNome}`).setDescription(desc).setFooter({ text: `${curso?.nome || ""}${curso?.bimestre ? ` — ${curso?.bimestre} Bimestre` : ""} • Expansão Noturno` })],
            components: [],
          });
        } catch (_) {}
      }).then(async ({ concluidos, total }) => {
        const botoesRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`sf_voltar_secoes_${courseId}`).setLabel("📖 Outras aulas").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("voltar_cursos").setLabel("📚 Outros cursos").setStyle(ButtonStyle.Secondary),
        );
        try {
          await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(concluidos === total ? 0x2ecc71 : 0xe67e22).setTitle(`${concluidos === total ? "🏁" : "⚠️"} ${secaoNome} — Concluída`).setDescription(`**${concluidos}/${total}** atividades executadas com sucesso.`).setFooter({ text: `${curso?.nome || ""}${curso?.bimestre ? ` — ${curso?.bimestre} Bimestre` : ""} • Expansão Noturno` })],
            components: [botoesRow],
          });
        } catch (_) {}
      }).catch(() => {}).finally(() => {
        userBusy.delete(userId);
        userActivity.set(userId, Date.now());
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("sf_ativ_")) {
      const sessao = getSessaoAtiva(interaction.user.id);
      if (!sessao) return interaction.reply({ flags: 64, content: "❌ Sessão expirada. Use `!expansao` para logar novamente." });

      cancelarAutoAdvance(interaction.user.id);
      const parts = interaction.customId.split("_");
      const courseId = parseInt(parts[2]);
      const sectionId = parseInt(parts[3]);
      const index = parseInt(parts[4]);

      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Carregando...").setDescription("🔄 Carregando atividade...").setFooter({ text: "Expansão Noturno • Seduc-SP" })],
        components: [],
      });

      try {
        await renderAtividade(interaction, courseId, sectionId, index, null);
      } catch (err) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Erro").setDescription(`Não foi possível navegar: \`${err.message}\``)],
          components: [],
        });
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("sf_voltar_secao_")) {
      const sessao = getSessaoAtiva(interaction.user.id);
      if (!sessao) return interaction.reply({ flags: 64, content: "❌ Sessão expirada. Use `!expansao` para logar novamente." });

      cancelarAutoAdvance(interaction.user.id);
      const parts = interaction.customId.replace("sf_voltar_secao_", "").split("_");
      const courseId = parseInt(parts[0]);
      const sectionId = parseInt(parts[1]);

      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Carregando...").setDescription("🔄 Buscando atividades...").setFooter({ text: "Expansão Noturno • Seduc-SP" })],
        components: [],
      });

      try {
        await mostrarAtividadesSecao(interaction, courseId, sectionId);
      } catch (err) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Erro").setDescription(`\`${err.message}\``)],
          components: [],
        });
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("sf_voltar_secoes_")) {
      const sessao = getSessaoAtiva(interaction.user.id);
      if (!sessao) return interaction.reply({ flags: 64, content: "❌ Sessão expirada. Use `!expansao` para logar novamente." });

      cancelarAutoAdvance(interaction.user.id);
      const courseId = parseInt(interaction.customId.replace("sf_voltar_secoes_", ""));

      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Carregando...").setDescription("🔄 Buscando aulas...").setFooter({ text: "Expansão Noturno • Seduc-SP" })],
        components: [],
      });

      try {
        await mostrarSecoes(interaction, courseId);
      } catch (err) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Erro").setDescription(`\`${err.message}\``)],
          components: [],
        });
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === "voltar_cursos") {
      const sessao = getSessaoAtiva(interaction.user.id);
      if (!sessao) return interaction.reply({ flags: 64, content: "❌ Sessão expirada. Use `!expansao` para logar novamente." });

      cancelarAutoAdvance(interaction.user.id);
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏳ Carregando...").setDescription("🔄 Voltando aos cursos...").setFooter({ text: "Expansão Noturno • Seduc-SP" })],
        components: [],
      });

      const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("📚 Cursos disponíveis").setDescription(`Bem-vindo de volta, **${sessao.nome || sessao.ra}**!\n\nEscolha qual curso deseja ver:`).setFooter({ text: "Expansão Noturno • Seduc-SP" }).setTimestamp();
      const select = new StringSelectMenuBuilder().setCustomId("select_curso").setPlaceholder("📚 Selecione um curso...").addOptions(montarOpcoesSelect(sessao));
      const sairBotao = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("sf_sair_fila").setLabel("🚪 Sair do Bot").setStyle(ButtonStyle.Danger));

      await interaction.editReply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select), sairBotao],
      });
      return;
    }
  });
};
