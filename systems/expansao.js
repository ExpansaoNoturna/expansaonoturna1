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

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
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
  return dados[userId]?.contas || [];
}

function salvarConta(userId, conta) {
  if (!dados[userId]) dados[userId] = { sessaoAtiva: null, contas: [] };
  const idx = dados[userId].contas.findIndex(c => c.ra === conta.ra && c.dg === conta.dg);
  if (idx >= 0) dados[userId].contas[idx] = conta;
  else dados[userId].contas.push(conta);
  dados[userId].sessaoAtiva = conta;
  salvarDados(dados);
}

function setSessaoAtiva(userId, conta) {
  if (!dados[userId]) dados[userId] = { sessaoAtiva: null, contas: [] };
  dados[userId].sessaoAtiva = conta;
  salvarDados(dados);
}

async function moodleLogin(ra, digito, senha) {
  const puppeteer = require("puppeteer");
  const espera = (ms) => new Promise(r => setTimeout(r, ms));

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(UA);

    await page.goto(`${SF_BASE}/escolha-de-perfil`, { waitUntil: "networkidle2", timeout: 30000 });
    await espera(2000);

    await page.waitForSelector('p.MuiTypography-root', { timeout: 10000 });
    await espera(1000);
    const clicouEstudante = await page.evaluate(() => {
      const el = [...document.querySelectorAll('p.MuiTypography-root')].find(e => e.textContent.trim() === "Estudante");
      if (el) { el.click(); return true; }
      return false;
    });
    if (!clicouEstudante) throw new Error("Botão 'Estudante' não encontrado");

    await page.waitForSelector('#input-usuario-sed', { timeout: 15000 });
    await espera(2000);

    await page.click('#input-usuario-sed', { clickCount: 3 });
    await espera(300);
    await page.type('#input-usuario-sed', String(ra).trim(), { delay: 50 });
    await espera(500);

    await page.click('[name="digito-ra"]', { clickCount: 3 });
    await espera(300);
    await page.type('[name="digito-ra"]', String(digito).trim(), { delay: 50 });
    await espera(500);

    await page.click('#input-senha', { clickCount: 3 });
    await espera(300);
    await page.type('#input-senha', String(senha).trim(), { delay: 50 });
    await espera(500);

    const clicouAcessar = await page.evaluate(() => {
      let btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Acessar');
      if (!btn) btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase().includes('acessar'));
      if (!btn) btn = document.querySelector('button[type="submit"]');
      if (!btn) btn = [...document.querySelectorAll('button')].find(b => !b.disabled);
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    });
    if (!clicouAcessar) throw new Error("Botão Acessar não encontrado");

    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 });
    await espera(2000);

    if (page.url().includes("login") || page.url().includes("escolha")) {
      throw new Error("RA, dígito ou senha incorretos.");
    }

    const nome = await page.evaluate(() => {
      const el = document.querySelector('[class*="nome"], [class*="Name"], h1, h2');
      return el ? el.textContent.trim() : null;
    }).catch(() => null);

    await page.goto(`${SF_BASE}/plataformas`, { waitUntil: "networkidle2", timeout: 20000 });
    await espera(3000);

    await page.waitForSelector('[class*="MuiSelect-select"]', { timeout: 10000 });
    await espera(1000);
    await page.click('[class*="MuiSelect-select"]');
    await page.waitForSelector('[role="option"]', { timeout: 10000 });
    await espera(1000);

    const selecionou = await page.evaluate(() => {
      const op = [...document.querySelectorAll('[role="option"]')].find(o => o.textContent.toUpperCase().includes("EXPANS"));
      if (op) { op.click(); return op.textContent.trim(); }
      return null;
    });
    if (!selecionou) throw new Error("Opção 'EXPANSÃO' não encontrada no dropdown");

    await page.waitForFunction(() => {
      return [...document.querySelectorAll('h5.MuiTypography-h5')].some(el => el.textContent.trim() === "Expansão Noturno");
    }, { timeout: 15000 });
    await espera(1000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await espera(500);

    const clicouCard = await page.evaluate(() => {
      const h5 = [...document.querySelectorAll('h5.MuiTypography-h5')].find(el => el.textContent.trim() === "Expansão Noturno");
      if (!h5) return false;
      const card = h5.closest('.MuiCard-root');
      if (card) { card.click(); return true; }
      h5.click();
      return true;
    });
    if (!clicouCard) throw new Error("Card 'Expansão Noturno' não encontrado");

    await espera(1000);

    const paginasAntes = (await browser.pages()).length;
    let novaAba = null;
    for (let tentativa = 0; tentativa < 20 && !novaAba; tentativa++) {
      await espera(1000);
      const paginas = await browser.pages();
      if (paginas.length > paginasAntes) {
        novaAba = paginas[paginas.length - 1];
      }
    }
    if (!novaAba) throw new Error("Nova aba não abriu em 20s");

    await novaAba.setUserAgent(UA);
    await espera(3000);

    await novaAba.waitForFunction(() => window.M?.cfg?.sesskey, { timeout: 30000 });

    const sesskey = await novaAba.evaluate(() => window.M.cfg.sesskey);
    const moodleUserId = await novaAba.evaluate(() => {
      if (window.M?.cfg?.userid) return window.M.cfg.userid;
      if (window.YUI_config?.Moodle?.cfg?.userid) return window.YUI_config.Moodle.cfg.userid;
      const meta = document.querySelector('meta[name="userId"]') || document.querySelector('meta[name="user-id"]');
      if (meta) return meta.getAttribute("content");
      const bodyClass = document.body?.className || "";
      const uidMatch = bodyClass.match(/user-(\d+)/);
      if (uidMatch) return uidMatch[1];
      if (document.body?.dataset?.userid) return document.body.dataset.userid;
      return null;
    });
    const rawCookies = await novaAba.cookies();
    const moodleCookies = rawCookies.map(c => `${c.name}=${c.value}`);
    if (!moodleCookies.find(c => c.startsWith("MoodleSession="))) throw new Error("MoodleSession não encontrado");

    return { sesskey, moodleCookies, nome, moodleUserId };
  } finally {
    await browser.close();
  }
}

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
  const espera = (ms) => new Promise(r => setTimeout(r, ms));

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(UA);

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
        await page.goto(cm.url, { waitUntil: "networkidle2", timeout: 30000 });
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

