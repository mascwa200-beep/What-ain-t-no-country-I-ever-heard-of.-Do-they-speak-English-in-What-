/* =========================================================================
   PIXEL DEITY — codec.js
   Compact save encoding: RLE + byte-quantization + base64, so an entire
   multiverse of planets fits comfortably in localStorage.
   ========================================================================= */
(function (global) {
  'use strict';

  function bytesToStr(u8) {
    let s = ''; const CH = 8192;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return s;
  }
  function strToBytes(str) {
    const u8 = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i);
    return u8;
  }

  // Run-length encode a Uint8Array as (count,value) pairs; counts cap at 255.
  function rle(u8) {
    const out = [];
    let i = 0;
    while (i < u8.length) {
      const v = u8[i]; let n = 1;
      while (i + n < u8.length && u8[i + n] === v && n < 255) n++;
      out.push(n, v); i += n;
    }
    return new Uint8Array(out);
  }
  function unrle(u8, outLen) {
    const out = new Uint8Array(outLen);
    let o = 0;
    for (let i = 0; i + 1 < u8.length; i += 2) {
      const n = u8[i], v = u8[i + 1];
      out.fill(v, o, o + n); o += n;
    }
    return out;
  }

  // Public: Uint8Array (or any typed array's bytes) -> b64(RLE)
  function packU8(u8) { return btoa(bytesToStr(rle(u8))); }
  function unpackU8(s, outLen) { return unrle(strToBytes(atob(s)), outLen); }

  // Float32Array in [0,1] -> quantized Uint8 (1/255 precision is invisible
  // in-game) -> RLE -> b64. ~8-30x smaller than raw f32 for terrain fields.
  function packF01(f32) {
    const q = new Uint8Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      let v = f32[i];
      if (!(v >= 0)) v = 0; else if (v > 1) v = 1; // also scrubs NaN
      q[i] = (v * 255 + 0.5) | 0;
    }
    return packU8(q);
  }
  function unpackF01(s, outLen) {
    const q = unpackU8(s, outLen);
    const f = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) f[i] = q[i] / 255;
    return f;
  }

  // Int16Array -> bytes (LE) -> RLE -> b64 (owner maps are very runny)
  function packI16(i16) { return packU8(new Uint8Array(i16.buffer.slice(0))); }
  function unpackI16(s, count) {
    const u8 = unpackU8(s, count * 2);
    return new Int16Array(u8.buffer);
  }

  global.PD = global.PD || {};
  global.PD.Codec = { packU8, unpackU8, packF01, unpackF01, packI16, unpackI16 };
})(window);
