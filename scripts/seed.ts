import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ROLE_CODES, ROLE_NAMES, PERMISSION_CODES } from "../shared/crm";
import { transaction, run, rows, closePool } from "../server/crm/db";
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  admin: PERMISSION_CODES, ceo: PERMISSION_CODES, pricing: ["customers.read"],
  sales: ["customers.read", "customers.create", "customers.update", "contacts.manage"], employee: [], technician: [],
};
const regions = [{code:"NA",name:"North America"},{code:"CA",name:"Central America"},{code:"SA",name:"South America"},{code:"EU",name:"Europe"},{code:"MENA",name:"Middle East/North Africa"},{code:"APAC",name:"Asia-Pacific"},{code:"OTHER",name:"Other"}];
export async function seed() {
  const countries = JSON.parse(await readFile(new URL("../server/crm/countries.json", import.meta.url), "utf8")) as {code:string;name:string;regionCode:string}[];
  await transaction(async db => {
    await rows(db, "SELECT id FROM crm_security_guard WHERE id = 1 FOR UPDATE");
    for (const code of PERMISSION_CODES) await run(db, "INSERT IGNORE INTO crm_permissions (code, name) VALUES (?, ?)", [code, code.split(".").join(" · ")]);
    for (const code of ROLE_CODES) {
      const existing = await rows(db, "SELECT code FROM crm_roles WHERE code = ?", [code]);
      if (!existing.length) {
        await run(db, "INSERT INTO crm_roles (code, name, protected) VALUES (?, ?, ?)", [code, ROLE_NAMES[code], ["admin", "ceo"].includes(code)]);
        for (const permission of DEFAULT_ROLE_PERMISSIONS[code]) await run(db, "INSERT INTO crm_role_permissions (role_code, permission_code) VALUES (?, ?)", [code, permission]);
      }
    }
    for (const region of regions) await run(db, "INSERT IGNORE INTO crm_business_regions (code, name) VALUES (?, ?)", [region.code, region.name]);
    for (const country of countries) {
      await run(db, "INSERT IGNORE INTO crm_countries (code, name) VALUES (?, ?)", [country.code, country.name]);
      await run(db, "INSERT IGNORE INTO crm_country_regions (country_code, region_code) VALUES (?, ?)", [country.code, country.regionCode]);
    }
    await run(db, "INSERT IGNORE INTO crm_company (id, timezone, default_currency) VALUES (1, 'UTC', 'USD')");
  });
  console.log(`Seed ready: ${countries.length} ISO countries, 7 regions, 6 roles, ${PERMISSION_CODES.length} permissions, blank company. No identities or business test records created; existing edits preserved.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) seed().catch(() => { console.error("Seed failed. Apply migrations first and verify database configuration."); process.exitCode = 1; }).finally(closePool);
