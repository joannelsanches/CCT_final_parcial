import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { iniciarAmbiente } from '../scripts/support/ambiente.js';
import { migrarCanais } from '../services/migracaoCanais.js';

let ambiente, dados;
before(async () => {
  ambiente = await iniciarAmbiente();
});
beforeEach(async () => {
  dados = await ambiente.semear();
});
after(async () => {
  await ambiente?.encerrar();
});

test('preferências e notificações expõem somente e-mail e os avisos internos', async () => {
  const c = await ambiente.cliente('estudante', dados);
  const r = await c.requisitar('/preferencias/notificacoes');
  assert.equal(r.status, 200);
  assert.match(r.html, /name="receberEmail"/);
  assert.doesNotMatch(r.html, /telefone.*opcional|Cloud API|templates/i);
  assert.equal(
    (await c.post('/preferencias/notificacoes', { receberEmail: 'on', campoSemUso: 'on' })).status,
    302
  );
  assert.deepEqual(
    (
      await ambiente.modelos.Usuario.findById(dados.usuarios.estudante._id)
    ).preferenciasNotificacao.toObject(),
    { email: true }
  );
});

test('migração simula, arquiva dados removidos e repete sem alterar usuários ou avisos', async () => {
  const { Usuario, Notificacao } = ambiente.modelos;
  await Usuario.collection.updateOne(
    { _id: dados.usuarios.estudante._id },
    {
      $set: {
        'preferenciasNotificacao.canalLegado': { autorizado: true, telefone: '+5500000000000' }
      }
    }
  );
  const aviso = await Notificacao.create({
    destinatario: dados.usuarios.estudante._id,
    titulo: 'Histórico',
    mensagem: 'Preservar aviso',
    email: { status: 'ACEITO', tentativas: 1, messageId: 'id-email' }
  });
  await Notificacao.collection.updateOne(
    { _id: aviso._id },
    {
      $set: {
        canalLegado: { status: 'ENTREGUE', tentativas: 2, historico: [{ status: 'ENTREGUE' }] },
        observacaoHistorica: 'Preservar dado sem relação com canais'
      }
    }
  );
  await Notificacao.collection.createIndex({ 'canalLegado.status': 1 });
  const antes = await Notificacao.collection.findOne({ _id: aviso._id });
  assert.equal((await migrarCanais({ simular: true })).notificacoes, 1);
  assert.ok((await Notificacao.collection.findOne({ _id: aviso._id })).canalLegado);
  assert.equal(
    await ambiente.mongoose.connection.collection('historicoCanaisRemovidos').countDocuments(),
    0
  );
  const r = await migrarCanais({ simular: false });
  assert.equal(r.usuarios, 1);
  assert.equal(r.notificacoes, 1);
  assert.equal(r.indices, 1);
  const depois = await Notificacao.collection.findOne({ _id: aviso._id });
  assert.equal(depois.canalLegado, undefined);
  assert.equal(depois.observacaoHistorica, antes.observacaoHistorica);
  assert.deepEqual(depois.email, antes.email);
  assert.equal(depois.mensagem, antes.mensagem);
  assert.equal(depois.lida, antes.lida);
  assert.equal(
    (await Usuario.findById(dados.usuarios.estudante._id)).email,
    dados.usuarios.estudante.email
  );
  const arquivo = ambiente.mongoose.connection.collection('historicoCanaisRemovidos');
  assert.equal(await arquivo.countDocuments(), 2);
  assert.deepEqual(await migrarCanais({ simular: false }), {
    simular: false,
    usuarios: 0,
    notificacoes: 0,
    indices: 0
  });
  assert.equal(await arquivo.countDocuments(), 2);
});
