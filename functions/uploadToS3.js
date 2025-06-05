const AWS = require('aws-sdk');
const { parse } = require('aws-multipart-parser');
const XLSX = require('xlsx');
const { convert } = require('docx-pdf');
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

    // Verificar que el archivo sea un Excel
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

    // 3. Cargar plantilla Word desde S3
    const templateKey = 'plantillas/minuta_template.docx';
    const templateResponse = await s3.getObject({
      Bucket: 'paystubguyana',
      Key: templateKey
    }).promise();

    // Guardar plantilla temporalmente
    const templatePath = '/tmp/minuta_template.docx';
    fs.writeFileSync(templatePath, templateResponse.Body);

    // 4. Procesar cada fila del Excel
    const generatedFiles = [];
    for (const row of rows) {
      try {
        // Crear archivo temporal Word modificado
        const modifiedDocxPath = await replaceTemplatePlaceholders(templatePath, row);
        
        // Convertir a PDF
        const pdfPath = await convertDocxToPdf(modifiedDocxPath);
        const pdfBuffer = fs.readFileSync(pdfPath);
        
        // Subir PDF a S3 en carpeta invoice/
        const pdfS3Key = `invoice/${row.ID || Date.now()}.pdf`;
        await s3.upload({
          Bucket: 'paystubguyana',
          Key: pdfS3Key,
          Body: pdfBuffer,
          ContentType: 'application/pdf'
        }).promise();
        
        generatedFiles.push({
          id: row.ID || 'N/A',
          s3Key: pdfS3Key,
          status: 'success'
        });

        // Limpiar archivos temporales
        fs.unlinkSync(modifiedDocxPath);
        fs.unlinkSync(pdfPath);
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

async function replaceTemplatePlaceholders(templatePath, data) {
  // Implementación simplificada - en producción usa docx-templates
  const modifiedPath = `/tmp/modified_${data.ID || Date.now()}.docx`;
  fs.copyFileSync(templatePath, modifiedPath);
  return modifiedPath;
}

async function convertDocxToPdf(docxPath) {
  return new Promise((resolve, reject) => {
    const pdfPath = docxPath.replace('.docx', '.pdf');
    
    convert(docxPath, pdfPath, (err, result) => {
      if (err) return reject(err);
      resolve(pdfPath);
    });
  });
}
