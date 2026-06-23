import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const adapter = new PrismaBetterSqlite3({ url: path.resolve('./data/realestate.db') } as any);
const prisma = new PrismaClient({ adapter } as any);

// Name mapping: CBS name → our DB name
const CBS_TO_DB: Record<string, string> = {
  'תל אביב -יפו': 'תל אביב-יפו',
  'הרצלייה': 'הרצליה',
};

// DB name → CBS name (for lookup)
const DB_TO_CBS: Record<string, string> = {};
Object.entries(CBS_TO_DB).forEach(([cbs, db]) => { DB_TO_CBS[db] = cbs; });

interface CbsCity {
  code: string;
  name: string;
  district: string;
  status: string;
  population_2024: number;
  permits_2016: number;
  permits_2017: number;
  permits_2018: number;
  permits_2019: number;
  permits_2020: number;
  permits_2021: number;
  permits_2022: number;
  permits_2023: number;
  permits_2024: number;
}

async function main() {
  const cbsData: CbsCity[] = JSON.parse(
    fs.readFileSync(path.resolve('./data/cbs_permits.json'), 'utf-8')
  );

  // Normalize CBS name → DB name
  const normalize = (name: string) => CBS_TO_DB[name] || name;

  // Get existing cities from DB
  const existingCities = await prisma.city.findMany();
  const existingNames = new Set(existingCities.map((c: any) => c.city_name));

  let permitsAdded = 0;
  let citiesAdded = 0;
  let permitsUpdated = 0;

  for (const cbs of cbsData) {
    const dbName = normalize(cbs.name);
    const years = [2016,2017,2018,2019,2020,2021,2022,2023,2024];

    if (existingNames.has(dbName)) {
      // City exists — upsert building permits
      for (const year of years) {
        const permits = (cbs as any)[`permits_${year}`];
        if (permits != null) {
          await prisma.buildingPermit.upsert({
            where: { city_name_year: { city_name: dbName, year } },
            update: { permits },
            create: { city_name: dbName, year, permits, source: 'CBS_YISHUV' },
          });
          permitsAdded++;
        }
      }
    } else {
      // New city — create in DB with available data
      try {
        await prisma.city.create({
          data: {
            city_name: dbName,
            population_2026: cbs.population_2024, // best available
            people_per_apartment: null,
            construction_4y_gross: null,
            net_coefficient: null,
            price_per_sqm_2023: null,
            price_per_sqm_2026: null,
          },
        });
        citiesAdded++;
        existingNames.add(dbName);

        // Add permits for new city
        for (const year of years) {
          const permits = (cbs as any)[`permits_${year}`];
          if (permits != null) {
            await prisma.buildingPermit.create({
              data: { city_name: dbName, year, permits, source: 'CBS_YISHUV' },
            });
            permitsAdded++;
          }
        }
      } catch (e: any) {
        console.error(`Failed to create city ${dbName}: ${e.message}`);
      }
    }
  }

  // Also update population_2026 for existing cities that have null and now have CBS 2024 pop
  for (const cbs of cbsData) {
    const dbName = normalize(cbs.name);
    const existing = existingCities.find((c: any) => c.city_name === dbName);
    if (existing && !(existing as any).population_2026 && cbs.population_2024 > 0) {
      await prisma.city.update({
        where: { city_name: dbName },
        data: { population_2026: cbs.population_2024 },
      });
    }
  }

  console.log(`Done: ${citiesAdded} new cities added, ${permitsAdded} permit records upserted`);

  // Summary
  const total = await prisma.city.count();
  const totalPermits = await prisma.buildingPermit.count();
  console.log(`Total cities: ${total}, Total permit records: ${totalPermits}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
