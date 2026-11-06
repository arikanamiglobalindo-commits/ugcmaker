(function () {
  const $ = (sel) => document.querySelector(sel);

  function init() {
    loadSettings();
    setupToggleKey();
    setupModelRules();
    setupSave();
  }

  function loadSettings() {
    const s = window.__currentSettings;
    if (!s) return;

    if (s.api_key) $('#api-key-input').value = s.api_key;
    if (s.api_base_url) $('#api-url-input').value = s.api_base_url;
    if (s.default_resolution) $('#def-resolution').value = s.default_resolution;
    if (s.default_ratio) $('#def-ratio').value = s.default_ratio;
    if (s.default_model) $('#def-model').value = s.default_model;
    if (s.default_duration) $('#def-duration').value = s.default_duration;
  }

  function setupToggleKey() {
    const btn = $('#toggle-key');
    const input = $('#api-key-input');

    btn.addEventListener('click', () => {
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    });
  }

  function setupModelRules() {
    const model = $('#def-model');
    const resolution = $('#def-resolution');
    if (!model || !resolution) return;

    const limits = {
      'seedance-2.5': { resolutions: ['480p', '720p', '1080p'], maxDuration: 30, ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'] },
      'seedance-2.0': { resolutions: ['480p', '720p', '1080p', '4k'], maxDuration: 15, ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'] },
      'seedance-2.0-fast': { resolutions: ['480p', '720p'], maxDuration: 15, ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'] },
      'seedance-2.0-mini': { resolutions: ['480p', '720p'], maxDuration: 15, ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'] },
      'kling-4.0': { resolutions: ['720p', '1080p'], maxDuration: 30, ratios: ['16:9', '9:16', '1:1', '21:9', 'adaptive'] },
      'kling-4.0-flash': { resolutions: ['720p'], maxDuration: 20, ratios: ['16:9', '9:16', '1:1', '21:9', 'adaptive'] },
      'kling-3.0': { resolutions: ['720p', '1080p', '4k'], maxDuration: 15, ratios: ['16:9', '9:16', '1:1'] },
      'kling-3.0-turbo': { resolutions: ['720p', '1080p'], maxDuration: 15, ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'] },
      'vidu-q4': { resolutions: ['720p', '1080p', '4k'], maxDuration: 16, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      'minimax-h3': { resolutions: ['720p', '1080p'], maxDuration: 15, ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'] }
    };
    const duration = $('#def-duration');

    const sync = () => {
      const l = limits[model.value] || limits['seedance-2.5'];
      Array.from(resolution.options).forEach((opt) => { opt.disabled = !l.resolutions.includes(opt.value); });
      if (!l.resolutions.includes(resolution.value)) resolution.value = l.resolutions.includes('720p') ? '720p' : l.resolutions[0];
      const ratio = $('#def-ratio');
      if (ratio) {
        Array.from(ratio.options).forEach((opt) => { opt.disabled = !l.ratios.includes(opt.value); });
        if (!l.ratios.includes(ratio.value)) ratio.value = '9:16';
      }
      if (duration) {
        Array.from(duration.options).forEach((opt) => { opt.disabled = parseInt(opt.value, 10) > l.maxDuration; });
        if (parseInt(duration.value, 10) > l.maxDuration) duration.value = l.maxDuration + 's';
      }
    };

    model.addEventListener('change', sync);
    sync();
  }

  function setupSave() {
    const btn = $('#save-btn');

    btn.addEventListener('click', async () => {
      const data = {
        api_key: $('#api-key-input').value.trim(),
        api_base_url: $('#api-url-input').value.trim(),
        default_resolution: $('#def-resolution').value,
        default_ratio: $('#def-ratio').value,
        default_model: $('#def-model').value,
        default_duration: $('#def-duration').value
      };

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (res.ok) {
          showToast('Settings saved', 'success');
        } else {
          showToast('Failed to save', 'error');
        }
      } catch (err) {
        showToast('Connection error', 'error');
      }

      btn.disabled = false;
      btn.textContent = 'Save Settings';
    });
  }

  function showToast(message, type) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
