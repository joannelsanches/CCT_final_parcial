import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

import {
  gravarResultado,
  paginasVerificacao,
  pastaVerificacao as pasta
} from './support/verificacao.js';
import { iniciarAmbiente } from './support/ambiente.js';

await mkdir(pasta, { recursive: true });
const ambiente = await iniciarAmbiente({ completo: true });
let browser;
let falhaExecucao;
const registros = [];
const links = [];
const erros = [];

async function capturar(page, { tamanho, perfil, path, nome, http, esperado = 200 }) {
  const dimensoes = await page.evaluate(() => {
    const visivel = (elemento) => elemento.getClientRects().length > 0;
    const formularios = [
      ...document.querySelectorAll('.form-card, .institutional-form, .login-card')
    ]
      .filter(visivel)
      .map((card) => {
        const retangulo = card.getBoundingClientRect();
        const pai = card.parentElement;
        const limite = pai.getBoundingClientRect();
        const estilo = getComputedStyle(pai);
        const esquerda = parseFloat(estilo.paddingLeft) + parseFloat(estilo.borderLeftWidth);
        const direita = parseFloat(estilo.paddingRight) + parseFloat(estilo.borderRightWidth);
        const centro = limite.left + esquerda + (limite.width - esquerda - direita) / 2;
        const item = {
          classe: card.className,
          largura: retangulo.width,
          desvioHorizontal: Math.abs(retangulo.left + retangulo.width / 2 - centro)
        };
        if (card.classList.contains('login-card')) {
          const topo = parseFloat(estilo.paddingTop) + parseFloat(estilo.borderTopWidth);
          const base = parseFloat(estilo.paddingBottom) + parseFloat(estilo.borderBottomWidth);
          item.desvioVertical = Math.abs(
            retangulo.top +
              retangulo.height / 2 -
              (limite.top + topo + (limite.height - topo - base) / 2)
          );
          item.semSobreposicao =
            retangulo.top >=
              document.querySelector('.site-header').getBoundingClientRect().bottom &&
            retangulo.bottom <= document.querySelector('.site-footer').getBoundingClientRect().top;
          item.rotulosLegiveis = [...card.querySelectorAll('.field label')].every(
            (label) => getComputedStyle(label).textAlign !== 'center'
          );
        }
        return item;
      });
    const css = getComputedStyle(document.documentElement);
    const cores = ['verde', 'verde-claro', 'coral', 'rosa', 'pessego'].map((cor) =>
      css.getPropertyValue(`--${cor}`).trim().toLowerCase()
    );
    return {
      pagina: document.documentElement.scrollWidth,
      viewport: innerWidth,
      imagens: [...document.images]
        .filter(visivel)
        .every((imagem) => imagem.complete && imagem.naturalWidth > 0),
      csrf: [...document.querySelectorAll('form[method="post"]')].every(
        (form) => !!form.querySelector('input[name="_csrf"]')?.value
      ),
      formularios,
      cores,
      semRepresentacaoFruta:
        !document.querySelector('[class*="guava"], [class*="goiaba"]') &&
        !/\b(goiaba|guava)\b/i.test(document.body.innerText)
    };
  });
  const centralizados = dimensoes.formularios.every(
    (form) =>
      form.desvioHorizontal < 2 &&
      (form.desvioVertical === undefined ||
        (form.desvioVertical < 2 && form.semSobreposicao && form.rotulosLegiveis))
  );
  const paletaPreservada =
    JSON.stringify(dimensoes.cores) ===
    JSON.stringify(['#64a002', '#b9d394', '#fe5668', '#ff8d8f', '#ffc1a5']);
  if (
    http !== esperado ||
    dimensoes.pagina > dimensoes.viewport + 1 ||
    !dimensoes.csrf ||
    !dimensoes.imagens ||
    !centralizados ||
    !paletaPreservada ||
    !dimensoes.semRepresentacaoFruta
  ) {
    erros.push(`${nome}: HTTP ${http}, inspeção ${JSON.stringify(dimensoes)}`);
  }
  await page.screenshot({ path: resolve(pasta, nome + '.png'), fullPage: true });
  registros.push({
    tamanho,
    perfil,
    path,
    http,
    esperado,
    ...dimensoes,
    centralizados,
    paletaPreservada,
    arquivo: nome + '.png'
  });
}

async function conferirLinks(page, tamanho, perfil, vaga) {
  const destino = `/vagas/${vaga._id}`;
  for (const origem of ['/', '/vagas']) {
    await page.goto(ambiente.base + origem);
    const [resposta] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === ambiente.base + destino && response.request().isNavigationRequest()
      ),
      page.locator(`a[href="${destino}"]`).filter({ hasText: 'Ver detalhes' }).first().click()
    ]);
    await page.waitForURL(ambiente.base + destino);
    const chamada = perfil === 'publico' ? 'Entrar para candidatar-se' : 'Candidatar-se';
    const acao = page.getByRole(perfil === 'publico' ? 'link' : 'button', {
      name: chamada,
      exact: true
    });
    await acao.waitFor({ state: 'visible' });
    const acaoVisivel = await acao.isVisible();
    links.push({ tamanho, perfil, origem, destino, http: resposta.status(), acaoVisivel });
    if (resposta.status() !== 200 || !acaoVisivel)
      erros.push(`${tamanho}/${perfil}: detalhes pelo link de ${origem}`);
  }
}

async function conferirLoginComErro(page, tamanho) {
  await page.goto(ambiente.base + '/login');
  await page.getByLabel('E-mail', { exact: true }).fill('naocadastrado@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-ficticia-invalida');
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === ambiente.base + '/login' && response.request().method() === 'POST'
    ),
    page.getByRole('button', { name: 'Entrar', exact: true }).click()
  ]);
  await page.getByRole('alert').filter({ hasText: 'E-mail ou senha inválidos.' }).waitFor();
  await capturar(page, {
    tamanho,
    perfil: 'publico',
    path: '/login (erro)',
    nome: `${tamanho}-publico-login-erro`,
    http: resposta.status(),
    esperado: 422
  });
}

