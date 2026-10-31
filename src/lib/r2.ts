/**
 * ==============================================================================
 * ASOPALAV ERP — CLOUDFLARE R2 OBJECT STORAGE GATEWAY (Native WebCrypto SigV4)
 * ==============================================================================
 * All non-profile images (voucher receipts, bills, signatures, proofs) are stored
 * permanently in Cloudflare R2 ('asopalav-erp-media' bucket) and served via the
 * ultra-fast Cloudflare CDN: https://pub-5c613915e11142e0af82109d818863e1.r2.dev/
 *
 * Uses the standard W3C Web Cryptography API (crypto.subtle) native to all modern
 * browsers: 0 npm dependencies, 0 KB bundle weight, 100% reliable.
 * ==============================================================================
 */

import { getStoredCloudConfig } from '@/store/cloudConfigStore';

// Safe configuration retrieval
export const getR2Config = () => {
  const current = getStoredCloudConfig();
  return {
    accountId: current.cloudflareAccountId || import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID || import.meta.env.VITE_R2_ACCOUNT_ID || '41fcdd0b926599600e392e23fd9a17ce',
    bucketName: current.r2BucketName || import.meta.env.VITE_R2_BUCKET_NAME || 'asopalav-erp-media',
    publicDomain: (current.r2PublicDomain || import.meta.env.VITE_R2_PUBLIC_DOMAIN || 'https://pub-5c613915e11142e0af82109d818863e1.r2.dev').replace(/\/+$/, ''),
    accessKeyId: current.r2AccessKeyId || import.meta.env.VITE_R2_ACCESS_KEY_ID || 'de26211b45ce57522107182dbfe2a052',
    secretAccessKey: current.r2SecretAccessKey || import.meta.env.VITE_R2_SECRET_ACCESS_KEY || '7a2a490c0719abbb3b1cfb588c17aeeccfe3cb6369bf44e62b5c93843b4ba678',
  };
};

// Backwards-compatible stubs for any external callers
export const s3Client = null;
export const reinitializeR2 = () => null;

/**
 * Native WebCrypto helpers for AWS Signature V4
 */
async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const cryptoObj = (typeof window !== 'undefined' ? window.crypto : globalThis.crypto);
  const buffer: ArrayBuffer = typeof data === 'string'
    ? new TextEncoder().encode(data).buffer as ArrayBuffer
    : data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : data;

  const hashBuffer = await cryptoObj.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(keyData: ArrayBuffer | Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoObj = (typeof window !== 'undefined' ? window.crypto : globalThis.crypto);
  const keyBuffer: ArrayBuffer = keyData instanceof Uint8Array
    ? (keyData.buffer.slice(keyData.byteOffset, keyData.byteOffset + keyData.byteLength) as ArrayBuffer)
    : keyData;

  const cryptoKey = await cryptoObj.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const buffer = new TextEncoder().encode(data);
  const sigBuffer = await cryptoObj.subtle.sign('HMAC', cryptoKey, buffer);
  return new Uint8Array(sigBuffer);
}

function toHex(uint8Array: Uint8Array): string {
  return Array.from(uint8Array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compresses an image client-side to an optimized WebP Blob to save bandwidth and storage.
 */
export async function compressImageToBlob(
  file: File | Blob,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.82
): Promise<{ blob: Blob; contentType: string; ext: string }> {
  // If not an image (e.g. PDF), return original
  if (file.type && !file.type.startsWith('image/')) {
    return {
      blob: file,
      contentType: file.type || 'application/octet-stream',
      ext: file instanceof File ? file.name.split('.').pop() || 'bin' : 'bin',
    };
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            maxHeight = height;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve({ blob, contentType: 'image/webp', ext: 'webp' });
              } else {
                canvas.toBlob(
                  (jpegBlob) => {
                    resolve({
                      blob: jpegBlob || file,
                      contentType: 'image/jpeg',
                      ext: 'jpg',
                    });
                  },
                  'image/jpeg',
                  quality
                );
              }
            },
            'image/webp',
            quality
          );
        } else {
          resolve({ blob: file, contentType: file.type || 'image/jpeg', ext: 'jpg' });
        }
      };
      img.onerror = () => resolve({ blob: file, contentType: file.type || 'image/jpeg', ext: 'jpg' });
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve({ blob: file, contentType: file.type || 'image/jpeg', ext: 'jpg' });
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a non-profile image (receipts, signatures, settlement proofs) directly to Cloudflare R2.
 * Uses native WebCrypto SigV4.
 *
 * GUARANTEE: Never returns a temporary blob: URL. If upload fails, throws a clear Error.
 */
