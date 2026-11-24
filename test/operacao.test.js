import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { after, before, beforeEach, test } from 'node:test';

import { iniciarAmbiente } from '../scripts/support/ambiente.js';
import { inicializarDadosInstitucionais } from '../services/dadosInstitucionais.js';

const executar = promisify(execFile);
let ambiente;
let dados;

before(async () => {
  ambiente = await iniciarAmbiente();
});
beforeEach(async () => {
  dados = await ambiente.semear();
});
after(async () => {
  await ambiente?.encerrar();
});

async function executarScript(script, argumentos = [], variaveis = {}) {
  return executar(process.execPath, [`scripts/${script}`, ...argumentos], {
    env: { ...process.env, ...variaveis },
    timeout: 20000
  });
}

test('inicialização institucional é repetível e não cria pessoas, empresas ou vagas', async () => {
  const { Campus, AreaAtuacao, Curso, Usuario, Empresa, Vaga } = ambiente.modelos;
  await Promise.all([Campus.deleteMany({}), AreaAtuacao.deleteMany({}), Curso.deleteMany({})]);
  const antes = await Promise.all([
    Usuario.countDocuments(),
    Empresa.countDocuments(),
    Vaga.countDocuments()
  ]);
  await executarScript('inicializar-instituicao.js');
  const primeira = await inicializarDadosInstitucionais();
  const segunda = await inicializarDadosInstitucionais();
  assert.equal(String(primeira.campus._id), String(segunda.campus._id));
  assert.equal(String(primeira.curso._id), String(segunda.curso._id));
  assert.equal(await Campus.countDocuments(), 1);
  assert.equal(await AreaAtuacao.countDocuments(), 1);
  assert.equal(await Curso.countDocuments(), 1);
  assert.deepEqual(
    await Promise.all([Usuario.countDocuments(), Empresa.countDocuments(), Vaga.countDocuments()]),
    antes
  );
});

test('inicialização institucional preserva ajustes administrativos do curso', async () => {
  const { Curso } = ambiente.modelos;
  dados.curso.ativo = false;
  dados.curso.regrasEstagio.cargaHorariaSemanalMaxima = 24;
  await dados.curso.save();
  await inicializarDadosInstitucionais();
  const curso = await Curso.findById(dados.curso._id);
  assert.equal(curso.ativo, false);
  assert.equal(curso.regrasEstagio.cargaHorariaSemanalMaxima, 24);
});

test('criação administrativa pode repetir sem alterar senha e recusa e-mail de outro perfil', async () => {
  const variaveis = {
    ADMIN_NOME: 'Operação StartIF',
    ADMIN_EMAIL: 'operacao@example.test',
    ADMIN_SENHA: 'Senha-ficticia-para-teste-2026',
    ADMIN_FUNCAO: 'SETOR_ESTAGIOS'
  };
  await executarScript('criar-admin.js', [], variaveis);
  const primeira = await ambiente.modelos.Usuario.findOne({ email: variaveis.ADMIN_EMAIL }).select(
    '+senhaHash'
  );
  await executarScript('criar-admin.js', [], {
    ...variaveis,
    ADMIN_SENHA: 'Outra-senha-ficticia-2026'
  });
  const segunda = await ambiente.modelos.Usuario.findById(primeira._id).select('+senhaHash');
  assert.equal(segunda.tipo, 'ADMIN');
  assert.equal(segunda.funcaoAdministrativa, 'SETOR_ESTAGIOS');
  assert.equal(segunda.senhaHash, primeira.senhaHash);
  await assert.rejects(
    executarScript('criar-admin.js', [], {
      ...variaveis,
      ADMIN_EMAIL: dados.usuarios.estudante.email
    }),
    (erro) => /conta sem perfil administrativo/.test(erro.stderr)
  );
  assert.equal(
    (await ambiente.modelos.Usuario.findById(dados.usuarios.estudante._id)).tipo,
    'ESTUDANTE'
  );
});

test('simulações de migração preservam registros, coleções e índices', async () => {
  const db = ambiente.mongoose.connection.db;
  async function retrato() {
    const nomes = (await db.listCollections().toArray()).map((c) => c.name).sort();
    const registros = {};
    for (const nome of nomes) {
      const colecao = db.collection(nome);
      registros[nome] = {
        documentos: await colecao.find({}).sort({ _id: 1 }).toArray(),
        indices: await colecao.listIndexes().toArray()
      };
    }
    return JSON.stringify(registros);
  }
  const antes = await retrato();
  for (const script of [
    'migrar-dados.js',
    'migrar-bage.js',
    'migrar-arquivos.js',
    'migrar-canais.js'
  ]) {
    await executarScript(script, ['--simular']);
    assert.equal(await retrato(), antes, script);
  }
});

test('entrada da Vercel carrega o aplicativo com EJS e arquivos estáticos', async () => {
  const { default: app } = await import('../api/index.js');
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${servidor.address().port}`;
    for (const caminho of ['/login', '/vagas', '/css/style.css', '/js/app.js']) {
      const resposta = await fetch(base + caminho);
      assert.equal(resposta.status, 200, caminho);
      assert.ok((await resposta.text()).length > 0);
    }
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});
