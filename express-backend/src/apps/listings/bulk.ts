// listings.bulk — XLSX template/export/import (openpyxl → exceljs).

import ExcelJS from 'exceljs';
import { db } from '../../db/index.js';
import { pyFloatRepr } from '../../lib/py.js';
import { pyDecimal, pyErrorsRepr, runSerializer } from './drf.js';
import { createHotelRoom, createListing } from './models.js';
import { HOTEL_ROOM_FIELDS, LISTING_FIELDS, listingValidate, type ListingRow } from './serializers.js';

const LISTING_SHEET = 'Listings';
const ROOMS_SHEET = 'HotelRooms';
const INSTRUCTIONS_SHEET = 'Instructions';

type Kind = 'int' | 'str' | 'decimal' | 'bool' | 'list';

export const LISTING_COLUMNS: [string, Kind][] = [
  ['row_id', 'int'], ['owner_email', 'str'], ['title', 'str'], ['description', 'str'], ['price', 'decimal'],
  ['property_type', 'str'], ['privacy_type', 'str'], ['address', 'str'], ['city', 'str'], ['state', 'str'], ['country', 'str'],
  ['latitude', 'decimal'], ['longitude', 'decimal'], ['check_in_time', 'str'], ['check_out_time', 'str'], ['self_checkin', 'bool'],
  ['square_footage', 'int'], ['bedrooms', 'int'], ['beds', 'int'], ['bathrooms', 'int'], ['max_guests', 'int'],
  ['amenities', 'list'], ['highlights', 'list'], ['booking_mode', 'str'], ['cancellation_policy', 'str'],
  ['weekend_premium_percent', 'int'], ['new_listing_promo', 'bool'], ['last_minute_discount_enabled', 'bool'],
  ['last_minute_discount_percent', 'int'], ['weekly_discount_enabled', 'bool'], ['weekly_discount_percent', 'int'],
  ['monthly_discount_enabled', 'bool'], ['monthly_discount_percent', 'int'], ['exterior_camera', 'bool'], ['noise_monitor', 'bool'],
  ['weapons_on_property', 'bool'], ['pricing_type', 'str'], ['payment_schedule', 'str'], ['lease_term_months', 'int'],
];

export const ROOM_COLUMNS: [string, Kind][] = [
  ['row_id', 'int'], ['name', 'str'], ['room_type', 'str'], ['description', 'str'], ['price_per_night', 'decimal'],
  ['max_occupancy', 'int'], ['beds', 'int'], ['bed_type', 'str'], ['bathrooms', 'int'], ['amenities', 'list'], ['total_count', 'int'],
];

const EXAMPLE_LISTING_ROW: Record<string, unknown> = {
  row_id: 1, owner_email: '', title: 'Cozy Two Bedroom Apartment', description: 'A bright, quiet apartment close to downtown.',
  price: 45, property_type: 'apartment', privacy_type: 'entire_place', address: '12 Randall St', city: 'Monrovia',
  state: 'Montserrado', country: 'Liberia', latitude: '', longitude: '', check_in_time: '15:00', check_out_time: '11:00',
  self_checkin: false, square_footage: 900, bedrooms: 2, beds: 2, bathrooms: 1, max_guests: 4, amenities: 'wifi, kitchen, parking',
  highlights: 'quiet street', booking_mode: 'approve_first', cancellation_policy: 'flexible', weekend_premium_percent: 0,
  new_listing_promo: false, last_minute_discount_enabled: false, last_minute_discount_percent: 0, weekly_discount_enabled: false,
  weekly_discount_percent: 0, monthly_discount_enabled: false, monthly_discount_percent: 0, exterior_camera: false,
  noise_monitor: false, weapons_on_property: false, pricing_type: 'nightly', payment_schedule: '', lease_term_months: '',
};

const EXAMPLE_ROOM_ROW: Record<string, unknown> = {
  row_id: 1, name: 'Standard Queen', room_type: 'standard', description: '', price_per_night: 30, max_occupancy: 2, beds: 1,
  bed_type: 'queen', bathrooms: 1, amenities: 'wifi, ac', total_count: 3,
};

const INSTRUCTIONS_TEXT = [
  'How to use this workbook',
  '',
  "1. Fill in one row per listing on the 'Listings' sheet. row_id is a number you choose to identify the row within THIS file only (not a database ID) — it's how a listing links to its room types below.",
  "2. Only fill in the 'HotelRooms' sheet for listings whose property_type is 'hotels' or 'lodge' — every row there must reference a row_id that exists on the Listings sheet. Leave it empty for other property types.",
  "3. amenities and highlights are comma-separated (e.g. 'wifi, kitchen, parking').",
  '4. True/false columns accept TRUE/FALSE, yes/no, or 1/0.',
  "5. owner_email: leave blank to import as your own listings. Admins importing on behalf of another host/agent must fill this in with that user's account email.",
  "6. Imported listings are created exactly like one made through the listing wizard (same required fields, same minimum price) and land as 'Pending Review' — NOT published yet. Photos aren't part of this import; add them per listing afterward. Each listing still needs its ownership verification completed before it can go live, same as any other listing.",
  '7. Re-uploading this file does not update existing listings — every import creates brand-new listings.',
];

