"use server";

import { revalidatePath } from "next/cache";
import { appDb } from "@/lib/appDb";
import { workspaceId } from "@/lib/auth";

// Logged-in user gets their own workspace; anonymous visitors keep the
// owner workspace so nothing is ever blocked behind a login.
const USER = () => workspaceId();

export async function addTrackedCity(city: string) {
  if (!city?.trim()) return;
  appDb().prepare("INSERT OR IGNORE INTO tracked_cities (user_id, city_name) VALUES (?, ?)").run(USER(), city.trim());
  revalidatePath("/deals");
}

export async function removeTrackedCity(city: string) {
  appDb().prepare("DELETE FROM tracked_cities WHERE user_id=? AND city_name=?").run(USER(), city);
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

export async function addDeal(input: DealInput) {
  if (!input.city?.trim()) return;
  appDb().prepare(
    `INSERT INTO client_deals (user_id, city, neighborhood, street, house_num, size, rooms, floor, price, balcony_sqm, parking_spots, storage_sqm, status, listing_url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    USER(), input.city.trim(), input.neighborhood?.trim() || null, input.street?.trim() || null,
    input.house_num?.trim() || null, input.size ?? null, input.rooms ?? null, input.floor ?? null,
    input.price ?? null, input.balcony_sqm ?? null, input.parking_spots ?? null, input.storage_sqm ?? null,
    input.status || "seen", input.listing_url?.trim() || null, input.notes?.trim() || null
  );
  revalidatePath("/deals");
}

export async function updateDeal(id: number, patch: Partial<DealInput>) {
  const allowed = ["city", "neighborhood", "street", "house_num", "size", "rooms", "floor", "price", "balcony_sqm", "parking_spots", "storage_sqm", "status", "listing_url", "notes"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push((patch as any)[k] ?? null); }
  }
  if (!sets.length) return;
  sets.push("updated_at=CURRENT_TIMESTAMP");
  appDb().prepare(`UPDATE client_deals SET ${sets.join(", ")} WHERE id=? AND user_id=?`).run(...vals, id, USER());
  revalidatePath("/deals");
}

export async function deleteDeal(id: number) {
  appDb().prepare("DELETE FROM client_deals WHERE id=? AND user_id=?").run(id, USER());
  appDb().prepare("DELETE FROM deal_tasks WHERE deal_id=?").run(id);
  revalidatePath("/deals");
}

export async function addTask(dealId: number, title: string) {
  if (!title?.trim()) return;
  appDb().prepare("INSERT INTO deal_tasks (deal_id, title) VALUES (?, ?)").run(dealId, title.trim());
  revalidatePath("/deals");
}

export async function toggleTask(taskId: number, done: boolean) {
  appDb().prepare("UPDATE deal_tasks SET done=? WHERE id=?").run(done ? 1 : 0, taskId);
  revalidatePath("/deals");
}

export async function deleteTask(taskId: number) {
  appDb().prepare("DELETE FROM deal_tasks WHERE id=?").run(taskId);
  revalidatePath("/deals");
}
