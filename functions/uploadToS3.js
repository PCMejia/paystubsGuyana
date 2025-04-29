const AWS = require('aws-sdk');
const { parse } = require('aws-multipart-parser');

// Configura S3 con tus variables
const s3 = new AWS.S3({
  accessKeyId: process.env.MY_AWS_ACCESS_KEY,
  secretAccessKey: process.env.MY_AWS_SECRET_KEY
});

exports.handler = async (event) => {
  try {
    // Parsear el formulario multipart
    const { file } = parse(event);
    
    if (!file) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No se subió ningún archivo' })
      };
    }

    // Validar tipo de archivo
    const validTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (!validTypes.includes(file.contentType)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Solo se permiten archivos Excel (.xls, .xlsx)' })
      };
    }

    // Parámetros para S3
    const params = {
      Bucket: 'paystubguyana',
      Key: `invoice/${Date.now()}_${file.filename}`,
      Body: file.content,
      ContentType: file.contentType
    };

    // Subir a S3
    const data = await s3.upload(params).promise();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Archivo subido exitosamente',
        location: data.Location
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Error al procesar el archivo',
        details: error.message 
      })
    };
  }
};