module.exports = (client) => {

  client.on("error", (err) => console.error("❌ Discord client error:", err.message));

  async function mostrarTelaInicial(channel) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🔐 Expansão Noturno")
      .setDescription("Bem-vindo ao **Expansão Noturno**!\n\nAdicione uma nova conta ou entre com uma conta já salva.")
      .setFooter({ text: "Expansão Noturno • Seduc-SP" });

    const botoes = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sf_nova_conta")
        .setLabel("➕ Nova Conta")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("sf_contas_salvas")
        .setLabel("📂 Contas Salvas")
        .setStyle(ButtonStyle.Secondary)
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

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select)],
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
        return {
          label: s.title.slice(0, 100),
          description: desc.slice(0, 100),
          value: String(s.id),
          emoji: "📖",
        };
      }));

    const botoes = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("voltar_cursos")
        .setLabel("📚 Voltar aos cursos")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(select),
        botoes,
      ],
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
        new ButtonBuilder()
          .setCustomId(`sf_ativ_${courseId}_${sectionId}_${index - 1}`)
          .setLabel("⬅️ Anterior")
          .setStyle(ButtonStyle.Secondary),
      ] : []),
      ...(temProximo ? [
        new ButtonBuilder()
          .setCustomId(`sf_ativ_${courseId}_${sectionId}_${index + 1}`)
          .setLabel("➡️ Próxima atividade")
          .setStyle(ButtonStyle.Primary),
      ] : []),
      new ButtonBuilder()
        .setCustomId(`sf_voltar_secao_${courseId}_${sectionId}`)
        .setLabel("🔁 Outras atividades")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`sf_voltar_secoes_${courseId}`)
        .setLabel("📖 Outras aulas")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [botoesRow] });

    cancelarAutoAdvance(interaction.user.id);
    if (temProximo) {
      const _userId = interaction.user.id;
      const timer = setTimeout(async () => {
        autoAdvanceTimers.delete(_userId);
        try {
          await renderAtividade(interaction, courseId, sectionId, index + 1, data);
        } catch (err) {}
      }, 4000);
      autoAdvanceTimers.set(_userId, { timer });
    }
  }

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    if (message.content.toLowerCase() === "!expansao") {
      try { await message.delete(); } catch (_) {}
      await mostrarTelaInicial(message.channel);
    }
  });

  client.on("interactionCreate", async (interaction) => {

    if (interaction.isButton() && interaction.customId === "sf_nova_conta") {
      try {
        const modal = new ModalBuilder().setCustomId("sf_modal_login").setTitle("Login — Nova Conta");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("ra").setLabel("RA (só números)").setStyle(TextInputStyle.Short).setPlaceholder("Ex: 186735683").setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("dg").setLabel("Dígito do RA").setStyle(TextInputStyle.Short).setPlaceholder("Ex: 0").setMaxLength(1).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("senha").setLabel("Senha").setStyle(TextInputStyle.Short).setPlaceholder("Sua senha da plataforma").setRequired(true)
          )
        );
        await interaction.showModal(modal);
      } catch (e) {}
      return;
    }

    if (interaction.isButton() && interaction.customId === "sf_contas_salvas") {
      const userId = interaction.user.id;
      const contas = getContas(userId);

      if (!contas.length) {
        return interaction.reply({ flags: 64, content: "❌ Nenhuma conta salva. Use **➕ Nova Conta**." });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📂 Contas Salvas")
        .setDescription("Selecione uma conta para entrar:")
        .setFooter({ text: "Expansão Noturno • Seduc-SP" });

      const select = new StringSelectMenuBuilder()
        .setCustomId("sf_select_conta")
        .setPlaceholder("Selecione uma conta...")
        .addOptions(contas.map((c, i) => ({
          label: c.nome || `${c.ra}-${c.dg}`,
          description: `RA: ${c.ra}-${c.dg}`,
          value: String(i),
          emoji: "👤",
        })));

      await interaction.reply({
        flags: 64,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)],
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "sf_select_conta") {
      const userId = interaction.user.id;
      const contas = getContas(userId);
      const idx = parseInt(interaction.values[0]);
      const conta = contas[idx];

      if (!conta) {
        return interaction.update({ content: "❌ Conta não encontrada.", embeds: [], components: [] });
      }

      await interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("⏳ Entrando...")
          .setDescription(`🔄 Logando com a conta **${conta.nome || conta.ra}**...`)
          .setFooter({ text: "Expansão Noturno • Seduc-SP" })],
        components: [],
      });

      try {
        const { sesskey, moodleCookies, nome, moodleUserId } = await moodleLogin(conta.ra, conta.dg, conta.senha);
        const cursos = await buscarCursosDoUsuario(sesskey, moodleCookies, moodleUserId);
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

      try {
        const { sesskey, moodleCookies, nome, moodleUserId } = await moodleLogin(ra, dg, senha);
        const cursos = await buscarCursosDoUsuario(sesskey, moodleCookies, moodleUserId);
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
        await interaction.update({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Erro").setDescription(`\`${err.message}\``)],
          components: [],
        });
        return;
      }

      const secaoNome = secaoObj.title || "Aula";
      const curso = getCurso(sessao, courseId);
      const itensComUrl = itens.filter(cm => cm.url);

      function barraProgresso(feitos, total) {
        const pct = total > 0 ? Math.floor((feitos / total) * 10) : 0;
        return `\`${ "█".repeat(pct) + "░".repeat(10 - pct) }\` ${feitos}/${total}`;
      }

      await interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`📖 ${secaoNome}`)
          .setDescription(`🔄 Iniciando execução automática...\n\n${barraProgresso(0, itensComUrl.length)}`)
          .setFooter({ text: `${curso?.nome || ""} • Expansão Noturno` })
        ],
        components: [],
      });

      rodarAtividadesSecao(sessao, itens, async ({ index, total, nome, status, concluidos }) => {
        const icons = { abrindo: "🔄", ok: "✅", erro: "⚠️" };
        const colors = { abrindo: 0x5865f2, ok: 0x2ecc71, erro: 0xe67e22 };
        const desc = status === "ok"
          ? `✅ **${nome}**\n\n${barraProgresso(concluidos, total)}`
          : `${icons[status]} **${nome}**\n\n${barraProgresso(concluidos, total)}`;

        try {
          await interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(colors[status] || 0x5865f2)
              .setTitle(`📖 ${secaoNome}`)
              .setDescription(desc)
              .setFooter({ text: `${curso?.nome || ""} • Expansão Noturno` })
            ],
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
            embeds: [new EmbedBuilder()
              .setColor(concluidos === total ? 0x2ecc71 : 0xe67e22)
              .setTitle(`${concluidos === total ? "🏁" : "⚠️"} ${secaoNome} — Concluída`)
              .setDescription(`**${concluidos}/${total}** atividades executadas com sucesso.`)
              .setFooter({ text: `${curso?.nome || ""} • Expansão Noturno` })
            ],
            components: [botoesRow],
          });
        } catch (_) {}
      }).catch(() => {});

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

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("📚 Cursos disponíveis")
        .setDescription(`Bem-vindo de volta, **${sessao.nome || sessao.ra}**!\n\nEscolha qual curso deseja ver:`)
        .setFooter({ text: "Expansão Noturno • Seduc-SP" })
        .setTimestamp();

      const select = new StringSelectMenuBuilder()
        .setCustomId("select_curso")
        .setPlaceholder("📚 Selecione um curso...")
        .addOptions(montarOpcoesSelect(sessao));

      await interaction.editReply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)],
      });
      return;
    }

  });
};