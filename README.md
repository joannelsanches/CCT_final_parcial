# StartIF

Sistema de oferta e gerenciamento de estágios exclusivo do **IFSul — Campus Bagé**, com JavaScript, Node.js, Express, EJS, CSS, MongoDB/Mongoose e autenticação por sessões persistentes.

## Instalar e configurar

Requisitos: Node.js **22 ou superior**, npm e MongoDB com **replica set**, ou MongoDB Atlas. Os processos que usam transações exigem essa configuração do banco.

```bash
npm ci
cp .env.example .env
```

No PowerShell, use `Copy-Item .env.example .env`. Preserve um `.env` local existente. Configure `MONGODB_URI`, `SESSION_SECRET` e `URL_BASE` com seus dados. Para gerar um segredo de sessão: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

As instruções para instalar/iniciar o MongoDB local, preparar o replica set ou utilizar Atlas estão em [BANCO.md](docs/BANCO.md). Confira a conexão antes de cadastrar dados:

```bash
npm run verificar:banco
npm run inicializar:instituicao
```

O verificador não altera cadastros. A inicialização institucional é repetível e cria somente a referência de Bagé, uma área de TI e o curso Técnico em Informática, preservando ajustes existentes. Outros cursos e áreas de Bagé são administrados pela interface.

## Criar o administrador e executar

Preencha `ADMIN_NOME`, `ADMIN_EMAIL`, `ADMIN_SENHA` (pelo menos oito caracteres, sem senha comum) e `ADMIN_FUNCAO`. Funções existentes: `ADMINISTRADOR`, `SETOR_ESTAGIOS` e `COORDENADOR`.

```bash
npm run criar-admin
npm start
```

Repetir a criação preserva uma conta administrativa existente e sua senha. Abra `http://localhost:3001`, ou a porta configurada. `npm run dev` reinicia o servidor ao editar arquivos.

Estudantes e empresas utilizam os cadastros normais da aplicação. Matrícula, curso, documentos, validação da empresa e demais conferências continuam sujeitos às regras existentes. Não há contas predefinidas nem modo de demonstração na aplicação. A retirada desse modo não apaga registros já existentes no MongoDB.

## Google e e-mail

Contas locais e os módulos normais funcionam enquanto Google e SMTP não estiverem configurados.

- [GOOGLE.md](docs/GOOGLE.md): cliente OAuth, consentimento, usuários autorizados, callbacks e vinculação autenticada.
- [NOTIFICACOES.md](docs/NOTIFICACOES.md): configuração SMTP, preferências, fila, falhas e retentativas.
- [OPERACAO.md](docs/OPERACAO.md): arquivos privados, migrações, rotinas agendadas e implantação.

O Google usa `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_CALLBACK_URL`. O e-mail usa `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` e `URL_BASE`. `.env.example` contém todos os nomes e valores ilustrativos, sem credenciais reais.

Em produção, use HTTPS, `NODE_ENV=production`, segredo de sessão próprio e `URL_BASE` com a origem pública. O cookie seguro exige HTTPS. As sessões duram até oito horas. Nenhum cadastro Google atribui administração automaticamente.

O `.env` deve continuar fora do Git. Substitua no provedor quaisquer credenciais reais anteriormente versionadas e atualize a configuração local e a implantação. A exclusão do arquivo atual não remove cópias do histórico.

## Verificações isoladas

```bash
npm test
npm run test:paginas
npx playwright install chromium
npm run test:visual
```

Os testes e verificadores criam seu próprio MongoDB temporário com replica set. Os dados descartáveis ficam restritos a esse ambiente e são removidos no encerramento. A base configurada no `.env` não é utilizada por essas verificações. O primeiro uso pode baixar o binário MongoDB 7.0.24. Nenhum SMTP real ou cliente Google real é necessário para os testes simulados.

Os testes cobrem autenticação local e Google, assinatura/declarações de JWTs, vinculação de contas, permissões, CSRF, vagas, candidaturas, convênios, documentos, aprovação/início/encerramento, avaliações, e-mail simulado, concorrência, migrações, avatar e relatórios PDF vazios/extensos.

O verificador de páginas percorre perfis e formulários. O visual abre Chromium em computador e celular e confere links, imagens, centralização, foco, rolagem e erros. Relatórios e capturas ficam em `artifacts/qa/`, ignorado pelo Git. `PLAYWRIGHT_EXECUTABLE_PATH` permite informar uma instalação compatível. Uma execução interrompida não comprova aprovação visual.

## Estrutura

| Pasta ou entrada | Responsabilidade |
|---|---|
| `app.js` | Express, sessões, CSRF, dados compartilhados e erros |
| `index.js` | Inicialização local e conexão com o banco |
| `api/index.js`, `vercel.json` | Entrada e configuração da Vercel |
| `routes/`, `controllers/` | Endpoints, autorização e coordenação dos fluxos |
| `models/` | Esquemas e índices Mongoose |
| `services/` | Processos, autenticação, notificações, armazenamento e PDF |
| `middlewares/`, `utils/` | Proteções, validações, datas e regras compartilhadas |
| `views/`, `public/` | EJS, CSS, JavaScript do navegador e imagens públicas |
| `config/` | Conexão MongoDB e uploads |
| `assets/fonts/` | Fontes dos PDFs e atribuições obrigatórias |
| `scripts/` | Inicialização institucional, manutenção e migrações |
| `scripts/support/`, `test/` | Dados descartáveis, infraestrutura e casos de teste isolados |
| `docs/` | Configuração, operação e requisitos institucionais |

## Imagem da home e relatórios

Substitua `public/images/home-fundo.png`, ou ajuste a variável CSS `--imagem-home`. A camada fica atrás dos textos e botões, com sobreposição para contraste e cor de fundo alternativa. Preserve o recorte responsivo ao trocar a imagem.

A exportação administrativa usa PDF verdadeiro, com filtros, fontes incorporadas, acentos, tabela e paginação. Não precisa de navegador no servidor.

As únicas dependências de produção acrescentadas são `google-auth-library`, para OAuth/OIDC e validação criptográfica da identidade, e `pdfkit`, para geração dos relatórios.

## Requisitos institucionais

As regras existentes foram preservadas. Consulte [FONTES_INSTITUCIONAIS.md](docs/FONTES_INSTITUCIONAIS.md) e [MATRIZ_REQUISITOS.md](docs/MATRIZ_REQUISITOS.md). Esses documentos registram a referência documental anterior, suas datas e limites; não representam nova homologação institucional. Matrícula, PPC, calendário, instalações e autenticidade das assinaturas continuam exigindo conferência institucional.
