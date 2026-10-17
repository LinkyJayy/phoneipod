// Minimal ID3v2 (2.2 / 2.3 / 2.4) reader for title, artist, album, track number and cover art.
const ID3 = (() => {
  const synchsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
  const uint32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

  function decode(enc, bytes) {
    let label = 'latin1';
    if (enc === 3) label = 'utf-8';
    else if (enc === 1 || enc === 2) {
      label = enc === 2 ? 'utf-16be' : 'utf-16le';
      if (bytes[0] === 0xfe && bytes[1] === 0xff) { label = 'utf-16be'; bytes = bytes.subarray(2); }
      else if (bytes[0] === 0xff && bytes[1] === 0xfe) { label = 'utf-16le'; bytes = bytes.subarray(2); }
    }
    try {
      return new TextDecoder(label).decode(bytes).split('\0')[0].trim();
    } catch {
      return '';
    }
  }

  function picture(data, v22) {
    const enc = data[0];
    let i = 1;
    let mime = 'image/jpeg';
    if (v22) {
      if (String.fromCharCode(data[1], data[2], data[3]).toLowerCase() === 'png') mime = 'image/png';
      i = 4;
    } else {
      let j = i;
      while (j < data.length && data[j] !== 0) j++;
      const m = decode(0, data.subarray(i, j)).toLowerCase();
      if (m) mime = m.includes('/') ? m : 'image/' + m;
      i = j + 1;
    }
    i++; // picture type
    if (enc === 1 || enc === 2) {
      while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2;
      i += 2;
    } else {
      while (i < data.length && data[i] !== 0) i++;
      i++;
    }
    return i < data.length ? new Blob([data.slice(i)], { type: mime }) : null;
  }

  async function parse(file) {
    const out = {};
    try {
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return out; // "ID3"
      const ver = head[3];
      const size = synchsafe(head, 6);
      const b = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
      const idLen = ver === 2 ? 3 : 4;
      const hdrLen = ver === 2 ? 6 : 10;
      let off = 0;
      if (ver > 2 && head[5] & 0x40) off = ver === 4 ? synchsafe(b, 0) : uint32(b, 0) + 4;

      while (off + hdrLen < b.length) {
        const id = String.fromCharCode(...b.subarray(off, off + idLen));
        if (!/^[A-Z0-9]+$/.test(id)) break;
        const len = ver === 2 ? (b[off + 3] << 16) | (b[off + 4] << 8) | b[off + 5]
          : ver === 4 ? synchsafe(b, off + 4) : uint32(b, off + 4);
        const data = b.subarray(off + hdrLen, off + hdrLen + len);
        off += hdrLen + len;
        if (!len) continue;
        const text = () => decode(data[0], data.subarray(1));
        switch (id) {
          case 'TIT2': case 'TT2': out.title = text(); break;
          case 'TPE1': case 'TP1': out.artist = text(); break;
          case 'TALB': case 'TAL': out.album = text(); break;
          case 'TRCK': case 'TRK': out.track = parseInt(text(), 10) || undefined; break;
          case 'APIC': case 'PIC': if (!out.art) out.art = picture(data, ver === 2); break;
        }
      }
    } catch (e) {
      console.warn('ID3 parse failed', e);
    }
    return out;
  }

  return { parse };
})();
