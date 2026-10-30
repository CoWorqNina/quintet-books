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

export interface Period {
  key: string;
  startDate: string;
  endDate: string;
  status: "Open" | "Final";
}

export interface ApiError {
  error: string;
}
