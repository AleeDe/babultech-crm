-- Cases raised through the portal assistant are marked as such, so support can
-- see where a case came from and that the conversation is in its description.
alter type "CaseSource" add value if not exists 'CHATBOT';
