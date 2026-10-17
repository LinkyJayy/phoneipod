// Client for the PhoneiPod server. Every call carries the session cookie.
const API = (() => {
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function request(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError("Can't reach the server", 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('api:unauthorized'));
      throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
    }
    return data;
  }

  // XHR so the upload can report progress.
  function upload(form, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/tracks');
      xhr.responseType = 'json';
      xhr.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        const data = xhr.response || {};
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data.track);
        if (xhr.status === 401) window.dispatchEvent(new Event('api:unauthorized'));
        reject(new ApiError(data.error || `Upload failed (${xhr.status})`, xhr.status));
      };
      xhr.onerror = () => reject(new ApiError("Can't reach the server", 0));
      xhr.send(form);
    });
  }

  return {
    ApiError,
    config: () => request('GET', '/api/config'),
    me: () => request('GET', '/api/auth/me').then(d => d.user),
    login: (username, password) => request('POST', '/api/auth/login', { username, password }).then(d => d.user),
    signup: (username, password) => request('POST', '/api/auth/signup', { username, password }).then(d => d.user),
    logout: () => request('POST', '/api/auth/logout'),
    changePassword: (current, next) => request('POST', '/api/auth/password', { current, next }),
    deleteAccount: password => request('DELETE', '/api/auth/account', { password }),
    savePrefs: prefs => request('PUT', '/api/prefs', prefs),
    tracks: () => request('GET', '/api/tracks').then(d => d.tracks),
    upload,
    remove: id => request('DELETE', `/api/tracks/${encodeURIComponent(id)}`),
    audioUrl: id => `/api/tracks/${encodeURIComponent(id)}/audio`,
    artUrl: id => `/api/tracks/${encodeURIComponent(id)}/art`,
  };
})();
