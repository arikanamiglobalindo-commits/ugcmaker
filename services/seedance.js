const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getSettings } = require('../database');

const DEFAULT_BASE_URL = 'https://api.kie.ai';
const UPLOAD_BASE_URL = 'https://kieai.redpandaai.co';

const normalizeBaseUrl = (baseUrl) => {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  // Old BytePlus URLs (or empty) fall back to KIE AI.
  if (!url || /bytepluses|byteplus|volces/i.test(url)) {
    url = DEFAULT_BASE_URL;
  }
  return url.replace(/\/api(\/v\d+)?$/, '');
};

// Per-model limits from the KIE AI docs.
const MODELS = {
  'seedance-2.5': { id: 'bytedance/seedance-2-5', resolutions: ['480p', '720p', '1080p'], maxDuration: 30, maxRefs: 30, outputFormat: true },
  'seedance-2.0': { id: 'bytedance/seedance-2', resolutions: ['480p', '720p', '1080p', '4k'], maxDuration: 15, maxRefs: 9 },
  'seedance-2.0-fast': { id: 'bytedance/seedance-2-fast', resolutions: ['480p', '720p'], maxDuration: 15, maxRefs: 9 },
  'seedance-2.0-mini': { id: 'bytedance/seedance-2-mini', resolutions: ['480p', '720p'], maxDuration: 15, maxRefs: 9 }
};

const getModelConfig = (model) => MODELS[model] || MODELS['seedance-2.5'];

const parseDuration = (duration, maxDuration = 30) => {
  const value = parseInt(String(duration || '5').replace('s', ''), 10);
  if (Number.isNaN(value)) return 5;
  return Math.min(maxDuration, Math.max(4, value));
};

const createApiError = (errorData, fallback) => {
  const rawMessage = errorData.message || errorData.error?.message || errorData.error || JSON.stringify(errorData);
  const providerMessage = rawMessage && rawMessage !== '{}' ? String(rawMessage) : fallback;
  const requestIdMatch = providerMessage.match(/Request id:\s*([a-zA-Z0-9]+)/i);

  if (/input image may contain real person/i.test(providerMessage)) {
    const err = new Error('Gambar reference terdeteksi berisi orang asli. Hapus atau ganti Creator reference dengan karakter AI/non-real person, lalu coba generate lagi.');
    err.statusCode = 422;
    err.code = 'REAL_PERSON_IMAGE_REJECTED';
    err.providerMessage = providerMessage;
    err.requestId = requestIdMatch ? requestIdMatch[1] : null;
    return err;
  }

  const err = new Error(providerMessage || fallback);
  err.providerMessage = providerMessage;
  err.requestId = requestIdMatch ? requestIdMatch[1] : null;
  return err;
};

const imageToDataUrl = (asset) => {
  const filepath = asset.filepath || '';
  const fullPath = path.resolve(__dirname, '..', filepath);

  if (!fullPath.startsWith(path.resolve(__dirname, '..'))) {
    throw new Error('Invalid asset path');
  }

  const bytes = fs.readFileSync(fullPath);
  const ext = path.extname(filepath).toLowerCase().replace('.', '');
  const mimeMap = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif'
  };
  const mime = mimeMap[ext] || 'image/png';

  return `data:${mime};base64,${bytes.toString('base64')}`;
};

