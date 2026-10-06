// Django Channels equivalent for the Express backend:
//
//   channelLayer        — channels_redis' RedisChannelLayer API (group_add /
//                         group_discard / group_send / send) on Express's own
//                         Redis, via pub/sub, so a group_send from any process
//                         (API, worker) reaches consumers in every API process.
//   AsyncWebsocketConsumer + asConsumer()
//                       — channels.generic.websocket.AsyncWebsocketConsumer:
//                         events (client frames, layer messages, disconnect)
//                         are handled strictly one at a time, layer messages
//                         dispatch to the method named after message.type
//                         ("chat.message" → chat_message), an exception in a
//                         handler kills the consumer and closes the socket
//                         with 1011 (what daphne does), close() defaults to 1000,
//                         and a client close frame without a code is echoed
//                         with 1000 like daphne (lib/ws.ts, for every socket).
//   installOriginValidator()
//                       — channels.security.websocket.AllowedHostsOriginValidator
//                         (asgi.py wraps every WS route in it when DEBUG is off):
//                         a bad/missing Origin is refused at the HTTP handshake
//                         with daphne's exact "HTTP/1.1 403 Access denied".
//
// Generic on purpose: the messaging app's ChatConsumer can extend
// AsyncWebsocketConsumer and use channelLayer the same way.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { addUpgradeGuard, type Consumer } from '../../lib/ws.js';
import { pyJsonDumps, pyStrRepr } from '../../lib/py.js';

export interface LayerMessage {
  type: string;
  [key: string]: unknown;
}

const PREFIX = 'hk:channels:';
const groupTopic = (group: string) => `${PREFIX}group:${group}`;
const channelTopic = (channel: string) => `${PREFIX}channel:${channel}`;

let sub: Redis | null = null;
const members = new Map<string, Set<string>>(); // topic → local channel names
const pending = new Map<string, Promise<unknown>>(); // topic → in-flight SUBSCRIBE
const handlers = new Map<string, (msg: LayerMessage) => void>(); // channel name → receiver
const processId = randomBytes(6).toString('hex');

function subscriber(): Redis {
  if (!sub) {
    sub = redis.duplicate();
    sub.on('message', (topic: string, payload: string) => {
      const set = members.get(topic);
      if (!set?.size) return;
      let msg: LayerMessage;
      try {
        msg = JSON.parse(payload) as LayerMessage;
      } catch {
        return;
      }
      for (const ch of [...set]) handlers.get(ch)?.(msg);
    });
    sub.on('error', (err) => logger.warn({ err }, 'channel layer subscriber error'));
  }
  return sub;
}

async function join(topic: string, channel: string): Promise<void> {
  let set = members.get(topic);
  if (!set) {
    set = new Set();
    members.set(topic, set);
    const p = subscriber().subscribe(topic);
    pending.set(topic, p);
    set.add(channel);
    try {
      await p;
    } finally {
      pending.delete(topic);
    }
    return;
  }
  set.add(channel);
  await pending.get(topic);
}

async function leave(topic: string, channel: string): Promise<void> {
  const set = members.get(topic);
  if (!set) return;
  set.delete(channel);
  if (set.size === 0) {
    members.delete(topic);
    await pending.get(topic);
    if (!members.has(topic)) await subscriber().unsubscribe(topic);
  }
}

