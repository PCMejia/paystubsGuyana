const AWS = require('aws-sdk');
const { parse } = require('aws-multipart-parser');

// Reemplaza el require por import dinámico
let fetch;
import('node-fetch').then(mod => fetch = mod.default);

exports.handler = async (event) => {
  // Asegúrate que fetch esté cargado
  if (!fetch) fetch = (await import('node-fetch')).default;
  
  try {
    const { file } = parse(event);
    if (!file) throw new Error('No file uploaded');

    // Obtener mes y año actual para el nombre de la carpeta
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0'); // Mes (01-12)
    const year = now.getFullYear();
    const folderName = `invoice/paystubs-${month}-${year}`; // Modificado: dentro de invoice/

    // Modificado: Incluir la ruta completa en el s3Key
    const s3Key = `${folderName}/${Date.now()}_${file.filename.replace(/\s+/g, '_')}`;
    
    await new AWS.S3({
      accessKeyId: process.env.MY_AWS_ACCESS_KEY,
      secretAccessKey: process.env.MY_AWS_SECRET_KEY,
      region: 'us-east-2'
    }).upload({
      Bucket: 'paystubguyana',
      Key: s3Key,
      Body: file.content,
      ContentType: file.contentType
    }).promise();

    const makeResponse = await fetch('https://hook.us2.make.com/sym6r1wjvg082q478rz2im1ishkplt9a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s3_key: s3Key,
        original_name: file.filename
      })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        folder: folderName,
        s3_key: s3Key 
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
