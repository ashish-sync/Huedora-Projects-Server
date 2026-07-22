import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const FinanceExpense = defineCollection('finance_expenses', {
  ...softDelete,
  expenseKey: '',
  title: '',
  category: 'Other',
  amount: 0,
  expenseDate: '',
  status: 'Draft',
  paymentMode: '',
  payeeName: '',
  contactId: null,
  remarks: '',
  createdById: null,
  createdByEmail: '',
  approvedById: null,
  approvedAt: null,
  isActive: true,
});

export const FinanceInvoice = defineCollection('finance_invoices', {
  ...softDelete,
  invoiceKey: '',
  invoiceNumber: '',
  vendorName: '',
  contactId: null,
  amount: 0,
  taxAmount: 0,
  totalAmount: 0,
  invoiceDate: '',
  dueDate: '',
  status: 'Open',
  paymentMode: '',
  linkedInOutId: null,
  remarks: '',
  createdById: null,
  createdByEmail: '',
  isActive: true,
});
