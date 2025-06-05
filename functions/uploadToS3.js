const AWS = require('aws-sdk');
const { parse } = require('aws-multipart-parser');
const XLSX = require('xlsx');
const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// Configuración de S3
const s3 = new AWS.S3({
  accessKeyId: process.env.MY_AWS_ACCESS_KEY,
  secretAccessKey: process.env.MY_AWS_SECRET_KEY,
  region: 'us-east-2'
});

exports.handler = async (event) => {
  try {
    const { file } = parse(event);
    if (!file) throw new Error('No file uploaded');

    // Verificar que el archivo sea un Excel YEAH
    if (!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.contentType)) {
      throw new Error('El archivo debe ser un documento Excel (.xlsx o .xls)');
    }

    // 1. Guardar el archivo Excel en S3 (en carpeta archivoexcel)
    const excelS3Key = `archivoexcel/${Date.now()}_${file.filename.replace(/\s+/g, '_')}`;
    await s3.upload({
      Bucket: 'paystubguyana',
      Key: excelS3Key,
      Body: file.content,
      ContentType: file.contentType
    }).promise();

    // 2. Leer el archivo Excel
    const workbook = XLSX.read(file.content);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);

    // 3. Cargar plantilla PDF desde S3
    const templateKey = 'plantillas/minuta_template.pdf'; // Cambiado a PDF
    const templateResponse = await s3.getObject({
      Bucket: 'paystubguyana',
      Key: templateKey
    }).promise();

    // Guardar plantilla temporalmente
    const templatePath = '/tmp/minuta_template.pdf';
    fs.writeFileSync(templatePath, templateResponse.Body);

    // 4. Procesar cada fila del Excel
    const generatedFiles = [];
    for (const row of rows) {
      try {
        // Crear PDF modificado
        const pdfBytes = await fillPdfTemplate(templatePath, row);
        
        // Subir PDF a S3 en carpeta invoice/
        const pdfS3Key = `invoice/${row.ID || Date.now()}.pdf`;
        await s3.upload({
          Bucket: 'paystubguyana',
          Key: pdfS3Key,
          Body: pdfBytes,
          ContentType: 'application/pdf'
        }).promise();
        
        generatedFiles.push({
          id: row.ID || 'N/A',
          s3Key: pdfS3Key,
          status: 'success'
        });
      } catch (error) {
        generatedFiles.push({
          id: row.ID || 'N/A',
          status: 'error',
          error: error.message
        });
      }
    }

    // Limpiar plantilla temporal
    fs.unlinkSync(templatePath);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        excel_location: excelS3Key,
        processed_rows: rows.length,
        generated_files: generatedFiles
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

async function fillPdfTemplate(templatePath, data) {
  // 1. Cargar plantilla PDF
  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);
  
  // 2. Obtener la primera página
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  
  // 3. Obtener dimensiones de la página
  const { width, height } = firstPage.getSize();
  
  // 4. Insertar datos en posiciones específicas (ajusta estas coordenadas)
  firstPage.drawText(data.ID || '', {
    x: 100,  // Ajusta posición X
    y: height - 150,  // Ajusta posición Y
    size: 12,
    color: rgb(0, 0, 0),
  });
  
  firstPage.drawText(data.Nombre || '', {
    x: 100,
    y: height - 180,
    size: 12,
    color: rgb(0, 0, 0),
  });

  // Agrega más campos según tu plantilla...
  
  // 5. Guardar PDF modificado
  return await pdfDoc.save();
}
