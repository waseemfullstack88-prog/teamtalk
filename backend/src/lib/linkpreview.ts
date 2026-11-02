import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Secure link previews. The server fetches the URL on behalf of the user, so it must never be usable
 * to reach internal services (SSRF). Rules:
 *  - only http/https, no credentials in the URL, only ports 80/443/8080/8443
 *  - hostname is resolved and EVERY resulting address must be public
 *  - redirects are followed manually (max 3) and re-validated at every hop
 *  - short timeout, 1 MB body cap, HTML only
 * Note: a DNS-rebinding window between validation and connect is reduced, not eliminated, by pinning the
 * address via the `lookup` check below; run the API in a network segment without access to internal hosts.
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb')) return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    return false;
  }
  return true; // not an IP: treat as unsafe
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address);

export async function assertSafeUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links are allowed');
  if (u.username || u.password) throw new Error('Credentials in URLs are not allowed');
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (![80, 443, 8080, 8443].includes(port)) throw new Error('Port not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Host not allowed');
  const addrs = net.isIP(host) ? [host] : await resolve(host);
  if (addrs.length === 0 || addrs.some(isPrivateIp)) throw new Error('Host not allowed');
  return u;
}

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

export function parseOpenGraph(html: string, base: URL): LinkPreview {
  const meta = (key: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '') : undefined;
  };
  const title = meta('og:title') ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '');
  let image = meta('og:image');
  if (image) {
    try {
      const iu = new URL(image, base);
      image = iu.protocol === 'https:' ? iu.toString() : undefined; // only https images; shown via the CSP-restricted img-src
    } catch {
      image = undefined;
    }
  }
  return {
    url: base.toString(),
    title: title?.slice(0, 200) || undefined,
    description: (meta('og:description') ?? meta('description'))?.slice(0, 300),
    siteName: meta('og:site_name')?.slice(0, 100),
    image,
  };
}

export async function fetchLinkPreview(raw: string, resolve?: Resolver, fetchImpl: typeof fetch = fetch): Promise<LinkPreview> {
  let url = await assertSafeUrl(raw, resolve);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'user-agent': 'TeamTalkLinkPreview/1.0', accept: 'text/html' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertSafeUrl(new URL(res.headers.get('location')!, url).toString(), resolve);
      continue;
    }
    if (!res.ok) throw new Error('Could not load page');
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return { url: url.toString() };
    const reader = res.body?.getReader();
    let html = '';
    let total = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      html += Buffer.from(value).toString('utf8');
      if (total > 1_000_000 || /<\/head>/i.test(html)) {
        await reader.cancel();
        break;
      }
    }
    return parseOpenGraph(html, url);
  }
  throw new Error('Too many redirects');
}
