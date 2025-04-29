const AWS = require('aws-sdk');
const { parse } = require('aws-multipart-parser');
const fetch = require('node-fetch');

const s3 = new AWS.S3({
  accessKeyId: process.env.MY_AWS_ACCESS_KEY,
  secretAccessKey: process.env.MY_AWS_SECRET_KEY
});

exports.handler = async (event) => {
  try {
    // 1. Validar archivo
    const { file } = parse(event);
    if (!file) throw new Error('No file uploaded');

    // 2. Subir a S3
    const s3Key = `invoice/${Date.now()}_${file.filename.replace(/\s+/g, '_')}`;
    await s3.upload({
      Bucket: 'paystubguyana',
      Key: s3Key,
      Body: file.content,
      ContentType: file.contentType
    }).promise();

    // 3. Llamar a Make.com
    const makeResponse = await fetch('https://hook.us2.make.com/sym6r1wjvg082q478rz2im1ishkplt9a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s3_key: s3Key,
        original_name: file.filename,
        action: 'process_paystub'
      })
    });

    if (!makeResponse.ok) throw new Error(await makeResponse.text());

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        s3_path: s3Key 
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: err.message,
        step: 'backend_processing' 
      })
    };
  }
};
