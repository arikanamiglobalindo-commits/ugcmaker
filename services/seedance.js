const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getSettings } = require('../database');

const DEFAULT_BASE_URL = 'https://api.kie.ai';
const UPLOAD_BASE_URL = process.env.KIE_UPLOAD_URL || 'https://kieai.redpandaai.co';

const normalizeBaseUrl = (baseUrl) => {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  // Old BytePlus URLs (or empty) fall back to KIE AI.
  if (!url || /bytepluses|byteplus|volces/i.test(url)) {
    url = DEFAULT_BASE_URL;
  }
  return url.replace(/\/api(\/v\d+)?$/, '');
};

const SEEDANCE_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'];

const seedanceInput = (extra = {}) => ({ prompt, refs, resolution, ratio, duration }) => {
  const input = { prompt, generate_audio: true, resolution, aspect_ratio: ratio, duration, ...extra };
  if (refs.length > 0) input.reference_image_urls = refs;
  return input;
};

// Per-model limits and request format, taken from the KIE AI docs.
// refStyle decides how "[Product 1]"-style labels in the prompt are rewritten.
const MODELS = {
  'seedance-2.5': {
    audioRef: 'urls',
    id: 'bytedance/seedance-2-5', resolutions: ['480p', '720p', '1080p'], ratios: SEEDANCE_RATIOS,
    maxDuration: 30, maxRefs: 30, buildInput: seedanceInput({ output_format: 'mp4' })
  },
  'seedance-2.0': {
    audioRef: 'urls',
    id: 'bytedance/seedance-2', resolutions: ['480p', '720p', '1080p', '4k'], ratios: SEEDANCE_RATIOS,
    maxDuration: 15, maxRefs: 9, buildInput: seedanceInput()
  },
  'seedance-2.0-fast': {
    audioRef: 'urls',
    id: 'bytedance/seedance-2-fast', resolutions: ['480p', '720p'], ratios: SEEDANCE_RATIOS,
    maxDuration: 15, maxRefs: 9, buildInput: seedanceInput()
  },
  'seedance-2.0-mini': {
    audioRef: 'urls',
    id: 'bytedance/seedance-2-mini', resolutions: ['480p', '720p'], ratios: SEEDANCE_RATIOS,
    maxDuration: 15, maxRefs: 9, buildInput: seedanceInput()
  },
  'kling-4.0': {
    audioRef: 'kling',
    id: 'kling-4.0/reference-to-video', resolutions: ['720p', '1080p'], ratios: ['16:9', '9:16', '1:1', '21:9', 'adaptive'],
    maxDuration: 30, maxRefs: 10, refStyle: 'kling',
    buildInput: ({ prompt, refs, resolution, ratio, duration }) => ({
      prompt, duration, resolution, aspect_ratio: ratio === 'adaptive' ? 'auto' : ratio, image_urls: refs
    })
  },
  'kling-4.0-flash': {
    id: 'kling-4.0/flash-reference-to-video', resolutions: ['720p'], ratios: ['16:9', '9:16', '1:1', '21:9', 'adaptive'],
    maxDuration: 20, maxRefs: 10, refStyle: 'kling',
    buildInput: ({ prompt, refs, ratio, duration }) => ({
      prompt, duration, resolution: '720p', aspect_ratio: ratio === 'adaptive' ? 'auto' : ratio, image_urls: refs
    })
  },
  'vidu-q4': {
    audioRef: 'urls',
    id: 'vidu-q4/reference-to-video', resolutions: ['720p', '1080p', '4k'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    maxDuration: 16, maxRefs: 15, refStyle: 'numbered', requiresRefs: true,
    buildInput: ({ prompt, refs, resolution, ratio, duration }) => ({
      prompt, duration, resolution, aspect_ratio: ratio, audio: true, reference_image_urls: refs
    })
  },
  'kling-3.0': {
    id: 'kling-3.0-omni/reference-to-video', resolutions: ['720p', '1080p', '4k'], ratios: ['16:9', '9:16', '1:1'],
    maxDuration: 15, maxRefs: 7, maxPrompt: 3000, refStyle: 'numbered', requiresRefs: true,
    buildInput: ({ prompt, refs, resolution, ratio, duration }) => ({
      prompt, image_urls: refs, duration, resolution, aspect_ratio: ratio, audio: true
    })
  },
  'kling-3.0-turbo': {
    // Image-to-video from a single first frame; audio is always included.
    // Uses the creator photo if there is one, otherwise the product photo.
    id: 'kling/v3-turbo-image-to-video', resolutions: ['720p', '1080p'],
    ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'],
    maxDuration: 15, maxRefs: 1, maxPrompt: 2400, requiresRefs: true,
    pickRefs: (inputs) => {
      const creator = inputs.find((a) => a && a.type === 'model');
      return [creator || inputs[0]].filter(Boolean);
    },
    buildInput: ({ prompt, refs, resolution, duration }) => ({
      prompt, image_urls: refs, duration: String(duration), resolution
    })
  },
  'minimax-h3': {
    audioRef: 'urls',
    // H3 uses its own resolution names: 768P (shown as 720p) and 2K (shown as 1080p).
    id: 'minimax-h3/reference-to-video', resolutions: ['720p', '1080p'], ratios: SEEDANCE_RATIOS,
    maxDuration: 15, maxRefs: 9, refStyle: 'numbered',
    buildInput: ({ prompt, refs, resolution, ratio, duration }) => {
      const input = { prompt, duration, resolution: resolution === '1080p' ? '2K' : '768P', aspect_ratio: ratio };
      if (refs.length > 0) input.reference_image_urls = refs;
      return input;
    }
  }
};

// Curated ElevenLabs voices (ids from the KIE AI ElevenLabs docs).
const VOICE_IDS = new Set([
  'TX3LPaxmHKxFdv7VOQHJ', '1SM7GgM6IMuvQlz2BwM3', 'UgBBYS2sOqTuMpoF3BR0', 'vBKc2FfBKJfcZNyEt1n6',
  'DTKMou8ccj1ZaWGBiotd', 'Sq93GQT4X1lKDXsQcixO', 'nPczCjzI2devNBz1zQrb', 'EkK5I93UQWFDigLMpZcX',
  'BZgkqPqms7Kj9ulSkVzn', 'kPzsL2i3teMYv0FxEYQ6', 'lcMyyd2HUfFzxdCaC4Ta', 'hpp4J3VqNfWAUOO0d1Us',
  'FGY2WhTYpPnrIDTdsKH5', '5l5f8iK3YPeGga21rQIX', 'g6xIsTj2HwM6VR4iXFCw', '6aDn1KB0hjpdcocrUkmq'
]);

const VOICE_FALLBACK_TEXT = {
  id: 'Hai semuanya! Hari ini aku mau kasih rekomendasi produk favorit aku, langsung aja ya.',
  en: 'Hey everyone! Today I want to show you one of my favorite products, let me show you.'
};

// A short sample (about 6-10 seconds) is enough: the video models use it as the
// voice character for the creator, and all of them accept clips of 3-12 seconds.
const buildVoiceSampleText = (script, lang) => {
  const clean = String(script || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 40) return VOICE_FALLBACK_TEXT[lang] || VOICE_FALLBACK_TEXT.id;
  if (clean.length <= 150) return clean;
  const cut = clean.slice(0, 150);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentenceEnd >= 60) return cut.slice(0, sentenceEnd + 1);
  return cut.replace(/\s+\S*$/, '') + '.';
};

