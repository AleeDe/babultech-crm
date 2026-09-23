-- A commission plan that sets the timing and leaves the rate to the partner.
--
-- There were no commission plans at all, which meant every partner ran on the
-- engine's fallback: ON_PAYMENT_RECEIVED, at the partner's own default rate.
-- That is the right behaviour, but nobody chose it - it was simply what
-- happened when the plan lookup found nothing. A rule that exists only as the
-- absence of a rule cannot be read, reviewed or changed.
--
-- So it is written down. Deliberately rate-less: every partner negotiates
-- their own percentage, and a plan carrying a flat rate would overrule the one
-- on the partner record. With flatPercent null the engine falls back to
-- partner."defaultCommissionPercent", which is where the agreed number lives.
--
-- Assigning it to a partner therefore changes nothing about what they are paid.
-- It only makes the timing explicit, and gives somewhere to hang a clawback
-- window and a payout delay later.
insert into commission_plan (
  id, name, description, basis, trigger, "rateType",
  "flatPercent", "payoutDelayDays", "clawbackWindowDays",
  "effectiveFrom", active, "createdAt", "updatedAt"
)
select
  gen_random_uuid(),
  'Standard - on payment received',
  'Commission is earned when the customer''s payment clears, calculated on the '
  || 'deal amount at the partner''s own agreed rate. Carries no rate of its own, '
  || 'so the percentage on the partner record is what applies.',
  'OPPORTUNITY_AMOUNT',
  'ON_PAYMENT_RECEIVED',
  'FLAT_PERCENT',
  null,          -- no rate: the partner's own percentage decides
  0,             -- payable as soon as it is earned
  90,            -- a refunded invoice can be clawed back within 90 days
  current_date,
  true,
  now(), now()
where not exists (
  select 1 from commission_plan where name = 'Standard - on payment received'
);
