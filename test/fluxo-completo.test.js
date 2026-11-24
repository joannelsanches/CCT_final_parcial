import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { iniciarAmbiente } from '../scripts/support/ambiente.js';
import {
  popularCenariosTeste,
  SENHA_TESTE,
  DOMINIO_ESTUDANTE_TESTE
} from '../scripts/support/cenarios.js';
import { validarCPF } from '../utils/validacoes.js';
import { calcularPerfilEstudante } from '../utils/perfilCompleto.js';
import { validarRegrasTermo } from '../utils/regrasTermo.js';
import { criarAvatarPng, documentoTeste } from '../scripts/support/arquivosTeste.js';

let ambiente, resultado, f;
before(
  async () => {
    ambiente = await iniciarAmbiente();
    resultado = await popularCenariosTeste();
    const usuarios = {};
    for (const conta of resultado.contas)
      usuarios[conta.perfil] = await ambiente.modelos.Usuario.findOne({ email: conta.email });
    f = { usuarios, senha: SENHA_TESTE };
    process.env.DOMINIOS_INSTITUCIONAIS =
      'ifsul.edu.br,academico.ifsul.edu.br,' + DOMINIO_ESTUDANTE_TESTE;
  },
  { timeout: 120000 }
);
after(async () => {
  await ambiente?.encerrar();
});

test('cenários isolados recusam execução no ambiente normal da aplicação', async () => {
  const anterior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(popularCenariosTeste(), /ambiente isolado de testes/);
  } finally {
    process.env.NODE_ENV = anterior;
  }
});

test('dados de teste possuem perfis completos, regras válidas e repetição sem duplicatas', async () => {
  const estudantes = await ambiente.modelos.Estudante.find().populate('usuario curso campus');
  assert.equal(estudantes.length, 6);
  for (const e of estudantes) {
    assert.equal(validarCPF(e.cpf), true);
    assert.equal(calcularPerfilEstudante(e).percentual, 100);
    assert.equal(e.matriculaRegular, true);
  }
  const termos = await ambiente.modelos.TermoCompromisso.find().populate('estudante curso empresa');
  assert.equal(termos.length, 7);
  for (const t of termos) assert.equal(validarRegrasTermo(t), '', t.status + ':' + t._id);
  const arquivos = ambiente.mongoose.connection.collection('arquivosStartif.files');
  const antes = await arquivos.countDocuments();
  const repetido = await popularCenariosTeste();
  assert.equal(repetido.criados, 0);
  assert.equal(await arquivos.countDocuments(), antes);
  assert.equal(await ambiente.modelos.Avaliacao.countDocuments(), 2);
  assert.equal(await ambiente.modelos.Usuario.countDocuments(), 11);
  assert.ok(
    (await documentoTeste('Currículo de teste', ['Conteúdo para teste isolado']))
      .subarray(0, 5)
      .equals(Buffer.from('%PDF-'))
  );
  assert.equal(criarAvatarPng().subarray(1, 4).toString(), 'PNG');
});

test('contas dos perfis acessam seus módulos, fotos e documentos com autorização', async () => {
  for (const [perfil, caminhos] of [
    ['ana', ['/estudante', '/estudante/perfil', '/termos', '/avaliacoes', '/estudante/historico']],
    ['empresa', ['/empresa', '/empresa/vagas', '/empresa/convenios', '/termos', '/avaliacoes']],
    ['admin', ['/admin', '/admin/usuarios', '/admin/empresas', '/admin/relatorios']],
    ['setor', ['/admin', '/termos']],
    ['coordenador', ['/admin', '/termos']]
  ]) {
    const c = await ambiente.cliente(perfil, f);
    for (const caminho of caminhos)
      assert.equal((await c.requisitar(caminho)).status, 200, perfil + ':' + caminho);
  }
  const ana = await ambiente.modelos.Estudante.findOne({ usuario: f.usuarios.ana._id });
  const c = await ambiente.cliente('ana', f);
  const perfil = await c.requisitar('/estudante/perfil');
  assert.match(perfil.html, /class="user-chip"/);
  assert.match(perfil.html, /data-avatar/);
  assert.equal((await c.requisitar('/midia/estudantes/' + ana._id + '/foto')).status, 200);
  assert.equal((await c.requisitar('/estudantes/' + ana._id + '/curriculo')).status, 200);
  const bruno = await ambiente.cliente('bruno', f);
  assert.equal((await bruno.requisitar('/midia/estudantes/' + ana._id + '/foto')).status, 403);
  const termo = await ambiente.modelos.TermoCompromisso.findOne({ estudante: ana._id });
  assert.equal((await c.requisitar('/termos/documentos/' + termo.documentos[0]._id)).status, 200);
  assert.equal(
    (await bruno.requisitar('/termos/documentos/' + termo.documentos[0]._id)).status,
    403
  );
});