const voiceCache = new Map();

const generateVoiceSample = async ({ voiceId, script, language, apiKey, baseUrl }) => {
  const lang = /english/i.test(language || '') ? 'en' : 'id';
  const text = buildVoiceSampleText(script, lang);
  const cacheKey = `${voiceId}|${lang}|${text}`;
  if (voiceCache.has(cacheKey)) return voiceCache.get(cacheKey);

  const created = await kieRequest(`${baseUrl}/api/v1/jobs/createTask`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      model: 'elevenlabs/text-to-speech-turbo-2-5',
      input: { text, voice: voiceId, language_code: lang, stability: 0.5, similarity_boost: 0.75 }
    })
  });
  const taskId = created.data?.taskId;
  if (!taskId) throw new Error('ElevenLabs tidak mengembalikan task ID.');

  for (let attempt = 0; attempt < 45; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await pollTaskStatus(taskId);
    if (status.status === 'completed' && status.video_url) {
      voiceCache.set(cacheKey, status.video_url);
      return status.video_url;
    }
    if (status.status === 'failed') {
      throw new Error(`Gagal membuat suara ElevenLabs: ${status.error || 'unknown error'}`);
    }
  }
  throw new Error('Pembuatan suara ElevenLabs terlalu lama. Coba lagi.');
};