export async function uploadToR2(
  file: File | Blob | Uint8Array,
  folder: 'receipts' | 'signatures' = 'receipts',
  fileName?: string
): Promise<string> {
  const config = getR2Config();
  if (!config.accessKeyId || !config.secretAccessKey || !config.accountId) {
    throw new Error('Cloudflare R2 configuration is missing credentials.');
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(now.getDate());
  const month = pad(now.getMonth() + 1);
  const year = now.getFullYear();
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  const randomStr = Math.random().toString(36).substring(2, 6);

  let uploadArrayBuffer: ArrayBuffer;
  let contentType = 'image/webp';
  let fileExt = 'webp';

  if (file instanceof File || file instanceof Blob) {
    const compressed = await compressImageToBlob(file, 1600, 1600, 0.82);
    contentType = compressed.contentType;
    fileExt = compressed.ext;
    uploadArrayBuffer = await compressed.blob.arrayBuffer();
  } else {
    uploadArrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    fileExt = fileName ? fileName.split('.').pop() || 'webp' : 'webp';
  }

  const safeKey = `${folder}/${year}-${month}/${folder}_${day}-${month}-${year}_${hours}-${minutes}-${seconds}_${randomStr}.${fileExt}`;

  // AWS Signature V4 over WebCrypto API
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const region = 'auto';

  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const uri = `/${config.bucketName}/${safeKey}`;
  const endpoint = `https://${host}${uri}`;

  const payloadHash = await sha256Hex(uploadArrayBuffer);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    uri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  // Derive signing key
  const kSecret = new TextEncoder().encode('AWS4' + config.secretAccessKey);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 's3');
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signatureBytes = await hmacSha256(kSigning, stringToSign);
  const signature = toHex(signatureBytes);

  const authorizationHeader = `${algorithm} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Host: host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: authorizationHeader,
      'Content-Type': contentType,
    },
    body: uploadArrayBuffer,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('R2 Direct Upload Failed HTTP', res.status, errText);
    throw new Error(`Failed to upload to Cloudflare R2 (HTTP ${res.status}). Please check network.`);
  }

  const finalPublicUrl = `${config.publicDomain}/${safeKey}`;
  return finalPublicUrl;
}

/**
 * Deletes an uploaded file from Cloudflare R2.
 * Restricts deletion strictly to allowed media folders ('receipts/', 'signatures/').
 */
export async function deleteFromR2(urlOrKey: string): Promise<boolean> {
  if (!urlOrKey) return false;

  // Ignore blob URLs (they are in-memory only)
  if (urlOrKey.startsWith('blob:')) {
    return true;
  }

  const key = urlOrKey
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^\/+/, '');

  if (!key) return false;

  const ALLOWED_FOLDERS = ['receipts/', 'signatures/'];
  const isAllowed = ALLOWED_FOLDERS.some((f) => key.startsWith(f));
  if (!isAllowed) {
    console.warn(`[Security] Blocked unauthorized storage deletion targeting key: ${key}`);
    return false;
  }

  try {
    const config = getR2Config();
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const region = 'auto';

    const host = `${config.accountId}.r2.cloudflarestorage.com`;
    const uri = `/${config.bucketName}/${key}`;
    const endpoint = `https://${host}${uri}`;

    const payloadHash = await sha256Hex('');
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'DELETE',
      uri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const canonicalRequestHash = await sha256Hex(canonicalRequest);
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join('\n');

    const kSecret = new TextEncoder().encode('AWS4' + config.secretAccessKey);
    const kDate = await hmacSha256(kSecret, dateStamp);
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, 's3');
    const kSigning = await hmacSha256(kService, 'aws4_request');
    const signatureBytes = await hmacSha256(kSigning, stringToSign);
    const signature = toHex(signatureBytes);

    const authorizationHeader = `${algorithm} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        Host: host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: authorizationHeader,
      },
    });

    return res.ok || res.status === 204;
  } catch (err) {
    console.warn(`Failed to delete ${key} from Cloudflare R2:`, err);
    return false;
  }
}
