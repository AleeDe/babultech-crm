-- Who signed for the company, with their designation: "Hasan Shamsi (CEO)".
--
-- The title is taken from the signer's job title when they sign, and saved with
-- the signature, so a later change of title never alters a signed contract.

alter table employment_contract add column if not exists "companySignedTitle" varchar(150);
