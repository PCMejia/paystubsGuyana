const AWS = require('aws-sdk');
const { parse } = require('aws-multipart-parser');
const XLSX = require('xlsx');
const fs = require('fs-extra');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const libre = require('libreoffice-convert');
const tmp = require('tmp');
let fetch;

// Cargar node-fetch dinámicamente (como en Lambda)
import('node-fetch').then(mod => fetch = mod.default);

// Ruta a tu plantilla Word
const TEMPLATE_PATH = path.join(__dirname, 'minuta_template.docx');

exports.handler = async (event) => {
  if (!fetch) fetch = (await import('node-fetch')).default;

  try {
    // Parsear archivo recibido
    const { file } = parse(event);
    if (!file) throw new Error('No file uploaded');

    // Leer el archivo Excel (desde buffer)
    const workbook = XLSX.read(file.content, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Convertir a JSON: saltar la primera fila (header real está en la fila 2)
    const rows = XLSX.utils.sheet_to_json(sheet, {
      range: 1, // empieza en la fila 2 (índice 1)
      defval: '' // pone "" en lugar de undefined
    });

    if (!rows.length) throw new Error('No rows found in Excel file');

    // Configurar S3
    const s3 = new AWS.S3({
      accessKeyId: process.env.MY_AWS_ACCESS_KEY,
      secretAccessKey: process.env.MY_AWS_SECRET_KEY,
      region: 'us-east-2'
    });

    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    const folderName = `invoice/paystubs-${month}-${year}`;

    const results = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Validación básica opcional (puedes modificar)
      if (!row.NAME || !row.ID) continue;

      const docxPath = await generateDocxFromTemplate(row);
      const pdfBuffer = await convertDocxToPdf(docxPath);

      const safeName = (row.NAME || 'employee').replace(/\s+/g, '_');
      const fileName = `${folderName}/${safeName}_${i + 1}.pdf`;

      await s3.upload({
        Bucket: 'paystubguyana',
        Key: fileName,
        Body: pdfBuffer,
        ContentType: 'application/pdf'
      }).promise();

      results.push(fileName);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, files: results })
    };

  } catch (err) {
    console.error('Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// Rellenar plantilla .docx con datos de la fila
async function generateDocxFromTemplate(data) {
  const content = await fs.readFile(TEMPLATE_PATH, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true
  });

  // Ignorar campos faltantes sin romper
  doc.setOptions({
    nullGetter: () => ''
  });

  doc.render(data);
  const buf = doc.getZip().generate({ type: 'nodebuffer' });

  const tmpFile = tmp.fileSync({ postfix: '.docx' });
  fs.writeFileSync(tmpFile.name, buf);
  return tmpFile.name;
}

// Convertir .docx a PDF con libreoffice
function convertDocxToPdf(docxPath) {
  return new Promise((resolve, reject) => {
    const input = fs.readFileSync(docxPath);
    libre.convert(input, '.pdf', undefined, (err, done) => {
      if (err) return reject(err);
      resolve(done);
    });
  });
}