const REF_LABELS = { product: 'Product', model: 'Creator', background: 'Background' };

// Rewrites "[Creator 1]"-style labels into the reference syntax a model understands,
// based on the order the images are sent in.
const rewriteReferences = (prompt, assets, refStyle) => {
  if (!refStyle || !assets || assets.length === 0) return prompt;
  const counters = {};
  const mapping = [];
  assets.forEach((asset, i) => {
    if (typeof asset === 'string') return;
    const label = REF_LABELS[asset.type] || 'Reference';
    counters[label] = (counters[label] || 0) + 1;
    const tag = refStyle === 'kling' ? `@image_${i + 1}` : `reference image ${i + 1}`;
    mapping.push({ text: `[${label} ${counters[label]}]`, tag, label });
  });
  let out = prompt;
  mapping.forEach(({ text, tag }) => { out = out.split(text).join(tag); });
  const legend = mapping.map(({ tag, label }) => `${tag} = ${label.toLowerCase()}`).join(', ');
  return legend ? `${out}\n\nReferences: ${legend}.` : out;
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
  const ext = path.extname(asset.filepath || '').toLowerCase();
  const isJpgOrPng = ['.jpg', '.jpeg', '.png'].includes(ext);
  if (w && h && minSide >= 300 && maxSide <= 6000) {
    if (isJpgOrPng) return imageToDataUrl(asset);
    const converted = await sharp(fullPath).rotate().png().toBuffer();
    return `data:image/png;base64,${converted.toString('base64')}`;
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

  const model = getModelConfig(options.ai_model);
  const allInputs = imageInputs || [];
  const chosenInputs = model.pickRefs ? model.pickRefs(allInputs) : allInputs.slice(0, model.maxRefs);

  const referenceUrls = [];
  if (chosenInputs.length > 0) {
    for (const [i, input] of chosenInputs.entries()) {
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

  if (model.requiresRefs && referenceUrls.length === 0) {
    throw new Error('Model ini butuh minimal satu gambar referensi (produk/creator/background).');
  }
  const resolution = model.resolutions.includes(options.resolution) ? options.resolution : model.resolutions.includes('720p') ? '720p' : model.resolutions[0];
  const ratio = model.ratios.includes(options.ratio) ? options.ratio : '9:16';

  let finalPrompt = prompt;
  if (model.maxPrompt) {
    // Leave room for the reference legend added below.
    const budget = model.maxPrompt - 200;
    if (finalPrompt.length > budget) finalPrompt = finalPrompt.slice(0, budget).replace(/\s+\S*$/, '');
  }

  let voiceUrl = null;
  if (options.voice_id && VOICE_IDS.has(options.voice_id)) {
    if (!model.audioRef) {
      throw new Error('Model ini belum mendukung pilihan suara ElevenLabs. Pilih "Bawaan model" atau ganti model.');
    }
    voiceUrl = await generateVoiceSample({
      voiceId: options.voice_id, script: options.script, language: options.language, apiKey, baseUrl
    });
    const voiceLine = model.audioRef === 'kling'
      ? 'Creator berbicara dengan suara @CreatorVoice untuk semua dialog.'
      : 'Suara creator: gunakan karakter suara dari reference audio 1 untuk semua dialog (warna suara, aksen, dan gaya bicara).';
    finalPrompt = `${finalPrompt}\n${voiceLine}`;
  }

  const input = model.buildInput({
    prompt: rewriteReferences(finalPrompt, chosenInputs, model.refStyle),
    refs: referenceUrls,
    resolution,
    ratio,
    duration: parseDuration(options.duration, model.maxDuration)
  });
  if (voiceUrl) {
    if (model.audioRef === 'kling') {
      input.voices = [{ name: 'CreatorVoice', audio_url: voiceUrl }];
    } else {
      input.reference_audio_urls = [voiceUrl];
    }
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
