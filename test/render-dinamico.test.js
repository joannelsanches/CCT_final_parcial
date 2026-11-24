import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import ejs from 'ejs';

const base = {
  googleCadastro: null,
  avatarUsuario: {},
  csrfToken: 'csrf-ficticio',
  podeGerenciarExclusoes: false,
  usuarioLogado: null,
  mensagem: null,
  erros: {},
  valores: {},
  notificacoesNaoLidas: 0,
  formatarData: () => '01/01/2026',
  formatarMoeda: () => 'R$ 1.000,00',
  formatarEndereco: () => 'Bagé/RS',
  formatarLocalizacaoResumida: () => 'Bagé · RS',
  formatarCep: () => '96400-000',
  formatarNomeProprio: (nome = '') => nome,
  montarLinhaTempoEstagio: () => [],
  montarChecklistDocumentos: () => [],
  rotuloStatusConvenio: (status = '') => status.replaceAll('_', ' '),
  iniciais: () => 'SI'
};

async function renderizar(view, dados = {}) {
  const html = await ejs.renderFile(join(process.cwd(), 'views', view), { ...base, ...dados });
  assert.match(html, /StartIF/);
}

test('views principais renderizam com estados vazios e dados mínimos', async () => {
  await renderizar('auth/cadastro-empresa.ejs');
  await renderizar('empresa/perfil.ejs', {
    empresa: {
      _id: 'e1',
      nomeFantasia: 'Empresa',
      razaoSocial: 'Empresa Ltda.',
      cnpj: '00000000000000',
      telefone: '',
      emailContato: '',
      responsavel: {},
      endereco: {},
      statusCadastro: 'PENDENTE'
    },
    convenio: null,
    conclusaoPerfil: { percentual: 0, faltantes: [] }
  });
  await renderizar('estudante/perfil.ejs', {
    estudante: {
      _id: 's1',
      usuario: { nome: 'Estudante' },
      cpf: '',
      matricula: '',
      matriculaRegular: false,
      curso: null,
      campus: null,
      competencias: [],
      endereco: {}
    },
    cursos: [],
    campi: [],
    conclusaoPerfil: { percentual: 0, faltantes: [] }
  });
  await renderizar('empresa/vaga-form.ejs', { vaga: null, cursos: [], campi: [], areas: [] });
  await renderizar('vagas/lista.ejs', { vagas: [], cursos: [], campi: [], areas: [], filtros: {} });
  await renderizar('admin/cadastros-index.ejs', { contagens: { campi: 0, areas: 0, cursos: 0 } });
  await renderizar('admin/areas.ejs', { areas: [], edicao: null });
  await renderizar('admin/cursos.ejs', { cursos: [], campi: [], areas: [], edicao: null });
  await renderizar('admin/convenios.ejs', {
    convenios: [],
    empresas: [],
    grupo: 'andamento',
    contagens: { andamento: 0, ativos: 0, inativos: 0, todos: 0 }
  });
  const convenio = {
    _id: 'c1',
    numero: '',
    status: 'RASCUNHO',
    empresa: { _id: 'e1', nomeFantasia: 'Empresa', razaoSocial: 'Empresa Ltda.' },
    assinaturas: [],
    historicoStatus: []
  };
  await renderizar('admin/convenio-detalhes.ejs', { convenio });
  await renderizar('admin/convenio-editar.ejs', { convenio, empresas: [convenio.empresa] });
  await renderizar('empresa/convenios.ejs', {
    empresa: convenio.empresa,
    convenios: [],
    grupo: 'andamento',
    contagens: { andamento: 0, ativos: 0, inativos: 0, todos: 0 }
  });
  await renderizar('empresa/convenio-detalhes.ejs', { convenio });
  await renderizar('admin/usuarios.ejs', {
    usuarios: [],
    perfisEstudante: {},
    perfisEmpresa: {},
    tipo: '',
    busca: '',
    paginacao: { pagina: 1, totalPaginas: 1, total: 0 }
  });
  await renderizar('estudante/termos.ejs', { termos: [], selecionadas: [] });
  await renderizar('admin/termos.ejs', { termos: [] });
  await renderizar('empresa/avaliacoes.ejs', { candidaturas: [], avaliacoes: [] });
});
