-- Prospect: the first stage of a lead.
--
-- Somebody marketing has reached - a webinar sign-up, a website form, a
-- campaign member - who is not yet worth a salesperson's call. A prospect is a
-- lead like any other, so there is still one record per person and one
-- duplicate rule, but it stays out of the pipeline, the calling queue and the
-- dashboard's counts until someone qualifies it, or its score does.
--
-- On its own because a new enum value cannot be used in the transaction that
-- adds it; 20260929000007 uses it.

alter type "LeadStatus" add value if not exists 'PROSPECT' before 'NEW';
