/**
 * The two statuses an expense carries, and why approving one does not pay it.
 *
 * Drawn rather than written because the confusing part is structural: approval
 * and payment are separate tracks, and prose describing two parallel state
 * machines reads as one sequence. The picture puts them on two lines with the
 * gate between them, which is the whole point — an approved expense is not a
 * paid expense, and the row sits waiting until someone settles it.
 *
 * currentColor throughout so it reads in both themes; the one literal hue is
 * on the gate, which is the step people miss. Amber rather than red because
 * this is the next step, not a failure.
 */
export function ExpenseFlowDiagram() {
  return (
    <figure className="my-5">
      <svg
        viewBox="0 0 700 340"
        role="img"
        aria-label="An expense carries two separate statuses. Approval runs draft, submitted, then approved or rejected; a rejected claim can be fixed and resubmitted. Payment only begins once approval reaches approved, and ends at reimbursed when the employee paid personally, or paid when the company paid a supplier directly."
        className="w-full max-w-full"
      >
        {/* ============================================== approval track */}
        <text x="4" y="16" fontSize="11" fontWeight="700" fill="currentColor" letterSpacing="0.5">
          APPROVAL
        </text>
        <text x="82" y="16" fontSize="11" fill="currentColor" opacity="0.65">
          is the claim allowed?
        </text>

        <rect x="4" y="32" width="96" height="40" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="52" y="57" fontSize="13" textAnchor="middle" fill="currentColor">Draft</text>

        <text x="140" y="46" fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.7">submit</text>
        <line x1="100" y1="52" x2="168" y2="52" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="168,47 178,52 168,57" fill="currentColor" />

        <rect x="182" y="32" width="112" height="40" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="238" y="57" fontSize="13" textAnchor="middle" fill="currentColor">Submitted</text>

        <text x="336" y="46" fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.7">approve</text>
        <line x1="294" y1="52" x2="364" y2="52" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="364,47 374,52 364,57" fill="currentColor" />

        <rect x="378" y="32" width="108" height="40" rx="6" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <text x="432" y="57" fontSize="13" fontWeight="600" textAnchor="middle" fill="currentColor">Approved</text>

        {/* Rejected drops below Submitted, and loops back to it — not to
            Draft, since a resubmit re-enters the same queue. */}
        <text x="248" y="98" fontSize="10" fill="currentColor" opacity="0.7">reject</text>
        <line x1="238" y1="72" x2="238" y2="106" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="233,106 238,116 243,106" fill="currentColor" />

        <rect x="182" y="118" width="112" height="36" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 3" />
        <text x="238" y="141" fontSize="12" textAnchor="middle" fill="currentColor" opacity="0.85">Rejected</text>

        <path
          d="M 182 136 L 146 136 L 146 68"
          fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 3"
        />
        <polygon points="141,68 146,58 151,68" fill="currentColor" />
        <text x="140" y="172" fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.7">
          fix and resubmit
        </text>

        {/* ==================================================== the gate */}
        <line
          x1="432" y1="72" x2="432" y2="216"
          stroke="#d97706" strokeWidth="2.5"
        />
        <polygon points="426,216 432,227 438,216" fill="#d97706" />
        <text x="446" y="126" fontSize="11.5" fontWeight="700" fill="#d97706">
          approving does not
        </text>
        <text x="446" y="142" fontSize="11.5" fontWeight="700" fill="#d97706">
          pay anybody
        </text>
        <text x="446" y="160" fontSize="10" fill="#d97706" opacity="0.85">
          someone still has to settle it
        </text>

        {/* ============================================== payment track */}
        <text x="4" y="212" fontSize="11" fontWeight="700" fill="currentColor" letterSpacing="0.5">
          PAYMENT
        </text>
        <text x="82" y="212" fontSize="11" fill="currentColor" opacity="0.65">
          has the money gone out?
        </text>

        <rect x="4" y="228" width="96" height="40" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="52" y="253" fontSize="13" textAnchor="middle" fill="currentColor">Unpaid</text>

        <text x="160" y="242" fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.7">settle</text>
        <line x1="100" y1="248" x2="212" y2="248" stroke="currentColor" strokeWidth="1.5" />

        {/* One action, two destinations — the Reimbursable tick decides which,
            so it is a fork rather than a second decision at settle time. */}
        <path d="M 212 248 L 212 296 L 282 296" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="282,291 292,296 282,301" fill="currentColor" />
        <path d="M 212 248 L 212 200 L 282 200" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="282,195 292,200 282,205" fill="currentColor" />

        <rect x="296" y="182" width="128" height="36" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="360" y="205" fontSize="12.5" textAnchor="middle" fill="currentColor">Reimbursed</text>
        <text x="222" y="192" fontSize="10" fill="currentColor" opacity="0.7">Reimbursable</text>

        <rect x="296" y="278" width="128" height="36" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="360" y="301" fontSize="12.5" textAnchor="middle" fill="currentColor">Paid</text>
        <text x="222" y="316" fontSize="10" fill="currentColor" opacity="0.7">not reimbursable</text>

        <text x="452" y="197" fontSize="10" fill="currentColor" opacity="0.7">they paid from</text>
        <text x="452" y="210" fontSize="10" fill="currentColor" opacity="0.7">their own pocket</text>

        <text x="452" y="293" fontSize="10" fill="currentColor" opacity="0.7">the company paid</text>
        <text x="452" y="306" fontSize="10" fill="currentColor" opacity="0.7">the supplier direct</text>
      </svg>

      <figcaption className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Approval and payment are two separate statuses, not one sequence. An expense reaching
        Approved is still unpaid: it waits until someone settles it. Which of the two settled
        states it lands on is decided by the <strong>Reimbursable</strong> tick on the expense
        itself, not by a second choice at the time. Approved and both settled states are final -
        the system will not walk either back, so a claim cannot be paid twice.
      </figcaption>
    </figure>
  );
}