/** channels.layers.get_channel_layer() — RedisChannelLayer semantics over Redis pub/sub. */
export const channelLayer = {
  /**
   * Creates a process-local channel ("specific.<process>!<random>", like
   * channels_redis) whose messages are passed to `receiver`. Resolves once it
   * can receive channelLayer.send() messages from any process.
   */
  async newChannel(receiver: (msg: LayerMessage) => void): Promise<string> {
    const name = `specific.${processId}!${randomBytes(6).toString('hex')}`;
    handlers.set(name, receiver);
    await join(channelTopic(name), name);
    return name;
  },

  /** Removes a channel from every group it joined (consumer finished). */
  async closeChannel(channel: string): Promise<void> {
    handlers.delete(channel);
    const topics = [...members.entries()].filter(([, s]) => s.has(channel)).map(([t]) => t);
    await Promise.all(topics.map((t) => leave(t, channel)));
  },

  /** channel_layer.group_add(group, channel_name) */
  async groupAdd(group: string, channel: string): Promise<void> {
    await join(groupTopic(group), channel);
  },

  /** channel_layer.group_discard(group, channel_name) */
  async groupDiscard(group: string, channel: string): Promise<void> {
    await leave(groupTopic(group), channel);
  },

  /** channel_layer.group_send(group, message) — reaches group members in every process. */
  async groupSend(group: string, message: LayerMessage): Promise<void> {
    await redis.publish(groupTopic(group), JSON.stringify(message));
  },

  /** channel_layer.send(channel_name, message) */
  async send(channel: string, message: LayerMessage): Promise<void> {
    await redis.publish(channelTopic(channel), JSON.stringify(message));
  },
};

/** For scripts/tests that import the layer: drop the subscriber connection. */
export async function closeChannelLayer(): Promise<void> {
  if (sub) {
    const s = sub;
    sub = null;
    members.clear();
    handlers.clear();
    await s.quit().catch(() => undefined);
  }
}

// --- AsyncWebsocketConsumer -------------------------------------------------------

/** Raised by a consumer to mirror Python's TypeError/ValueError/AttributeError crashes. */
export class ConsumerCrash extends Error {}

export abstract class AsyncWebsocketConsumer {
  channelName = '';
  /** Class-level `groups` (joined on connect, left on disconnect, like Channels). */
  groups: string[] = [];
  readonly channelLayer = channelLayer;
  private dead = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    public readonly ws: WebSocket,
    public readonly req: IncomingMessage,
    /** URL route kwargs (scope["url_route"]["kwargs"]). */
    public readonly params: Record<string, string>,
  ) {}

  // ---- overridables -------------------------------------------------------
  async connect(): Promise<void> {
    await this.accept();
  }
  /** receive(text_data=None, bytes_data=None) */
  async receive(_textData?: string, _bytesData?: Buffer): Promise<void> {}
  async disconnect(_code: number): Promise<void> {}

  // ---- API used by consumers ------------------------------------------------
  /** The HTTP upgrade has already completed (lib/ws.ts), so accept() has nothing left to do. */
  async accept(): Promise<void> {}

  /** self.send(text_data=...) / self.send(bytes_data=...) */
  async send(textData?: string, bytesData?: Buffer, close = false): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      if (textData !== undefined) this.ws.send(textData);
      else if (bytesData !== undefined) this.ws.send(bytesData);
    }
    if (close) await this.close();
  }

  /** AsyncJsonWebsocketConsumer.send_json — encoded exactly like Python's json.dumps. */
  async sendJson(content: unknown, close = false): Promise<void> {
    await this.send(pyJsonDumps(content), undefined, close);
  }

  /** self.close(code=None) — daphne sends 1000 when no code is given. */
  async close(code?: number): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close(code ?? 1000);
  }

  // ---- runtime ----------------------------------------------------------------
  private enqueue(fn: () => Promise<void>) {
    this.chain = this.chain.then(async () => {
      if (this.dead) return;
      try {
        await fn();
      } catch (err) {
        this.crash(err);
      }
    });
  }

  private crash(err: unknown) {
    logger.error({ err, consumer: this.constructor.name }, 'websocket consumer crashed');
    this.dead = true;
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close(1011);
    void channelLayer.closeChannel(this.channelName);
  }

  private async dispatchLayerMessage(msg: LayerMessage) {
    const name = String(msg.type ?? '').replace(/\./g, '_');
    if (name.startsWith('_')) throw new ConsumerCrash('Malformed type in message (leading underscore)');
    const fn = (this as unknown as Record<string, unknown>)[name];
    if (typeof fn !== 'function') throw new ConsumerCrash(`No handler for message type ${msg.type}`);
    await (fn as (m: LayerMessage) => Promise<void>).call(this, msg);
  }

  /** Starts the consumer on an upgraded socket. */
  run(): void {
    this.enqueue(async () => {
      this.channelName = await channelLayer.newChannel((msg) => this.enqueue(() => this.dispatchLayerMessage(msg)));
      for (const g of this.groups) await channelLayer.groupAdd(g, this.channelName);
      await this.connect();
    });
    this.ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      this.enqueue(() => (isBinary ? this.receive(undefined, buf) : this.receive(buf.toString('utf8'), undefined)));
    });
    this.ws.on('close', (code: number) => {
      this.enqueue(async () => {
        for (const g of this.groups) await channelLayer.groupDiscard(g, this.channelName);
        await this.disconnect(code);
        this.dead = true;
        await channelLayer.closeChannel(this.channelName);
      });
      // A crashed/finished consumer still releases its channel.
      if (this.dead) void channelLayer.closeChannel(this.channelName);
    });
    this.ws.on('error', (err) => logger.warn({ err }, 'websocket error'));
  }
}

