const fs = require('fs');
const { S3Client, PutObjectCommand, ObjectCannedACL } = require('@aws-sdk/client-s3');



const REGION = process.env.REGION;
const BUCKET = process.env.BUCKET_NAME;
const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY;

// Initialize S3 client
const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads a local file to S3 and returns the public URL.
 * @param {Object} params
 * @param {string} params.localFilePath - Path to the local file
 * @param {string} params.s3Key - Desired key (path) in S3
 * @returns {Promise<string|null>}
 */
async function uploadFileToS3({ localFilePath, s3Key }) {
  try {
    const fileStream = fs.createReadStream(localFilePath);
    const uploadParams = {
      Bucket: BUCKET,
      Key: s3Key,
      Body: fileStream,
      ACL: ObjectCannedACL.public_read,
      ContentType: 'image/png',
    };

    await s3.send(new PutObjectCommand(uploadParams));

    const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${s3Key}`;
    console.log(`[S3] Uploaded screenshot to: ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.error('[S3] Upload failed:', err);
    return null;
  }
}

module.exports = {
  uploadFileToS3,
};
