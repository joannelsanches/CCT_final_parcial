import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { iniciarAmbiente } from '../scripts/support/ambiente.js';
import { inicioDoDiaInstitucional } from '../utils/datas.js';

let ambiente;
let dados;
before(async () => {
  ambiente = await iniciarAmbiente();
});
after(async () => {
  if (ambiente) await ambiente.encerrar();
});
beforeEach(async () => {
  dados = await ambiente.semear();
});

const url = () => `/vagas/${dados.vaga._id}`;

async function verificarLinks(cliente) {
  for (const caminho of ['/', '/vagas']) {
    const pagina = await cliente.requisitar(caminho);
    assert.equal(pagina.status, 200, caminho);
    const link = pagina.html.match(new RegExp(`href="(${url()})">Ver detalhes`));
    assert.ok(link, `Link da vaga em ${caminho}`);
    assert.equal((await cliente.requisitar(link[1])).status, 200, `Detalhes por ${caminho}`);
  }
}

test('visitante abre detalhes pelos cards da home, da lista e pela URL direta', async () => {
  const visitante = await ambiente.cliente(null, dados);
  await verificarLinks(visitante);
  const resposta = await visitante.requisitar(url());
  assert.equal(resposta.status, 200);
  assert.match(resposta.html, /Entrar para candidatar-se/);
  assert.doesNotMatch(resposta.html, /action="\/candidaturas\//);
});

test('estudante consulta oferta pública sem candidatura nem currículo anterior', async () => {
  const estudante = await ambiente.cliente('estudante', dados);
  await verificarLinks(estudante);
  const resposta = await estudante.requisitar(url());
  assert.equal(resposta.status, 200);
  assert.match(resposta.html, new RegExp(`action="/candidaturas/${dados.vaga._id}"`));
  assert.match(resposta.html, /name="_csrf" value="[^"]+"/);
  assert.equal(await ambiente.modelos.Candidatura.countDocuments(), 0);
});

test('referência de campus não populável mantém o mesmo acesso público da home e da lista', async () => {
  await ambiente.modelos.Campus.deleteOne({ _id: dados.campus._id });
  const populada = await ambiente.modelos.Vaga.findById(dados.vaga._id).populate('campus');
  assert.equal(populada.campus, null);
  assert.equal(
    String((await ambiente.modelos.Vaga.findById(dados.vaga._id)).campus),
    String(dados.campus._id)
  );
  for (const perfil of [null, 'estudante']) {
    const cliente = await ambiente.cliente(perfil, dados);
    await verificarLinks(cliente);
    const resposta = await cliente.requisitar(url());
    assert.equal(resposta.status, 200);
    assert.doesNotMatch(resposta.html, /Oferta indisponível para novas candidaturas/);
    assert.match(resposta.html, perfil ? />\s*Candidatar-se\s*</ : /Entrar para candidatar-se/);
  }
});

test('identificadores inválidos e vagas inexistentes retornam 404 sem erro interno', async () => {
  for (const perfil of [null, 'estudante']) {
    const cliente = await ambiente.cliente(perfil, dados);
    for (const id of ['id-invalido', 'abcdefghijkl', 'z'.repeat(24), '000000000000000000000001']) {
      const resposta = await cliente.requisitar(`/vagas/${id}`);
      assert.equal(resposta.status, 404, `${perfil || 'visitante'}: ${id}`);
      assert.match(resposta.html, /Página não encontrada/);
      assert.doesNotMatch(resposta.html, /CastError|erro interno/i);
    }
  }
});

test('rascunhos, vagas em análise e retiradas continuam privados para quem não participa', async () => {
  const clientes = await Promise.all(
    [null, 'estudante', 'outraEmpresa'].map((perfil) => ambiente.cliente(perfil, dados))
  );
  for (const status of [
    'RASCUNHO',
    'PENDENTE_VALIDACAO',
    'FECHADA',
    'REPROVADA',
    'CANCELADA',
    'ARQUIVADA'
  ]) {
    await ambiente.modelos.Vaga.updateOne(
      { _id: dados.vaga._id },
      { $set: { status, arquivada: status === 'ARQUIVADA' } }
    );
    for (const cliente of clientes) {
      assert.equal((await cliente.requisitar(url())).status, 404, status);
      for (const caminho of ['/', '/vagas']) {
        assert.ok(
          !(await cliente.requisitar(caminho)).html.includes(`href="${url()}"`),
          `${status}: ${caminho}`
        );
      }
    }
  }
});

test('empresa proprietária e administração consultam vagas privadas; outra empresa não', async () => {
  await ambiente.modelos.Vaga.updateOne(
    { _id: dados.vaga._id },
    { $set: { status: 'PENDENTE_VALIDACAO' } }
  );
  for (const perfil of ['empresa', 'admin', 'coordenador', 'setor']) {
    const cliente = await ambiente.cliente(perfil, dados);
    const resposta = await cliente.requisitar(url());
    assert.equal(resposta.status, 200, perfil);
    assert.match(resposta.html, /Oferta indisponível para novas candidaturas/);
    assert.doesNotMatch(resposta.html, /action="\/candidaturas\//);
  }
  const outra = await ambiente.cliente('outraEmpresa', dados);
  assert.equal((await outra.requisitar(url())).status, 404);
});

test('perfis e referências de empresa ausentes não autorizam consulta a vaga privada', async () => {
  await ambiente.modelos.Vaga.updateOne({ _id: dados.vaga._id }, { $set: { status: 'RASCUNHO' } });
  await ambiente.modelos.Empresa.deleteMany({});
  const empresa = await ambiente.cliente('empresa', dados);
  assert.equal((await empresa.requisitar(url())).status, 404);
});

test('estudante vinculado preserva consulta ao histórico fechado, arquivado ou expirado', async () => {
  await ambiente.modelos.Candidatura.create({
    vaga: dados.vaga._id,
    estudante: dados.estudante._id
  });
  const estudante = await ambiente.cliente('estudante', dados);
  const visitante = await ambiente.cliente(null, dados);
  for (const alteracao of [
    { status: 'FECHADA', arquivada: false },
    { status: 'ARQUIVADA', arquivada: true },
    {
      status: 'ABERTA',
      arquivada: false,
      prazo: new Date(inicioDoDiaInstitucional().getTime() - 86400000)
    }
  ]) {
    await ambiente.modelos.Vaga.updateOne({ _id: dados.vaga._id }, { $set: alteracao });
    const resposta = await estudante.requisitar(url());
    assert.equal(resposta.status, 200);
    assert.match(resposta.html, /Oferta indisponível para novas candidaturas/);
    assert.doesNotMatch(resposta.html, /action="\/candidaturas\//);
    assert.equal((await visitante.requisitar(url())).status, 404);
  }
});

test('nome legado de campus não substitui o identificador institucional nem libera outro campus', async () => {
  const legado = new ambiente.mongoose.Types.ObjectId();
  await ambiente.mongoose.connection
    .collection('campus')
    .insertOne({ _id: legado, nome: 'Campus Bagé', cidade: 'Bagé', ativo: true });
  await ambiente.modelos.Vaga.updateOne({ _id: dados.vaga._id }, { $set: { campus: legado } });
  for (const perfil of [null, 'estudante']) {
    const cliente = await ambiente.cliente(perfil, dados);
    assert.equal((await cliente.requisitar(url())).status, 404);
    assert.ok(!(await cliente.requisitar('/vagas')).html.includes(`href="${url()}"`));
  }
});

test('prazo público inclui o dia final e exclui o dia anterior', async () => {
  const visitante = await ambiente.cliente(null, dados);
  const hoje = inicioDoDiaInstitucional();
  await ambiente.modelos.Vaga.updateOne({ _id: dados.vaga._id }, { $set: { prazo: hoje } });
  await verificarLinks(visitante);
  await ambiente.modelos.Vaga.updateOne(
    { _id: dados.vaga._id },
    { $set: { prazo: new Date(hoje.getTime() - 86400000) } }
  );
  assert.equal((await visitante.requisitar(url())).status, 404);
  assert.ok(!(await visitante.requisitar('/vagas')).html.includes(`href="${url()}"`));
});

test('consulta pública independe da validação da matrícula, mas candidatura continua bloqueada', async () => {
  await ambiente.modelos.Estudante.updateOne(
    { _id: dados.estudante._id },
    { $set: { matriculaRegular: false } }
  );
  const estudante = await ambiente.cliente('estudante', dados);
  assert.equal((await estudante.requisitar(url())).status, 200);
  const resposta = await estudante.post(`/candidaturas/${dados.vaga._id}`);
  assert.equal(resposta.status, 302);
  assert.equal(resposta.location, '/estudante/perfil');
  assert.equal(await ambiente.modelos.Candidatura.countDocuments(), 0);
});

test('consulta pública independe do curso; candidatura a curso incompatível é bloqueada', async () => {
  const curso = await ambiente.modelos.Curso.create({
    nome: 'Outro curso de Bagé',
    nivel: 'TÉCNICO',
    campus: dados.campus._id,
    areasRelacionadas: [dados.area._id]
  });
  await ambiente.modelos.Estudante.updateOne(
    { _id: dados.estudante._id },
    {
      $set: { curso: curso._id, 'curriculo.caminho': 'gridfs:curriculos:012345678901234567890123' }
    }
  );
  const estudante = await ambiente.cliente('estudante', dados);
  assert.equal((await estudante.requisitar(url())).status, 200);
  assert.equal((await estudante.post(`/candidaturas/${dados.vaga._id}`)).status, 302);
  assert.equal(await ambiente.modelos.Candidatura.countDocuments(), 0);
});

test('candidatura mantém autenticação, perfil, CSRF, currículo e prevenção de duplicidade', async () => {
  const visitante = await ambiente.cliente(null, dados);
  assert.equal((await visitante.post(`/candidaturas/${dados.vaga._id}`)).location, '/login');
  const empresa = await ambiente.cliente('empresa', dados);
  assert.equal((await empresa.post(`/candidaturas/${dados.vaga._id}`)).status, 403);
  const estudante = await ambiente.cliente('estudante', dados);
  assert.equal(
    (await estudante.post(`/candidaturas/${dados.vaga._id}`, { _csrf: '' })).status,
    403
  );
  assert.equal(
    (await estudante.post(`/candidaturas/${dados.vaga._id}`)).location,
    '/estudante/perfil'
  );
  assert.equal(await ambiente.modelos.Candidatura.countDocuments(), 0);
  await ambiente.modelos.Estudante.updateOne(
    { _id: dados.estudante._id },
    { $set: { 'curriculo.caminho': 'gridfs:curriculos:012345678901234567890123' } }
  );
  const enviada = await estudante.post(`/candidaturas/${dados.vaga._id}`);
  assert.equal(enviada.status, 302);
  assert.equal(enviada.location, '/estudante/candidaturas');
  await estudante.post(`/candidaturas/${dados.vaga._id}`);
  assert.equal(await ambiente.modelos.Candidatura.countDocuments(), 1);
});

test('vaga aberta marcada como arquivada não recebe novas candidaturas', async () => {
  await ambiente.modelos.Vaga.updateOne({ _id: dados.vaga._id }, { $set: { arquivada: true } });
  await ambiente.modelos.Estudante.updateOne(
    { _id: dados.estudante._id },
    { $set: { 'curriculo.caminho': 'gridfs:curriculos:012345678901234567890123' } }
  );
  const estudante = await ambiente.cliente('estudante', dados);
  assert.equal((await estudante.requisitar(url())).status, 404);
  await estudante.post(`/candidaturas/${dados.vaga._id}`);
  assert.equal(await ambiente.modelos.Candidatura.countDocuments(), 0);
});
