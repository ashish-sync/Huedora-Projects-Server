import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  LogisticsExpenseCategory,
  LogisticsExpenseSubCategory,
  LogisticsExpenseType,
} from './logistics.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, 'seed', 'consolidated-expense-master.json');
const SEED_VERSION = 'consolidated-v2';
const MARKER_CODE = `_EXPENSE_MASTER_${SEED_VERSION}`;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function readSeedPayload() {
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  return JSON.parse(raw);
}

/** Load consolidated Expense Master (categories and sub-categories). Idempotent per version. */
export async function ensureExpenseMasterSeed() {
  const marker = await LogisticsExpenseCategory.findOne({ code: MARKER_CODE });
  if (marker) return { seeded: false };

  const payload = readSeedPayload();
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const subCategories = Array.isArray(payload.subCategories) ? payload.subCategories : [];

  await LogisticsExpenseSubCategory.deleteMany({});
  await LogisticsExpenseType.deleteMany({});
  const existingCategories = await LogisticsExpenseCategory.find({});
  for (const row of existingCategories) {
    if (row.code === MARKER_CODE) continue;
    row.isDeleted = true;
    row.isActive = false;
    await row.save();
  }

  const categoryByName = new Map();

  for (const row of categories) {
    const code = trim(row.Code).toUpperCase();
    const name = trim(row['Expense Category']);
    if (!code || !name) continue;
    const existing = await LogisticsExpenseCategory.findOne({ code, isDeleted: false });
    const cat =
      existing ||
      (await LogisticsExpenseCategory.create({
        code,
        name,
        covers: '',
        isSystem: true,
        isActive: true,
      }));
    if (existing) {
      existing.name = name;
      existing.isSystem = true;
      existing.isActive = true;
      existing.isDeleted = false;
      await existing.save();
    }
    categoryByName.set(name.toLowerCase(), cat);
  }

  for (const row of subCategories) {
    const categoryName = trim(row['Expense Category']);
    const subName = trim(row['Sub Category'] || row['Expense Sub-Category']);
    if (!categoryName || !subName) continue;
    const cat = categoryByName.get(categoryName.toLowerCase());
    if (!cat) continue;
    const existing = await LogisticsExpenseSubCategory.findOne({
      categoryId: cat._id,
      name: new RegExp(`^${subName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      isDeleted: false,
    });
    if (!existing) {
      await LogisticsExpenseSubCategory.create({
        categoryId: cat._id,
        categoryName: cat.name,
        name: subName,
        isSystem: true,
        isActive: true,
      });
    }
  }

  await LogisticsExpenseCategory.create({
    code: MARKER_CODE,
    name: 'Migration marker',
    covers: '',
    isDeleted: true,
    isActive: false,
    isSystem: true,
  });

  console.log(
    `[logistics] Expense Master seeded: ${categories.length} categories, ${subCategories.length} sub-categories`
  );
  return { seeded: true, categories: categories.length, subCategories: subCategories.length };
}