/** _cell(kind, value) */
function cell(kind: Kind, value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (kind === 'bool') return value ? 'TRUE' : 'FALSE';
  if (kind === 'list') {
    if (Array.isArray(value)) {
      if (value.some((v) => typeof v !== 'string')) throw new TypeError('sequence item: expected str instance');
      return value.join(', ');
    }
    return value || '';
  }
  if (kind === 'decimal' && typeof value === 'string' && value !== '') return Number(value);
  return value;
}

// openpyxl never writes a cell whose value is '' — leave those cells absent.
const blankToNull = (v: unknown) => (v === '' ? null : v);

function writeSheet(ws: ExcelJS.Worksheet, columns: [string, Kind][], rows: Record<string, unknown>[]) {
  ws.addRow(columns.map(([h]) => h));
  for (const row of rows) ws.addRow(columns.map(([f, k]) => blankToNull(cell(k, row[f]))));
}

export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const instructions = wb.addWorksheet(INSTRUCTIONS_SHEET);
  writeSheet(wb.addWorksheet(LISTING_SHEET), LISTING_COLUMNS, [EXAMPLE_LISTING_ROW]);
  writeSheet(wb.addWorksheet(ROOMS_SHEET), ROOM_COLUMNS, [EXAMPLE_ROOM_ROW]);
  for (const line of INSTRUCTIONS_TEXT) instructions.addRow([blankToNull(line)]);
  instructions.getColumn(1).width = 100;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildExportWorkbook(listings: ListingRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const listingRows: Record<string, unknown>[] = [];
  const roomRows: Record<string, unknown>[] = [];
  const ownerIds = [...new Set(listings.map((l) => l.owner_id))];
  const owners = ownerIds.length ? await db.selectFrom('users_user').select(['id', 'email']).where('id', 'in', ownerIds).execute() : [];
  const emailBy = new Map(owners.map((o) => [o.id, o.email]));
  const rooms = listings.length
    ? await db.selectFrom('listings_hotelroom').selectAll().where('listing_id', 'in', listings.map((l) => l.id)).orderBy('room_type').orderBy('price_per_night').execute()
    : [];
  listings.forEach((l, idx) => {
    const i = idx + 1;
    const row: Record<string, unknown> = { row_id: i, owner_email: emailBy.get(l.owner_id) };
    for (const [f] of LISTING_COLUMNS) if (f !== 'row_id' && f !== 'owner_email') row[f] = (l as Record<string, unknown>)[f];
    listingRows.push(row);
    for (const room of rooms.filter((r) => r.listing_id === l.id)) {
      const rr: Record<string, unknown> = { row_id: i };
      for (const [f] of ROOM_COLUMNS) if (f !== 'row_id') rr[f] = (room as Record<string, unknown>)[f];
      roomRows.push(rr);
    }
  });
  writeSheet(wb.addWorksheet(LISTING_SHEET), LISTING_COLUMNS, listingRows);
  writeSheet(wb.addWorksheet(ROOMS_SHEET), ROOM_COLUMNS, roomRows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- import -------------------------------------------------------------------------------------

/** openpyxl cell value (data_only) from an exceljs cell value. */
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return cellValue((v as { result: ExcelJS.CellValue }).result);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as { text: string }).text;
    if ('error' in v) return (v as { error: string }).error;
  }
  return v;
}

/** str(value) of an openpyxl value. */
function pyCellStr(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.000Z$/, '').replace('Z', '');
  return String(v);
}

class ParseFail extends Error {}

/** _parse_cell(kind, value) — throws ParseFail for InvalidOperation/ValueError. */
function parseCell(kind: Kind, value: unknown): unknown {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const s = pyCellStr(value);
  if (kind === 'int' || kind === 'decimal') {
    const d = pyDecimal(s.trim());
    if (d === null) throw new ParseFail();
    if (d === 'nan' || d === 'inf') {
      if (kind === 'int') throw new Error(d === 'nan' ? 'cannot convert NaN to integer' : 'cannot convert Infinity to integer');
      return s;
    }
    if (kind === 'decimal') return `${d.neg ? '-' : ''}${d.digits}e${d.exp}`;
    let n = d.exp >= 0 ? BigInt(d.digits) * 10n ** BigInt(d.exp) : (d.digits.length > -d.exp ? BigInt(d.digits.slice(0, d.digits.length + d.exp)) : 0n);
    if (d.neg) n = -n;
    return Number(n);
  }
  if (kind === 'bool') return ['true', 'yes', '1', 'y'].includes(s.trim().toLowerCase());
  if (kind === 'list') return s.split(',').map((x) => x.trim()).filter(Boolean);
  return s.trim();
}