const createPatternSvg = (width, height) => {
  const spacing = 34;
  const strokeWidth = 7;
  const opacity = 0.18;
  const lines = [];
  for (let x = -height; x < width + height; x += spacing) {
    lines.push(`<line x1="${x}" y1="${height}" x2="${x + height}" y2="0" stroke="#1d1d1f" stroke-width="${strokeWidth}" opacity="${opacity}" />`);
  }
  return Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${lines.join('')}</svg>`);
};

const imageToPatternedDataUrl = async (asset) => {
  const filepath = asset.filepath || '';
  const fullPath = path.resolve(__dirname, '..', filepath);

  if (!fullPath.startsWith(path.resolve(__dirname, '..'))) {
    throw new Error('Invalid asset path');
  }

  const source = sharp(fullPath).rotate();
  const metadata = await source.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const buffer = await source
    .composite([{ input: createPatternSvg(width, height), blend: 'over' }])
    .png()
    .toBuffer();

  return `data:image/png;base64,${buffer.toString('base64')}`;
};

const VALID_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'];

const kieRequest = async (url, apiKey, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(init.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  // KIE returns HTTP 200 even on errors; the real status is in data.code.
  const code = data.code ?? response.status;
  if (!response.ok || (code && code !== 200)) {
    const err = createApiError(
      { message: data.msg || data.message || '' },
      `KIE AI request failed (code ${code})`
    );
    const reason = data.msg || data.message || '';
    if (code === 401) {
      if (/whitelist/i.test(reason)) {
        err.message = 'API key KIE AI ditolak karena IP whitelist. Matikan IP whitelist pada key ini di kie.ai/api-key.';
      } else if (/not authorized to use this model/i.test(reason)) {
        err.message = 'API key KIE AI tidak diizinkan memakai model ini. Izinkan model tersebut pada key di kie.ai/api-key.';
      } else {
        err.message = `API key KIE AI ditolak: ${reason || 'key tidak valid'}. Periksa lagi di Settings.`;
      }
    }
    if (code === 402) err.message = 'Kredit KIE AI tidak cukup. Isi ulang kredit di kie.ai.';
    err.kieCode = code;
    throw err;
  }
  return data;
};

// KIE needs public image URLs, so local reference images are uploaded to
// KIE's temporary file storage (files are deleted after 24 hours).
const prepareImageForUpload = async (asset, patterned) => {
  if (patterned) return imageToPatternedDataUrl(asset);

  const fullPath = path.resolve(__dirname, '..', asset.filepath || '');
  if (!fullPath.startsWith(path.resolve(__dirname, '..'))) {
    throw new Error('Invalid asset path');
  }

  // Seedance 2.5 requires each side to be 300-6000 px; upscale/downscale if needed.
  const meta = await sharp(fullPath).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  if (w && h && minSide >= 300 && maxSide <= 6000) {
    return imageToDataUrl(asset);
  }
  const scale = minSide < 300 ? 300 / minSide : 6000 / maxSide;
  const buffer = await sharp(fullPath).rotate()
    .resize(Math.round(w * scale), Math.round(h * scale))
    .png()
    .toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
};

const uploadImageToKie = async (dataUrl, apiKey, index) => {
  const ext = (dataUrl.match(/^data:image\/(\w+);/) || [])[1] || 'png';
  const data = await kieRequest(`${UPLOAD_BASE_URL}/api/file-base64-upload`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      base64Data: dataUrl,
      uploadPath: 'ugcmaker/references',
      fileName: `ref-${Date.now()}-${index}.${ext === 'jpeg' ? 'jpg' : ext}`
    })
  });
  const url = data.data?.downloadUrl || data.data?.fileUrl;
  if (!url) throw new Error('Upload gambar ke KIE AI gagal: tidak ada URL yang dikembalikan.');
  return url;
};

const createVideoTask = async (prompt, imageInputs, options = {}) => {
  const settings = getSettings();
  const apiKey = settings.api_key;
  const baseUrl = normalizeBaseUrl(settings.api_base_url);

  if (!apiKey) {
    throw new Error('API key not configured. Go to Settings to add your KIE AI API key.');
  }

  const referenceUrls = [];
  if (imageInputs && imageInputs.length > 0) {
    for (const [i, input] of imageInputs.entries()) {
      if (typeof input === 'string' && /^https?:\/\//.test(input)) {
        referenceUrls.push(input);
        continue;
      }
      const dataUrl = typeof input === 'string'
        ? input
        : await prepareImageForUpload(input, options.patternReferences);
      referenceUrls.push(await uploadImageToKie(dataUrl, apiKey, i));
    }
  }

  const model = getModelConfig(options.ai_model);
  const resolution = model.resolutions.includes(options.resolution) ? options.resolution : '720p';
  const ratio = VALID_RATIOS.includes(options.ratio) ? options.ratio : '9:16';

  const input = {
    prompt,
    generate_audio: true,
    resolution,
    aspect_ratio: ratio,
    duration: parseDuration(options.duration, model.maxDuration)
  };
  if (model.outputFormat) {
    input.output_format = 'mp4';
  }
  if (referenceUrls.length > 0) {
    input.reference_image_urls = referenceUrls.slice(0, model.maxRefs);
  }

  const data = await kieRequest(`${baseUrl}/api/v1/jobs/createTask`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      model: model.id,
      input
    })
  });

  const taskId = data.data?.taskId;
  if (!taskId) throw new Error('KIE AI tidak mengembalikan task ID.');
  return taskId;
};

const pollTaskStatus = async (jobId) => {
  const settings = getSettings();
  const apiKey = settings.api_key;
  const baseUrl = normalizeBaseUrl(settings.api_base_url);

  const data = await kieRequest(
    `${baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(jobId)}`,
    apiKey,
    { method: 'GET' }
  );

  const record = data.data || {};
  const state = record.state;

  let videoUrl = null;
  if (state === 'success') {
    let result = record.resultJson;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch (e) { result = null; }
    }
    result = result || record.result || {};
    videoUrl = (result.resultUrls && result.resultUrls[0]) || result.videoUrl || null;
  }

  return {
    status: state === 'success' ? 'completed' : state === 'fail' ? 'failed' : 'generating',
    video_url: videoUrl,
    error: state === 'fail' ? (record.failMsg || `Generation failed (code ${record.failCode || '-'})`) : null
  };
};

module.exports = {
  MODELS,
  createVideoTask,
  pollTaskStatus,
  imageToPatternedDataUrl
};
