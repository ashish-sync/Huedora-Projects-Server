/** All Camp Financial-tab submissions map to this Expense Master pair. */
export const CAMP_FINANCE_EXPENSE_CATEGORY = 'Healthcare Operations';
export const CAMP_FINANCE_EXPENSE_SUB_CATEGORY = 'Camp Operations & Home Visits';

export function campFinanceExpenseDefaults() {
  return {
    expenseCategory: CAMP_FINANCE_EXPENSE_CATEGORY,
    expenseSubCategory: CAMP_FINANCE_EXPENSE_SUB_CATEGORY,
  };
}
