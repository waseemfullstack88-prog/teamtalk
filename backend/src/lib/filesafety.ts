import net from 'node:net';
import path from 'node:path';
import { env } from '../config/env.js';

/** Make an uploaded file name safe to display and to put in a Content-Disposition header. */
export function safeFilename(name: string): string {
  const base = path.basename(name.normalize('NFKC').replace(/\\/g, '/'));
  let out = base
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_') // control + reserved characters
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '') // bidi override tricks (evil\u202Egnp.exe)
    .replace(/^\.+/, '') // no hidden/relative names
    .trim()
    .slice(0, 120);
  if (!out) out = 'file';
  return out;
}

const DANGEROUS_EXT = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'jar', 'sh', 'dll', 'apk', 'html', 'htm', 'svg', 'hta', 'lnk', 'reg',
]);
export const isDangerousExtension = (name: string) => DANGEROUS_EXT.has(name.split('.').pop()?.toLowerCase() ?? '');

/** Minimal magic-byte sniffing so the declared MIME type cannot be trivially spoofed. */
export function sniffMime(buf: Buffer): string | null {
  const s = (o: number, str: string) => buf.subarray(o, o + str.length).toString('latin1') === str;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (s(1, 'PNG\r\n')) return 'image/png';
  if (s(0, 'GIF8')) return 'image/gif';
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'image/webp';
  if (s(0, '%PDF-')) return 'application/pdf';
  if (s(0, 'PK\u0003\u0004')) return 'application/zip'; // also docx/xlsx/pptx
  if (s(4, 'ftyp')) return 'video/mp4';
  if (s(0, 'OggS')) return 'audio/ogg';
  if (s(0, 'ID3') || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (s(0, 'RIFF') && s(8, 'WAVE')) return 'audio/wav';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (s(0, '\xd0\xcf\x11\xe0')) return 'application/msword'; // legacy OLE (doc/xls)
  return null;
}

/** Does a declared MIME type agree with what the bytes say? Unknown signatures (text, etc.) pass only for text types. */
export function mimeConsistent(declared: string, buf: Buffer): boolean {
  const sniffed = sniffMime(buf);
  if (!sniffed) return declared.startsWith('text/') || declared.startsWith('audio/') || declared.startsWith('video/');
  const family = (m: string) => m.split('/')[0];
  if (sniffed === 'application/zip') return declared === 'application/zip' || declared.includes('officedocument');
  if (sniffed === 'application/msword') return declared.includes('ms') || declared.includes('word') || declared.includes('excel');
  if (sniffed === 'video/mp4') return declared.startsWith('video/') || declared.startsWith('audio/');
  if (sniffed === 'video/webm') return declared === 'video/webm' || declared === 'audio/webm';
  return family(sniffed) === family(declared) && (sniffed === declared || declared.startsWith('audio/'));
}

export type ScanResult = 'CLEAN' | 'INFECTED' | 'SKIPPED';

/**
 * Virus-scanning integration hook. When CLAMAV_HOST is set the file is streamed to clamd using the
 * INSTREAM protocol. Without a scanner configured files are marked SKIPPED (shown in the admin UI).
 * Plug other engines in by replacing this function.
 */
export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  if (!env.CLAMAV_HOST) return 'SKIPPED';
  return new Promise((resolve, reject) => {
    const sock = net.connect(env.CLAMAV_PORT, env.CLAMAV_HOST);
    let out = '';
    sock.setTimeout(30_000, () => sock.destroy(new Error('clamd timeout')));
    sock.on('error', reject);
    sock.on('data', (d) => (out += d.toString()));
    sock.on('end', () => resolve(/FOUND/.test(out) ? 'INFECTED' : /OK/.test(out) ? 'CLEAN' : 'SKIPPED'));
    sock.write('zINSTREAM\0');
    for (let i = 0; i < buf.length; i += 64 * 1024) {
      const chunk = buf.subarray(i, i + 64 * 1024);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(chunk.length);
      sock.write(len);
      sock.write(chunk);
    }
    sock.end(Buffer.alloc(4));
  });
}