test('nova candidatura, seleção e criação de termo funcionam em cenário isolado', async () => {
  const vaga = await ambiente.modelos.Vaga.findOne({ titulo: /candidate-se durante o teste/ });
  const ana = await ambiente.cliente('ana', f);
  assert.equal((await ana.post('/candidaturas/' + vaga._id)).status, 302);
  const estudante = await ambiente.modelos.Estudante.findOne({ usuario: f.usuarios.ana._id });
  const candidatura = await ambiente.modelos.Candidatura.findOne({
    estudante: estudante._id,
    vaga: vaga._id
  });
  assert.ok(candidatura);
  const empresa = await ambiente.cliente('empresa', f);
  assert.equal(
    (
      await empresa.post('/empresa/candidaturas/' + candidatura._id + '/status', {
        status: 'SELECIONADO'
      })
    ).status,
    302
  );
  const d = (data) => new Date(data).toISOString().slice(0, 10);
  const r = await ana.post('/termos', {
    candidatura: String(candidatura._id),
    orientadorNome: 'Paula Exemplo',
    orientadorEmail: 'orientacao.teste@example.test',
    seguroResponsavel: 'CONCEDENTE',
    seguradora: 'Seguros Didáticos',
    numeroApolice: 'TESTE-NOVO',
    coberturaMorteAcidental: '20000',
    coberturaInvalidez: '20000',
    seguroVigenciaInicio: d(new Date(Date.now() - 86400000)),
    seguroVigenciaFim: d(new Date(vaga.periodoFim.getTime() + 86400000))
  });
  assert.equal(r.status, 302, r.html);
  assert.equal(
    (await ambiente.modelos.TermoCompromisso.findOne({ candidatura: candidatura._id })).status,
    'RASCUNHO'
  );
});

test('aprovação documental, início, encerramento e avaliação podem ser executados', async () => {
  const { Estudante, TermoCompromisso: Termo } = ambiente.modelos;
  const setor = await ambiente.cliente('setor', f);
  const carla = await Estudante.findOne({ usuario: f.usuarios.carla._id });
  const pendente = await Termo.findOne({ estudante: carla._id, status: 'PENDENTE' });
  for (const documento of pendente.documentos) {
    assert.equal(
      (
        await setor.post(`/termos/${pendente._id}/documentos/${documento._id}/validar`, {
          decisao: 'aprovar'
        })
      ).status,
      302
    );
  }
  const confirmacoes = Object.fromEntries(
    [
      'compatibilidadeCursoPpc',
      'jornadaHorarioEscolar',
      'supervisorApto',
      'instalacoesAvaliadas',
      'recessoPrevisto',
      'calendarioConferido',
      'frequenciaRendimento',
      'restricoesMenor',
      'requisitosAcademicosPpc'
    ].map((c) => [c, 'on'])
  );
  await setor.post(`/termos/${pendente._id}/analisar`, { decisao: 'aprovar', ...confirmacoes });
  assert.equal((await Termo.findById(pendente._id)).status, 'APROVADO');
  const diego = await Estudante.findOne({ usuario: f.usuarios.diego._id });
  const inicio = await Termo.findOne({ estudante: diego._id });
  await setor.post(`/termos/${inicio._id}/iniciar`);
  assert.equal((await Termo.findById(inicio._id)).situacaoEstagio, 'EM_ANDAMENTO');
  const elisa = await Estudante.findOne({ usuario: f.usuarios.elisa._id });
  const fim = await Termo.findOne({ estudante: elisa._id });
  await setor.post(`/termos/${fim._id}/encerrar`, { cargaHorariaCumprida: '720' });
  assert.equal((await Termo.findById(fim._id)).situacaoEstagio, 'ENCERRADO');
  const rafael = await Estudante.findOne({ usuario: f.usuarios.rafael._id });
  const encerrado = await Termo.findOne({ estudante: rafael._id });
  const aluno = await ambiente.cliente('rafael', f),
    empresa = await ambiente.cliente('empresa', f);
  for (const cliente of [aluno, empresa])
    assert.equal(
      (
        await cliente.post('/avaliacoes', {
          candidatura: String(encerrado.candidatura),
          nota: '5',
          comentario: 'Avaliação fictícia feita durante a teste.'
        })
      ).status,
      302
    );
  assert.equal(await ambiente.modelos.Avaliacao.countDocuments({ estudante: rafael._id }), 2);
});

test('avatar e progresso atualizam após salvar foto sem exigir outro login', async () => {
  const ana = await ambiente.modelos.Estudante.findOne({ usuario: f.usuarios.ana._id });
  const cliente = await ambiente.cliente('ana', f);
  const antes = (await cliente.requisitar('/estudante/perfil')).html;
  const imagemAntes = /\/midia\/estudantes\/[^"<>]+\?v=\d+/.exec(antes)?.[0];
  const form = new FormData();
  const d = (data) => new Date(data).toISOString().slice(0, 10);
  for (const [chave, valor] of Object.entries({
    _csrf: cliente.csrf,
    curso: String(ana.curso),
    semestre: String(ana.semestre),
    turno: ana.turno,
    disponibilidade: ana.disponibilidade,
    competencias: ana.competencias.join(','),
    dataInicioCurso: d(ana.dataInicioCurso),
    previsaoConclusaoCurso: d(ana.previsaoConclusaoCurso),
    disciplinasEmCurso: String(ana.disciplinasEmCurso),
    dataNascimento: d(ana.dataNascimento),
    telefone: ana.telefone
  }))
    form.set(chave, valor);
  form.set('fotoPerfil', new Blob([criarAvatarPng(1)], { type: 'image/png' }), 'nova-foto.png');
  assert.equal((await cliente.post('/estudante/perfil', {}, { form })).status, 302);
  const depois = (await cliente.requisitar('/estudante/perfil')).html;
  assert.ok(imagemAntes);
  assert.notEqual(/\/midia\/estudantes\/[^"<>]+\?v=\d+/.exec(depois)?.[0], imagemAntes);
  assert.match(depois, /100% do perfil preenchido/);
  assert.equal((await cliente.post('/estudante/perfil/foto/remover')).status, 302);
  const semFoto = (await cliente.requisitar('/estudante/perfil')).html;
  assert.doesNotMatch(semFoto, /data-avatar/);
  assert.match(semFoto, /93% do perfil preenchido/);
});
