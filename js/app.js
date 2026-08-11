/* ============================================================
   app.js — lógica da aplicação Momentos
   ============================================================ */

(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const MAX_PHOTOS = 5;

  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado'];

  const LS = {
    lastBackupAt: 'momentos.lastBackupAt',
    intervalDays: 'momentos.backupIntervalDays',
    snoozeUntil: 'momentos.snoozeUntil',
    firstRunAt: 'momentos.firstRunAt'
  };

  const $ = (sel, root) => (root || document).querySelector(sel);

  // ---------------- Estado ----------------

  let events = [];              // todos os eventos em memória (só texto)
  let thumbIndex = new Map();   // eventId -> { thumb: Blob, count: n }
  let objectUrls = [];          // URLs temporários a libertar no próximo render
  let filters = { q: '', month: '', tag: '' };
  let currentId = null;         // evento aberto no detalhe
  let editingId = null;         // evento a ser editado (null = novo)
  let formPhotos = [];          // { id?, blob, thumb, width, height }
  let removedPhotoIds = [];
  let currentView = 'list';

  // ---------------- Utilitários ----------------

  function todayISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function parseISO(iso) {
    const parts = String(iso).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function sortKey(ev) {
    return ev.date + 'T' + (ev.time || '00:00');
  }

  function formatLongDate(ev) {
    const d = parseISO(ev.date);
    let s = WEEKDAYS_LONG[d.getDay()] + ', ' + d.getDate() + ' de ' +
            MONTHS[d.getMonth()] + ' de ' + d.getFullYear();
    if (ev.time) s += ' às ' + ev.time;
    return s;
  }

  function monthLabel(yearMonth) {
    const parts = yearMonth.split('-');
    const name = MONTHS[Number(parts[1]) - 1];
    return name.charAt(0).toUpperCase() + name.slice(1) + ' de ' + parts[0];
  }

  // Tira acentos e maiúsculas para a pesquisa não ser exigente.
  function normalize(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function parseTags(raw) {
    return String(raw || '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 10);
  }

  function url(blob) {
    const u = URL.createObjectURL(blob);
    objectUrls.push(u);
    return u;
  }

  function releaseUrls() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    const u = URL.createObjectURL(blob);
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }

  function stamp() {
    return todayISO().replace(/-/g, '');
  }

  // ---------------- Navegação ----------------

  function showView(name) {
    currentView = name;
    ['list', 'detail', 'form', 'settings'].forEach((v) => {
      $('#view-' + v).classList.toggle('hidden', v !== name);
    });
    $('#fab').classList.toggle('hidden', name !== 'list');
    $('#btn-back').classList.toggle('hidden', name === 'list');
    $('#btn-settings').classList.toggle('hidden', name !== 'list');

    const titles = { list: 'Momentos', detail: 'Momento', form: 'Momento', settings: 'Definições' };
    $('#topbar-title').textContent = titles[name];
    window.scrollTo(0, 0);
  }

  function goBack() {
    if (currentView === 'form' && editingId != null) openDetail(editingId);
    else showView('list');
  }

  // ---------------- Carregar e desenhar a lista ----------------

  async function loadAll() {
    events = await DB.getAllEvents();
    events.sort((a, b) => sortKey(b).localeCompare(sortKey(a))); // mais recente primeiro
    thumbIndex = await DB.getThumbIndex();
    renderFilters();
    renderList();
  }

  function filteredEvents() {
    const q = normalize(filters.q);
    return events.filter((ev) => {
      if (filters.month && ev.yearMonth !== filters.month) return false;
      if (filters.tag && (ev.tags || []).indexOf(filters.tag) === -1) return false;
      if (q) {
        const haystack = normalize(ev.title + ' ' + (ev.note || '') + ' ' + (ev.tags || []).join(' '));
        if (haystack.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderFilters() {
    // Meses disponíveis, do mais recente para o mais antigo
    const months = [];
    events.forEach((ev) => { if (months.indexOf(ev.yearMonth) === -1) months.push(ev.yearMonth); });
    months.sort().reverse();

    const sel = $('#month-filter');
    sel.innerHTML = '<option value="">Todos os meses</option>';
    months.forEach((m) => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = monthLabel(m);
      sel.appendChild(o);
    });
    sel.value = months.indexOf(filters.month) === -1 ? '' : filters.month;
    if (sel.value === '') filters.month = '';

    // Etiquetas existentes
    const tags = [];
    events.forEach((ev) => (ev.tags || []).forEach((t) => {
      if (tags.indexOf(t) === -1) tags.push(t);
    }));
    tags.sort((a, b) => a.localeCompare(b, 'pt'));

    const box = $('#tag-filter');
    box.innerHTML = '';
    tags.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'chip' + (filters.tag === t ? ' active' : '');
      b.textContent = t;
      b.addEventListener('click', () => {
        filters.tag = (filters.tag === t) ? '' : t;
        renderFilters();
        renderList();
      });
      box.appendChild(b);
    });

    const list = $('#tag-suggestions');
    list.innerHTML = '';
    tags.forEach((t) => {
      const o = document.createElement('option');
      o.value = t;
      list.appendChild(o);
    });

    const active = filters.q || filters.month || filters.tag;
    $('#clear-filters').classList.toggle('hidden', !active);
  }

  function renderList() {
    releaseUrls();
    const list = filteredEvents();
    const timeline = $('#timeline');
    timeline.innerHTML = '';

    const total = events.length;
    const shown = list.length;
    $('#count').textContent = total === 0 ? ''
      : (shown === total ? total + (total === 1 ? ' momento' : ' momentos')
                         : shown + ' de ' + total + ' momentos');

    const emptyBox = $('#empty');
    if (shown === 0) {
      emptyBox.classList.remove('hidden');
      $('#empty-text').textContent = total === 0
        ? 'Ainda não há momentos registados.'
        : 'Nenhum momento corresponde a esta pesquisa.';
      $('#empty-action').classList.toggle('hidden', total !== 0);
      return;
    }
    emptyBox.classList.add('hidden');

    // Agrupar por mês, mantendo a ordem (já vem ordenado)
    let currentMonth = null;
    let ol = null;

    list.forEach((ev) => {
      if (ev.yearMonth !== currentMonth) {
        currentMonth = ev.yearMonth;
        const group = document.createElement('section');
        group.className = 'month-group';

        const head = document.createElement('h2');
        head.className = 'month-head';
        const parts = currentMonth.split('-');
        head.innerHTML =
          '<span class="month-name"></span><span class="month-year"></span><span class="month-count"></span>';
        head.querySelector('.month-name').textContent = MONTHS[Number(parts[1]) - 1];
        head.querySelector('.month-year').textContent = parts[0];
        head.querySelector('.month-count').textContent =
          list.filter((x) => x.yearMonth === currentMonth).length + '';
        group.appendChild(head);

        ol = document.createElement('ol');
        ol.className = 'entries';
        group.appendChild(ol);
        timeline.appendChild(group);
      }
      ol.appendChild(entryNode(ev));
    });
  }

  function entryNode(ev) {
    const d = parseISO(ev.date);
    const li = document.createElement('li');
    li.className = 'entry';
    li.tabIndex = 0;

    const dateBox = document.createElement('div');
    dateBox.className = 'entry-date';
    dateBox.innerHTML = '<span class="entry-day"></span><span class="entry-dow"></span>';
    dateBox.querySelector('.entry-day').textContent = d.getDate();
    dateBox.querySelector('.entry-dow').textContent = WEEKDAYS[d.getDay()];
    li.appendChild(dateBox);

    const body = document.createElement('div');
    body.className = 'entry-body';
    const h3 = document.createElement('h3');
    h3.className = 'entry-title';
    h3.textContent = ev.title;
    body.appendChild(h3);

    if (ev.note) {
      const p = document.createElement('p');
      p.className = 'entry-note';
      p.textContent = ev.note;
      body.appendChild(p);
    }
    if ((ev.tags || []).length) {
      const meta = document.createElement('div');
      meta.className = 'entry-meta';
      ev.tags.forEach((t) => {
        const c = document.createElement('span');
        c.className = 'chip static';
        c.textContent = t;
        meta.appendChild(c);
      });
      body.appendChild(meta);
    }
    li.appendChild(body);

    const info = thumbIndex.get(ev.id);
    if (info) {
      const box = document.createElement('div');
      box.className = 'entry-thumb';
      const img = document.createElement('img');
      img.src = url(info.thumb);
      img.alt = '';
      img.loading = 'lazy';
      box.appendChild(img);
      if (info.count > 1) {
        const more = document.createElement('span');
        more.className = 'more';
        more.textContent = '+' + (info.count - 1);
        box.appendChild(more);
      }
      li.appendChild(box);
    }

    li.addEventListener('click', () => openDetail(ev.id));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(ev.id); }
    });
    return li;
  }

  // ---------------- Detalhe ----------------

  async function openDetail(id) {
    const ev = await DB.getEvent(id);
    if (!ev) { toast('Esse momento já não existe.'); return loadAll(); }
    currentId = ev.id;

    const photos = await DB.getPhotos(ev.id);
    const box = $('#detail-body');
    box.innerHTML = '';

    const date = document.createElement('p');
    date.className = 'detail-date';
    date.textContent = formatLongDate(ev);
    box.appendChild(date);

    const title = document.createElement('h2');
    title.className = 'detail-title';
    title.textContent = ev.title;
    box.appendChild(title);

    if ((ev.tags || []).length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      ev.tags.forEach((t) => {
        const c = document.createElement('span');
        c.className = 'chip static';
        c.textContent = t;
        chips.appendChild(c);
      });
      box.appendChild(chips);
    }

    if (photos.length) {
      const grid = document.createElement('div');
      grid.className = 'photo-grid';
      photos.forEach((p) => {
        const cell = document.createElement('div');
        cell.className = 'photo-cell';
        const img = document.createElement('img');
        img.src = url(p.thumb);
        img.alt = 'Foto de ' + ev.title;
        img.addEventListener('click', () => openLightbox(p.blob));
        cell.appendChild(img);
        grid.appendChild(cell);
      });
      box.appendChild(grid);
    }

    if (ev.note) {
      const note = document.createElement('p');
      note.className = 'detail-note';
      note.textContent = ev.note;
      box.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'detail-actions';

    const edit = document.createElement('button');
    edit.className = 'btn primary';
    edit.textContent = 'Editar';
    edit.addEventListener('click', () => openForm(ev.id));

    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = 'Apagar';
    del.addEventListener('click', async () => {
      if (!confirm('Apagar "' + ev.title + '" e as respetivas fotos?')) return;
      await DB.deleteEvent(ev.id);
      toast('Momento apagado.');
      showView('list');
      await loadAll();
    });

    actions.appendChild(edit);
    actions.appendChild(del);
    box.appendChild(actions);

    showView('detail');
  }

  function openLightbox(blob) {
    const img = $('#lightbox-img');
    img.src = url(blob);
    $('#lightbox').classList.remove('hidden');
  }

  // ---------------- Formulário ----------------

  async function openForm(id) {
    editingId = (id == null) ? null : id;
    formPhotos = [];
    removedPhotoIds = [];

    if (editingId == null) {
      $('#f-title').value = '';
      $('#f-date').value = todayISO();
      $('#f-time').value = '';
      $('#f-note').value = '';
      $('#f-tags').value = '';
    } else {
      const ev = await DB.getEvent(editingId);
      $('#f-title').value = ev.title;
      $('#f-date').value = ev.date;
      $('#f-time').value = ev.time || '';
      $('#f-note').value = ev.note || '';
      $('#f-tags').value = (ev.tags || []).join(', ');
      const photos = await DB.getPhotos(editingId);
      formPhotos = photos.map((p) => ({
        id: p.id, blob: p.blob, thumb: p.thumb, width: p.width, height: p.height
      }));
    }

    renderPhotoPreview();
    showView('form');
    $('#f-title').focus();
  }

  function renderPhotoPreview() {
    const grid = $('#photo-preview');
    grid.innerHTML = '';
    formPhotos.forEach((p, i) => {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      const img = document.createElement('img');
      img.src = url(p.thumb);
      img.alt = 'Foto ' + (i + 1);
      cell.appendChild(img);

      const rm = document.createElement('button');
      rm.className = 'photo-remove';
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remover foto ' + (i + 1));
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        if (p.id != null) removedPhotoIds.push(p.id);
        formPhotos.splice(i, 1);
        renderPhotoPreview();
      });
      cell.appendChild(rm);
      grid.appendChild(cell);
    });

    const left = MAX_PHOTOS - formPhotos.length;
    $('#photo-status').textContent = left > 0
      ? 'Podes adicionar mais ' + left + (left === 1 ? ' foto.' : ' fotos.')
      : 'Chegaste ao limite de ' + MAX_PHOTOS + ' fotos.';
    $('#btn-camera').disabled = left <= 0;
    $('#btn-gallery').disabled = left <= 0;
  }

  async function handleFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    const room = MAX_PHOTOS - formPhotos.length;
    const accepted = files.slice(0, room);
    if (files.length > room) toast('Só cabem mais ' + room + '. As restantes foram ignoradas.');

    $('#photo-status').textContent = 'A comprimir…';
    for (let i = 0; i < accepted.length; i++) {
      try {
        const result = await Images.compress(accepted[i]);
        formPhotos.push(result);
      } catch (err) {
        toast(err.message || 'Não foi possível processar a imagem.');
      }
    }
    renderPhotoPreview();
  }

  async function saveForm() {
    const title = $('#f-title').value.trim();
    const date = $('#f-date').value;

    if (!title) { toast('Escreve um título.'); $('#f-title').focus(); return; }
    if (!date) { toast('Escolhe uma data.'); $('#f-date').focus(); return; }

    $('#btn-save').disabled = true;
    try {
      const now = new Date().toISOString();
      const base = editingId == null ? {} : await DB.getEvent(editingId);

      const ev = {
        id: editingId == null ? undefined : editingId,
        title: title,
        date: date,
        time: $('#f-time').value || '',
        note: $('#f-note').value.trim(),
        tags: parseTags($('#f-tags').value),
        yearMonth: date.slice(0, 7),
        createdAt: base.createdAt || now,
        updatedAt: now
      };

      const savedId = await DB.saveEvent(ev);

      for (let i = 0; i < removedPhotoIds.length; i++) {
        await DB.deletePhoto(removedPhotoIds[i]);
      }
      for (let i = 0; i < formPhotos.length; i++) {
        const p = formPhotos[i];
        if (p.id != null) continue; // já estava gravada
        await DB.addPhoto({
          eventId: savedId, blob: p.blob, thumb: p.thumb,
          width: p.width, height: p.height
        });
      }

      toast(editingId == null ? 'Momento guardado.' : 'Alterações guardadas.');
      editingId = null;
      await loadAll();
      showView('list');
    } catch (err) {
      console.error(err);
      toast('Não foi possível guardar: ' + (err.message || 'erro desconhecido'));
    } finally {
      $('#btn-save').disabled = false;
    }
  }

  // ---------------- Exportar / importar ----------------

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataUrl) {
    return fetch(dataUrl).then((r) => r.blob()); // conversão local, não usa rede
  }

  async function buildExport(withPhotos) {
    const all = await DB.getAllEvents();
    all.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const photos = withPhotos ? await DB.getAllPhotos() : [];

    const byEvent = new Map();
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (!byEvent.has(p.eventId)) byEvent.set(p.eventId, []);
      byEvent.get(p.eventId).push(p);
    }

    const out = [];
    for (let i = 0; i < all.length; i++) {
      const ev = all[i];
      const record = {
        title: ev.title, date: ev.date, time: ev.time || '',
        note: ev.note || '', tags: ev.tags || [],
        createdAt: ev.createdAt, updatedAt: ev.updatedAt
      };
      if (withPhotos) {
        const list = byEvent.get(ev.id) || [];
        record.photos = [];
        for (let j = 0; j < list.length; j++) {
          record.photos.push({
            width: list[j].width,
            height: list[j].height,
            full: await blobToDataURL(list[j].blob),
            thumb: await blobToDataURL(list[j].thumb)
          });
        }
      }
      out.push(record);
    }

    return {
      app: 'momentos',
      schema: 1,
      exportedAt: new Date().toISOString(),
      includesPhotos: withPhotos,
      events: out
    };
  }

  async function exportJson(withPhotos) {
    toast('A preparar o ficheiro…');
    try {
      const data = await buildExport(withPhotos);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const name = 'momentos-' + stamp() + (withPhotos ? '-completo' : '-textos') + '.json';
      downloadBlob(blob, name);
      if (withPhotos) markBackupDone();
      toast('Ficheiro gerado (' + Images.formatBytes(blob.size) + ').');
    } catch (err) {
      console.error(err);
      toast('A exportação falhou: ' + (err.message || 'erro desconhecido'));
    }
  }

  async function exportCsv() {
    const all = await DB.getAllEvents();
    all.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const thumbs = await DB.getThumbIndex();

    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = ['Data;Hora;Título;Etiquetas;Nota;Fotos'];
    all.forEach((ev) => {
      const info = thumbs.get(ev.id);
      lines.push([
        esc(ev.date), esc(ev.time || ''), esc(ev.title),
        esc((ev.tags || []).join(', ')), esc(ev.note || ''),
        esc(info ? info.count : 0)
      ].join(';'));
    });

    // O BOM faz o Excel português abrir os acentos corretamente.
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'momentos-' + stamp() + '.csv');
    toast('CSV gerado.');
  }

  async function importJson(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      toast('Esse ficheiro não é um JSON válido.');
      return;
    }
    if (!data || !Array.isArray(data.events)) {
      toast('Não encontrei momentos dentro do ficheiro.');
      return;
    }
    if (!confirm('Importar ' + data.events.length + ' momentos? Vão juntar-se aos que já tens.')) return;

    let ok = 0;
    for (let i = 0; i < data.events.length; i++) {
      const raw = data.events[i];
      if (!raw || !raw.title || !raw.date) continue;
      try {
        const id = await DB.saveEvent({
          title: String(raw.title),
          date: String(raw.date),
          time: raw.time || '',
          note: raw.note || '',
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          yearMonth: String(raw.date).slice(0, 7),
          createdAt: raw.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        const photos = Array.isArray(raw.photos) ? raw.photos : [];
        for (let j = 0; j < photos.length; j++) {
          if (!photos[j].full) continue;
          const full = await dataURLToBlob(photos[j].full);
          const thumb = photos[j].thumb ? await dataURLToBlob(photos[j].thumb) : full;
          await DB.addPhoto({
            eventId: id, blob: full, thumb: thumb,
            width: photos[j].width || 0, height: photos[j].height || 0
          });
        }
        ok++;
      } catch (err) {
        console.error('Falhou a importar um momento', err);
      }
    }
    await loadAll();
    toast(ok + ' momentos importados.');
  }

  async function renderStats() {
    const all = await DB.getAllEvents();
    const photos = await DB.getAllPhotos();
    let bytes = 0;
    photos.forEach((p) => { bytes += (p.blob ? p.blob.size : 0) + (p.thumb ? p.thumb.size : 0); });

    let line = all.length + (all.length === 1 ? ' momento' : ' momentos') + ' · ' +
               photos.length + (photos.length === 1 ? ' foto' : ' fotos') + ' · ' +
               Images.formatBytes(bytes) + ' em imagens.';

    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (est.usage) line += ' Espaço total usado pela app: ' + Images.formatBytes(est.usage) + '.';
      } catch (e) { /* estimativa indisponível, ignora */ }
    }
    $('#stats').textContent = line;

    const last = localStorage.getItem(LS.lastBackupAt);
    $('#last-backup').textContent = last
      ? 'Última exportação completa: ' + new Date(last).toLocaleDateString('pt-PT') + '.'
      : 'Ainda não fizeste nenhuma exportação completa.';
  }

  // ---------------- Lembrete de cópia de segurança ----------------

  function getInterval() {
    const v = parseInt(localStorage.getItem(LS.intervalDays), 10);
    return isNaN(v) ? 14 : v;
  }

  function daysBetween(a, b) {
    return Math.floor((b - a) / (1000 * 60 * 60 * 24));
  }

  function markBackupDone() {
    localStorage.setItem(LS.lastBackupAt, new Date().toISOString());
    localStorage.removeItem(LS.snoozeUntil);
    $('#backup-banner').classList.add('hidden');
  }

  function checkBackupReminder() {
    const banner = $('#backup-banner');
    const interval = getInterval();
    if (interval <= 0 || events.length === 0) { banner.classList.add('hidden'); return; }

    const snooze = localStorage.getItem(LS.snoozeUntil);
    if (snooze && new Date(snooze) > new Date()) { banner.classList.add('hidden'); return; }

    if (!localStorage.getItem(LS.firstRunAt)) {
      localStorage.setItem(LS.firstRunAt, new Date().toISOString());
    }
    const reference = localStorage.getItem(LS.lastBackupAt) || localStorage.getItem(LS.firstRunAt);
    const days = daysBetween(new Date(reference), new Date());
    if (days < interval) { banner.classList.add('hidden'); return; }

    $('#backup-banner-text').textContent = localStorage.getItem(LS.lastBackupAt)
      ? 'Já passaram ' + days + ' dias desde a última cópia de segurança.'
      : 'Ainda não guardaste nenhuma cópia de segurança dos teus momentos.';
    banner.classList.remove('hidden');
  }

  // ---------------- Ligações de eventos ----------------

  function bind() {
    $('#fab').addEventListener('click', () => openForm(null));
    $('#empty-action').addEventListener('click', () => openForm(null));
    $('#btn-back').addEventListener('click', goBack);
    $('#btn-settings').addEventListener('click', () => {
      $('#f-interval').value = getInterval();
      renderStats();
      showView('settings');
    });

    let searchTimer = null;
    $('#search').addEventListener('input', (e) => {
      filters.q = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { renderFilters(); renderList(); }, 150);
    });

    $('#month-filter').addEventListener('change', (e) => {
      filters.month = e.target.value;
      renderFilters();
      renderList();
    });

    $('#clear-filters').addEventListener('click', () => {
      filters = { q: '', month: '', tag: '' };
      $('#search').value = '';
      renderFilters();
      renderList();
    });

    $('#btn-camera').addEventListener('click', () => $('#input-camera').click());
    $('#btn-gallery').addEventListener('click', () => $('#input-gallery').click());
    $('#input-camera').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
    $('#input-gallery').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

    $('#btn-save').addEventListener('click', saveForm);
    $('#btn-cancel').addEventListener('click', goBack);

    $('#lightbox').addEventListener('click', () => $('#lightbox').classList.add('hidden'));

    $('#export-full').addEventListener('click', () => exportJson(true));
    $('#export-light').addEventListener('click', () => exportJson(false));
    $('#export-csv').addEventListener('click', exportCsv);

    $('#btn-import').addEventListener('click', () => $('#input-import').click());
    $('#input-import').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) { await importJson(f); renderStats(); }
    });

    $('#f-interval').addEventListener('change', (e) => {
      const v = Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0));
      e.target.value = v;
      localStorage.setItem(LS.intervalDays, String(v));
      checkBackupReminder();
      toast(v === 0 ? 'Aviso desligado.' : 'Aviso a cada ' + v + ' dias.');
    });

    $('#btn-wipe').addEventListener('click', async () => {
      if (!confirm('Isto apaga TODOS os momentos e fotos deste dispositivo. Continuar?')) return;
      if (!confirm('Tens a certeza? Não há como voltar atrás sem uma exportação.')) return;
      await DB.clearAll();
      localStorage.removeItem(LS.lastBackupAt);
      await loadAll();
      renderStats();
      toast('Tudo apagado.');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#lightbox').classList.contains('hidden')) $('#lightbox').classList.add('hidden');
      else if (currentView !== 'list') goBack();
    });

    $('#backup-now').addEventListener('click', () => exportJson(true));
    $('#backup-snooze').addEventListener('click', () => {
      const until = new Date();
      until.setDate(until.getDate() + 3);
      localStorage.setItem(LS.snoozeUntil, until.toISOString());
      $('#backup-banner').classList.add('hidden');
    });
  }

  // ---------------- Arranque ----------------

  async function init() {
    $('#app-version').textContent = APP_VERSION;
    bind();
    try {
      await loadAll();
      checkBackupReminder();
    } catch (err) {
      console.error(err);
      toast('Não foi possível abrir a base de dados.');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registado', e));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
