import bcrypt from 'bcryptjs';
import mongoose from '../../config/conexao.js';
import Usuario from '../../models/Usuario.js';
import Estudante from '../../models/Estudante.js';
import Empresa from '../../models/Empresa.js';
import AreaAtuacao from '../../models/AreaAtuacao.js';
import Curso from '../../models/Curso.js';
import Vaga from '../../models/Vaga.js';
import Candidatura from '../../models/Candidatura.js';
import Convenio from '../../models/Convenio.js';
import Termo from '../../models/TermoCompromisso.js';
import Avaliacao from '../../models/Avaliacao.js';
import Notificacao from '../../models/Notificacao.js';
import { garantirCampusBage } from '../../utils/campus.js';
import { inicioDoDiaInstitucional } from '../../utils/datas.js';
import { regrasPpcConferido } from '../../utils/ppcsBage.js';
import {
  DOCUMENTOS_OBRIGATORIOS_INICIAIS,
  ROTULOS_DOCUMENTOS
} from '../../utils/documentosTermo.js';
import { criarAvatarPng, documentoTeste, guardarArquivoTeste } from './arquivosTeste.js';

export const SENHA_TESTE = 'StartIF.Teste2026!';
export const DOMINIO_ESTUDANTE_TESTE = 'academico.ifsul.example.test';
const id = (numero) =>
  new mongoose.Types.ObjectId('de00000000000000' + numero.toString(16).padStart(8, '0'));

