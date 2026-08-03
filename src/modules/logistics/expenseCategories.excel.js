/** Expense Master excel columns — aligned to Consolidated_Expense_Master.xlsx */

export const EXPENSE_CATEGORY_SAMPLE_HEADERS = ['Code', 'Expense Category'];

export const EXPENSE_CATEGORY_EXPORT_HEADERS = [...EXPENSE_CATEGORY_SAMPLE_HEADERS, 'Active'];

export const EXPENSE_CATEGORY_HEADERS = EXPENSE_CATEGORY_EXPORT_HEADERS;

export const EXPENSE_CATEGORY_SAMPLE_ROWS = [
  ['SLT', 'Sales & Marketing'],
  ['HCO', 'Healthcare Operations'],
];

export const EXPENSE_CATEGORY_IMPORT_COLUMNS = [
  { labels: ['Code'], field: 'code', required: true },
  { labels: ['Expense Category', 'Name'], field: 'name', required: true },
  { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
];

export const EXPENSE_TYPE_SAMPLE_HEADERS = ['Expense Type'];

export const EXPENSE_TYPE_IMPORT_COLUMNS = [
  { labels: ['Expense Type', 'Name'], field: 'name', required: true },
  { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
];

export const EXPENSE_SUBCATEGORY_SAMPLE_HEADERS = ['Expense Category', 'Expense Sub-Category'];

export const EXPENSE_SUBCATEGORY_IMPORT_COLUMNS = [
  { labels: ['Expense Category', 'Category'], field: 'categoryName', required: true },
  { labels: ['Expense Sub-Category', 'Sub Category', 'Name'], field: 'name', required: true },
  { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
];
