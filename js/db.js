// Tiny IndexedDB wrapper. Tracks (including their audio Blobs) live in the browser.
const DB = (() => {
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('phoneipod', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('tracks', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tracks', mode);
      const req = fn(tx.objectStore('tracks'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    all: () => run('readonly', s => s.getAll()),
    put: track => run('readwrite', s => s.put(track)),
    remove: id => run('readwrite', s => s.delete(id)),
    clear: () => run('readwrite', s => s.clear()),
  };
})();
