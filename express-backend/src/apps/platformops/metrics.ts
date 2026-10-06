// psutil equivalents (Linux /proc + statfs) for platformops views/tasks.

import { readFileSync, statfsSync } from 'node:fs';

/** Python round(x, 1) (half-even on the decimal repr is close enough for live metrics). */
export const round1 = (x: number) => Math.round(x * 10) / 10;

function cpuTimes(): { busy: number; total: number } {
  const line = readFileSync('/proc/stat', 'utf8').split('\n').find((l) => l.startsWith('cpu '))!;
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0, guest = 0, guestNice = 0] = v;
  const total = user + nice + system + idle + iowait + irq + softirq + steal + guest + guestNice - guest - guestNice;
  return { busy: total - idle - iowait, total };
}

/** psutil.cpu_percent(interval=0.5) */
export async function cpuPercent(intervalMs = 500): Promise<number> {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, intervalMs));
  const b = cpuTimes();
  const all = b.total - a.total;
  if (all <= 0) return 0;
  const pct = ((b.busy - a.busy) / all) * 100;
  return round1(Math.min(100, Math.max(0, pct)));
}

/** psutil.virtual_memory(): total, used = total - available, percent. */
export function virtualMemory(): { total: number; used: number; percent: number } {
  const info: Record<string, number> = {};
  for (const l of readFileSync('/proc/meminfo', 'utf8').split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(l);
    if (m) info[m[1]!] = Number(m[2]) * 1024;
  }
  const total = info.MemTotal ?? 0;
  const avail = info.MemAvailable ?? info.MemFree ?? 0;
  return { total, used: total - avail, percent: total ? round1(((total - avail) / total) * 100) : 0 };
}

/** psutil.disk_usage('/') */
export function diskUsage(path = '/'): { total: number; used: number; free: number; percent: number } {
  const s = statfsSync(path);
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  const used = (s.blocks - s.bfree) * s.bsize;
  const denom = used + free;
  return { total, used, free, percent: denom ? round1((used / denom) * 100) : 0 };
}

/** psutil.net_io_counters() (all interfaces summed) */
export function netIo(): { bytes_sent: number; bytes_recv: number } {
  let sent = 0; let recv = 0;
  for (const l of readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
    const i = l.indexOf(':');
    if (i < 0) continue;
    const f = l.slice(i + 1).trim().split(/\s+/).map(Number);
    recv += f[0] ?? 0;
    sent += f[8] ?? 0;
  }
  return { bytes_sent: sent, bytes_recv: recv };
}

/** views._collect_metrics / tasks.collect_server_metrics field set. */
export async function collectMetrics() {
  const mem = virtualMemory();
  const disk = diskUsage('/');
  const net = netIo();
  return {
    cpu_percent: await cpuPercent(500),
    memory_percent: round1(mem.percent),
    memory_used_mb: round1(mem.used / 1e6),
    memory_total_mb: round1(mem.total / 1e6),
    disk_used_percent: round1(disk.percent),
    disk_free_gb: round1(disk.free / 1e9),
    net_bytes_sent_mb: round1(net.bytes_sent / 1e6),
    net_bytes_recv_mb: round1(net.bytes_recv / 1e6),
  };
}
