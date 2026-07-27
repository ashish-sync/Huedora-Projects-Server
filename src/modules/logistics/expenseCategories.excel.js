/** Expense category excel columns — sample matches Master One form. */

export const EXPENSE_CATEGORY_SAMPLE_HEADERS = ['Name', 'Covers'];

export const EXPENSE_CATEGORY_EXPORT_HEADERS = [...EXPENSE_CATEGORY_SAMPLE_HEADERS, 'Active'];

export const EXPENSE_CATEGORY_HEADERS = EXPENSE_CATEGORY_EXPORT_HEADERS;

export const EXPENSE_CATEGORY_SAMPLE_ROWS = [
  ['Travel', 'Employee travel and conveyance'],
  ['Meals', 'Team meals during camps'],
];

export const EXPENSE_CATEGORY_IMPORT_COLUMNS = [
  { labels: ['Name'], field: 'name', required: true },
  { labels: ['Covers', 'Description'], field: 'covers', optional: true },
  { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
];
