-- A partner login may be a person, too.
--
-- The customer portal established the shape: a login is a person (a contact)
-- acting for an organisation. Partner logins were created before that and carry
-- only the partner id, so the CHECK written with the customer portal forbade
-- them a contactId at all.
--
-- Relaxed rather than required: partner logins created through the Users screen
-- have no contact behind them and must keep working. New ones granted from the
-- partner's own page name the contact they belong to, which is what makes "who
-- is this login?" answerable.
alter table app_user drop constraint if exists app_user_type_links_check;
alter table app_user add constraint app_user_type_links_check check (
  ("userType" = 'INTERNAL' and "partnerId" is null and "contactId" is null)
  or ("userType" = 'PARTNER' and "partnerId" is not null)
  or ("userType" = 'CUSTOMER' and "contactId" is not null and "partnerId" is null)
);

-- What a partner login gains from carrying a contact: nothing beyond its own
-- contact row. The case and account policies go through
-- app_current_customer_account_id(), which requires userType = 'CUSTOMER', so
-- they stay closed. contact_customer_read matches app_current_contact_id(),
-- which means a partner user can read the contact record that is themselves -
-- their own name and email, which they already know.
comment on constraint app_user_type_links_check on app_user is
  'INTERNAL has neither link; PARTNER has a partner and may name a contact; CUSTOMER is a contact.';
