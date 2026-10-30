// Types shared by the server (worker/) and the screens (src/).

export type Book = "Store" | "Commissary";
export type ProfitCenter = "GGC" | "The Nest" | "Shared";
export type Role = "Owner" | "Accountant" | "Supervisor" | "Staff" | "Commissary In-charge";

export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  books: Book[];
  profitCenters: ProfitCenter[];
}

export type AccountType =
  | "Header"
  | "Asset"
  | "Contra-Asset"
  | "Liability"
  | "Equity"
  | "Revenue"
  | "Contra-Revenue"
  | "COGS"
  | "Operating Expense"
  | "Other Income/Expense";

export interface Account {
  id: string; // Airtable record ID
  code: string;
  name: string;
  type: AccountType;
  normalBalance: "Dr" | "Cr" | null;
  book: Book | "Both" | null;
  profitCenterRule: string | null;
  subLedger: string | null;
  cashFlowGroup: string | null;
  statement: "Balance Sheet" | "Income Statement";
  statementLine: string;
  parentCode: string | null;
  isHeader: boolean;
  isCashAccount: boolean;
  active: boolean;
  description: string | null;
}

export interface Party {
  id: string; // Airtable record ID
  name: string;
  type: "Supplier" | "Employee" | "Owner" | "Lender" | "Platform" | "Other";
  books: Book[];
  profitCenter: "GGC" | "The Nest" | null;
  active: boolean;
  /** Suppliers need owner approval before use; other party types are always approved. */
  approved: boolean;
  approvalStatus: "Pending" | "Approved" | "Rejected" | null;
  contactDetails: string | null;
  paymentTerms: string | null;
  itemsSupplied: string | null;
  addedBy: string | null;
}

export interface Period {
  key: string;
  startDate: string;
  endDate: string;
  status: "Open" | "Final";
}

export interface ApiError {
  error: string;
}

export interface JournalLine {
  lineNo: number;
  accountCode: string;
  accountName: string;
  profitCenter: ProfitCenter | null;
  debit: number;
  credit: number;
  partyName: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  memo: string | null;
}

export interface JournalEntry {
  id: number;
  kind: string;
  transactionType: number | null;
  templateName: string;
  book: Book;
  profitCenter: ProfitCenter | null;
  entryDate: string;
  status: "Draft" | "Submitted" | "Approved" | "Rejected" | "Cancelled";
  description: string | null;
  sourceDocument: string | null;
  reason: string | null;
  unsupported: boolean;
  attachments: { path: string; name: string; type: string; size: number }[];
  dailyReportId: number | null;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  totalDebit: number;
  canBatchApprove: boolean;
  lines: JournalLine[];
}

export interface DailyReportSummary {
  id: number;
  businessDate: string;
  profitCenter: "GGC" | "The Nest";
  status: "Active" | "Cancelled";
  netSales: number;
  createdBy: string;
  createdAt: string;
  entryStatuses: Record<string, number>;
  attachments: { path: string; name: string; type: string; size: number }[];
}