function readSheetRows(ws: ExcelJS.Worksheet | undefined, columns: [string, Kind][]): [number, Record<string, unknown>][] {
  if (!ws || ws.rowCount < 1) return [];
  const width = ws.columnCount;
  const rowValues = (r: number) => Array.from({ length: width }, (_, i) => cellValue(ws.getRow(r).getCell(i + 1).value));
  const header = rowValues(1);
  const headerIndex = new Map<string, number>();
  header.forEach((h, i) => { if (h !== null && h !== '' && h !== 0 && h !== false) headerIndex.set(pyCellStr(h), i); });
  const rows: [number, Record<string, unknown>][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const raw = rowValues(r);
    if (raw.every((v) => v === null || pyCellStr(v).trim() === '')) continue;
    const parsed: Record<string, unknown> = {};
    for (const [field, kind] of columns) {
      const idx = headerIndex.get(field);
      const rawValue = idx !== undefined && idx < raw.length ? raw[idx] : null;
      let value: unknown;
      try { value = parseCell(kind, rawValue); } catch (e) { if (e instanceof ParseFail) value = null; else throw e; }
      if (value !== null || field === 'row_id') parsed[field] = value;
    }
    rows.push([r, parsed]);
  }
  return rows;
}

/** Converts parsed cell values into the dict ListingSerializer(data=...) receives (Decimal → str form). */
function decimalsToStrings(d: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+e-?\d+$/.test(v) ? decimalText(v) : v]));
}
function decimalText(v: string): string {
  const [m, e] = v.split('e') as [string, string];
  const neg = m.startsWith('-'); const digits = neg ? m.slice(1) : m; const exp = Number(e);
  let s: string;
  if (exp >= 0) s = digits + '0'.repeat(exp);
  else { const p = digits.padStart(-exp + 1, '0'); s = `${p.slice(0, p.length + exp)}.${p.slice(p.length + exp)}`; }
  return (neg ? '-' : '') + s;
}

export async function importWorkbook(file: Buffer, requestingUser: { id: number }, isAdmin: boolean): Promise<[ListingRow[], unknown[]]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as never);
  } catch {
    throw new Error('File is not a zip file');
  }
  const listingRows = readSheetRows(wb.getWorksheet(LISTING_SHEET), LISTING_COLUMNS);
  const roomRows = readSheetRows(wb.getWorksheet(ROOMS_SHEET), ROOM_COLUMNS);
  const roomsByRowId = new Map<unknown, Record<string, unknown>[]>();
  for (const [, room] of roomRows) {
    const k = room.row_id ?? null;
    if (!roomsByRowId.has(k)) roomsByRowId.set(k, []);
    roomsByRowId.get(k)!.push(room);
  }
  const created: ListingRow[] = [];
  const rowErrors: unknown[] = [];
  for (const [excelRow, data] of listingRows) {
    const rowId = data.row_id ?? null;
    delete data.row_id;
    const ownerEmail = String(data.owner_email ?? '').trim();
    delete data.owner_email;
    let ownerId: number;
    if (ownerEmail) {
      if (!isAdmin) { rowErrors.push({ row: excelRow, errors: { owner_email: 'Only admins can import listings on behalf of another account.' } }); continue; }
      const owner = await db.selectFrom('users_user').select('id').where((eb) => eb(eb.fn('upper', ['email']), '=', eb.fn('upper', [eb.val(ownerEmail)])))
        .orderBy('id').executeTakeFirst();
      if (!owner) { rowErrors.push({ row: excelRow, errors: { owner_email: `No account found for ${ownerEmail}.` } }); continue; }
      ownerId = owner.id;
    } else if (isAdmin) {
      rowErrors.push({ row: excelRow, errors: { owner_email: 'Required for an admin-driven import — whose listing is this?' } });
      continue;
    } else ownerId = requestingUser.id;

    const v = await runSerializer(decimalsToStrings(data), LISTING_FIELDS, { validate: listingValidate(null) });
    if (v.errors) { rowErrors.push({ row: excelRow, errors: v.errors }); continue; }
    const listing = await createListing(v.values, { owner_id: ownerId, status: 'pending_review' });
    for (const roomData0 of roomsByRowId.get(rowId) ?? []) {
      const roomData = decimalsToStrings({ ...roomData0 });
      delete roomData.row_id;
      roomData.listing = listing.id;
      const rv = await runSerializer(roomData, HOTEL_ROOM_FIELDS);
      if (!rv.errors) await createHotelRoom(rv.values, listing.id);
      else rowErrors.push({ row: excelRow, errors: { hotel_rooms: `A room type failed validation and was skipped: ${pyErrorsRepr(rv.errors)}` } });
    }
    created.push(listing);
  }
  return [created, rowErrors];
}
