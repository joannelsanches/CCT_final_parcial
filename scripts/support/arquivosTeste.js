import { deflateSync } from 'node:zlib';
import { bucketArquivos } from '../../services/armazenamento.js';
import { criarPdf, finalizarPdf } from '../../utils/pdf.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function imagemPng(largura, altura, pixel) {
  const dados = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    const inicio = y * (largura * 4 + 1);
    for (let x = 0; x < largura; x++) {
      const cor = pixel(x, y);
      for (let c = 0; c < 4; c++) dados[inicio + 1 + x * 4 + c] = cor[c] ?? 255;
    }
  }
  const bloco = (tipo, conteudo) => {
    const t = Buffer.from(tipo);
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(conteudo.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, conteudo])));
    return Buffer.concat([tamanho, t, conteudo, crc]);
  };
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8;
  cabecalho[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', deflateSync(dados)),
    bloco('IEND', Buffer.alloc(0))
  ]);
}

export function criarAvatarPng(indice = 0) {
  const fundos = [
    [228, 239, 210],
    [255, 226, 214],
    [221, 234, 245],
    [249, 220, 225],
    [232, 229, 245],
    [234, 242, 224]
  ];
  const peles = [
    [210, 151, 108],
    [137, 86, 61],
    [239, 188, 145],
    [165, 110, 78],
    [225, 166, 116],
    [109, 70, 54]
  ];
  const pele = peles[indice % peles.length];
  return imagemPng(240, 240, (x, y) => {
    let cor = fundos[indice % fundos.length];
    if ((x - 120) ** 2 + (y - 105) ** 2 < 58 ** 2) cor = [53, 43, 35];
    if ((x - 120) ** 2 / 47 ** 2 + (y - 111) ** 2 / 58 ** 2 < 1 && y > 73) cor = pele;
    if (x > 104 && x < 136 && y > 151 && y < 188) cor = pele;
    if ((x - 120) ** 2 / 101 ** 2 + (y - 242) ** 2 / 74 ** 2 < 1)
      cor = indice % 2 ? [55, 82, 89] : [72, 119, 0];
    if ((x - 103) ** 2 + (y - 110) ** 2 < 3 ** 2 || (x - 137) ** 2 + (y - 110) ** 2 < 3 ** 2)
      cor = [46, 36, 29];
    if (y > 138 && y < 141 && x > 109 && x < 131) cor = [135, 67, 62];
    return cor;
  });
}

export async function documentoTeste(titulo, linhas) {
  const doc = criarPdf({ info: { Title: titulo, Author: 'StartIF - Teste' } });
  doc.font('Negrito').fontSize(24).fillColor('#487700').text('StartIF');
  doc.font('Regular').fontSize(10).fillColor('#526049').text('IFSul — Campus Bagé · Base de teste');
  doc.moveDown(2).font('Negrito').fontSize(17).fillColor('#253026').text(titulo);
  doc.moveDown().font('Regular').fontSize(11);
  for (const linha of linhas) doc.text(linha, { paragraphGap: 10 });
  doc
    .moveDown(2)
    .fontSize(9)
    .fillColor('#a43546')
    .text('DOCUMENTO FICTÍCIO PARA DEMONSTRAÇÃO. SEM VALIDADE INSTITUCIONAL.');
  return finalizarPdf(doc);
}

export async function guardarArquivoTeste(nome, bytes, pasta, mimetype) {
  const bucket = bucketArquivos();
  const origem = 'teste-v1:' + pasta + ':' + nome;
  let arquivo = await bucket.find({ 'metadata.origem': origem }).next();
  if (!arquivo) {
    const stream = bucket.openUploadStream(nome, { metadata: { origem, pasta, mimetype } });
    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(bytes);
    });
    arquivo = { _id: stream.id };
  }
  return {
    caminho: `gridfs:${pasta}:${arquivo._id}`,
    nomeOriginal: nome,
    mimetype,
    tamanho: bytes.length,
    dataEnvio: new Date()
  };
}
