/**
 * A lightweight, in-house device fingerprint for the fraud-prevention
 * blocklist the backend already enforces (trustsafety.BlockedFingerprint,
 * checked via the X-Device-Fingerprint header on register/Google sign-up).
 *
 * Deliberately not a third-party fingerprinting SDK — this platform doesn't
 * need cross-site tracking, just a reasonably stable per-device identifier
 * so an admin can block a specific abusive device. It combines stable,
 * low-entropy browser signals (not IP, not anything server-side headers
 * already capture) and hashes them with SHA-256 via the Web Crypto API.
 *
 * Best-effort: if any signal is unavailable (older browser, privacy mode
 * restricting canvas, etc.) it's simply omitted from the input rather than
 * failing the whole computation.
 */

let cached: Promise<string> | null = null;

function canvasSignal(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 100, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('homekonet-fp', 2, 2);
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

function collectSignals(): string {
  const nav = window.navigator;
  const scr = window.screen;
  const parts = [
    nav.userAgent || '',
    nav.language || '',
    String(nav.hardwareConcurrency ?? ''),
    String((nav as any).deviceMemory ?? ''),
    `${scr.width}x${scr.height}x${scr.colorDepth}`,
    String(Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
    String(new Date().getTimezoneOffset()),
    canvasSignal(),
  ];
  return parts.join('||');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Returns a stable hex fingerprint for this browser, computed once and cached in memory for the page's lifetime. */
export function getDeviceFingerprint(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      try {
        if (!window.crypto?.subtle) return '';
        return await sha256Hex(collectSignals());
      } catch {
        return '';
      }
    })();
  }
  return cached;
}
