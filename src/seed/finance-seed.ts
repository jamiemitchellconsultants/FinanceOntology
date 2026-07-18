/**
 * Finance Ontology Seed Data.
 *
 * Pre-populates the ontology with core finance domain concepts,
 * relationships, systems, and example gaps.
 *
 * This reflects a typical enterprise finance team using an ERP (SAP/Oracle),
 * an AP automation tool, an expense system, a banking/treasury platform,
 * and a budgeting/planning tool.
 */

import type {
  Concept,
  OntologyData,
  Relationship,
  SystemDef,
  Gap,
} from '../ontology/types.js';

// ─── Systems ──────────────────────────────────────────────────────────────────

const systems: Record<string, SystemDef> = {
  erp: {
    id: 'erp',
    name: 'ERP System',
    type: 'erp',
    description:
      'Core Enterprise Resource Planning system (e.g. SAP, Oracle Financials). ' +
      'Source of truth for General Ledger, Chart of Accounts, and financial close.',
    baseUrl: 'https://erp.internal/api/v1',
    authType: 'oauth2',
    status: 'unknown',
    ingestionConfig: { type: 'rest_api' },
  },
  ap_system: {
    id: 'ap_system',
    name: 'AP Automation',
    type: 'ap',
    description:
      'Accounts Payable automation tool (e.g. Basware, Tipalti, Coupa). ' +
      'Manages invoice processing, vendor payments, and purchase order matching.',
    baseUrl: 'https://ap.internal/api/v2',
    authType: 'api_key',
    status: 'unknown',
    ingestionConfig: { type: 'rest_api' },
  },
  banking: {
    id: 'banking',
    name: 'Treasury / Banking',
    type: 'banking',
    description:
      'Treasury management and banking connectivity (e.g. Kyriba, GTreasury). ' +
      'Manages cash positions, bank accounts, and payment execution.',
    baseUrl: 'https://treasury.internal/api/v1',
    authType: 'oauth2',
    status: 'unknown',
    ingestionConfig: { type: 'rest_api' },
  },
  budgeting: {
    id: 'budgeting',
    name: 'Budgeting & Planning',
    type: 'budgeting',
    description:
      'Financial planning and analysis tool (e.g. Adaptive Planning, Anaplan, Pigment). ' +
      'Manages budgets, forecasts, and variance analysis.',
    baseUrl: 'https://planning.internal/api/v3',
    authType: 'oauth2',
    status: 'unknown',
    ingestionConfig: { type: 'rest_api' },
  },
  expense: {
    id: 'expense',
    name: 'Expense Management',
    type: 'expense',
    description:
      'Employee expense management (e.g. Concur, Expensify, Navan). ' +
      'Captures employee expenses and integrates with AP and GL.',
    baseUrl: 'https://expense.internal/api/v1',
    authType: 'oauth2',
    status: 'unknown',
    ingestionConfig: { type: 'rest_api' },
  },
  procurement: {
    id: 'procurement',
    name: 'Procurement',
    type: 'procurement',
    description:
      'Procurement and purchasing system (e.g. Coupa, Jaggaer, SAP Ariba). ' +
      'Manages purchase requisitions, POs, and supplier contracts.',
    baseUrl: 'https://procurement.internal/api/v1',
    authType: 'api_key',
    status: 'unknown',
    ingestionConfig: { type: 'rest_api' },
  },
};

// ─── Concepts ─────────────────────────────────────────────────────────────────

