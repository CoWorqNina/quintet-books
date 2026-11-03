// Inventory by category: purchases of these items go to an inventory account first; the
// month-end count (item by item, valued and totalled per category) decides what was used,
// which then moves to the category's cost of sales.

/** Header of the category inventory accounts. */
export const INVENTORY_CATEGORIES_HEADER = "1320";

export interface InventoryCategory {
  /** Inventory account (balance sheet). */
  code: string;
  name: string;
  /** Cost of sales account the used part moves to. */
  cogs: string;
}

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  { code: "1321", name: "Raw – Chicken", cogs: "5130" },
  { code: "1322", name: "Fries", cogs: "5185" },
  { code: "1323", name: "Breading & Marinate", cogs: "5110" },
  { code: "1324", name: "Sauces", cogs: "5140" },
  { code: "1325", name: "Raw – Beef", cogs: "5135" },
  { code: "1326", name: "Other Ingredients", cogs: "5180" },
  { code: "1327", name: "Oil", cogs: "5150" },
  { code: "1328", name: "Gas (LPG)", cogs: "5170" },
  { code: "1329", name: "Rice", cogs: "5100" },
  { code: "1330", name: "Packaging", cogs: "5160" },
  { code: "1331", name: "Beverages", cogs: "5190" },
];

const BY_CODE = new Map(INVENTORY_CATEGORIES.map((c) => [c.code, c]));

/** Cost of sales accounts that are now reached only through a category (purchases go to inventory). */
const LEGACY_COGS: Record<string, string> = {
  ...Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c.cogs, c.code])),
  "5120": "1323", // Marinate, merged into Breading & Marinate
};

export function inventoryCategory(code: string): InventoryCategory | undefined {
  return BY_CODE.get(code);
}

export const isInventoryCategory = (code: string) => BY_CODE.has(code);

/** A cost of sales account replaced by an inventory category (not used for purchases any more). */
export const isInventoriedCogs = (code: string) => code in LEGACY_COGS;

/**
 * The category of a counted item. Counts before categories (October) carry the cost of sales
 * account; those map to their category.
 */
export function categoryOfCountLine(account: string): InventoryCategory | undefined {
  return BY_CODE.get(account) ?? BY_CODE.get(LEGACY_COGS[account] ?? "");
}
