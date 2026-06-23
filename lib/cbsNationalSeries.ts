/**
 * Loader for CBS national-level series collected by the 10-year agent.
 * Source file: data/cbs_national_series.json
 */
import fs from "fs";
import path from "path";

export interface ConstructionInputRow {
  year: number;
  annual_yoy_pct?: number;
  annual_yoy_pct_ytd?: number;
  approx_index: number | null;
  source_url: string;
  confidence: "high" | "medium" | "low";
  note?: string;
}

export interface HpiAnnualRow {
  year: number;
  annual_pct_change: number;
  source_url: string;
  source_name?: string;
  confidence: "high" | "medium" | "low";
  note?: string;
}

export interface HpiMonthlyRow {
  period: string;          // e.g., "2025-10/11" or "2026-02/03"
  national_yoy_pct?: number;
  national_mom_pct?: number;
  source_url: string;
  source_name?: string;
  confidence: "high" | "medium" | "low";
  district_breakdown?: Array<{ district: string; yoy_pct: number }>;
  note?: string;
}

export interface CityAvgPriceRow {
  city: string;
  period: string;          // e.g., "Q1 2025"
  avg_price_apartment: number;
  source_url: string;
  source_name?: string;
  confidence: "high" | "medium" | "low";
  note?: string;
}

export interface TxYearRow {
  year: number;
  total_transactions: number;
  source_url: string;
  confidence: "high" | "medium" | "low";
  note?: string;
}

export interface CbsNationalSeries {
  lastUpdated: string;
  construction_input_index: ConstructionInputRow[];
  housing_price_index_annual: HpiAnnualRow[];
  monthly_price_index_recent: HpiMonthlyRow[];
  yearly_avg_prices_by_city: CityAvgPriceRow[];
  transactions_summary_by_year: TxYearRow[];
  transactions_quarterly_recent: Array<Record<string, unknown>>;
  stock_unsold_apartments_recent: Array<Record<string, unknown>>;
}

let cached: CbsNationalSeries | null = null;

const FILE_PATH = path.resolve(process.cwd(), "data", "cbs_national_series.json");

export function getCbsNationalSeries(): CbsNationalSeries {
  if (cached) return cached;
  if (!fs.existsSync(FILE_PATH)) {
    cached = {
      lastUpdated: "",
      construction_input_index: [],
      housing_price_index_annual: [],
      monthly_price_index_recent: [],
      yearly_avg_prices_by_city: [],
      transactions_summary_by_year: [],
      transactions_quarterly_recent: [],
      stock_unsold_apartments_recent: [],
    };
    return cached;
  }
  try {
    cached = JSON.parse(fs.readFileSync(FILE_PATH, "utf-8")) as CbsNationalSeries;
  } catch {
    cached = {
      lastUpdated: "",
      construction_input_index: [],
      housing_price_index_annual: [],
      monthly_price_index_recent: [],
      yearly_avg_prices_by_city: [],
      transactions_summary_by_year: [],
      transactions_quarterly_recent: [],
      stock_unsold_apartments_recent: [],
    };
  }
  return cached!;
}