function documentoNumerico(base, pesos1, pesos2) {
  const digito = (texto, pesos) => {
    const resto = [...texto].reduce((s, n, i) => s + Number(n) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(base, pesos1);
  return base + primeiro + digito(base + primeiro, pesos2);
}

export async function popularCenariosTeste({ agora = new Date() } = {}) {
  if (process.env.NODE_ENV !== 'test' || mongoose.connection.name !== 'startif_testes')
    throw new Error('Os cenários só podem ser usados no ambiente isolado de testes.');
  const configuracao = mongoose.connection.collection('configuracaoTeste');
  if (!(await configuracao.findOne({ _id: 'startif-teste-v1' }))) {
    const modelos = [
      Usuario,
      Estudante,
      Empresa,
      Curso,
      AreaAtuacao,
      Vaga,
      Candidatura,
      Convenio,
      Termo,
      Avaliacao,
      Notificacao
    ];
    for (const Model of modelos)
      if (await Model.countDocuments())
        throw new Error(
          'A base escolhida já contém dados não gerenciados. Use uma base de teste vazia.'
        );
    await configuracao.insertOne({ _id: 'startif-teste-v1', criadaEm: agora });
  }
  const hoje = inicioDoDiaInstitucional(agora);
  const dia = (deslocamento) => new Date(hoje.getTime() + deslocamento * 86400000);
  const data = (valor) => new Date(valor).toISOString().slice(0, 10).split('-').reverse().join('/');
  const marcadores = mongoose.connection.collection('registrosTeste');
  const senhaHash = await bcrypt.hash(SENHA_TESTE, 12);
  let criados = 0,
    existentes = 0;
  async function inserir(Model, numero, dados) {
    const chave = Model.collection.collectionName + ':' + id(numero);
    const registro = await Model.findById(id(numero));
    if (registro) {
      if (!(await marcadores.findOne({ _id: chave })))
        throw new Error(
          'Conflito com registro não gerenciado pela teste. Use outra base de teste.'
        );
      existentes++;
      return registro;
    }
    let criado;
    await mongoose.connection.transaction(async (session) => {
      [criado] = await Model.create([{ _id: id(numero), ...dados }], { session });
      await marcadores.insertOne(
        {
          _id: chave,
          colecao: Model.collection.collectionName,
          registro: criado._id,
          criadoEm: agora
        },
        { session }
      );
    });
    criados++;
    return criado;
  }
  const campus = await garantirCampusBage();
  const area = await inserir(AreaAtuacao, 500, { nome: 'Tecnologia da Informação', ativo: true });
  const alimentos = await inserir(AreaAtuacao, 501, { nome: 'Alimentos e qualidade', ativo: true });
  const cursos = [];
  for (const [i, nome, nivel, setor] of [
    [0, 'Técnico em Informática', 'TÉCNICO', area],
    [1, 'Análise e Desenvolvimento de Sistemas', 'SUPERIOR', area],
    [2, 'Tecnologia em Alimentos', 'SUPERIOR', alimentos]
  ]) {
    cursos.push(
      await inserir(Curso, 400 + i, {
        nome,
        nivel,
        campus: campus._id,
        ativo: true,
        areasRelacionadas: [setor._id],
        regrasEstagio: {
          cargaHorariaDiariaMaxima: 6,
          cargaHorariaSemanalMaxima: 30,
          permiteJornada40h: false,
          ...regrasPpcConferido(nome)
        }
      })
    );
  }
  const contas = {};
  for (const [i, chave, nome, funcao] of [
    [10, 'admin', 'Administração Teste', 'ADMINISTRADOR'],
    [11, 'setor', 'Setor de Estágios Teste', 'SETOR_ESTAGIOS'],
    [12, 'coordenador', 'Coordenação Teste', 'COORDENADOR']
  ]) {
    contas[chave] = await inserir(Usuario, i, {
      nome,
      email: chave + '.teste@example.test',
      senhaHash,
      tipo: 'ADMIN',
      funcaoAdministrativa: funcao,
      preferenciasNotificacao: { email: false }
    });
  }
  const endereco = {
    logradouro: 'Rua Didática',
    numero: '100',
    bairro: 'Centro',
    cidade: 'Bagé',
    estado: 'RS',
    cep: '96400000'
  };
  const empresas = [];
  for (let i = 0; i < 2; i++) {
    const chave = i ? 'empresa-pendente' : 'empresa';
    contas[chave] = await inserir(Usuario, 20 + i, {
      nome: i ? 'Empresa em Cadastro' : 'Marina Exemplo',
      email: chave + '.teste@example.test',
      senhaHash,
      tipo: 'EMPRESA',
      preferenciasNotificacao: { email: false }
    });
    const logo = await guardarArquivoTeste(
      'empresa-' + i + '.png',
      criarAvatarPng(i + 3),
      'empresas',
      'image/png'
    );
    empresas.push(
      await inserir(Empresa, 300 + i, {
        usuario: contas[chave]._id,
        cnpj: documentoNumerico(
          String(900000000001 + i),
          [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
          [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        ),
        razaoSocial: i ? 'Horizonte Didático Ltda.' : 'Pampa Tecnologia Didática Ltda.',
        nomeFantasia: i ? 'Horizonte Didático' : 'Pampa Tecnologia',
        telefone: '(53) 3000-0000',
        emailContato: chave + '.teste@example.test',
        responsavel: { nome: 'Marina Exemplo', cargo: 'Diretora' },
        endereco,
        descricao:
          'Organização fictícia de Bagé para teste de oportunidades e acompanhamento de estágios.',
        logo,
        statusCadastro: i ? 'PENDENTE' : 'APROVADO'
      })
    );
  }
  const estudantes = [];
  for (const [i, chave, nome] of [
    [0, 'ana', 'Ana Silva Teste'],
    [1, 'bruno', 'Bruno Costa Teste'],
    [2, 'carla', 'Carla Souza Teste'],
    [3, 'diego', 'Diego Lima Teste'],
    [4, 'elisa', 'Elisa Rocha Teste'],
    [5, 'rafael', 'Rafael Alves Teste']
  ]) {
    contas[chave] = await inserir(Usuario, 100 + i, {
      nome,
      email: `${chave}.teste@${DOMINIO_ESTUDANTE_TESTE}`,
      senhaHash,
      tipo: 'ESTUDANTE',
      preferenciasNotificacao: { email: false }
    });
    const fotoPerfil = await guardarArquivoTeste(
      chave + '-perfil.png',
      criarAvatarPng(i),
      'estudantes',
      'image/png'
    );
    const curriculo = await guardarArquivoTeste(
      chave + '-curriculo.pdf',
      await documentoTeste('Currículo — ' + nome, [
        'Estudante do IFSul — Campus Bagé.',
        'Curso: Técnico em Informática.',
        'Competências: JavaScript, HTML, CSS, lógica de programação e trabalho em equipe.',
        'Disponibilidade: manhã e tarde. Contato: ' + contas[chave].email
      ]),
      'curriculos',
      'application/pdf'
    );
    estudantes.push(
      await inserir(Estudante, 200 + i, {
        usuario: contas[chave]._id,
        cpf: documentoNumerico(
          String(100000000 + i * 1111111),
          [10, 9, 8, 7, 6, 5, 4, 3, 2],
          [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]
        ),
        matricula: 'TESTE2026' + String(i + 1).padStart(3, '0'),
        matriculaRegular: true,
        dataNascimento: dia(-22 * 365 - i * 20),
        dataInicioCurso: dia(-800),
        previsaoConclusaoCurso: dia(1000),
        disciplinasEmCurso: 5,
        telefone: '(53) 3000-0000',
        endereco,
        curso: cursos[0]._id,
        campus: campus._id,
        semestre: 4,
        turno: 'NOITE',
        disponibilidade: 'Manhã e tarde; aulas no turno da noite.',
        competencias: ['JavaScript', 'HTML', 'CSS', 'Trabalho em equipe'],
        fotoPerfil,
        curriculo
      })
    );
  }
  const preparado = await guardarArquivoTeste(
    'convenio-preparado.pdf',
    await documentoTeste('Convênio preparado para assinatura', [
      'Concedente: Pampa Tecnologia Didática Ltda.',
      'Instituição: IFSul — Campus Bagé.',
      'Vigência: ' + data(dia(-365)) + ' a ' + data(dia(1000)),
      'Este arquivo representa o documento preparado, separado da devolução assinada.'
    ]),
    'documentos',
    'application/pdf'
  );
  const assinado = await guardarArquivoTeste(
    'convenio-assinado.pdf',
    await documentoTeste('Convênio — devolução assinada fictícia', [
      'Partes: Pampa Tecnologia Didática Ltda. e IFSul — Campus Bagé.',
      'Assinaturas simuladas: Marina Exemplo e Representante Institucional Teste.',
      'Vigência: ' + data(dia(-365)) + ' a ' + data(dia(1000))
    ]),
    'documentos',
    'application/pdf'
  );
  const convenio = await inserir(Convenio, 350, {
    empresa: empresas[0]._id,
    numero: 'BG-TESTE-001',
    dataInicial: dia(-365),
    dataFinal: dia(1000),
    status: 'ATIVO',
    documentoParaAssinatura: preparado,
    pdfAssinado: {
      ...assinado,
      dataRecebimento: dia(-365),
      nomeSignatario: 'Marina Exemplo',
      funcaoSignatario: 'Diretora',
      dataAssinatura: dia(-366)
    },
    assinaturas: [
      {
        papel: 'EMPRESA',
        nome: 'Marina Exemplo',
        funcao: 'Diretora',
        entidade: empresas[0].razaoSocial,
        dataAssinatura: dia(-366)
      },
      {
        papel: 'INSTITUICAO',
        nome: 'Representante Institucional Teste',
        funcao: 'Representante institucional',
        entidade: 'IFSul — Campus Bagé',
        dataAssinatura: dia(-366)
      }
    ],
    dataAprovacao: dia(-365),
    aprovadoPor: contas.setor._id,
    historicoStatus: [
      {
        status: 'ATIVO',
        data: dia(-365),
        usuario: contas.setor._id,
        observacao: 'Cenário fictício de convênio vigente.'
      }
    ]
  });
  const preparadoHorizonte = await guardarArquivoTeste(
    'convenio-horizonte-preparado.pdf',
    await documentoTeste('Convênio BG-TESTE-002 preparado para assinatura', [
      'Concedente: ' + empresas[1].razaoSocial,
      'Instituição: IFSul — Campus Bagé.',
      'Vigência proposta: ' + data(dia(-1)) + ' a ' + data(dia(730)),
      'Representantes fictícios: Marina Exemplo e Representante Institucional Teste.'
    ]),
    'documentos',
    'application/pdf'
  );
  await guardarArquivoTeste(
    'convenio-horizonte-assinado.pdf',
    await documentoTeste('Convênio BG-TESTE-002 — devolução assinada fictícia', [
      'Concedente: ' + empresas[1].razaoSocial,
      'Instituição: IFSul — Campus Bagé.',
      'Vigência: ' + data(dia(-1)) + ' a ' + data(dia(730)),
      'Assinaturas simuladas de Marina Exemplo e Representante Institucional Teste em ' +
        data(dia(-1))
    ]),
    'documentos',
    'application/pdf'
  );
  await inserir(Convenio, 351, {
    empresa: empresas[1]._id,
    numero: 'BG-TESTE-002',
    status: 'RASCUNHO',
    documentoParaAssinatura: preparadoHorizonte
  });
  const supervisor = {
    nome: 'Marina Exemplo',
    cargo: 'Analista de sistemas',
    formacao: 'Análise e Desenvolvimento de Sistemas',
    experiencia: 'Experiência em desenvolvimento web e acompanhamento de equipes.',
    email: 'supervisao.teste@example.test',
    telefone: '(53) 3000-0000',
    quantidadeEstagiariosAtuais: 2
  };
  const vagas = [];
  const cenarios = [
    ['Desenvolvimento web — novas candidaturas', 'ABERTA', 25, 175],
    ['Suporte técnico — entrevistas', 'ABERTA', 30, 180],
    ['Interfaces web — documentos', 'ABERTA', 35, 185],
    ['Desenvolvimento JavaScript — selecionado', 'ABERTA', 40, 190],
    ['Documentação do estágio — rascunho', 'FECHADA', 30, 180],
    ['Plano de atividades — correção', 'FECHADA', 35, 185],
    ['Análise institucional — aprovação', 'FECHADA', 25, 175],
    ['Início do estágio — autorizado', 'FECHADA', -3, 87],
    ['Encerramento do estágio', 'FECHADA', -180, 0],
    ['Experiência concluída — avaliações registradas', 'FECHADA', -240, -60],
    ['Experiência concluída — avaliar agora', 'FECHADA', -220, -40],
    ['Vaga em análise institucional', 'PENDENTE_VALIDACAO', 40, 190],
    ['Rascunho para editar e publicar', 'RASCUNHO', 45, 195],
    ['Aplicações web — candidate-se durante o teste', 'ABERTA', 45, 195]
  ];
  for (let i = 0; i < cenarios.length; i++) {
    const [titulo, status, inicio, fim] = cenarios[i];
    vagas.push(
      await inserir(Vaga, 600 + i, {
        empresa: empresas[0]._id,
        titulo,
        descricao:
          'Oportunidade fictícia para aprender e aplicar conhecimentos de desenvolvimento de sistemas em uma equipe com acompanhamento.',
        areaAtuacao: area._id,
        requisitos: 'Conhecimentos de lógica, HTML, CSS e JavaScript.',
        atividades:
          'Desenvolver interfaces, corrigir problemas simples e documentar funcionalidades sob supervisão.',
        campus: campus._id,
        cursosCompativeis: [cursos[0]._id, cursos[1]._id],
        prazo: dia(inicio > 0 ? 18 : inicio - 5),
        periodoInicio: dia(inicio),
        periodoFim: dia(fim),
        modalidade: 'REMOTO',
        modalidadeEstagio: 'NAO_OBRIGATORIO',
        bolsa: 1100,
        auxilioTransporte: 120,
        cargaHoraria: 30,
        cargaHorariaDiaria: 6,
        cargaHorariaSemanal: 30,
        diasSemana: ['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA'],
        horarioInicio: '08:00',
        horarioFim: '14:00',
        reducaoJornadaAvaliacoes: true,
        supervisor,
        status,
        dataPublicacao: ['ABERTA', 'FECHADA'].includes(status)
          ? dia(inicio > 0 ? -10 : inicio - 15)
          : undefined
      })
    );
  }
  const candidaturas = [];
  for (const [i, aluno, vaga, status] of [
    [0, 0, 0, 'EM_ANALISE'],
    [1, 0, 1, 'ENTREVISTA'],
    [2, 0, 2, 'AGUARDANDO_DOCUMENTOS'],
    [3, 0, 3, 'SELECIONADO'],
    [4, 1, 4, 'SELECIONADO'],
    [5, 1, 5, 'SELECIONADO'],
    [6, 2, 6, 'SELECIONADO'],
    [7, 3, 7, 'SELECIONADO'],
    [8, 4, 8, 'SELECIONADO'],
    [9, 0, 9, 'SELECIONADO'],
    [10, 5, 10, 'SELECIONADO'],
    [11, 1, 0, 'NAO_SELECIONADO'],
    [12, 2, 1, 'CANCELADO']
  ]) {
    candidaturas.push(
      await inserir(Candidatura, 700 + i, {
        estudante: estudantes[aluno]._id,
        vaga: vagas[vaga]._id,
        status,
        dataCandidatura: dia(vaga >= 7 && vaga <= 10 ? cenarios[vaga][2] - 20 : -10),
        observacaoEmpresa:
          status === 'ENTREVISTA'
            ? 'Entrevista fictícia agendada para apresentação da equipe.'
            : '',
        historicoStatus: [
          {
            status: 'EM_ANALISE',
            data: dia(vaga >= 7 && vaga <= 10 ? cenarios[vaga][2] - 20 : -10)
          },
          {
            status,
            data: dia(vaga >= 7 && vaga <= 10 ? cenarios[vaga][2] - 15 : -5),
            usuario: contas.empresa._id
          }
        ]
      })
    );
  }
  const termos = [];
  for (const [i, aluno, vaga, cand, status, situacao] of [
    [0, 1, 4, 4, 'RASCUNHO', 'NAO_INICIADO'],
    [1, 1, 5, 5, 'REPROVADO', 'NAO_INICIADO'],
    [2, 2, 6, 6, 'PENDENTE', 'NAO_INICIADO'],
    [3, 3, 7, 7, 'APROVADO', 'NAO_INICIADO'],
    [4, 4, 8, 8, 'APROVADO', 'EM_ANDAMENTO'],
    [5, 0, 9, 9, 'APROVADO', 'ENCERRADO'],
    [6, 5, 10, 10, 'APROVADO', 'ENCERRADO']
  ]) {
    const v = vagas[vaga],
      e = estudantes[aluno],
      u = Object.values(contas).find((c) => String(c._id) === String(e.usuario));
    const assinatura = new Date(
      Math.min(v.periodoInicio.getTime() - 12 * 86400000, dia(-4).getTime())
    );
    const textoBase = [
      'Estudante: ' + u.nome,
      'Matrícula: ' + e.matricula,
      'Curso: ' + cursos[0].nome,
      'Concedente: ' + empresas[0].razaoSocial,
      'Período: ' + data(v.periodoInicio) + ' a ' + data(v.periodoFim),
      'Jornada: 6 horas por dia e 30 horas por semana, de segunda a sexta, das 08h às 14h.',
      'Bolsa: R$ 1.100,00. Auxílio-transporte: R$ 120,00.',
      'Supervisor: Marina Exemplo. Orientadora: Paula Exemplo.',
      'Redução de jornada em avaliações e recesso proporcional previstos.'
    ];
    const docs = [];
    for (const tipo of [
      ...DOCUMENTOS_OBRIGATORIOS_INICIAIS,
      ...(i >= 4 ? ['RELATORIO', 'TERMO_REALIZACAO'] : [])
    ]) {
      const titulo = ROTULOS_DOCUMENTOS[tipo];
      const dadosArquivo = await guardarArquivoTeste(
        `termo-${i}-${tipo.toLowerCase()}.pdf`,
        await documentoTeste(titulo, [
          ...textoBase,
          ...(tipo === 'APOLICE_SEGURO'
            ? [
                'Seguradora: Seguros Didáticos. Apólice: TESTE-' + i + '.',
                'Coberturas: morte acidental R$ 20.000,00 e invalidez permanente por acidente R$ 20.000,00.',
                'Responsável: concedente. Vigência: ' +
                  data(dia(-400)) +
                  ' a ' +
                  data(dia(600)) +
                  '.'
              ]
            : [
                'Plano: ' + v.atividades,
                'Assinaturas fictícias das partes registradas para o cenário de teste.'
              ])
        ]),
        'documentos',
        'application/pdf'
      );
      if (i === 0 && tipo !== 'COMPROVANTE_MATRICULA') continue;
      docs.push({
        ...dadosArquivo,
        dataEnvio: i >= 3 ? assinatura : dia(-3),
        nome: titulo,
        tipo,
        status:
          i >= 3 ? 'APROVADO' : i === 1 && tipo === 'APOLICE_SEGURO' ? 'REJEITADO' : 'ENVIADO',
        validado: i >= 3,
        dataAnalise: i >= 3 ? new Date(assinatura.getTime() + 86400000) : undefined,
        analisadoPor: i >= 3 ? contas.setor._id : undefined,
        motivoRejeicao:
          i === 1 && tipo === 'APOLICE_SEGURO'
            ? 'Reenvie a apólice com identificação legível.'
            : undefined
      });
    }
    const tce = await guardarArquivoTeste(
      `termo-${i}-tce.pdf`,
      await documentoTeste('Termo de compromisso e plano de atividades', [
        ...textoBase,
        'Data das assinaturas simuladas: ' + data(assinatura),
        'Estudante: ' +
          u.nome +
          '. Empresa: Marina Exemplo. Instituição: Representante Institucional Teste.'
      ]),
      'documentos',
      'application/pdf'
    );
    const validacoes = Object.fromEntries(
      [
        'requisitosAcademicosPpc',
        'calendarioConferido',
        'frequenciaRendimento',
        'restricoesMenor',
        'recessoPrevisto',
        'cadastroEmpresaAprovado',
        'convenioVigente',
        'matriculaRegular',
        'compatibilidadeCursoPpc',
        'jornadaHorarioEscolar',
        'supervisorApto',
        'instalacoesAvaliadas',
        'documentosCompletos'
      ].map((c) => [c, i >= 3])
    );
    termos.push(
      await inserir(Termo, 800 + i, {
        candidatura: candidaturas[cand]._id,
        estudante: e._id,
        empresa: empresas[0]._id,
        convenio: convenio._id,
        curso: cursos[0]._id,
        matricula: e.matricula,
        estudanteDataNascimento: e.dataNascimento,
        concedente: {
          razaoSocial: empresas[0].razaoSocial,
          cnpj: empresas[0].cnpj,
          representante: 'Marina Exemplo',
          cargoRepresentante: 'Diretora'
        },
        instituicaoEnsino: {
          nome: 'Instituto Federal de Educação, Ciência e Tecnologia Sul-rio-grandense',
          campus: 'Campus Bagé',
          cnpj: '10729992000731',
          representante: 'Representante Institucional Teste'
        },
        professorOrientador: {
          nome: 'Paula Exemplo',
          email: 'orientacao.teste@example.test',
          formacao: 'Informática'
        },
        supervisorEmpresa: supervisor,
        modalidade: 'NAO_OBRIGATORIO',
        planoAtividades: v.atividades,
        periodo: { inicio: v.periodoInicio, fim: v.periodoFim },
        jornada: {
          cargaDiaria: 6,
          cargaSemanal: 30,
          diasSemana: v.diasSemana,
          horarioInicio: '08:00',
          horarioFim: '14:00',
          reducaoEmAvaliacoes: true
        },
        bolsa: 1100,
        auxilioTransporte: 120,
        seguro: {
          responsavel: 'CONCEDENTE',
          seguradora: 'Seguros Didáticos',
          numeroApolice: 'TESTE-' + i,
          coberturaMorteAcidental: 20000,
          coberturaInvalidez: 20000,
          vigenciaInicio: dia(-400),
          vigenciaFim: dia(600)
        },
        documentos: docs,
        tceAssinado: i === 0 ? undefined : { ...tce, dataEnvio: assinatura },
        assinaturas:
          i === 0
            ? []
            : [
                { papel: 'ESTUDANTE', nome: u.nome, dataAssinatura: assinatura },
                { papel: 'EMPRESA', nome: 'Marina Exemplo', dataAssinatura: assinatura },
                {
                  papel: 'INSTITUICAO',
                  nome: 'Representante Institucional Teste',
                  dataAssinatura: assinatura
                }
              ],
        validacoesInstitucionais: validacoes,
        status,
        situacaoEstagio: situacao,
        dataSolicitacao: new Date(assinatura.getTime() - 3 * 86400000),
        dataAnalise: i >= 3 ? assinatura : undefined,
        dataAprovacao: i >= 3 ? assinatura : undefined,
        dataEnvioAnalise: i === 2 ? dia(-2) : undefined,
        dataInicioEfetivo: ['EM_ANDAMENTO', 'ENCERRADO'].includes(situacao)
          ? v.periodoInicio
          : undefined,
        dataEncerramento: situacao === 'ENCERRADO' ? v.periodoFim : undefined,
        cargaHorariaCumprida: situacao === 'ENCERRADO' ? 720 : undefined,
        proximoRelatorio: situacao === 'EM_ANDAMENTO' ? dia(0) : undefined,
        justificativa: i === 1 ? 'Corrija a apólice e reenvie os documentos.' : '',
        historicoStatus: [
          {
            status,
            data: i >= 3 ? assinatura : dia(-2),
            usuario: contas.setor._id,
            observacao: 'Cenário fictício para teste.'
          }
        ]
      })
    );
    if (['EM_ANDAMENTO', 'ENCERRADO'].includes(situacao)) {
      await Estudante.updateOne(
        { _id: e._id, 'historicoEstagios.vaga': { $ne: v._id } },
        {
          $push: {
            historicoEstagios: {
              vaga: v._id,
              empresa: empresas[0]._id,
              dataInicio: v.periodoInicio,
              dataFim: situacao === 'ENCERRADO' ? v.periodoFim : undefined
            }
          }
        }
      );
    }
  }
  for (const [i, tipo, autor, nota, comentario] of [
    [
      0,
      'AVALIACAO_ESTUDANTE',
      contas.ana._id,
      5,
      'Aprendi com acompanhamento e atividades compatíveis com meu curso.'
    ],
    [
      1,
      'AVALIACAO_EMPRESA',
      contas.empresa._id,
      5,
      'Boa evolução técnica, comunicação e compromisso com as atividades.'
    ]
  ]) {
    await inserir(Avaliacao, 900 + i, {
      estudante: estudantes[0]._id,
      empresa: empresas[0]._id,
      vaga: vagas[9]._id,
      autor,
      tipo,
      nota,
      comentario,
      data: dia(-55)
    });
  }
  for (const [i, chave, titulo, texto, link] of [
    [
      0,
      'ana',
      'Uma nova oportunidade para seu curso',
      'Confira as vagas abertas de desenvolvimento web.',
      '/vagas'
    ],
    [
      1,
      'ana',
      'Entrevista agendada',
      'A empresa atualizou sua candidatura para entrevista.',
      '/estudante/candidaturas'
    ],
    [
      2,
      'bruno',
      'Documento precisa de correção',
      'Confira a apólice e reenvie o documento indicado.',
      '/termos'
    ],
    [
      3,
      'carla',
      'Termo enviado para análise',
      'Os documentos foram recebidos pela instituição.',
      '/termos'
    ],
    [
      4,
      'empresa',
      'Novo candidato inscrito',
      'Veja os perfis e acompanhe as etapas da seleção.',
      '/empresa/vagas'
    ],
    [5, 'setor', 'Termo aguardando análise', 'Confira os documentos de Carla.', '/termos'],
    [
      6,
      'admin',
      'Empresa aguardando validação',
      'Uma organização concluiu seu cadastro.',
      '/admin/empresas'
    ]
  ]) {
    await inserir(Notificacao, 1000 + i, {
      destinatario: contas[chave]._id,
      titulo,
      mensagem: texto,
      link,
      tipoEvento: 'TESTE',
      chaveUnica: 'TESTE-' + i,
      email: { solicitado: false, status: 'DESATIVADO' },
      data: dia(-1),
      lida: i === 0
    });
  }
  return {
    base: mongoose.connection.name,
    criados,
    existentes,
    contas: Object.entries(contas).map(([perfil, u]) => ({ perfil, email: u.email })),

    vagas: vagas.length,
    termos: termos.length
  };
}
