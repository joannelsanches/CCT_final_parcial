import test from 'node:test';
import assert from 'node:assert/strict';

import nodemailer from 'nodemailer';

import { enviarEmail, mensagemEmail, urlNotificacao } from '../services/emailService.js';

import {
  diasUteisEntre,
  documentosEncerramento,
  validarRegrasTermo
} from '../utils/regrasTermo.js';
import { papeisObrigatoriosTce } from '../utils/assinaturas.js';
import Campus from '../models/Campus.js';
import { CAMPUS_BAGE_ID } from '../utils/escopoInstitucional.js';
const termo = () => ({
  periodo: { inicio: '2026-11-01', fim: '2027-04-01' },
  modalidade: 'NAO_OBRIGATORIO',
  estudanteDataNascimento: '2005-01-01',
  jornada: { cargaDiaria: 6, cargaSemanal: 30 },
  bolsa: 1000,
  auxilioTransporte: 100,
  seguro: {
    responsavel: 'CONCEDENTE',
    vigenciaInicio: '2026-01-01',
    vigenciaFim: '2028-01-01',
    coberturaMorteAcidental: 15000,
    coberturaInvalidez: 15000
  },
  periodicidadeRelatoriosMeses: 6,
  estudante: {
    dataInicioCurso: '2024-01-01',
    previsaoConclusaoCurso: '2028-01-01',
    disciplinasEmCurso: 3
  },
  curso: { regrasEstagio: {} }
});
test('Nodemailer simulado produz HTML e texto em português sem envio real', async () => {
  const transportador = nodemailer.createTransport({ jsonTransport: true });
  const d = {
    para: 'ana@example.test',
    assunto: 'Documento pendente',
    mensagem: 'Envie <seguro> & matrícula.',
    link: '/termos'
  };
  const result = await enviarEmail(d, { transportador });
  assert.equal(result.aceito, true);
  const m = mensagemEmail(d);
  assert.match(m.html, /&lt;seguro&gt; &amp;/);
  assert.match(m.text, /IFSul — Campus Bagé/);
  assert.match(m.html, /http:\/\/localhost:3001\/termos/);
  assert.doesNotMatch(urlNotificacao('//malicioso.example/x'), /malicioso/);
});
test('SMTP distingue rejeição permanente, falha temporária e resultado incerto', async () => {
  for (const [erro, estado] of [
    [{ responseCode: 550 }, 'permanente'],
    [{ responseCode: 451 }, 'retry'],
    [{ code: 'ETIMEDOUT', command: 'DATA' }, 'incerto']
  ]) {
    const r = await enviarEmail(
      { para: 'falso@example.test', assunto: 'Teste', mensagem: 'Teste' },
      {
        transportador: {
          sendMail: async () => {
            throw Object.assign(new Error('falha simulada'), erro);
          }
        }
      }
    );
    if (estado === 'retry') assert.equal(r.retentavel, true);
    if (estado === 'incerto') assert.equal(r.incerto, true);
    if (estado === 'permanente') assert.equal(r.retentavel, false);
  }
});
test('SMTP tenta novamente falha de conexão anterior ao envio, mantendo DATA incerto', async () => {
  for (const command of ['CONN', 'EHLO', 'DATA', undefined]) {
    const resultado = await enviarEmail(
      { para: 'falso@example.test', assunto: 'Teste', mensagem: 'Teste' },
      {
        transportador: {
          sendMail: async () => {
            throw Object.assign(new Error('Timeout simulado'), { code: 'ETIMEDOUT', command });
          }
        }
      }
    );
    assert.equal(resultado.retentavel, command === 'CONN' || command === 'EHLO');
    assert.equal(resultado.incerto, command === 'DATA' || command === undefined);
  }
});
test('responsável legal é obrigatório quando a assinatura ocorre antes dos 18 anos', () => {
  const t = {
    estudanteDataNascimento: '2008-11-01',
    periodo: { inicio: '2026-12-01' },
    assinaturas: [{ papel: 'ESTUDANTE', dataAssinatura: '2026-10-12' }]
  };
  assert.ok(papeisObrigatoriosTce(t).includes('RESPONSAVEL_LEGAL'));
  t.assinaturas[0].dataAssinatura = '2026-11-02';
  assert.ok(!papeisObrigatoriosTce(t).includes('RESPONSAVEL_LEGAL'));
});
test('TCE não permite retirar a redução de jornada em avaliações', () => {
  const t = termo();
  t.jornada.reducaoEmAvaliacoes = false;
  assert.match(validarRegrasTermo(t), /redução de jornada/);
});
test('Campus usa ID único de Bagé e rejeita novos registros de campus pelo model', async () => {
  const c = new Campus({ nome: 'IFSul — Campus Bagé', cidade: 'Bagé' });
  assert.equal(String(c._id), CAMPUS_BAGE_ID);
  await assert.doesNotReject(() => c.validate());
  c._id = '111111111111111111111111';
  await assert.rejects(() => c.validate(), /registro único/);
});

