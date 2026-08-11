/* ============================================================
   db.js — acesso ao IndexedDB
   Duas stores: 'events' (texto, leve) e 'photos' (imagens, pesado).
   Estão separadas de propósito: a linha do tempo lê só os eventos,
   as imagens grandes só são lidas quando abres um momento.
   ============================================================ */

(function () {
  const DB_NAME = 'momentos-db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('events')) {
          const s = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by-date', 'date');
          s.createIndex('by-yearMonth', 'yearMonth');
        }
        if (!db.objectStoreNames.contains('photos')) {
          const p = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
          p.createIndex('by-eventId', 'eventId');
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function asPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---------- Eventos ----------

  async function saveEvent(event) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      const record = Object.assign({}, event);
      if (record.id == null) delete record.id; // deixa o autoIncrement gerar
      const req = store.put(record);
      req.onsuccess = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getEvent(id) {
    const db = await open();
    return asPromise(db.transaction('events').objectStore('events').get(Number(id)));
  }

  async function getAllEvents() {
    const db = await open();
    return asPromise(db.transaction('events').objectStore('events').getAll());
  }

  async function deleteEvent(id) {
    const photos = await getPhotos(id);
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['events', 'photos'], 'readwrite');
      tx.objectStore('events').delete(Number(id));
      const ps = tx.objectStore('photos');
      photos.forEach((p) => ps.delete(p.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- Fotos ----------

  async function addPhoto(photo) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      const record = Object.assign({}, photo);
      if (record.id == null) delete record.id;
      const req = tx.objectStore('photos').put(record);
      req.onsuccess = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getPhotos(eventId) {
    const db = await open();
    const idx = db.transaction('photos').objectStore('photos').index('by-eventId');
    return asPromise(idx.getAll(Number(eventId)));
  }

  async function getAllPhotos() {
    const db = await open();
    return asPromise(db.transaction('photos').objectStore('photos').getAll());
  }

  async function deletePhoto(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(Number(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* Devolve um Map eventId -> { thumb, count } com apenas a primeira
     miniatura de cada evento. Percorre as fotos uma única vez, sem
     carregar os blobs grandes para a lista. */
  async function getThumbIndex() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const map = new Map();
      const req = db.transaction('photos').objectStore('photos').openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(map);
        const v = cursor.value;
        const entry = map.get(v.eventId);
        if (entry) {
          entry.count += 1;
        } else {
          map.set(v.eventId, { thumb: v.thumb, count: 1 });
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function clearAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['events', 'photos'], 'readwrite');
      tx.objectStore('events').clear();
      tx.objectStore('photos').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  window.DB = {
    saveEvent, getEvent, getAllEvents, deleteEvent,
    addPhoto, getPhotos, getAllPhotos, deletePhoto,
    getThumbIndex, clearAll
  };
})();
