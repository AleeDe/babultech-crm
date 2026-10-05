-- Co-founders: a fifth kind of contract.
--
-- A co-founder agreement has no end date: it runs until it is terminated,
-- resigned from or replaced by a revised agreement. Instead of a tenure it
-- records equity, the areas the co-founder is responsible for, optional
-- vesting, capital invested and a profit share. Pay and benefits stay
-- available for a co-founder who also draws a salary.
--
-- The daily job needs no change: a contract with no end date never ends by
-- itself and is never reminded about.

alter table employment_contract drop constraint if exists "employment_contract_contractType_check";
alter table employment_contract add constraint "employment_contract_contractType_check"
  check ("contractType" in ('INTERNSHIP', 'TRAINING', 'EMPLOYMENT', 'PERMANENT', 'COFOUNDER'));
alter table contract_template drop constraint if exists "contract_template_contractType_check";
alter table contract_template add constraint "contract_template_contractType_check"
  check ("contractType" in ('INTERNSHIP', 'TRAINING', 'EMPLOYMENT', 'PERMANENT', 'COFOUNDER'));

-- Only a co-founder agreement may leave the term open.
alter table employment_contract alter column "endDate" drop not null;
alter table employment_contract alter column "tenureMonths" drop not null;
alter table employment_contract add constraint employment_contract_term_check
  check ("contractType" = 'COFOUNDER' or ("endDate" is not null and "tenureMonths" is not null));

alter table employment_contract
  add column if not exists "equityPercent" numeric(6, 3) check ("equityPercent" is null or ("equityPercent" > 0 and "equityPercent" <= 100)),
  add column if not exists responsibilities text[] not null default '{}',
  add column if not exists "vestingMonths" integer check ("vestingMonths" is null or "vestingMonths" between 1 and 120),
  add column if not exists "cliffMonths" integer check ("cliffMonths" is null or "cliffMonths" between 0 and 60),
  add column if not exists "capitalAmount" numeric(18, 2) check ("capitalAmount" is null or "capitalAmount" >= 0),
  add column if not exists "capitalCurrency" char(3),
  add column if not exists "profitSharePercent" numeric(6, 3) check ("profitSharePercent" is null or ("profitSharePercent" >= 0 and "profitSharePercent" <= 100));

alter table employment_contract add constraint employment_contract_cofounder_check
  check ("contractType" <> 'COFOUNDER' or "equityPercent" is not null);
alter table employment_contract add constraint employment_contract_cliff_check
  check ("cliffMonths" is null or "vestingMonths" is null or "cliffMonths" <= "vestingMonths");
alter table employment_contract add constraint employment_contract_capital_check
  check ("capitalAmount" is null or "capitalCurrency" is not null);

-- The areas a co-founder can be responsible for.
insert into picklist (key, label, "groupName", "enumType", locked, description, "sortOrder")
values ('cofounder_area', 'Co-founder areas', 'People', null, false,
        'What a co-founder can be responsible for. A co-founder can have several.', 920)
on conflict (key) do nothing;

insert into picklist_value ("picklistKey", value, label, "sortOrder")
values ('cofounder_area', 'Development', 'Development', 10), ('cofounder_area', 'QA', 'QA', 20),
       ('cofounder_area', 'Training', 'Training', 30), ('cofounder_area', 'Sales', 'Sales', 40),
       ('cofounder_area', 'Support', 'Support', 50), ('cofounder_area', 'Marketing', 'Marketing', 60),
       ('cofounder_area', 'Research', 'Research', 70)
on conflict ("picklistKey", value) do nothing;

-- The starting co-founder agreement. Edit it under People > Contract
-- templates, and have it checked by a lawyer.
insert into contract_template (name, "contractType", body)
select 'Co-founder agreement', 'COFOUNDER', $t$CO-FOUNDER AGREEMENT
{{contractNumber}}

This agreement is made on {{today}} between {{companyName}} ("the Company") and {{fullName}}, son/daughter of {{fatherName}}, CNIC {{nationalId}}, residing at {{address}} ("the Co-founder").

1. Role
The Co-founder joins the Company as {{jobTitle}}, from {{startDate}}. This agreement has no fixed end date. It continues until it is replaced by a revised agreement, or ended as set out below.

2. Areas of responsibility
The Co-founder leads and is responsible for:
{{responsibilities}}
The co-founders may agree to change these areas as the Company grows; a change is recorded in a revised agreement.

3. Equity
The Co-founder holds {{equity}} of the Company.
Vesting: {{vesting}}.
Until equity has vested it may not be sold or transferred. On leaving, unvested equity returns to the Company.

4. Capital
Capital invested by the Co-founder: {{capital}}.

5. Profit share
The Co-founder's share of distributed profits: {{profitShare}}.

6. Pay and benefits
Salary or drawings: {{pay}}
The Co-founder also receives:
{{benefits}}

7. Commitment
The Co-founder will give the Company the time and attention their areas need, and will not take part in a competing business while this agreement is in force without the other co-founders' written consent.

8. Confidentiality
The Co-founder will keep confidential all information about the Company, its customers and its projects, during and after this agreement.

9. Work produced
Everything the Co-founder creates for the Company, including code, content, designs, methods and customer relationships, belongs to the Company.

10. Leaving
A co-founder may leave by giving {{noticeDays}} days' written notice. The Company may end this agreement for serious misconduct. Vested equity is kept; unvested equity returns to the Company.

11. Other terms
{{otherTerms}}

Signed for {{companyName}}                    Signed by the Co-founder
$t$
where not exists (select 1 from contract_template where "contractType" = 'COFOUNDER');