test('regras institucionais validam idade, cobertura, matrícula e papel do IFSul', () => {
  assert.equal(validarRegrasTermo(termo()), '');
  let t = termo();
  t.estudanteDataNascimento = '2015-01-01';
  assert.match(validarRegrasTermo(t), /16 anos/);
  t = termo();
  t.seguro.coberturaInvalidez = 14999;
  assert.match(validarRegrasTermo(t), /15.000/);
  t = termo();
  t.estudante.disciplinasEmCurso = 0;
  assert.match(validarRegrasTermo(t), /disciplina/);
  t = termo();
  t.empresa = { tipoConcedente: 'IFSUL' };
  assert.match(validarRegrasTermo(t), /4h/);
  t.jornada = { cargaDiaria: 4, cargaSemanal: 20 };
  assert.equal(validarRegrasTermo(t), '');
});
test('antecedência usa cinco dias úteis e feriados; encerramento distingue modalidades', () => {
  assert.equal(diasUteisEntre('2026-10-05', '2026-10-12'), 5);
  assert.equal(diasUteisEntre('2026-10-05', '2026-10-12', ['2026-10-12']), 4);
  assert.match(
    validarRegrasTermo(termo(), {
      conferirAntecedencia: true,
      agora: new Date('2026-10-30T12:00:00Z')
    }),
    /cinco dias/
  );
  assert.deepEqual(documentosEncerramento({ modalidade: 'OBRIGATORIO' }), [
    'RELATORIO_FINAL',
    'FICHA_AVALIACAO'
  ]);
  assert.deepEqual(documentosEncerramento({ modalidade: 'NAO_OBRIGATORIO' }), ['TERMO_REALIZACAO']);
  assert.deepEqual(documentosEncerramento({}, true), ['TERMO_RESCISAO', 'RELATORIO_ENCERRAMENTO']);
});
test('40h e prorrogação exigem PPC e autorização documentada; obrigatório limita 12 meses', () => {
  let t = termo();
  t.modalidade = 'OBRIGATORIO';
  t.periodo.fim = '2028-01-01';
  assert.match(validarRegrasTermo(t), /12 meses/);
  t = termo();
  t.curso.regrasEstagio = {
    permiteJornada40h: true,
    cargaHorariaDiariaMaxima: 8,
    cargaHorariaSemanalMaxima: 40
  };
  t.jornada = { cargaDiaria: 8, cargaSemanal: 40 };
  assert.match(validarRegrasTermo(t), /PPC/);
  t.curso.regrasEstagio.fontePpc = 'https://intranet.ifsul.edu.br/ppc';
  t.validacoesInstitucionais = { periodoSemAulas: true };
  assert.equal(validarRegrasTermo(t, { conferenciaFinal: true }), '');
  t.excecaoInstitucional = { necessidadesEspecificas: true };
  assert.match(validarRegrasTermo(t), /autoriza/);
});