async function conferirCadastrosComErros(page, tamanho) {
  for (const perfil of ['estudante', 'empresa']) {
    const path = `/cadastro/${perfil}`;
    await page.goto(ambiente.base + path);

    const [resposta] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === ambiente.base + path && response.request().method() === 'POST'
      ),
      page.locator('form[method="post"]').evaluate((form) => form.submit())
    ]);
    await page.locator('.field-error').first().waitFor();
    await capturar(page, {
      tamanho,
      perfil: 'publico',
      path: path + ' (erros)',
      nome: `${tamanho}-publico-cadastro-${perfil}-erros`,
      http: resposta.status(),
      esperado: 422
    });
  }
}

try {
  const f = await ambiente.semear();
  const convenio = await ambiente.modelos.Convenio.findOne({ numero: 'BG-TESTE-001' });
  browser = await chromium.launch({
    headless: true,
    timeout: 15000,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    args: ['--no-sandbox']
  });

  const perfis = paginasVerificacao(f.vaga, convenio);
  for (const [tamanho, viewport] of [
    ['desktop', { width: 1440, height: 1000 }],
    ['celular', { width: 390, height: 844 }]
  ]) {
    for (const [perfil, paginas] of perfis) {
      const context = await browser.newContext({ viewport, locale: 'pt-BR' });
      const page = await context.newPage();
      page.on('pageerror', (erro) => erros.push(erro.message));
      if (perfil !== 'publico') {
        await page.goto(ambiente.base + '/login');
        await page.getByLabel('E-mail', { exact: true }).fill(f.usuarios[perfil].email);
        await page.getByLabel('Senha', { exact: true }).fill(f.senha);
        await Promise.all([
          page.waitForURL((url) => url.pathname !== '/login'),
          page.getByRole('button', { name: 'Entrar', exact: true }).click()
        ]);
      }
      for (const path of paginas) {
        const response = await page.goto(ambiente.base + path, { waitUntil: 'networkidle' });
        const nome = `${tamanho}-${perfil}-${path.replaceAll('/', '-').replace(String(f.vaga._id), 'vaga').replace(String(convenio._id), 'convenio')}`;
        await capturar(page, { tamanho, perfil, path, nome, http: response.status() });
      }
      if (['publico', 'estudante'].includes(perfil))
        await conferirLinks(page, tamanho, perfil, f.vaga);
      if (perfil === 'publico') {
        await page.goto(ambiente.base + '/login');
        let focoEmail = false;
        for (let tab = 0; tab < 16; tab++) {
          await page.keyboard.press('Tab');
          const foco = await page.evaluate(() => ({
            id: document.activeElement.id,
            visivel: getComputedStyle(document.activeElement).outlineStyle !== 'none'
          }));
          if (!foco.visivel) erros.push(`${tamanho}: foco de teclado invisível`);
          if (foco.id === 'email') {
            focoEmail = true;
            break;
          }
        }
        if (!focoEmail) erros.push(`${tamanho}: campo de e-mail inacessível por Tab`);
        await conferirLoginComErro(page, tamanho);
        await conferirCadastrosComErros(page, tamanho);
      }
      if (tamanho === 'celular') {
        await page.locator('[data-menu]').click();
        if ((await page.locator('[data-menu]').getAttribute('aria-expanded')) !== 'true')
          erros.push(`${perfil}: menu móvel não abriu`);
        await page.keyboard.press('Escape');
        if ((await page.locator('[data-menu]').getAttribute('aria-expanded')) !== 'false')
          erros.push(`${perfil}: Escape não fechou menu`);
      }
      await context.close();
    }
  }

  const compacto = await browser.newContext({
    viewport: { width: 320, height: 568 },
    locale: 'pt-BR'
  });
  const pagina = await compacto.newPage();
  const resposta = await pagina.goto(ambiente.base + '/login');
  await capturar(pagina, {
    tamanho: 'celular-compacto',
    perfil: 'publico',
    path: '/login',
    nome: 'celular-compacto-login',
    http: resposta.status()
  });
  await conferirLoginComErro(pagina, 'celular-compacto');
  await compacto.close();
  if (erros.length) process.exitCode = 1;
} catch (erro) {
  const mensagem = erro.message.replace(/\u001b\[[0-9;]*m/g, '');
  const diagnosticos = mensagem
    .split('\n')
    .filter((linha) =>
      /socket\(\) failed|Operation not permitted|corruption|Failed to load/.test(linha)
    )
    .slice(0, 6);
  falhaExecucao = [mensagem.split('\n')[0], ...diagnosticos].join('\n');
  process.exitCode = 1;
  console.error('Verificação visual interrompida:', erro.message);
} finally {
  await gravarResultado('resultado.json', {
    data: new Date().toISOString(),
    tipo: 'NAVEGADOR',
    status: falhaExecucao
      ? browser
        ? 'INTERROMPIDA'
        : 'NAVEGADOR_INDISPONIVEL'
      : erros.length
        ? 'REPROVADA'
        : 'APROVADA',
    capturasAtuaisConfirmadas: !falhaExecucao && registros.length > 0,
    ...(falhaExecucao ? { motivo: falhaExecucao } : {}),
    registros,
    links,
    erros
  });
  console.log(
    JSON.stringify({ telas: registros.length, links: links.length, erros, falhaExecucao }, null, 2)
  );
  if (browser) await browser.close();
  await ambiente.encerrar();
}
