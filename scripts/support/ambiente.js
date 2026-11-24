import { MongoMemoryReplSet } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
export async function iniciarAmbiente({ completo = false } = {}) {
  for (const nome of [
    'SMTP_HOST',
    'EMAIL_FROM',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL'
  ])
    process.env[nome] = '';
  process.env.URL_BASE = 'http://localhost:3001';
  const banco = await MongoMemoryReplSet.create({
    binary: { version: '7.0.24' },
    replSet: { count: 1 },
    instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--nounixsocket'] }]
  });
  process.env.MONGODB_URI = banco.getUri('startif_testes');
  process.env.DOMINIOS_INSTITUCIONAIS =
    'ifsul.edu.br,academico.ifsul.edu.br,academico.ifsul.example.test';
  process.env.SESSION_SECRET = 'segredo-ficticio-exclusivo-dos-testes';
  process.env.UPLOAD_STORAGE = 'mongo';
  process.env.NODE_ENV = 'test';
  const mongoose = (await import('../../config/conexao.js')).default;
  await mongoose.connect(process.env.MONGODB_URI);
  const modelos = {};
  for (const nome of [
    'Usuario',
    'Empresa',
    'Estudante',
    'Curso',
    'Campus',
    'AreaAtuacao',
    'Vaga',
    'Candidatura',
    'TermoCompromisso',
    'Convenio',
    'Notificacao',
    'Avaliacao'
  ])
    modelos[nome] = (await import(`../../models/${nome}.js`)).default;
  await Promise.all(Object.values(modelos).map((modelo) => modelo.init()));
  const app = (await import('../../app.js')).default;
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const senha = 'StartIF-ficticio-2026';
  const senhaHash = await bcrypt.hash(senha, 4);
  async function semear() {
    if (completo) {
      const { popularCenariosTeste, SENHA_TESTE } = await import('./cenarios.js');
      await popularCenariosTeste();
      const usuarios = {};
      for (const [chave, email] of Object.entries({
        estudante: 'ana.teste@academico.ifsul.example.test',
        empresa: 'empresa.teste@example.test',
        admin: 'admin.teste@example.test',
        coordenador: 'coordenador.teste@example.test',
        setor: 'setor.teste@example.test'
      }))
        usuarios[chave] = await modelos.Usuario.findOne({ email });
      return {
        usuarios,
        senha: SENHA_TESTE,
        empresas: await modelos.Empresa.find({}).sort({ _id: 1 }),
        estudante: await modelos.Estudante.findOne({ usuario: usuarios.estudante._id }),
        vaga: await modelos.Vaga.findById('de0000000000000000000265')
      };
    }
    await Promise.all(Object.values(modelos).map((m) => m.deleteMany({})));
    for (const c of ['sessoes', 'arquivosStartif.files', 'arquivosStartif.chunks'])
      await mongoose.connection.collection(c).deleteMany({});
    const { Usuario, Empresa, Estudante, Curso, Campus, AreaAtuacao, Vaga } = modelos;
    const campus = await (await import('../../utils/campus.js')).garantirCampusBage();
    const area = await AreaAtuacao.create({ nome: 'Tecnologia da informação', ativo: true });
    const curso = await Curso.create({
      nome: 'Técnico em Informática',
      nivel: 'TÉCNICO',
      campus: campus._id,
      areasRelacionadas: [area._id],
      regrasEstagio: { exigeConvenio: false }
    });
    const usuarios = {};
    for (const [chave, tipo, funcao] of [
      ['estudante', 'ESTUDANTE'],
      ['empresa', 'EMPRESA'],
      ['outraEmpresa', 'EMPRESA'],
      ['admin', 'ADMIN', 'ADMINISTRADOR'],
      ['coordenador', 'ADMIN', 'COORDENADOR'],
      ['setor', 'ADMIN', 'SETOR_ESTAGIOS']
    ])
      usuarios[chave] = await Usuario.create({
        nome: {
          estudante: 'Ana Silva',
          empresa: 'Empresa Exemplo',
          outraEmpresa: 'Outra Empresa',
          admin: 'Administração',
          coordenador: 'Coordenação',
          setor: 'Setor de estágios'
        }[chave],
        email: `${chave.toLowerCase()}@example.test`,
        senhaHash,
        tipo,
        funcaoAdministrativa: funcao,
        preferenciasNotificacao: { email: true }
      });
    const empresas = [];
    for (const [i, chave] of ['empresa', 'outraEmpresa'].entries())
      empresas.push(
        await Empresa.create({
          usuario: usuarios[chave]._id,
          cnpj: `0000000000000${i}`,
          razaoSocial: `Empresa Exemplo ${i} Ltda.`,
          nomeFantasia: i ? 'Outra Empresa' : 'Tecnologia Bagé',
          telefone: '(53) 3000-0000',
          emailContato: `contato${i}@example.test`,
          responsavel: { nome: 'Supervisora Exemplo', cargo: 'Diretora' },
          statusCadastro: 'APROVADO',
          endereco: {
            logradouro: 'Rua Exemplo',
            numero: '100',
            bairro: 'Centro',
            cidade: 'Bagé',
            estado: 'RS',
            cep: '96400000'
          }
        })
      );
    const estudante = await Estudante.create({
      usuario: usuarios.estudante._id,
      cpf: '00000000000',
      matricula: 'FICTICIA-001',
      curso: curso._id,
      campus: campus._id,
      matriculaRegular: true,
      dataNascimento: '2005-01-01',
      dataInicioCurso: '2024-01-01',
      previsaoConclusaoCurso: '2030-12-31',
      disciplinasEmCurso: 5,
      semestre: 3,
      turno: 'NOITE'
    });
    const dias = (n) => new Date(Date.now() + n * 86400000);
    const dadosVaga = {
      empresa: empresas[0]._id,
      titulo: 'Estágio em desenvolvimento web',
      descricao: 'Aprenda com uma equipe que acompanha seu desenvolvimento.',
      areaAtuacao: area._id,
      requisitos: 'Conhecimentos básicos de JavaScript e vontade de aprender.',
      atividades: 'Desenvolvimento de interfaces e apoio na manutenção de sistemas.',
      campus: campus._id,
      cursosCompativeis: [curso._id],
      prazo: dias(15),
      periodoInicio: dias(25),
      periodoFim: dias(180),
      modalidade: 'REMOTO',
      modalidadeEstagio: 'NAO_OBRIGATORIO',
      bolsa: 1000,
      auxilioTransporte: 100,
      cargaHoraria: 30,
      cargaHorariaDiaria: 6,
      cargaHorariaSemanal: 30,
      diasSemana: ['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA'],
      horarioInicio: '08:00',
      horarioFim: '14:00',
      supervisor: { nome: 'Supervisora Exemplo', cargo: 'Analista', formacao: 'Informática' },
      status: 'ABERTA'
    };
    const vaga = await Vaga.create(dadosVaga);
    return { usuarios, empresas, estudante, curso, campus, area, vaga, dadosVaga, senha };
  }
  async function cliente(chave, f) {
    let cookie = '',
      csrf = '';
    async function requisitar(path, { method = 'GET', data, form, headers = {} } = {}) {
      const body = form || (data ? new URLSearchParams(data) : undefined);
      const r = await fetch(base + path, {
        method,
        body,
        redirect: 'manual',
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers }
      });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const bytes = Buffer.from(await r.arrayBuffer());
      const html = bytes.toString('utf8');
      const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
      if (match) csrf = match[1];
      return {
        status: r.status,
        html,
        location: r.headers.get('location'),
        headers: r.headers,
        bytes
      };
    }
    await requisitar('/login');
    if (chave) {
      const login = await requisitar('/login', {
        method: 'POST',
        data: { email: f.usuarios[chave].email, senha: f.senha, _csrf: csrf }
      });
      if (login.status !== 302) throw new Error(`Login de teste falhou: ${login.status}`);
      await requisitar('/preferencias/notificacoes');
    }
    return {
      requisitar,
      post: (path, data = {}, extra = {}) =>
        requisitar(path, { method: 'POST', data: { _csrf: csrf, ...data }, ...extra }),
      get csrf() {
        return csrf;
      }
    };
  }
  async function encerrar() {
    await new Promise((resolve) => servidor.close(resolve));
    await mongoose.disconnect();
    await banco.stop();
  }
  return { modelos, mongoose, base, semear, cliente, encerrar };
}
