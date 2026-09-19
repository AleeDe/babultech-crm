# Agency role presets

Migration `20260919000004` adds three active OWN-scope roles. Existing roles and
staff assignments are unchanged. Select a preset when adding or editing a user.

| Preset | Granted permissions | Intended workflow |
| --- | --- | --- |
| SDR / Cold Caller | `lead:read`, `lead:write` | Owned leads, calling, qualification and handoff |
| Marketing Executive | `lead:read`, `lead:write` | Owned campaigns and leads |
| Content Editor | `project:read`, `content:review` | Internal review on accessible assigned projects |

Campaigns currently share lead permissions. SDR and marketing therefore have
identical technical grants despite different job descriptions. These presets do
not establish separate campaign-only, lead-import/export or conversion powers.
Splitting those existing capabilities requires a separate UI/server/RLS change.
No administration, finance, employee rates or project-management grants are
included. This is a permission mapping, not an audit of every legacy CRM policy.

Editors should be added to relevant projects. `content:review` plus project
read access permits INTERNAL decisions only. The existing current-version,
current-plan and no-self-review checks remain. Editor authority alone does not
permit editing project configuration, planning content, changing rates, recording
CLIENT approval, issuing client-review links or publishing. Existing PM authority
continues to work. If an editor is separately assigned as a task contributor,
the existing contributor version/publication workflow still applies; the new
permission does not remove their other assignments.

Validation: rollback SQL tests exercise assigned/unrelated projects, internal
approval, rejected client approval, membership revocation, no management/rate
authority and exact preset scope. The migration was applied with synthetic
fixtures rolled back. Existing local suite: 623 passing tests.
The real Chromium content workflow passed 11 checks, including temporarily
switching the synthetic reviewer to Content Editor, completing internal review
and confirming client-review/publication controls stay hidden. All test fixtures
were removed. Screenshot: `artifacts/browser-qa/editor-review.png`.

Actual staff-to-role mapping remains an administrative decision. The change does
not infer responsibilities from employee names or add new wildcard permissions.
