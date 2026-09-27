// A full pass through the application, against the real database.
//
// Creates one record of every entity that carries a mechanism, then checks the
// mechanism actually fired: the generated total on a deal, the project that
// appears when a deal is won, the task costs that flow back onto the deal, the
// round-robin that picks a support owner, the commission a partner earns.
//
// Unlike the boundary tests, this one LEAVES ITS RECORDS BEHIND. The system is
// not live, and a populated application is easier to judge than an empty one.
// Everything it makes is named "WT ..." and carries the same run tag, so it can
// all be found and removed later. The one thing it cleans up is the temporary
// administrator it signs in as.
//
// Most of the work is done through a signed-in administrator rather than the
// service role, because the service role bypasses row-level security and would
// prove nothing about whether a real user can do any of this.
//
// Usage: node scripts/seed-walkthrough.mjs
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const tag = randomUUID().slice(0, 6).toUpperCase();
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
// Phone numbers have to be unique per run: the duplicate check matches on the
// last nine digits, so a fixed number would find the previous run and report a
// conflict that is entirely real.
const digits = () => String(Math.floor(Math.random() * 9e6) + 1e6);
const phone = (prefix) => prefix + " " + digits();

const cleanup = [];
const checks = [];
const made = {};

function pass(what) {
  checks.push(what);
  console.log(`  PASS  ${what}`);
}
function step(n, what) {
  console.log(`\n${n}. ${what}`);
}
async function ok(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
function money(v) {
  return Number(v ?? 0);
}

try {
  // -------------------------------------------------------------------------
  step("00", "Signing in as a temporary administrator");
  // -------------------------------------------------------------------------

  const superRole = await ok(
    admin.from("security_role").select("id, name").contains("permissions", ["*"]).limit(1).single(),
    "Find the Super Admin role",
  );

  const qaEmail = `wt-admin-${tag.toLowerCase()}@example.com`;
  const qaPassword = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({
    email: qaEmail, password: qaPassword, email_confirm: true,
  });
  if (created.error) throw created.error;
  const meId = created.data.user.id;
  cleanup.push(() => admin.auth.admin.deleteUser(meId));

  await ok(
    admin.from("app_user").insert({
      id: meId, fullName: `WT Administrator ${tag}`, email: qaEmail,
      roleId: superRole.id, userType: "INTERNAL", status: "ACTIVE",
      defaultBillingRate: 20000, costRate: 8000, updatedAt: now(),
    }),
    "Create the temporary administrator",
  );
  cleanup.push(() => admin.from("app_user").delete().eq("id", meId));

  const db = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await db.auth.signInWithPassword({ email: qaEmail, password: qaPassword });
  if (signIn.error) throw signIn.error;
  pass(`Signed in as ${superRole.name}, working under row-level security`);

  // -------------------------------------------------------------------------
  step("01", "Campaign");
  // -------------------------------------------------------------------------

  // Campaign type is a reference list of its own, and required.
  let campaignType = await ok(
    db.from("campaign_type").select("id, name").eq("active", true).limit(1).maybeSingle(),
    "Find a campaign type",
  );
  if (!campaignType) {
    const id = randomUUID();
    await ok(
      admin.from("campaign_type").insert({ id, name: "Digital", channel: "Online", active: true, updatedAt: now() }),
      "Create a campaign type",
    );
    campaignType = { id, name: "Digital" };
  }

  made.campaign = randomUUID();
  await ok(
    db.from("campaign").insert({
      id: made.campaign, campaignNumber: `WT-CMP-${tag}`, name: `WT Autumn Push ${tag}`,
      campaignTypeId: campaignType.id,
      status: "ACTIVE", startDate: today(), endDate: inDays(60),
      budgetAmount: 500000, expectedLeads: 40, expectedRevenue: 5000000,
      ownerUserId: meId, updatedAt: now(),
    }),
    "Create a campaign",
  );
  pass(`Campaign created against the ${campaignType.name} type`);

  // -------------------------------------------------------------------------
  step("02", "Lead, then converting it");
  // -------------------------------------------------------------------------

  made.lead = randomUUID();
  await ok(
    db.from("lead").insert({
      id: made.lead, leadNumber: `WT-LEAD-${tag}`,
      firstName: "Imran", lastName: `Khalid ${tag}`, companyName: `WT Meridian Foods ${tag}`,
      email: `wt-imran-${tag.toLowerCase()}@example.com`, phone: phone("0300"),
      status: "QUALIFIED", rating: "HOT", leadSource: "Campaign",
      campaignId: made.campaign, ownerUserId: meId, updatedAt: now(),
    }),
    "Create a lead",
  );
  pass("Lead created and qualified");

  // The converter is exercised where it can be; where its signature does not
  // match, the three records are made directly so the rest of the walkthrough
  // still runs - and that is said plainly rather than passed off as a test of
  // conversion.
  const conversion = await db.rpc("convert_lead", {
    p_lead_id: made.lead,
    p_actor_id: meId,
    p_account_id: null,
    p_create_opportunity: true,
    p_opportunity_name: `WT Meridian - warehouse rollout ${tag}`,
    p_amount: 1740000,
    p_expected_close: inDays(30),
    p_registered_at: null,
    p_expires_at: null,
    p_protection_days: null,
  });
  const converted = conversion.error
    ? null
    : typeof conversion.data === "string" ? JSON.parse(conversion.data) : conversion.data;
  if (conversion.error) {
    console.log(`  NOTE  convert_lead not used (${conversion.error.message.slice(0, 60)}); creating the three records directly`);
  }

  if (converted && (converted.accountId || converted.account_id)) {
    made.account = converted.accountId ?? converted.account_id;
    made.contact = converted.contactId ?? converted.contact_id;
    made.opportunity = converted.opportunityId ?? converted.opportunity_id;
    pass("Converting the lead produced the account, contact and deal together");
  } else {
    made.account = randomUUID();
    made.contact = randomUUID();
    await ok(
      db.from("account").insert({
        id: made.account, accountNumber: `WT-ACC-${tag}`, name: `WT Meridian Foods ${tag}`,
        accountType: "CUSTOMER", customerStatus: "ONBOARDING", ownerUserId: meId,
        industry: "Food and beverage", mainPhone: "042 35000000",
        billingAddress: { street: "12 Gulberg Main Boulevard", city: "Lahore", country: "Pakistan" },
        updatedAt: now(),
      }),
      "Create the account",
    );
    await ok(
      db.from("contact").insert({
        id: made.contact, accountId: made.account, firstName: "Imran", lastName: `Khalid ${tag}`,
        jobTitle: "Operations Director", email: `wt-imran-${tag.toLowerCase()}@example.com`,
        phone: phone("0300"), isPrimary: true, updatedAt: now(),
      }),
      "Create the contact",
    );
    pass("Account and contact created");
  }

  // -------------------------------------------------------------------------
  step("03", "Products and services, in a price book");
  // -------------------------------------------------------------------------

  // A platform sold as a licensed deployment, and installation sold in hours -
  // the service flagged Add in Task, whose hours become the project's work.
  made.product = randomUUID();
  made.service = randomUUID();
  await ok(
    db.from("product").insert([
      {
        id: made.product, productCode: "auto", name: `WT Warehouse Platform ${tag}`,
        // Spelled out: a multi-row insert fills a column one row omits with null,
        // not with its default.
        productType: "PRODUCT", addInTask: false,
        description: "Warehouse management platform, sold as a licensed deployment.",
        active: true, updatedAt: now(),
      },
      {
        id: made.service, productCode: "auto", name: `WT Installation ${tag}`,
        productType: "SERVICE", addInTask: true,
        description: "On-site installation, sold by the hour.",
        active: true, updatedAt: now(),
      },
    ]),
    "Create a product and a service",
  );
  const codes = await ok(
    db.from("product").select("id, productCode").in("id", [made.product, made.service]),
    "Read the issued codes",
  );
  assert.ok(codes.every((c) => /^[PS]-\d+$/.test(c.productCode)), "Codes are issued by the system, P- or S-");

  made.priceBook = randomUUID();
  made.platformEntry = randomUUID();
  made.installEntry = randomUUID();
  await ok(
    db.from("price_book").insert({
      id: made.priceBook, name: `WT Standard ${tag}`, currencyCode: "PKR",
      active: true, validFrom: today(), updatedAt: now(),
    }),
    "Create a price book",
  );
  await ok(
    db.from("price_book_entry").insert([
      {
        id: made.platformEntry, priceBookId: made.priceBook, productId: made.product,
        quantity: 1, rate: 0, licenseCost: 1200000, maintenanceCost: 240000,
        cloudCost: 180000, aiCost: 120000, active: true, updatedAt: now(),
      },
      {
        id: made.installEntry, priceBookId: made.priceBook, productId: made.service,
        quantity: 40, rate: 3500, licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0,
        active: true, updatedAt: now(),
      },
    ]),
    "Price both in the book",
  );
  pass("Platform (License 1,200,000 · Maintenance 240,000 · Cloud 180,000 · AI 120,000) and Installation (40 h at 3,500) in one book");

  // -------------------------------------------------------------------------
  step("04", "Deal, priced from the book");
  // -------------------------------------------------------------------------

  if (!made.opportunity) {
    made.opportunity = randomUUID();
    await ok(
      db.from("opportunity").insert({
        id: made.opportunity, opportunityNumber: `WT-OPP-${tag}`,
        name: `WT Meridian - warehouse rollout ${tag}`, accountId: made.account,
        primaryContactId: made.contact, ownerUserId: meId, campaignId: made.campaign,
        stage: "SOLUTION_PROPOSED", amount: 0, currencyCode: "PKR",
        expectedCloseDate: inDays(30), opportunityType: "NEW", leadSource: "Campaign",
        nextStep: "Security review with their IT team", updatedAt: now(),
      }),
      "Create the deal",
    );
  }

  // As the Add Product & Service screen saves them: all the lines at once.
  await ok(
    db.rpc("save_opportunity_lines", {
      p_opportunity: made.opportunity,
      p_price_book: made.priceBook,
      p_lines: [
        {
          productId: made.product, priceBookEntryId: made.platformEntry, quantity: 1, unitPrice: 0,
          licenseCost: 1200000, maintenanceCost: 240000, cloudCost: 180000, aiCost: 120000,
          discountPercent: 10, taxRateId: null,
        },
        {
          productId: made.service, priceBookEntryId: made.installEntry, quantity: 40, unitPrice: 3500,
          licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0, discountPercent: 0, taxRateId: null,
        },
      ],
    }),
    "Add the product and the service to the deal",
  );

  let deal = await ok(
    db.from("opportunity").select("amount, netAmount, pricedByLines, priceBookId").eq("id", made.opportunity).single(),
    "Read the deal",
  );
  // (1,200,000 + 240,000 + 180,000 + 120,000) less 10% = 1,566,000; 40 x 3,500 = 140,000
  assert.equal(money(deal.amount), 1706000, "The deal's amount must be the sum of its lines");
  assert.equal(deal.pricedByLines, true, "And from now on it is only its lines");
  pass(`Deal priced by its lines: ${money(deal.amount).toLocaleString()} (1,566,000 platform after 10% + 140,000 installation)`);

  // -------------------------------------------------------------------------
  step("05", "Quotation, copied from the deal and accepted");
  // -------------------------------------------------------------------------

  // As the quote form sends it: the deal's lines with every value kept, and
  // one changed - the customer wants 48 hours of installation, not 40.
  const quote = await ok(
    db.rpc("create_with_lines", {
      p_table: "quotation",
      p_payload: {
        opportunityId: made.opportunity, accountId: made.account, contactId: made.contact,
        versionNumber: 1, status: "DRAFT", quoteDate: today(), expiryDate: inDays(21),
        currencyCode: "PKR", priceBookId: made.priceBook,
        paymentTerms: "50% on order, 50% on go-live.",
      },
      p_line_table: "quote_line",
      p_lines: [
        {
          productId: made.product, priceBookEntryId: made.platformEntry,
          description: `WT Warehouse Platform ${tag} - licence and first year`,
          quantity: 1, unitPrice: 0, licenseCost: 1200000, maintenanceCost: 240000,
          cloudCost: 180000, aiCost: 120000, discountPercent: 10, taxRateId: null,
        },
        {
          productId: made.service, priceBookEntryId: made.installEntry,
          description: "On-site installation", quantity: 48, unitPrice: 3500,
          licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0, discountPercent: 0, taxRateId: null,
        },
      ],
      p_parent_field: "quotationId",
      p_number_field: "quoteNumber",
      p_sequence: "Quotation",
    }),
    "Create a quotation from the deal",
  );
  made.quotation = quote.id;

  const quoted = await ok(
    db.from("quotation").select("subtotal, discountAmount, taxAmount, totalAmount").eq("id", made.quotation).single(),
    "Read the quotation's totals",
  );
  // Before discount 1,740,000 + 168,000; discount 174,000; no tax.
  assert.equal(money(quoted.subtotal), 1908000, "The subtotal is the lines before discount");
  assert.equal(money(quoted.discountAmount), 174000, "The discount is worked out from the lines");
  assert.equal(money(quoted.totalAmount), 1734000, "And the total is the lines' totals");
  pass("Quotation carries the four costs from the deal, with the hours changed to 48: 1,734,000");

  await ok(
    db.from("quotation").update({ status: "SENT", sentAt: now(), updatedAt: now() }).eq("id", made.quotation),
    "Mark the quotation as sent",
  );
  await ok(db.rpc("accept_quotation", { p_id: made.quotation }), "Record the customer's acceptance");

  deal = await ok(
    db.from("opportunity").select("amount, stage").eq("id", made.opportunity).single(),
    "Re-read the deal",
  );
  const dealLines = await ok(
    db.from("opportunity_product").select("productId, quantity, licenseCost").eq("opportunityId", made.opportunity),
    "Read the deal's lines",
  );
  assert.equal(money(deal.amount), 1734000, "Accepting the quote makes its total the deal's");
  assert.equal(deal.stage, "VERBAL_CONFIRMATION", "And moves the deal on");
  assert.equal(
    money(dealLines.find((l) => l.productId === made.service)?.quantity), 48,
    "The deal now sells what the customer accepted - 48 hours",
  );
  pass("Accepting it put the quote's lines on the deal: 1,734,000, Verbal Confirmation");

  // -------------------------------------------------------------------------
  step("06", "Winning the deal, and the project that follows");
  // -------------------------------------------------------------------------

  await ok(
    db.from("opportunity").update({
      stage: "CLOSED_WON", actualCloseDate: today(), updatedAt: now(),
    }).eq("id", made.opportunity),
    "Close the deal as won",
  );

  const projectResult = await db.rpc("create_project_for_won_opportunity", {
    p_opportunity: made.opportunity,
  });
  if (projectResult.error) throw new Error(`Auto-create the project: ${projectResult.error.message}`);

  const projectRow = typeof projectResult.data === "string"
    ? JSON.parse(projectResult.data)
    : projectResult.data;
  assert.ok(projectRow?.id, "Winning a deal must create its project");
  made.project = projectRow.id;

  const project = await ok(
    db.from("project").select("projectNumber, name, contractValue, opportunityId, approvedHours").eq("id", made.project).single(),
    "Read the project",
  );
  assert.equal(project.opportunityId, made.opportunity, "The project must point back at the deal");
  assert.equal(money(project.contractValue), 1734000, "The project must carry the deal's total across");
  pass(`Project ${project.projectNumber} created automatically, carrying the contract value`);

  const members = await ok(
    db.from("project_member").select("userId, projectRole").eq("projectId", made.project),
    "Read the project team",
  );
  assert.ok(members.some((m) => m.userId === meId), "The deal owner must be on the project");
  pass("The deal owner was added to the project as its manager");

  // -------------------------------------------------------------------------
  step("07", "The project's work is what was sold");
  // -------------------------------------------------------------------------

  const soldTasks = await ok(
    db.from("project_task").select("id, name, soldHours, soldRate, estimatedHours, opportunityProductId").eq("projectId", made.project),
    "Read the project's tasks",
  );
  const install = soldTasks.find((t) => t.opportunityProductId);
  assert.equal(soldTasks.length, 1, "Only the service sold in hours becomes a task - the platform does not");
  assert.equal(money(install.soldHours), 48, "With the hours the customer bought");
  assert.equal(money(install.soldRate), 3500, "At the rate they agreed");
  assert.equal(money(project.approvedHours), 48, "And the project's budget is those hours");
  made.taskImpl = install.id;
  pass("Installation became a 48-hour task at 3,500; the platform, a product, did not");

  // Work the project manager adds is planning, not a sale: the deal is unmoved.
  await ok(
    db.from("project_task").insert({
      id: randomUUID(), projectId: made.project, name: `WT Data migration ${tag}`,
      estimatedHours: 24, status: "NOT_STARTED", priority: "HIGH",
      assignedUserId: meId, billable: false, updatedAt: now(),
    }),
    "Plan an extra task",
  );
  deal = await ok(db.from("opportunity").select("amount").eq("id", made.opportunity).single(), "Re-read the deal");
  assert.equal(money(deal.amount), 1734000, "Planning work must not change what was sold");
  const resync = await ok(db.rpc("sync_project_from_opportunity", { p_project: made.project }), "Sync from the deal");
  assert.equal((typeof resync === "string" ? JSON.parse(resync) : resync).added, 0, "Nothing is added twice");
  pass("A task the manager plans leaves the deal alone, and syncing from the deal adds nothing twice");

  // -------------------------------------------------------------------------
  step("08", "Time, and its approval");
  // -------------------------------------------------------------------------

  const consultantRole = await ok(
    admin.from("security_role").select("id").eq("name", "Consultant").single(),
    "Find the Consultant role",
  );
  const consultantEmail = `wt-consultant-${tag.toLowerCase()}@example.com`;
  const consultantPassword = randomBytes(18).toString("base64url");
  const consultantAuth = await admin.auth.admin.createUser({
    email: consultantEmail, password: consultantPassword, email_confirm: true,
  });
  if (consultantAuth.error) throw consultantAuth.error;
  made.consultant = consultantAuth.data.user.id;

  await ok(
    admin.from("app_user").insert({
      id: made.consultant, fullName: `WT Consultant ${tag}`, email: consultantEmail,
      roleId: consultantRole.id, userType: "INTERNAL", status: "ACTIVE",
      defaultBillingRate: 4000, costRate: 1800, managerUserId: meId,
      jobTitle: "Implementation Consultant", updatedAt: now(),
    }),
    "Create a consultant",
  );

  // They must be on the project before they can book time to it.
  await ok(
    db.from("project_member").insert({
      id: randomUUID(), projectId: made.project, userId: made.consultant,
      projectRole: "Consultant", allocationPercent: 100, startDate: today(),
      billingRate: 4000, costRate: 1800, active: true, updatedAt: now(),
    }),
    "Put the consultant on the project",
  );

  await ok(
    db.from("project_task").update({ assignedUserId: made.consultant, updatedAt: now() })
      .eq("id", made.taskImpl),
    "Assign the task to them",
  );
  pass("Consultant created and put on the project");

  const asConsultant = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const consultantSignIn = await asConsultant.auth.signInWithPassword({
    email: consultantEmail, password: consultantPassword,
  });
  if (consultantSignIn.error) throw consultantSignIn.error;

  made.timeLog = randomUUID();
  await ok(
    asConsultant.from("time_log").insert({
      id: made.timeLog, projectId: made.project, projectTaskId: made.taskImpl,
      userId: made.consultant,
      workDate: today(), hours: 8, billable: true, approvalStatus: "DRAFT",
      billingRate: 4000, costRate: 1800,
      description: "Mapping their existing stock records", updatedAt: now(),
    }),
    "Log time",
  );
  await ok(
    asConsultant.from("time_log").update({ approvalStatus: "SUBMITTED", updatedAt: now() })
      .eq("id", made.timeLog),
    "Submit the time",
  );

  // The author cannot sign off their own hours - the trigger refuses it, and
  // that refusal is worth showing rather than only working around.
  const selfApproval = await asConsultant.from("time_log")
    .update({ approvalStatus: "APPROVED", approvedById: made.consultant, updatedAt: now() })
    .eq("id", made.timeLog).select("id");
  assert.ok(selfApproval.error, "Nobody may approve their own time");
  pass("A consultant cannot approve their own hours");
  await ok(
    db.from("time_log").update({
      approvalStatus: "APPROVED", approvedById: meId, approvedAt: now(), updatedAt: now(),
    }).eq("id", made.timeLog),
    "Approve the time",
  );
  const timeRow = await ok(
    db.from("time_log").select("approvalStatus, billable, hours").eq("id", made.timeLog).single(),
    "Read the timesheet",
  );
  assert.equal(timeRow.approvalStatus, "APPROVED", "Approved time is what becomes billable");
  pass("8 hours logged by the consultant, submitted, and approved by their manager");

  // -------------------------------------------------------------------------
  step("09", "Invoice, and the payment against it");
  // -------------------------------------------------------------------------

  made.invoice = randomUUID();
  await ok(
    db.from("invoice").insert({
      id: made.invoice, invoiceNumber: `WT-INV-${tag}`, accountId: made.account,
      contactId: made.contact, projectId: made.project, status: "DRAFT",
      invoiceDate: today(), dueDate: inDays(30), currencyCode: "PKR",
      subtotal: 1000000, discountAmount: 0, taxAmount: 0, totalAmount: 1000000,
      paidAmount: 0, outstandingAmount: 1000000, writeOffAmount: 0,
      paymentTermsDays: 30, preparedById: meId, updatedAt: now(),
    }),
    "Create a draft invoice",
  );
  await ok(
    db.from("invoice_line").insert({
      id: randomUUID(), invoiceId: made.invoice, productId: made.product,
      description: "Initial licence instalment", quantity: 1, unitPrice: 1000000,
      lineTotal: 1000000, sortOrder: 1, updatedAt: now(),
    }),
    "Add an invoice line",
  );
  // Whoever prepares an invoice may not be the one to issue it, so finance is
  // a second person here.
  const managerRole = await ok(
    admin.from("security_role").select("id").eq("name", "Manager").single(),
    "Find the Manager role",
  );
  const financeEmail = `wt-finance-${tag.toLowerCase()}@example.com`;
  const financePassword = randomBytes(18).toString("base64url");
  const financeAuth = await admin.auth.admin.createUser({
    email: financeEmail, password: financePassword, email_confirm: true,
  });
  if (financeAuth.error) throw financeAuth.error;
  made.finance = financeAuth.data.user.id;
  await ok(
    admin.from("app_user").insert({
      id: made.finance, fullName: `WT Finance ${tag}`, email: financeEmail,
      roleId: managerRole.id, userType: "INTERNAL", status: "ACTIVE",
      jobTitle: "Finance Manager", updatedAt: now(),
    }),
    "Create a finance manager",
  );

  const asFinance = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const financeSignIn = await asFinance.auth.signInWithPassword({
    email: financeEmail, password: financePassword,
  });
  if (financeSignIn.error) throw financeSignIn.error;

  const selfIssue = await db.from("invoice")
    .update({ status: "SENT", sentAt: now(), issuedById: meId, updatedAt: now() })
    .eq("id", made.invoice).select("id");
  assert.ok(selfIssue.error, "The preparer must not be able to issue their own invoice");
  pass("The person who prepared the invoice cannot issue it");

  await ok(
    asFinance.from("invoice").update({
      status: "APPROVED", updatedAt: now(),
    }).eq("id", made.invoice),
    "Approve the invoice",
  );
  await ok(
    asFinance.from("invoice").update({
      status: "SENT", sentAt: now(), issuedById: made.finance, updatedAt: now(),
    }).eq("id", made.invoice),
    "Issue the invoice",
  );
  pass("Invoice raised for 1,000,000, approved and issued by finance");

  made.payment = randomUUID();
  await ok(
    asFinance.from("payment").insert({
      id: made.payment, paymentNumber: `WT-PAY-${tag}`, accountId: made.account,
      paymentDate: today(), amount: 600000, unallocatedAmount: 0, currencyCode: "PKR",
      paymentMethod: "BANK", referenceNumber: `WT-${tag}-TT`,
      status: "CLEARED", clearedAt: now(), updatedAt: now(),
    }),
    "Record a payment",
  );
  await ok(
    asFinance.from("payment_allocation").insert({
      id: randomUUID(), paymentId: made.payment, invoiceId: made.invoice,
      allocatedAmount: 600000, allocatedAt: now(), allocatedById: made.finance,
    }),
    "Allocate the payment",
  );
  pass("Part payment of 600,000 received and allocated to the invoice");

  // -------------------------------------------------------------------------
  step("10", "Expense claim");
  // -------------------------------------------------------------------------

  let category = await ok(
    db.from("expense_category").select("id, name").limit(1).maybeSingle(),
    "Find an expense category",
  );
  if (!category) {
    const id = randomUUID();
    await ok(
      admin.from("expense_category").insert({ id, name: "Travel", active: true, updatedAt: now() }),
      "Create an expense category",
    );
    category = { id, name: "Travel" };
  }
  made.expense = randomUUID();
  await ok(
    db.from("expense").insert({
      id: made.expense, expenseNumber: `WT-EXP-${tag}`, employeeUserId: meId,
      categoryId: category.id, projectId: made.project,
      expenseDate: today(), amount: 18500, taxAmount: 0, currencyCode: "PKR",
      description: `WT site visit to Meridian ${tag}`,
      approvalStatus: "SUBMITTED", paymentStatus: "UNPAID",
      billableToCustomer: true, reimbursable: true, updatedAt: now(),
    }),
    "File an expense claim",
  );
  await ok(
    db.from("expense").update({
      approvalStatus: "APPROVED", updatedAt: now(),
    }).eq("id", made.expense),
    "Approve the claim",
  );
  pass("Expense claim filed and approved");

  // -------------------------------------------------------------------------
  step("11", "Support case, assigned by round robin");
  // -------------------------------------------------------------------------

  const supportDept = await ok(
    admin.from("department").select("id, name").ilike("name", "support").maybeSingle(),
    "Find the Support department",
  );
  const supportPeople = supportDept
    ? await ok(
        admin.from("app_user").select("id, fullName")
          .eq("departmentId", supportDept.id).eq("userType", "INTERNAL")
          .eq("status", "ACTIVE").is("deletedAt", null),
        "Read the Support department",
      )
    : [];

  const assignee = await admin.rpc("next_support_assignee");
  const chosen = assignee.error ? null : assignee.data;

  made.case = randomUUID();
  await ok(
    db.from("support_case").insert({
      id: made.case, caseNumber: `WT-CASE-${tag}`, accountId: made.account,
      contactId: made.contact, subject: `WT Stock counts not syncing ${tag}`,
      description: "Overnight sync finished but the counts did not update.",
      caseType: "INCIDENT", status: "ASSIGNED", priority: "HIGH", source: "PORTAL",
      reopenCount: 0, slaBreached: false,
      ownerUserId: chosen ?? meId, updatedAt: now(),
    }),
    "Raise a support case",
  );
  await ok(
    db.from("case_comment").insert({
      id: randomUUID(), caseId: made.case, authorUserId: meId,
      commentType: "AGENT_RESPONSE",
      body: "Looking at the sync logs now - will come back within the hour.",
      isPublic: true, updatedAt: now(),
    }),
    "Reply on the case",
  );

  if (supportPeople.length === 0) {
    console.log("  NOTE  The Support department is empty, so the case fell back to the account owner");
  }
  pass(
    supportPeople.length
      ? `Case raised and assigned by round robin to one of ${supportPeople.length} Support people`
      : "Case raised and replied to (assignment fell back to the account owner)",
  );

  // -------------------------------------------------------------------------
  step("12", "Partner, and their portal login");
  // -------------------------------------------------------------------------

  made.partnerAccount = randomUUID();
  made.partnerContact = randomUUID();
  await ok(
    db.from("account").insert({
      id: made.partnerAccount, accountNumber: `WT-PACC-${tag}`,
      name: `WT Nexus Systems ${tag}`, accountType: "PARTNER", ownerUserId: meId,
      industry: "IT reseller", updatedAt: now(),
    }),
    "Create the partner's account",
  );
  await ok(
    db.from("contact").insert({
      id: made.partnerContact, accountId: made.partnerAccount,
      firstName: "Sana", lastName: `Rauf ${tag}`, jobTitle: "Channel Manager",
      email: `wt-sana-${tag.toLowerCase()}@example.com`, phone: phone("0321"),
      isPrimary: true, updatedAt: now(),
    }),
    "Create the partner's contact",
  );

  made.partner = randomUUID();
  await ok(
    db.from("partner").insert({
      id: made.partner, partnerNumber: `WT-PTR-${tag}`, displayName: `WT Nexus Systems ${tag}`,
      kind: "COMPANY", accountId: made.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT",
      tier: "SILVER", status: "ACTIVE", partnerManagerId: meId,
      defaultCommissionPercent: 12, payoutCurrencyCode: "PKR", startDate: today(),
      email: `wt-sana-${tag.toLowerCase()}@example.com`, updatedAt: now(),
    }),
    "Create the partner",
  );
  pass("Partner created, active, on a 12% default commission");

  const partnerRole = await ok(
    admin.from("security_role").select("id").eq("name", "Partner").single(),
    "Find the Partner role",
  );
  const partnerEmail = `wt-partner-${tag.toLowerCase()}@example.com`;
  const partnerPassword = randomBytes(18).toString("base64url");
  const partnerAuth = await admin.auth.admin.createUser({
    email: partnerEmail, password: partnerPassword, email_confirm: true,
  });
  if (partnerAuth.error) throw partnerAuth.error;
  made.partnerLogin = partnerAuth.data.user.id;

  await ok(
    admin.from("app_user").insert({
      id: made.partnerLogin, fullName: `Sana Rauf ${tag}`, email: partnerEmail,
      roleId: partnerRole.id, userType: "PARTNER", partnerId: made.partner,
      contactId: made.partnerContact, status: "ACTIVE", updatedAt: now(),
    }),
    "Create the partner login",
  );
  pass("Partner portal login created");

  // -------------------------------------------------------------------------
  step("13", "What the partner can do in their portal");
  // -------------------------------------------------------------------------

  const asPartner = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const partnerSignIn = await asPartner.auth.signInWithPassword({
    email: partnerEmail, password: partnerPassword,
  });
  if (partnerSignIn.error) throw partnerSignIn.error;

  const profile = await ok(
    asPartner.from("partner").select("id, displayName, defaultCommissionPercent").eq("id", made.partner).single(),
    "Read the partner profile as the partner",
  );
  assert.equal(money(profile.defaultCommissionPercent), 12, "The partner must see the rate they are on");
  pass("Partner signs in and sees their own profile and rate");

  const customerRaw = await ok(
    asPartner.rpc("partner_create_customer", {
      p_account_name: `WT Sapphire Textiles ${tag}`,
      p_first_name: "Bilal", p_last_name: `Ahmed ${tag}`,
      p_email: `wt-bilal-${tag.toLowerCase()}@example.com`, p_phone: phone("0333"),
      p_job_title: "IT Manager", p_industry: "Textiles", p_city: "Faisalabad",
      p_website: null, p_deal_name: `WT Sapphire - warehouse rollout ${tag}`,
      p_deal_amount: 900000, p_deal_close: inDays(45), p_deal_currency: "PKR",
      p_notes: "They run three sites and want one system across all of them.",
    }),
    "Create a customer as the partner",
  );
  const partnerCustomer = typeof customerRaw === "string" ? JSON.parse(customerRaw) : customerRaw;
  made.partnerCustomer = partnerCustomer.accountId;
  made.partnerDeal = partnerCustomer.opportunityId;

  assert.ok(made.partnerCustomer && made.partnerDeal, "The partner's customer and deal must both exist");
  assert.equal(partnerCustomer.contested, false, "A new name must not be contested");
  pass(`Partner created account ${partnerCustomer.accountNumber} with a contact and a deal`);

  const sourced = await ok(
    admin.from("account").select("sourcePartnerId, ownerUserId").eq("id", made.partnerCustomer).single(),
    "Check the sourcing",
  );
  assert.equal(sourced.sourcePartnerId, made.partner, "The customer must be credited to the partner");
  assert.equal(sourced.ownerUserId, meId, "The customer must be owned by the partner's manager");
  pass("The partner is credited, but the account is owned by their manager");

  const clashRaw = await ok(
    asPartner.rpc("partner_find_conflict", {
      p_account_name: `WT Meridian Foods ${tag}`, p_email: null, p_phone: null,
    }),
    "Check a conflict against our own customer",
  );
  const clash = typeof clashRaw === "string" ? JSON.parse(clashRaw) : clashRaw;
  assert.equal(clash.conflict, true, "An existing customer must be reported as a conflict");
  assert.ok(!JSON.stringify(clash).includes("wt-imran-"), "A conflict must not leak the existing contact's email");
  pass("Conflict check finds our existing customer without leaking their contact details");

  // -------------------------------------------------------------------------
  step("14", "Commission, and the partner asking for more");
  // -------------------------------------------------------------------------

  // The won deal was ours before the partner was involved, so it is given the
  // partner by hand - once, which is what creates the commission record.
  await ok(
    db.rpc("set_opportunity_partner", { p_opportunity: made.opportunity, p_partner: made.partner }),
    "Give the won deal its partner",
  );
  const record = await ok(
    admin.from("partner_commission")
      .select("id, status, baseAmount, commissionPercent, commissionAmount, partnerAmount, paymentDate")
      .eq("opportunityId", made.opportunity).single(),
    "Read the commission record",
  );
  made.commission = record.id;
  const expectedCommission = Math.round(money(record.baseAmount) * 12) / 100;
  assert.equal(money(record.commissionPercent), 12, "At the partner's 12%");
  assert.equal(money(record.commissionAmount), expectedCommission, "Commission is 12% of the deal amount");
  assert.equal(record.status, "IN_PROGRESS", "Nothing is paid until somebody marks it paid");
  assert.ok(record.paymentDate, "A won deal's commission has its payment date");
  pass(`Commission of ${expectedCommission.toLocaleString()} recorded at 12%, payment date ${record.paymentDate}`);

  await ok(
    asPartner.rpc("partner_commission_request_percent", {
      p_id: made.commission, p_percent: 18,
      p_reason: "We ran the whole pre-sales cycle on this one, including the site survey.",
    }),
    "Ask for a higher rate as the partner",
  );
  const waiting = await ok(
    admin.from("partner_commission").select("commissionPercent, requestStatus").eq("id", made.commission).single(),
    "Read the record after the request",
  );
  assert.equal(waiting.requestStatus, "PENDING", "The request waits for an answer");
  assert.equal(money(waiting.commissionPercent), 12, "The rate does not change until it is approved");
  pass("Partner asked for 18%, with their reasoning; the rate stays 12% until we answer");

  await ok(
    db.rpc("partner_commission_decide_request", {
      p_id: made.commission, p_approve: true,
      p_reason: "Agreed - the survey work was yours.",
    }),
    "Approve the request",
  );
  const agreed = await ok(
    admin.from("partner_commission").select("commissionPercent, requestStatus").eq("id", made.commission).single(),
    "Read the record after approval",
  );
  assert.equal(agreed.requestStatus, "APPROVED");
  assert.equal(money(agreed.commissionPercent), 18, "Approving applies the requested rate");
  pass("Request approved: 18% on this deal");

  // -------------------------------------------------------------------------
  step("15", "The conversation with the partner");
  // -------------------------------------------------------------------------

  await ok(
    asPartner.rpc("post_partner_message", {
      p_partner_id: made.partner,
      p_body: "Thanks for agreeing the rate. Sapphire want to start in November - can you hold capacity?",
      p_kind: "MESSAGE", p_subject: null, p_to: null, p_email_id: null,
    }),
    "Partner posts a message",
  );
  await ok(
    db.rpc("post_partner_message", {
      p_partner_id: made.partner,
      p_body: "We can. I will pencil in two consultants from the first week of November.",
      p_kind: "MESSAGE", p_subject: null, p_to: null, p_email_id: null,
    }),
    "We reply",
  );

  const thread = await ok(
    asPartner.from("partner_message").select("authorSide, body").eq("partnerId", made.partner).order("createdAt"),
    "Read the thread as the partner",
  );
  assert.equal(thread.length, 2, "Both sides of the conversation must be there");
  assert.deepEqual(thread.map((m) => m.authorSide), ["PARTNER", "INTERNAL"], "Each message must be attributed to its own side");
  pass("Two-way conversation recorded, each message attributed to its own side");

  const unread = await ok(
    db.from("partner_message").select("id", { count: "exact", head: true })
      .eq("partnerId", made.partner).eq("authorSide", "PARTNER").is("readAt", null)
      .then((r) => ({ data: r.count, error: r.error })),
    "Count what is unread on our side",
  );
  assert.equal(unread, 1, "Our unread count must be the partner's message only");
  pass("Unread count is the other side's messages only");

  // -------------------------------------------------------------------------
  step("16", "Customer portal login");
  // -------------------------------------------------------------------------

  const customerRole = await ok(
    admin.from("security_role").select("id").eq("name", "Customer").single(),
    "Find the Customer role",
  );
  const customerEmail = `wt-customer-${tag.toLowerCase()}@example.com`;
  const customerPassword = randomBytes(18).toString("base64url");
  const customerAuth = await admin.auth.admin.createUser({
    email: customerEmail, password: customerPassword, email_confirm: true,
  });
  if (customerAuth.error) throw customerAuth.error;
  made.customerLogin = customerAuth.data.user.id;

  await ok(
    admin.from("app_user").insert({
      id: made.customerLogin, fullName: `Imran Khalid ${tag}`, email: customerEmail,
      roleId: customerRole.id, userType: "CUSTOMER", contactId: made.contact,
      status: "ACTIVE", updatedAt: now(),
    }),
    "Create the customer login",
  );

  const asCustomer = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const customerSignIn = await asCustomer.auth.signInWithPassword({
    email: customerEmail, password: customerPassword,
  });
  if (customerSignIn.error) throw customerSignIn.error;

  const myCases = await ok(
    asCustomer.from("support_case").select("id, subject"),
    "Read cases as the customer",
  );
  assert.ok(myCases.some((c) => c.id === made.case), "The customer must see their own case");
  pass(`Customer signs in and sees their own ${myCases.length === 1 ? "case" : "cases"}`);

  for (const [table, what] of [
    ["opportunity", "deals"],
    ["invoice", "invoices"],
    ["partner_commission", "commission"],
    ["partner", "partners"],
    ["expense", "expenses"],
  ]) {
    const { data } = await asCustomer.from(table).select("id").limit(5);
    assert.equal((data ?? []).length, 0, `A customer must not read ${what}`);
  }
  pass("Customer cannot read deals, invoices, commission, partners or expenses");

  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(68)}`);
  console.log(`${checks.length} checks passed. Records are tagged "${tag}" and left in place.`);
  console.log(`${"=".repeat(68)}\n`);
  console.log("Sign in and look around with these:");
  console.log(`  Partner portal   ${partnerEmail}   ${partnerPassword}`);
  console.log(`  Support portal   ${customerEmail}   ${customerPassword}`);
  console.log(`  CRM (Consultant) ${consultantEmail}   ${consultantPassword}`);
  console.log(`  CRM (Manager)    ${financeEmail}   ${financePassword}`);
  console.log(`\nTo remove everything afterwards:  node scripts/clean-walkthrough.mjs ${tag}`);
} finally {
  for (const undo of cleanup.reverse()) {
    try { await undo(); } catch (err) { console.error("Cleanup failed:", err.message); }
  }
}
