"use server";

import { revalidatePath } from "next/cache";
import { appDb } from "@/lib/appDb";
import { requireWorkspaceIdForAction } from "@/lib/auth";

/**
 * Personal-workspace mutations. Every one of these is independently callable
 * over the network, so each re-derives the caller's workspace itself — none of
 * them may assume the page guard ran.
 *
 * OWNERSHIP IS ENFORCED INSIDE THE SQL, not by a separate read-then-write.
 * `deal_tasks` carries no user_id of its own; it inherits ownership through
 * `client_deals`. Expressing that as a subquery in the same statement keeps the
 * check and the write atomic — a check-then-act pair leaves a window where the
 * parent deal can change between the two.
 */

/** Trim to a bound so a public form cannot store unbounded text. */
function text(v: string | undefined | null, max: number): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/** Finite numbers only, clamped — NaN/Infinity/absurd values never reach the DB. */
function num(v: number | null | undefined, min: number, max: number): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

/** Mirrors STATUSES in components/DealsManager.tsx — an unknown status falls back to "seen". */
const STATUSES = new Set(["seen", "contacted", "negotiating", "offer", "closed", "dropped"]);

export async function addTrackedCity(city: string) {
  const userId = requireWorkspaceIdForAction();
  const name = text(city, 60);
  if (!name) return;
  appDb().prepare("INSERT OR IGNORE INTO tracked_cities (user_id, city_name) VALUES (?, ?)").run(userId, name);
  revalidatePath("/deals");
}

export async function removeTrackedCity(city: string) {
  const userId = requireWorkspaceIdForAction();
  appDb().prepare("DELETE FROM tracked_cities WHERE user_id=? AND city_name=?").run(userId, city);
  revalidatePath("/deals");
}

export interface DealInput {
  city: string;
  neighborhood?: string;
  street?: string;
  house_num?: string;
  size?: number | null;
  rooms?: number | null;
  floor?: number | null;
  price?: number | null;
  balcony_sqm?: number | null;
  parking_spots?: number | null;
  storage_sqm?: number | null;
  status?: string;
  listing_url?: string;
  notes?: string;
}

/** Shared normalisation, so add and update can never diverge on bounds. */
function normalize(input: Partial<DealInput>) {
  return {
    city: text(input.city, 60),
    neighborhood: text(input.neighborhood, 80),
    street: text(input.street, 120),
    house_num: text(input.house_num, 20),
    size: num(input.size, 0, 10_000),
    rooms: num(input.rooms, 0, 30),
    floor: num(input.floor, -5, 200),
    price: num(input.price, 0, 1e9),
    balcony_sqm: num(input.balcony_sqm, 0, 1_000),
    parking_spots: num(input.parking_spots, 0, 50),
    storage_sqm: num(input.storage_sqm, 0, 1_000),
    status: input.status && STATUSES.has(input.status) ? input.status : "seen",
    listing_url: text(input.listing_url, 500),
    notes: text(input.notes, 5_000),
  };
}

export async function addDeal(input: DealInput) {
  const userId = requireWorkspaceIdForAction();
  const v = normalize(input);
  if (!v.city) return;
  appDb().prepare(
    `INSERT INTO client_deals (user_id, city, neighborhood, street, house_num, size, rooms, floor, price, balcony_sqm, parking_spots, storage_sqm, status, listing_url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, v.city, v.neighborhood, v.street, v.house_num, v.size, v.rooms, v.floor,
    v.price, v.balcony_sqm, v.parking_spots, v.storage_sqm, v.status, v.listing_url, v.notes
  );
  revalidatePath("/deals");
}

export async function updateDeal(id: number, patch: Partial<DealInput>) {
  const userId = requireWorkspaceIdForAction();
  const allowed = ["city", "neighborhood", "street", "house_num", "size", "rooms", "floor", "price", "balcony_sqm", "parking_spots", "storage_sqm", "status", "listing_url", "notes"] as const;
  const v = normalize(patch);
  const sets: string[] = [];
  const vals: unknown[] = [];
  // Only the keys the caller actually sent. normalize() fills every field, and
  // writing the ones absent from `patch` would blank columns the user never touched.
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(v[k]); }
  }
  if (!sets.length) return;
  sets.push("updated_at=CURRENT_TIMESTAMP");
  appDb().prepare(`UPDATE client_deals SET ${sets.join(", ")} WHERE id=? AND user_id=?`).run(...vals, id, userId);
  revalidatePath("/deals");
}

export async function deleteDeal(id: number) {
  const userId = requireWorkspaceIdForAction();
  const db = appDb();
  // Tasks first, scoped through the parent deal. The schema declares
  // ON DELETE CASCADE, but SQLite ignores foreign keys unless the pragma is
  // enabled (appDb() sets only journal_mode), so the cascade is done by hand —
  // and dropping the deal first would make the subquery match nothing.
  db.transaction(() => {
    db.prepare(
      `DELETE FROM deal_tasks
       WHERE deal_id IN (SELECT id FROM client_deals WHERE id=? AND user_id=?)`
    ).run(id, userId);
    db.prepare("DELETE FROM client_deals WHERE id=? AND user_id=?").run(id, userId);
  })();
  revalidatePath("/deals");
}

export async function addTask(dealId: number, title: string) {
  const userId = requireWorkspaceIdForAction();
  const t = text(title, 300);
  if (!t) return;
  // INSERT ... SELECT ... WHERE EXISTS — the row is created only when the target
  // deal belongs to the caller, in a single statement.
  appDb().prepare(
    `INSERT INTO deal_tasks (deal_id, title)
     SELECT ?, ? WHERE EXISTS (SELECT 1 FROM client_deals WHERE id=? AND user_id=?)`
  ).run(dealId, t, dealId, userId);
  revalidatePath("/deals");
}

export async function toggleTask(taskId: number, done: boolean) {
  const userId = requireWorkspaceIdForAction();
  appDb().prepare(
    `UPDATE deal_tasks SET done=?
     WHERE id=? AND deal_id IN (SELECT id FROM client_deals WHERE user_id=?)`
  ).run(done ? 1 : 0, taskId, userId);
  revalidatePath("/deals");
}

export async function deleteTask(taskId: number) {
  const userId = requireWorkspaceIdForAction();
  appDb().prepare(
    `DELETE FROM deal_tasks
     WHERE id=? AND deal_id IN (SELECT id FROM client_deals WHERE user_id=?)`
  ).run(taskId, userId);
  revalidatePath("/deals");
}