/** Consumer.as_asgi() → a lib/ws.ts Consumer for wsRoute(). */
export function asConsumer(
  Cls: new (ws: WebSocket, req: IncomingMessage, params: Record<string, string>) => AsyncWebsocketConsumer,
): Consumer {
  return (ws, req, params) => new Cls(ws, req, params).run();
}

// --- AllowedHostsOriginValidator ----------------------------------------------------

/** settings.ALLOWED_HOSTS exactly as Django computes it (env_list + the onrender default). */
function djangoAllowedHosts(): string[] {
  const raw = process.env.DJANGO_ALLOWED_HOSTS;
  const render = process.env.RENDER_EXTERNAL_HOSTNAME ?? '';
  const fallback = 'localhost,127.0.0.1' + (render ? `,${render}` : '');
  const hosts = (raw ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);
  if (!raw) hosts.push('.onrender.com');
  return hosts;
}

interface ParsedUrl { scheme: string; hostname: string | null; port: number | null }

/** urllib.parse.urlparse (scheme / hostname / port only). */
function urlparse(url: string): ParsedUrl {
  let rest = url;
  let scheme = '';
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(rest);
  if (m) {
    scheme = m[1]!.toLowerCase();
    rest = rest.slice(m[0].length);
  }
  let netloc = '';
  if (rest.startsWith('//')) {
    const end = rest.slice(2).search(/[/?#]/);
    netloc = end < 0 ? rest.slice(2) : rest.slice(2, 2 + end);
  }
  const hostport = netloc.includes('@') ? netloc.slice(netloc.lastIndexOf('@') + 1) : netloc;
  let hostname: string;
  let portStr = '';
  if (hostport.startsWith('[')) {
    const close = hostport.indexOf(']');
    hostname = close >= 0 ? hostport.slice(1, close) : hostport.slice(1);
    const after = close >= 0 ? hostport.slice(close + 1) : '';
    if (after.startsWith(':')) portStr = after.slice(1);
  } else {
    const i = hostport.indexOf(':');
    hostname = i >= 0 ? hostport.slice(0, i) : hostport;
    portStr = i >= 0 ? hostport.slice(i + 1) : '';
  }
  const port = /^\d+$/.test(portStr) ? Number(portStr) : null;
  return { scheme, hostname: hostname ? hostname.toLowerCase() : null, port };
}

/** django.http.request.is_same_domain */
function isSameDomain(host: string, pattern: string): boolean {
  if (!pattern) return false;
  const p = pattern.toLowerCase();
  return (p[0] === '.' && (host.endsWith(p) || host === p.slice(1))) || p === host;
}

function originPort(u: ParsedUrl): number | null {
  if (u.port !== null) return u.port;
  if (u.scheme === 'http' || u.scheme === 'ws') return 80;
  if (u.scheme === 'https' || u.scheme === 'wss') return 443;
  return null;
}

/** OriginValidator.valid_origin with settings.ALLOWED_HOSTS. */
export function validOrigin(originHeader: string | undefined, allowed = djangoAllowedHosts()): boolean {
  if (originHeader === undefined) return allowed.includes('*');
  const origin = urlparse(originHeader);
  return allowed.some((pattern) => {
    if (pattern === '*') return true;
    const pp = urlparse(pattern.toLowerCase());
    if (origin.hostname === null) return false;
    if (!pp.scheme) {
      const ph = urlparse('//' + pattern).hostname || pattern;
      return isSameDomain(origin.hostname, ph);
    }
    return pp.scheme === origin.scheme && originPort(origin) === originPort(pp) && isSameDomain(origin.hostname, pp.hostname ?? '');
  });
}

/** Python urlsplit(...).port errors (ValueError messages) or null. */
function pyPortError(netloc: string): string | null {
  const hostinfo = netloc.slice(netloc.lastIndexOf('@') + 1);
  let port: string;
  const br = hostinfo.indexOf('[');
  if (br >= 0) {
    const after = hostinfo.slice(br + 1);
    const close = after.indexOf(']');
    const rest = close >= 0 ? after.slice(close + 1) : '';
    const c = rest.indexOf(':');
    port = c >= 0 ? rest.slice(c + 1) : '';
  } else {
    const c = hostinfo.indexOf(':');
    port = c >= 0 ? hostinfo.slice(c + 1) : '';
  }
  if (!port) return null;
  if (!/^[0-9]+$/.test(port)) return `Port could not be cast to integer value as ${pyStrRepr(port)}`;
  if (Number(port) > 65535) return 'Port out of range 0-65535';
  return null;
}

/** autobahn _url_to_origin: the ValueError message for an unusable Origin, else null. */
function autobahnOriginError(origin: string): string | null {
  if (origin.toLowerCase() === 'null') return null;
  const u = urlparse(origin);
  if (u.scheme === 'file') return null;
  const m = /^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/([^/?#]*)/.exec(origin);
  const portErr = pyPortError(m ? m[1]! : '');
  if (portErr) return portErr;
  if (!u.hostname) return `No host part in Origin '${origin}'`;
  return null;
}

let originValidatorInstalled = false;

/**
 * Wraps every WebSocket upgrade (lib/ws.ts addUpgradeGuard) in
 * AllowedHostsOriginValidator, as asgi.py does when DEBUG is off.
 * Process-wide and idempotent — any app's ws.ts may call it.
 */
export function installOriginValidator(): void {
  if (originValidatorInstalled || config.debug) return;
  originValidatorInstalled = true;
  const allowed = djangoAllowedHosts();
  addUpgradeGuard((req: IncomingMessage, socket: Duplex): boolean => {
    const raw = req.rawHeaders;
    const origins: string[] = [];
    for (let i = 0; i < raw.length; i += 2) if (raw[i]!.toLowerCase() === 'origin') origins.push(raw[i + 1]!);
    // daphne (autobahn) handshake checks come first: duplicate / unparsable Origin → 400.
    if (origins.length > 1) {
      socket.end('HTTP/1.1 400 HTTP Origin header appears more than once in opening handshake request\r\n\r\n');
      return false;
    }
    const originErr = origins.length === 1 ? autobahnOriginError(origins[0]!.trim()) : null;
    if (originErr) {
      socket.end(`HTTP/1.1 400 HTTP Origin header invalid: ${originErr}\r\n\r\n`);
      return false;
    }
    // Then Channels' AllowedHostsOriginValidator → 403.
    if (!validOrigin(origins[0], allowed)) {
      socket.end('HTTP/1.1 403 Access denied\r\n\r\n');
      return false;
    }
    return true;
  });
}
