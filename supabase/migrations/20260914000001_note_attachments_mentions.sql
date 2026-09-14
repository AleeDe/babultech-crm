-- Files, images and @mentions inside a note.
--
-- Notes were a plain text box. In practice the things people want to say about
-- a record come with evidence — a screenshot of the error, the supplier's
-- quote, the signed page — and with an audience: "@Hassan can you look at
-- this". Without either, the note gets written somewhere else entirely, which
-- is how a CRM ends up with its real history in WhatsApp.
--
-- Two tables rather than columns on `note`:
--
--   * A note can carry several files, so attachments are their own rows.
--   * A mention is a fact about two records (this note names that person) and
--     is queried from the person's side — "what was I mentioned in" — which a
--     JSON column on the note could not answer without scanning every note.
--
-- The document table is deliberately NOT reused. A document is a record-level
-- artefact with a category and a confidentiality flag, listed in its own panel
-- and kept for as long as the record lives. A note attachment belongs to one
-- comment, dies with it, and needs none of that. Conflating them would put
-- every pasted screenshot into the formal document list of the account.

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------

CREATE TABLE "note_attachment" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    -- The name the uploader saw. The stored object is named by a uuid instead,
    -- so a caller-supplied filename can never steer the storage path.
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    -- Path inside the private bucket. Never a public URL: these can hold
    -- anything a person thought worth attaching to a customer record.
    "storagePath" TEXT NOT NULL,
    -- Denormalised so the panel can decide between an inline preview and a
    -- download chip without parsing the mime type on every render.
    "isImage" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_attachment_pkey" PRIMARY KEY ("id")
);

-- ON DELETE CASCADE: an attachment has no meaning without its note. The stored
-- object is removed by the application in the same action; this stops a row
-- outliving the note even if that cleanup is interrupted.
ALTER TABLE "note_attachment"
  ADD CONSTRAINT "note_attachment_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_attachment"
  ADD CONSTRAINT "note_attachment_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "note_attachment_noteId_idx" ON "note_attachment"("noteId");

-- ---------------------------------------------------------------------------
-- Mentions
-- ---------------------------------------------------------------------------

CREATE TABLE "note_mention" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    -- Whether the person has been told. Recorded rather than assumed: a failed
    -- send must not look like a delivered one, and a re-saved note must not
    -- notify the same person twice.
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_mention_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "note_mention"
  ADD CONSTRAINT "note_mention_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_mention"
  ADD CONSTRAINT "note_mention_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "note_mention_noteId_idx" ON "note_mention"("noteId");
-- The index that makes "what was I mentioned in" cheap.
CREATE INDEX "note_mention_userId_idx" ON "note_mention"("userId");
-- One mention row per person per note: writing "@Hassan" twice in one note is
-- one mention, and must not send two emails.
CREATE UNIQUE INDEX "note_mention_noteId_userId_key" ON "note_mention"("noteId", "userId");

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------
--
-- Both tables follow `note` exactly, using the same helpers every other child
-- table in this schema uses (see 20260816000000_policies_remaining.sql). An
-- attachment and a mention are parts of a note, so inventing separate rules for
-- them would be two more predicates to keep in step with the note's own — and
-- the one that drifted would be the security hole.
--
-- Ownership is enforced in the application (deleteNote and deleteAttachment
-- both check createdById), which is where the note's own author checks already
-- live.

do $$
declare t text;
begin
  foreach t in array array['note_attachment', 'note_mention']
  loop
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists %I on %I', t || '_internal_read', t);
    execute format(
      'create policy %I on %I for select using (app_is_internal())',
      t || '_internal_read', t
    );

    execute format('drop policy if exists %I on %I', t || '_internal_write', t);
    execute format(
      'create policy %I on %I for all using (app_can_write()) with check (app_can_write())',
      t || '_internal_write', t
    );
  end loop;
end $$;

COMMENT ON TABLE "note_attachment" IS
  'Files and images attached to one note. Objects live in the private note-attachments bucket.';
COMMENT ON TABLE "note_mention" IS
  'People named with @ in a note. notifiedAt records whether they were actually told.';
