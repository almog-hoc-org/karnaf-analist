-- CreateTable
CREATE TABLE "cities" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "city_name" TEXT NOT NULL,
    "population_2021" INTEGER,
    "population_2026" INTEGER,
    "people_per_apartment" REAL,
    "construction_4y_gross" INTEGER,
    "net_coefficient" REAL,
    "price_per_sqm_2023" INTEGER,
    "price_per_sqm_2026" INTEGER,
    "total_apartments" REAL,
    "construction_net" REAL,
    "population_growth_abs" INTEGER,
    "population_growth_pct" REAL,
    "apartments_required" REAL,
    "apartment_growth" REAL,
    "golden_multiplier" REAL,
    "golden_pct" REAL,
    "price_change_pct" REAL,
    "last_updated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "city_sales" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "city_name" TEXT NOT NULL,
    "new_sales_2023" INTEGER,
    "new_sales_2024" INTEGER,
    "new_sales_2025" INTEGER,
    "unsold_inventory_2025" INTEGER,
    "avg_sales_3y" REAL,
    "years_to_clear_2025" REAL,
    "years_to_clear_avg" REAL,
    "last_updated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "city_sales_city_name_fkey" FOREIGN KEY ("city_name") REFERENCES "cities" ("city_name") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "building_permits" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "city_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "permits" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'CBS_YISHUV',
    "last_updated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "building_permits_city_name_fkey" FOREIGN KEY ("city_name") REFERENCES "cities" ("city_name") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cbs_press_data" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "city_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER,
    "construction_starts" INTEGER,
    "construction_completions" INTEGER,
    "source_url" TEXT,
    "publication_title" TEXT,
    "last_updated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cbs_press_data_city_name_fkey" FOREIGN KEY ("city_name") REFERENCES "cities" ("city_name") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "cities_city_name_key" ON "cities"("city_name");

-- CreateIndex
CREATE UNIQUE INDEX "city_sales_city_name_key" ON "city_sales"("city_name");

-- CreateIndex
CREATE UNIQUE INDEX "building_permits_city_name_year_key" ON "building_permits"("city_name", "year");

-- CreateIndex
CREATE UNIQUE INDEX "cbs_press_data_city_name_year_quarter_key" ON "cbs_press_data"("city_name", "year", "quarter");
