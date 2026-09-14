-- Widen the audited-field list so edits are actually recorded.
--
-- audited_fields() is a whitelist: update_record() writes a history row only
-- for fields that appear in it. The original list covered status, money and
-- ownership — the things that matter on a deal — which left most of the fields
-- a user actually edits silently untracked. Someone could change an expense's
-- amount category, its date, or what it was for, and the record's history would
-- show nothing.
--
-- That is the wrong default for a system whose audit trail exists so a finance
-- lead can answer "who changed this, and when". The list below adds the
-- descriptive and classifying fields that carry meaning on the screens people
-- edit: expenses, projects, tasks and the shared name/description pair.
--
-- Deliberately still a whitelist rather than "audit everything":
--   * updatedAt changes on every write and would double the table for nothing.
--   * Derived totals (completionPercent, outstandingAmount) are recomputed by
--     roll-ups, so they would record the system's own arithmetic as though a
--     person had done it.
--   * passwordHash must never be written to history in either column.
--
-- Mirrors AUDITED_FIELDS in src/lib/audit.ts — keep the two in step. A field
-- added here but not there is untracked on writes that go through auditChanges()
-- rather than update_record(), and vice versa.
create or replace function audited_fields()
returns text[]
language sql
immutable
as $$
  select array[
    -- Original list.
    'status','stage','priority','amount','totalAmount','contractValue',
    'commissionAmount','netPayableAmount','ownerUserId','assignedUserId',
    'projectManagerId','approvalStatus','expectedCloseDate','dueDate',
    'startDate','endDate','paidAmount','outstandingAmount','accountType',
    'partnerType','tier','revenueSharePercent','commissionPercentOverride',

    -- What a record is and what it says. "description" is the field most often
    -- corrected after the fact, and until now that correction left no trace.
    'name','description','subject','notes','scope','acceptanceCriteria',

    -- Expenses. These are the fields the expense edit form exposes, and the
    -- reason this migration exists: an expense can be re-dated, re-categorised,
    -- moved to another project or made billable, and each of those changes who
    -- ends up paying for it.
    'expenseDate','categoryId','projectId','employeeUserId','vendorAccountId',
    'billableToCustomer','reimbursable','taxAmount','currencyCode',
    'paymentStatus','receiptDocumentId',

    -- Projects and tasks.
    'projectType','health','billingType','approvedHours','plannedEndDate',
    'actualEndDate','estimatedHours','billable','phaseId','milestoneId',

    -- People and access. A role change is the single most security-relevant
    -- edit in the system and was previously invisible here.
    'roleId','departmentId','managerUserId','jobTitle','costRate',
    'defaultBillingRate','employeeNumber','email',

    -- Contact and account details people ring or invoice.
    'phone','accountId','contactId','partnerId','contractId','opportunityId',
    'billingAmount','invoicedAt','quantity','unitPrice','discountPercent'
  ];
$$;

comment on function audited_fields() is
  'Fields that update_record() writes history rows for. Mirrors AUDITED_FIELDS in src/lib/audit.ts.';
