/* archive.js - dependency-free ZIP Store writer for project and book exports. */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {}), Archive = SBM.Archive = {};
  /* ---------- 无第三方依赖的 ZIP（Store 模式；PNG 已压缩，避免二次压缩） ---------- */
  function zipU16(n) { return [n & 255, (n >>> 8) & 255]; }
  function zipU32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crcTable[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function joinBytes(parts) {
    var size = 0; parts.forEach(function (p) { size += p.length; });
    var out = new Uint8Array(size), off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.length; });
    return out;
  }
  function dataUrlBytes(url) {
    var b64 = String(url).split(',')[1] || '', raw = atob(b64), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function makeStoredZip(entries) {
    var enc = new TextEncoder(), local = [], central = [], offset = 0;
    var now = new Date(), dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
    var dosDate = (((Math.max(1980, now.getFullYear()) - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
    entries.forEach(function (entry) {
      var name = enc.encode(entry.name), data = entry.data instanceof Uint8Array ? entry.data : enc.encode(String(entry.data));
      var crc = crc32(data), localHeader = new Uint8Array([].concat(
        zipU32(0x04034b50), zipU16(20), zipU16(0x0800), zipU16(0), zipU16(dosTime), zipU16(dosDate),
        zipU32(crc), zipU32(data.length), zipU32(data.length), zipU16(name.length), zipU16(0)));
      local.push(localHeader, name, data);
      var centralHeader = new Uint8Array([].concat(
        zipU32(0x02014b50), zipU16(20), zipU16(20), zipU16(0x0800), zipU16(0), zipU16(dosTime), zipU16(dosDate),
        zipU32(crc), zipU32(data.length), zipU32(data.length), zipU16(name.length), zipU16(0), zipU16(0), zipU16(0), zipU16(0),
        zipU32(0), zipU32(offset)));
      central.push(centralHeader, name);
      offset += localHeader.length + name.length + data.length;
    });
    var centralBytes = joinBytes(central), localBytes = joinBytes(local);
    var end = new Uint8Array([].concat(zipU32(0x06054b50), zipU16(0), zipU16(0), zipU16(entries.length), zipU16(entries.length),
      zipU32(centralBytes.length), zipU32(localBytes.length), zipU16(0)));
    return new Blob([localBytes, centralBytes, end], { type: 'application/zip' });
  }

  Archive.zip = makeStoredZip;
  Archive.dataUrlBytes = dataUrlBytes;
})(window);