const concepts: Record<string, Concept> = {
  // ── Core GL / Chart of Accounts ──────────────────────────────────────────
  chart_of_accounts: {
    id: 'chart_of_accounts',
    name: 'Chart of Accounts',
    type: 'entity',
    description:
      'A structured list of all financial accounts used by the organization. ' +
      'Each account has a code, name, type (asset/liability/equity/income/expense), and hierarchy.',
    attributes: {
      account_code: { type: 'string', description: 'Unique account identifier', required: true },
      account_name: { type: 'string', description: 'Human-readable account name', required: true },
      account_type: {
        type: 'enum',
        description: 'Account classification',
        required: true,
        enumValues: ['asset', 'liability', 'equity', 'income', 'expense'],
      },
      is_active: { type: 'boolean', description: 'Whether the account is in use', required: true },
      parent_account_code: {
        type: 'string',
        description: 'Parent account for hierarchy',
        required: false,
      },
    },
    systemMappings: [
      {
        systemId: 'erp',
        entityName: 'GLAccount',
        apiEndpoint: '/finance/gl-accounts',
        fieldMappings: [
          { ontologyField: 'account_code', systemField: 'AccountCode' },
          { ontologyField: 'account_name', systemField: 'AccountDescription' },
          { ontologyField: 'account_type', systemField: 'AccountType' },
          { ontologyField: 'is_active', systemField: 'IsActive' },
        ],
      },
    ],
    tags: ['finance', 'gl', 'core'],
    confidence: 0.95,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  general_ledger: {
    id: 'general_ledger',
    name: 'General Ledger',
    type: 'entity',
    description:
      'The complete record of all financial transactions of the organization. ' +
      'Each entry (journal line) is associated with an account, period, amount, and reference.',
    attributes: {
      journal_id: { type: 'string', description: 'Journal entry identifier', required: true },
      account_code: { type: 'string', description: 'GL account code', required: true },
      period: {
        type: 'string',
        description: 'Accounting period (YYYY-MM)',
        required: true,
        format: 'YYYY-MM',
      },
      debit_amount: { type: 'number', description: 'Debit amount in base currency', required: false },
      credit_amount: {
        type: 'number',
        description: 'Credit amount in base currency',
        required: false,
      },
      currency: { type: 'string', description: 'Transaction currency code (ISO 4217)', required: true },
      posting_date: { type: 'date', description: 'Date the entry was posted', required: true },
      description: { type: 'string', description: 'Journal line description', required: false },
      cost_center_code: {
        type: 'string',
        description: 'Cost center this entry belongs to',
        required: false,
      },
    },
    systemMappings: [
      {
        systemId: 'erp',
        entityName: 'JournalEntry',
        apiEndpoint: '/finance/journal-entries',
        fieldMappings: [
          { ontologyField: 'journal_id', systemField: 'JournalId' },
          { ontologyField: 'account_code', systemField: 'AccountCode' },
          { ontologyField: 'period', systemField: 'FiscalPeriod' },
          { ontologyField: 'debit_amount', systemField: 'DebitAmount' },
          { ontologyField: 'credit_amount', systemField: 'CreditAmount' },
          { ontologyField: 'currency', systemField: 'CurrencyCode' },
          { ontologyField: 'posting_date', systemField: 'PostingDate' },
          { ontologyField: 'cost_center_code', systemField: 'CostCenterCode' },
        ],
      },
    ],
    tags: ['finance', 'gl', 'core'],
    confidence: 0.95,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  // ── Dimensions ─────────────────────────────────────────────────────────────
  cost_center: {
    id: 'cost_center',
    name: 'Cost Center',
    type: 'dimension',
    description:
      'An organizational unit used to accumulate costs. ' +
      'Cost centers are used to track departmental spending against budget.',
    attributes: {
      code: { type: 'string', description: 'Unique cost center code', required: true },
      name: { type: 'string', description: 'Cost center name', required: true },
      manager: { type: 'string', description: 'Responsible manager name or ID', required: false },
      parent_code: { type: 'string', description: 'Parent cost center code', required: false },
      company_code: { type: 'string', description: 'Company code this CC belongs to', required: true },
    },
    systemMappings: [
      {
        systemId: 'erp',
        entityName: 'CostCenter',
        apiEndpoint: '/controlling/cost-centers',
        fieldMappings: [
          { ontologyField: 'code', systemField: 'CostCenterCode' },
          { ontologyField: 'name', systemField: 'CostCenterName' },
          { ontologyField: 'manager', systemField: 'ResponsiblePerson' },
        ],
      },
      {
        systemId: 'budgeting',
        entityName: 'Department',
        apiEndpoint: '/dimensions/departments',
        fieldMappings: [
          { ontologyField: 'code', systemField: 'deptCode' },
          { ontologyField: 'name', systemField: 'deptName' },
        ],
        notes: 'Budget system uses "Department" for what ERP calls "Cost Center"',
      },
    ],
    tags: ['dimension', 'controlling', 'core'],
    confidence: 0.9,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  profit_center: {
    id: 'profit_center',
    name: 'Profit Center',
    type: 'dimension',
    description:
      'An organizational unit used to measure profitability. ' +
      'Profit centers capture both revenues and costs to calculate contribution margins.',
    attributes: {
      code: { type: 'string', description: 'Profit center code', required: true },
      name: { type: 'string', description: 'Profit center name', required: true },
      company_code: { type: 'string', description: 'Company code', required: true },
    },
    systemMappings: [
      {
        systemId: 'erp',
        entityName: 'ProfitCenter',
        apiEndpoint: '/controlling/profit-centers',
        fieldMappings: [
          { ontologyField: 'code', systemField: 'ProfitCenterCode' },
          { ontologyField: 'name', systemField: 'ProfitCenterName' },
        ],
      },
    ],
    tags: ['dimension', 'controlling'],
    confidence: 0.85,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  // ── AP ─────────────────────────────────────────────────────────────────────
  vendor: {
    id: 'vendor',
    name: 'Vendor',
    type: 'entity',
    description:
      'A supplier or service provider from whom the organization purchases goods or services.',
    attributes: {
      vendor_id: { type: 'string', description: 'Unique vendor identifier', required: true },
      name: { type: 'string', description: 'Vendor / supplier name', required: true },
      tax_id: { type: 'string', description: 'Tax identification number', required: false },
      payment_terms: {
        type: 'string',
        description: 'Standard payment terms (e.g. Net30)',
        required: false,
      },
      currency: { type: 'string', description: 'Default currency code', required: false },
      bank_account: { type: 'string', description: 'Bank account for payments', required: false },
      country: { type: 'string', description: 'Country of registration (ISO 3166)', required: false },
    },
    systemMappings: [
      {
        systemId: 'erp',
        entityName: 'Vendor',
        apiEndpoint: '/procurement/vendors',
        fieldMappings: [
          { ontologyField: 'vendor_id', systemField: 'VendorCode' },
          { ontologyField: 'name', systemField: 'VendorName' },
          { ontologyField: 'payment_terms', systemField: 'PaymentTerms' },
          { ontologyField: 'currency', systemField: 'CurrencyCode' },
        ],
      },
      {
        systemId: 'ap_system',
        entityName: 'Supplier',
        apiEndpoint: '/suppliers',
        fieldMappings: [
          { ontologyField: 'vendor_id', systemField: 'supplierId' },
          { ontologyField: 'name', systemField: 'supplierName' },
          { ontologyField: 'bank_account', systemField: 'bankAccountNumber' },
        ],
        notes: 'AP system uses "Supplier" for what ERP calls "Vendor" — IDs may differ',
      },
    ],
    tags: ['ap', 'procurement', 'core'],
    confidence: 0.9,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  invoice: {
    id: 'invoice',
    name: 'Invoice',
    type: 'entity',
    description:
      'A financial document from a vendor requesting payment for goods or services. ' +
      'Invoices go through approval and matching before payment.',
    attributes: {
      invoice_number: { type: 'string', description: 'Vendor invoice number', required: true },
      vendor_id: { type: 'string', description: 'Vendor identifier', required: true },
      invoice_date: { type: 'date', description: 'Date on the invoice', required: true },
      due_date: { type: 'date', description: 'Payment due date', required: true },
      total_amount: { type: 'number', description: 'Total invoice amount', required: true },
      currency: { type: 'string', description: 'Invoice currency', required: true },
      status: {
        type: 'enum',
        description: 'Invoice processing status',
        required: true,
        enumValues: ['received', 'matching', 'approved', 'paid', 'disputed', 'cancelled'],
      },
      po_number: { type: 'string', description: 'Related purchase order number', required: false },
    },
    systemMappings: [
      {
        systemId: 'ap_system',
        entityName: 'Invoice',
        apiEndpoint: '/invoices',
        fieldMappings: [
          { ontologyField: 'invoice_number', systemField: 'invoiceNumber' },
          { ontologyField: 'vendor_id', systemField: 'supplierId' },
          { ontologyField: 'invoice_date', systemField: 'invoiceDate' },
          { ontologyField: 'due_date', systemField: 'dueDate' },
          { ontologyField: 'total_amount', systemField: 'grossAmount' },
          { ontologyField: 'currency', systemField: 'currency' },
          { ontologyField: 'status', systemField: 'workflowStatus' },
          { ontologyField: 'po_number', systemField: 'purchaseOrderRef' },
        ],
      },
      {
        systemId: 'erp',
        entityName: 'APDocument',
        apiEndpoint: '/finance/ap-documents',
        fieldMappings: [
          { ontologyField: 'invoice_number', systemField: 'DocumentNumber' },
          { ontologyField: 'vendor_id', systemField: 'VendorCode' },
          { ontologyField: 'total_amount', systemField: 'DocumentAmount' },
          { ontologyField: 'status', systemField: 'PostingStatus' },
        ],
        notes: 'ERP only sees invoices after they have been posted from AP system',
      },
    ],
    tags: ['ap', 'finance', 'core'],
    confidence: 0.9,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  purchase_order: {
    id: 'purchase_order',
    name: 'Purchase Order',
    type: 'entity',
    description:
      'A formal request from the organization to a vendor to supply goods or services at an agreed price.',
    attributes: {
      po_number: { type: 'string', description: 'Purchase order number', required: true },
      vendor_id: { type: 'string', description: 'Vendor identifier', required: true },
      po_date: { type: 'date', description: 'PO creation date', required: true },
      total_value: { type: 'number', description: 'Total PO value', required: true },
      currency: { type: 'string', description: 'PO currency', required: true },
      status: {
        type: 'enum',
        description: 'PO status',
        required: true,
        enumValues: ['draft', 'approved', 'sent', 'partially_received', 'fully_received', 'closed', 'cancelled'],
      },
      cost_center_code: {
        type: 'string',
        description: 'Cost center to charge',
        required: false,
      },
    },
    systemMappings: [
      {
        systemId: 'procurement',
        entityName: 'PurchaseOrder',
        apiEndpoint: '/purchase-orders',
        fieldMappings: [
          { ontologyField: 'po_number', systemField: 'poNumber' },
          { ontologyField: 'vendor_id', systemField: 'supplierId' },
          { ontologyField: 'po_date', systemField: 'createdDate' },
          { ontologyField: 'total_value', systemField: 'totalValue' },
          { ontologyField: 'status', systemField: 'status' },
        ],
      },
      {
        systemId: 'erp',
        entityName: 'PurchaseOrder',
        apiEndpoint: '/procurement/purchase-orders',
        fieldMappings: [
          { ontologyField: 'po_number', systemField: 'PONumber' },
          { ontologyField: 'vendor_id', systemField: 'VendorCode' },
          { ontologyField: 'total_value', systemField: 'NetOrderValue' },
        ],
      },
    ],
    tags: ['procurement', 'ap', 'core'],
    confidence: 0.88,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  // ── Budget / Planning ───────────────────────────────────────────────────────
  budget: {
    id: 'budget',
    name: 'Budget',
    type: 'entity',
    description:
      'A financial plan allocating expected income and expenditure for a period. ' +
      'Budgets are set by cost center, GL account, and fiscal period.',
    attributes: {
      budget_id: { type: 'string', description: 'Budget record identifier', required: true },
      cost_center_code: { type: 'string', description: 'Cost center code', required: true },
      account_code: { type: 'string', description: 'GL account code', required: true },
      fiscal_year: { type: 'string', description: 'Fiscal year (YYYY)', required: true },
      period: { type: 'string', description: 'Period (01-12)', required: false },
      amount: { type: 'number', description: 'Budgeted amount', required: true },
      currency: { type: 'string', description: 'Budget currency', required: true },
      version: {
        type: 'string',
        description: 'Budget version (e.g. Original, Revised, Forecast)',
        required: false,
      },
    },
    systemMappings: [
      {
        systemId: 'budgeting',
        entityName: 'BudgetLine',
        apiEndpoint: '/budgets/lines',
        fieldMappings: [
          { ontologyField: 'budget_id', systemField: 'lineId' },
          { ontologyField: 'cost_center_code', systemField: 'deptCode' },
          { ontologyField: 'account_code', systemField: 'glCode' },
          { ontologyField: 'fiscal_year', systemField: 'fiscalYear' },
          { ontologyField: 'period', systemField: 'period' },
          { ontologyField: 'amount', systemField: 'budgetAmount' },
          { ontologyField: 'version', systemField: 'scenario' },
        ],
      },
      {
        systemId: 'erp',
        entityName: 'BudgetEntry',
        apiEndpoint: '/controlling/budget-entries',
        fieldMappings: [
          { ontologyField: 'cost_center_code', systemField: 'CostCenterCode' },
          { ontologyField: 'account_code', systemField: 'CostElement' },
          { ontologyField: 'amount', systemField: 'BudgetedAmount' },
        ],
        notes: 'ERP budget is loaded from planning tool — may lag by up to 1 business day',
      },
    ],
    tags: ['budget', 'fp&a', 'core'],
    confidence: 0.85,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  // ── Treasury / Cash ─────────────────────────────────────────────────────────
  bank_account: {
    id: 'bank_account',
    name: 'Bank Account',
    type: 'entity',
    description:
      'A bank account held by the organization. ' +
      'Tracked in the treasury system for cash position and payment execution.',
    attributes: {
      account_number: { type: 'string', description: 'Bank account number (masked)', required: true },
      bank_name: { type: 'string', description: 'Bank institution name', required: true },
      currency: { type: 'string', description: 'Account currency', required: true },
      iban: { type: 'string', description: 'IBAN (where applicable)', required: false },
      balance: { type: 'number', description: 'Current balance', required: false },
      balance_date: { type: 'date', description: 'Date of balance', required: false },
    },
    systemMappings: [
      {
        systemId: 'banking',
        entityName: 'BankAccount',
        apiEndpoint: '/accounts',
        fieldMappings: [
          { ontologyField: 'account_number', systemField: 'accountNumber' },
          { ontologyField: 'bank_name', systemField: 'bankName' },
          { ontologyField: 'currency', systemField: 'currency' },
          { ontologyField: 'balance', systemField: 'currentBalance' },
          { ontologyField: 'balance_date', systemField: 'valueDate' },
        ],
      },
      {
        systemId: 'erp',
        entityName: 'HouseBank',
        apiEndpoint: '/treasury/house-banks',
        fieldMappings: [
          { ontologyField: 'account_number', systemField: 'BankAccountId' },
          { ontologyField: 'currency', systemField: 'Currency' },
        ],
        notes: 'ERP house bank does not hold live balance — use banking system for cash position',
      },
    ],
    tags: ['treasury', 'cash', 'banking'],
    confidence: 0.88,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  payment: {
    id: 'payment',
    name: 'Payment',
    type: 'process',
    description:
      'The execution of a payment from the organization to a vendor or employee. ' +
      'Payments are approved in AP/expense systems and executed via the banking system.',
    attributes: {
      payment_id: { type: 'string', description: 'Payment reference', required: true },
      vendor_id: { type: 'string', description: 'Payee vendor ID', required: false },
      amount: { type: 'number', description: 'Payment amount', required: true },
      currency: { type: 'string', description: 'Payment currency', required: true },
      payment_date: { type: 'date', description: 'Value date of payment', required: true },
      bank_account: { type: 'string', description: 'Paying bank account', required: true },
      status: {
        type: 'enum',
        description: 'Payment status',
        required: true,
        enumValues: ['pending', 'submitted', 'cleared', 'rejected', 'cancelled'],
      },
    },
    systemMappings: [
      {
        systemId: 'ap_system',
        entityName: 'Payment',
        apiEndpoint: '/payments',
        fieldMappings: [
          { ontologyField: 'payment_id', systemField: 'paymentId' },
          { ontologyField: 'vendor_id', systemField: 'supplierId' },
          { ontologyField: 'amount', systemField: 'paymentAmount' },
          { ontologyField: 'currency', systemField: 'currency' },
          { ontologyField: 'payment_date', systemField: 'paymentDate' },
          { ontologyField: 'status', systemField: 'paymentStatus' },
        ],
      },
      {
        systemId: 'banking',
        entityName: 'Transaction',
        apiEndpoint: '/transactions',
        fieldMappings: [
          { ontologyField: 'payment_id', systemField: 'referenceNumber' },
          { ontologyField: 'amount', systemField: 'amount' },
          { ontologyField: 'payment_date', systemField: 'valueDate' },
          { ontologyField: 'status', systemField: 'transactionStatus' },
        ],
        notes: 'Banking system is the source of truth for cleared status',
      },
    ],
    tags: ['ap', 'treasury', 'process', 'core'],
    confidence: 0.87,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  // ── Expense ─────────────────────────────────────────────────────────────────
  expense_report: {
    id: 'expense_report',
    name: 'Expense Report',
    type: 'entity',
    description:
      'A claim for reimbursement of business expenses incurred by an employee. ' +
      'Approved reports create AP invoices or direct payments.',
    attributes: {
      report_id: { type: 'string', description: 'Expense report ID', required: true },
      employee_id: { type: 'string', description: 'Claimant employee ID', required: true },
      total_amount: { type: 'number', description: 'Total claimed amount', required: true },
      currency: { type: 'string', description: 'Report currency', required: true },
      submission_date: { type: 'date', description: 'Date submitted', required: true },
      approval_date: { type: 'date', description: 'Date approved', required: false },
      status: {
        type: 'enum',
        description: 'Report status',
        required: true,
        enumValues: ['draft', 'submitted', 'approved', 'rejected', 'paid'],
      },
    },
    systemMappings: [
      {
        systemId: 'expense',
        entityName: 'ExpenseReport',
        apiEndpoint: '/expense-reports',
        fieldMappings: [
          { ontologyField: 'report_id', systemField: 'reportId' },
          { ontologyField: 'employee_id', systemField: 'employeeId' },
          { ontologyField: 'total_amount', systemField: 'totalAmount' },
          { ontologyField: 'status', systemField: 'status' },
        ],
      },
    ],
    tags: ['expense', 'ap'],
    confidence: 0.82,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  // ── Reports / Metrics ───────────────────────────────────────────────────────
  trial_balance: {
    id: 'trial_balance',
    name: 'Trial Balance',
    type: 'report',
    description:
      'A listing of all GL account balances at a point in time. ' +
      'Used to verify that debits equal credits and as the basis for financial statements.',
    attributes: {
      period: { type: 'string', description: 'Reporting period (YYYY-MM)', required: true },
      account_code: { type: 'string', description: 'GL account code', required: true },
      opening_balance: { type: 'number', description: 'Balance at period start', required: true },
      period_debit: { type: 'number', description: 'Total debits in period', required: true },
      period_credit: { type: 'number', description: 'Total credits in period', required: true },
      closing_balance: { type: 'number', description: 'Balance at period end', required: true },
    },
    systemMappings: [
      {
        systemId: 'erp',
        entityName: 'TrialBalance',
        apiEndpoint: '/reports/trial-balance',
        fieldMappings: [
          { ontologyField: 'period', systemField: 'FiscalPeriod' },
          { ontologyField: 'account_code', systemField: 'AccountCode' },
          { ontologyField: 'opening_balance', systemField: 'OpeningBalance' },
          { ontologyField: 'closing_balance', systemField: 'ClosingBalance' },
        ],
      },
    ],
    tags: ['reporting', 'gl', 'close'],
    confidence: 0.92,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  budget_vs_actuals: {
    id: 'budget_vs_actuals',
    name: 'Budget vs Actuals',
    type: 'report',
    description:
      'Comparison of budgeted amounts against actual spending by cost center, ' +
      'GL account, and period. Used for variance analysis and management reporting.',
    attributes: {
      period: { type: 'string', description: 'Reporting period', required: true },
      cost_center_code: { type: 'string', description: 'Cost center', required: true },
      account_code: { type: 'string', description: 'GL account', required: true },
      budget_amount: { type: 'number', description: 'Budget amount', required: true },
      actual_amount: { type: 'number', description: 'Actual spend', required: true },
      variance: { type: 'number', description: 'Variance (actual - budget)', required: true },
      variance_pct: { type: 'number', description: 'Variance as % of budget', required: false },
    },
    systemMappings: [
      {
        systemId: 'budgeting',
        entityName: 'BudgetVsActual',
        apiEndpoint: '/reports/budget-vs-actual',
        fieldMappings: [
          { ontologyField: 'period', systemField: 'period' },
          { ontologyField: 'cost_center_code', systemField: 'deptCode' },
          { ontologyField: 'budget_amount', systemField: 'budgetAmount' },
          { ontologyField: 'actual_amount', systemField: 'actualAmount' },
          { ontologyField: 'variance', systemField: 'variance' },
        ],
        notes: 'Actuals are synced from ERP nightly; intraday actuals require ERP API call',
      },
    ],
    tags: ['reporting', 'fp&a', 'budget'],
    confidence: 0.8,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },

  cash_flow: {
    id: 'cash_flow',
    name: 'Cash Flow',
    type: 'metric',
    description:
      'The net movement of cash in and out of the organization. ' +
      'Includes operating, investing, and financing activities.',
    attributes: {
      period: { type: 'string', description: 'Period (YYYY-MM)', required: true },
      operating_cashflow: {
        type: 'number',
        description: 'Cash from operating activities',
        required: false,
      },
      investing_cashflow: {
        type: 'number',
        description: 'Cash from investing activities',
        required: false,
      },
      financing_cashflow: {
        type: 'number',
        description: 'Cash from financing activities',
        required: false,
      },
      net_cashflow: { type: 'number', description: 'Net cash movement', required: true },
      closing_cash: { type: 'number', description: 'Closing cash position', required: false },
    },
    systemMappings: [
      {
        systemId: 'banking',
        entityName: 'CashPosition',
        apiEndpoint: '/cash-positions',
        fieldMappings: [
          { ontologyField: 'period', systemField: 'date' },
          { ontologyField: 'closing_cash', systemField: 'totalCashPosition' },
          { ontologyField: 'net_cashflow', systemField: 'netMovement' },
        ],
      },
    ],
    tags: ['treasury', 'fp&a', 'metric'],
    confidence: 0.75,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
};

// ─── Relationships ─────────────────────────────────────────────────────────────

const relationships: Relationship[] = [
  // Chart of Accounts → General Ledger
  {
    id: 'rel-001',
    fromConceptId: 'general_ledger',
    toConceptId: 'chart_of_accounts',
    type: 'references',
    description: 'Every GL journal entry references a Chart of Accounts code',
    cardinality: 'N:1',
    confidence: 0.99,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // GL → Cost Center
  {
    id: 'rel-002',
    fromConceptId: 'general_ledger',
    toConceptId: 'cost_center',
    type: 'references',
    description: 'GL entries are allocated to a cost center for controlling',
    cardinality: 'N:1',
    confidence: 0.95,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Trial Balance aggregates GL
  {
    id: 'rel-003',
    fromConceptId: 'trial_balance',
    toConceptId: 'general_ledger',
    type: 'aggregates',
    description: 'Trial balance is derived by aggregating GL journal entries by account and period',
    cardinality: '1:N',
    confidence: 0.98,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Budget vs Actuals ← Budget
  {
    id: 'rel-004',
    fromConceptId: 'budget_vs_actuals',
    toConceptId: 'budget',
    type: 'references',
    description: 'Budget vs Actuals report references budget amounts',
    cardinality: 'N:1',
    confidence: 0.95,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Budget vs Actuals ← General Ledger (actuals)
  {
    id: 'rel-005',
    fromConceptId: 'budget_vs_actuals',
    toConceptId: 'general_ledger',
    type: 'references',
    description: 'Budget vs Actuals report uses GL actuals',
    cardinality: 'N:1',
    confidence: 0.95,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Budget ← Cost Center
  {
    id: 'rel-006',
    fromConceptId: 'budget',
    toConceptId: 'cost_center',
    type: 'references',
    description: 'Budget lines are allocated by cost center',
    cardinality: 'N:1',
    confidence: 0.97,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Invoice ← Vendor
  {
    id: 'rel-007',
    fromConceptId: 'invoice',
    toConceptId: 'vendor',
    type: 'references',
    description: 'Every invoice is raised by a vendor',
    cardinality: 'N:1',
    confidence: 0.99,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Purchase Order ← Vendor
  {
    id: 'rel-008',
    fromConceptId: 'purchase_order',
    toConceptId: 'vendor',
    type: 'references',
    description: 'Purchase orders are issued to vendors',
    cardinality: 'N:1',
    confidence: 0.99,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Invoice references Purchase Order (2-way match)
  {
    id: 'rel-009',
    fromConceptId: 'invoice',
    toConceptId: 'purchase_order',
    type: 'references',
    description: '2-way or 3-way match: invoice is matched against a PO',
    cardinality: 'N:1',
    confidence: 0.9,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Payment processes Invoice
  {
    id: 'rel-010',
    fromConceptId: 'payment',
    toConceptId: 'invoice',
    type: 'processed_by',
    description: 'Payment settles one or more invoices',
    cardinality: 'N:M',
    confidence: 0.95,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Payment uses Bank Account
  {
    id: 'rel-011',
    fromConceptId: 'payment',
    toConceptId: 'bank_account',
    type: 'references',
    description: 'Payment is executed from a bank account',
    cardinality: 'N:1',
    confidence: 0.97,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Cash Flow aggregates Bank Account
  {
    id: 'rel-012',
    fromConceptId: 'cash_flow',
    toConceptId: 'bank_account',
    type: 'aggregates',
    description: 'Cash flow position is derived from bank account movements',
    cardinality: '1:N',
    confidence: 0.88,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Expense Report feeds into Payment
  {
    id: 'rel-013',
    fromConceptId: 'expense_report',
    toConceptId: 'payment',
    type: 'feeds_into',
    description: 'Approved expense reports trigger employee reimbursement payments',
    cardinality: '1:1',
    confidence: 0.85,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Cost Center → Profit Center
  {
    id: 'rel-014',
    fromConceptId: 'cost_center',
    toConceptId: 'profit_center',
    type: 'relates_to',
    description: 'Cost centers are typically assigned to a profit center for P&L reporting',
    cardinality: 'N:1',
    confidence: 0.8,
    createdAt: '2024-01-01T00:00:00Z',
  },
  // Purchase Order ← Cost Center
  {
    id: 'rel-015',
    fromConceptId: 'purchase_order',
    toConceptId: 'cost_center',
    type: 'references',
    description: 'PO line items are charged to a cost center',
    cardinality: 'N:1',
    confidence: 0.9,
    createdAt: '2024-01-01T00:00:00Z',
  },
];

// ─── Initial Gaps ─────────────────────────────────────────────────────────────

const gaps: Gap[] = [
  {
    id: 'gap-001',
    type: 'ambiguous_mapping',
    description:
      'Vendor IDs in ERP and AP system may not match — ERP uses "VendorCode" (e.g. 10000123) ' +
      'while AP system uses "supplierId" (e.g. SUP-00123). Cross-system reconciliation requires a mapping table.',
    affectedConceptIds: ['vendor'],
    severity: 'high',
    status: 'open',
    source: 'seed:known_issue',
    discoveredAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'gap-002',
    type: 'stale_data',
    description:
      'Budget vs Actuals report in planning tool is refreshed nightly. ' +
      'Real-time actuals require direct ERP API queries which are not yet configured.',
    affectedConceptIds: ['budget_vs_actuals'],
    severity: 'medium',
    status: 'open',
    source: 'seed:known_issue',
    discoveredAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'gap-003',
    type: 'missing_concept',
    description:
      'Intercompany transactions are not yet modelled in the ontology. ' +
      'Required for consolidation reporting across legal entities.',
    affectedConceptIds: ['general_ledger'],
    severity: 'high',
    status: 'open',
    source: 'seed:known_issue',
    discoveredAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'gap-004',
    type: 'unknown_system',
    description:
      'Tax compliance system (e.g. Avalara, Vertex, OneSource) is not yet integrated. ' +
      'Tax codes and VAT/GST calculations are missing from the ontology.',
    affectedConceptIds: ['invoice'],
    severity: 'medium',
    status: 'open',
    source: 'seed:known_issue',
    discoveredAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'gap-005',
    type: 'missing_concept',
    description:
      'Fixed assets / capital expenditure is not modelled. ' +
      'CAPEX approvals, asset register, and depreciation are not captured.',
    affectedConceptIds: ['chart_of_accounts'],
    severity: 'medium',
    status: 'open',
    source: 'seed:known_issue',
    discoveredAt: '2024-01-01T00:00:00Z',
  },
];

// ─── Exported Seed ─────────────────────────────────────────────────────────────

export const FINANCE_SEED: Partial<OntologyData> = {
  concepts,
  relationships,
  gaps,
  systems,
};
