// notifications.consumers.NotificationConsumer — route ^ws/notifications/$.
//
// Protocol (identical to Django, text frames encoded like Python's json.dumps):
//   connect → accepted immediately (after AllowedHostsOriginValidator)
//   {"type": "authenticate", "token": "<access JWT>"} → joins notifications_<user_id>,
//       sends {"type": "authenticated", "user_id", "email"} then {"type": "unread_count", "count"}
//       bad token → {"type": "error", "message": "Invalid or expired token."} + close (1000)
//   {"type": "get_unread_count"} → unread_count (or error "Not authenticated.")
//   anything else → {"type": "error", "message": "Unknown message type: <str(type)>"}
//   invalid JSON → error "Invalid JSON."; valid JSON that isn't an object, or a
//       binary frame → the consumer crashes like Django's (close 1011)
//   group event notification_message → {"type": "new_notification", "notification", "unread_count"}

import { db } from '../../db/index.js';
import { decode } from '../../lib/jwt.js';
import { wsRoute } from '../../lib/ws.js';
import { AsyncWebsocketConsumer, ConsumerCrash, asConsumer, installOriginValidator, type LayerMessage } from './channels.js';
import { PyNum, pyJsonLoads, pyStr } from '../../lib/py.js';

type UserRow = { id: number; email: string };

export class NotificationConsumer extends AsyncWebsocketConsumer {
  user: UserRow | null = null;
  groupName: string | null = null;

  override async connect() {
    this.user = null;
    this.groupName = null;
    await this.accept();
  }

  override async disconnect(_code: number) {
    if (this.groupName) await this.channelLayer.groupDiscard(this.groupName, this.channelName);
    // Groups joined by earlier (re-)authentications stay attached to this channel in
    // Django until it goes away; the channel is closed right after this.
  }

  override async receive(textData?: string, _bytesData?: Buffer) {
    if (textData === undefined) {
      // receive(self, text_data) has no bytes_data parameter → TypeError in Django.
      throw new ConsumerCrash("receive() got an unexpected keyword argument 'bytes_data'");
    }
    let data: unknown;
    try {
      data = pyJsonLoads(textData);
    } catch {
      await this.sendError('Invalid JSON.');
      return;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data) || data instanceof PyNum) {
      throw new ConsumerCrash("object has no attribute 'get'"); // data.get(...) on a non-dict
    }
    const msgType = (data as Record<string, unknown>).type;
    if (msgType === 'authenticate') {
      await this.handleAuthenticate(data as Record<string, unknown>);
    } else if (msgType === 'get_unread_count') {
      if (!this.user) {
        await this.sendError('Not authenticated.');
        return;
      }
      await this.handleUnreadCount();
    } else {
      await this.sendError(`Unknown message type: ${pyStr(msgType)}`);
    }
  }

  private async handleAuthenticate(data: Record<string, unknown>) {
    const tokenStr = 'token' in data ? data.token : '';
    const user = await this.getUserFromToken(tokenStr);
    if (user === null) {
      await this.sendError('Invalid or expired token.');
      await this.close();
      return;
    }
    this.user = user;
    this.groupName = `notifications_${user.id}`;
    await this.channelLayer.groupAdd(this.groupName, this.channelName);
    await this.sendJson({ type: 'authenticated', user_id: user.id, email: user.email });
    await this.handleUnreadCount();
  }

  private async handleUnreadCount() {
    const count = await this.getUnreadCount(this.user!);
    await this.sendJson({ type: 'unread_count', count });
  }

  /** Group event handler — channel_layer.group_send(..., {"type": "notification_message", ...}). */
  async notification_message(event: LayerMessage) {
    if (!('notification' in event)) throw new ConsumerCrash("KeyError: 'notification'");
    const payload = event.notification;
    const count = this.user ? await this.getUnreadCount(this.user) : 0;
    await this.sendJson({ type: 'new_notification', notification: payload, unread_count: count });
  }

  /** AccessToken(token) + User.objects.get(id=token['user_id']) — no is_active check, like Django. */
  private async getUserFromToken(token: unknown): Promise<UserRow | null> {
    if (typeof token !== 'string') return null; // non-str → "Token is invalid"; None → new token without user_id
    let payload;
    try {
      payload = decode(token, 'access');
    } catch {
      return null;
    }
    if (payload.user_id === undefined) return null;
    const id = Number(payload.user_id);
    if (!Number.isSafeInteger(id)) throw new ConsumerCrash(`Field 'id' expected a number but got ${String(payload.user_id)}`);
    const user = await db.selectFrom('users_user').select(['id', 'email']).where('id', '=', id).executeTakeFirst();
    return user ?? null;
  }

  private async getUnreadCount(user: UserRow): Promise<number> {
    const { count } = await db.selectFrom('notifications_notification').select((eb) => eb.fn.countAll<number>().as('count'))
      .where('user_id', '=', user.id).where('is_read', '=', false).executeTakeFirstOrThrow();
    return Number(count);
  }

  private async sendError(message: string) {
    await this.sendJson({ type: 'error', message });
  }
}

installOriginValidator();
wsRoute('^ws/notifications/$', asConsumer(NotificationConsumer));
