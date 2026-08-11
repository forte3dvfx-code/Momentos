/* ============================================================
   images.js — compressão de fotos antes de gravar
   Redimensiona para 1600px no lado maior e grava em WebP (ou JPEG
   se o browser não souber WebP). Cria também uma miniatura de 320px
   para a linha do tempo. O original é descartado: duplicava o
   espaço ocupado sem ganho visível num telemóvel.
   ============================================================ */

(function () {
  const MAX_FULL = 1600;
  const MAX_THUMB = 320;
  const QUALITY_FULL = 0.80;
  const QUALITY_THUMB = 0.70;

  let cachedType = null;

  // Descobre uma vez se o browser consegue gravar WebP.
  function bestType() {
    if (cachedType) return cachedType;
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const ok = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    cachedType = ok ? 'image/webp' : 'image/jpeg';
    return cachedType;
  }

  /* Carrega o ficheiro como bitmap já rodado segundo o EXIF.
     Se createImageBitmap não existir (browsers antigos), usa <img>. */
  async function loadImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        try { return await createImageBitmap(file); } catch (e2) { /* segue para o fallback */ }
      }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
      img.src = url;
    });
  }

  function drawScaled(source, maxSide, type, quality) {
    const sw = source.width;
    const sh = source.height;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve({ blob, width: w, height: h });
        else reject(new Error('A conversão da imagem falhou.'));
      }, type, quality);
    });
  }

  /* Recebe um File e devolve { blob, thumb, width, height, type }. */
  async function compress(file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      throw new Error('O ficheiro escolhido não é uma imagem.');
    }
    const type = bestType();
    const source = await loadImage(file);

    const full = await drawScaled(source, MAX_FULL, type, QUALITY_FULL);
    const thumb = await drawScaled(source, MAX_THUMB, type, QUALITY_THUMB);

    if (source.close) source.close(); // liberta o bitmap da memória

    return {
      blob: full.blob,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
      type: type
    };
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  window.Images = { compress, formatBytes, bestType };
})();
