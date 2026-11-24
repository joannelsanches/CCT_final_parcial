import { gravarResultado, paginasVerificacao } from './support/verificacao.js';
import { iniciarAmbiente } from './support/ambiente.js';

const ambiente = await iniciarAmbiente({ completo: true });
const registros = [],
  erros = [];
try {
  const f = await ambiente.semear();
  const convenio = await ambiente.modelos.Convenio.findOne({ numero: 'BG-TESTE-001' });
  const paginas = paginasVerificacao(f.vaga, convenio);
  for (const [perfil, caminhos] of paginas) {
    const cliente = await ambiente.cliente(perfil === 'publico' ? null : perfil, f);
    for (const caminho of caminhos) {
      const resposta = await cliente.requisitar(caminho);
      const formularios = resposta.html.match(/<form\b[^>]*method="post"[\s\S]*?<\/form>/gi) || [];
      const csrf = formularios.every((form) => /name="_csrf"\s+value="[^"]+"/.test(form));
      const campusFixo = !/<select\b[^>]*name="campus"/.test(resposta.html);
      const item = {
        perfil: perfil || 'publico',
        caminho,
        http: resposta.status,
        formularios: formularios.length,
        csrf,
        campusFixo
      };
      registros.push(item);
      if (resposta.status !== 200 || !csrf || !campusFixo) erros.push(item);
    }
  }
  await gravarResultado('paginas.json', {
    data: new Date().toISOString(),
    tipo: 'HTTP_EJS',
    registros,
    erros
  });
  console.log(JSON.stringify({ paginas: registros.length, erros }, null, 2));
  if (erros.length) process.exitCode = 1;
} finally {
  await ambiente.encerrar();
}
