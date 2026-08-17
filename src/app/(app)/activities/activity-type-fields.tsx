"use client";

import { useState } from "react";
import { Select } from "@/components/ui";
import { FormField } from "@/components/record-form";
import { MESSAGE_CHANNELS, type MessageChannel } from "@/lib/types";

/** "SMS" wants expanding and "WhatsApp" has capitals humanize() would lose. */
const CHANNEL_LABELS: Record<MessageChannel, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "Text message (SMS)",
  LINKEDIN: "LinkedIn",
  OTHER: "Other",
};

/**
 * The type selector, plus the channel selector that only applies to a message.
 *
 * These are one component because the second depends on the first, and that
 * dependency has to be resolved in the browser — the alternative, always
 * showing the channel field, asks the rep to answer "which channel?" about a
 * meeting. The server drops the value for any other type anyway, so a stale
 * channel left behind by switching types cannot be saved.
 */
export function ActivityTypeFields({
  defaultType,
  defaultChannel,
}: {
  defaultType: string;
  defaultChannel: string;
}) {
  const [type, setType] = useState(defaultType);

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <FormField label="Type" name="activityType" required>
        <Select
          name="activityType"
          required
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="TASK">Task</option>
          <option value="CALL">Call</option>
          <option value="MEETING">Meeting</option>
          <option value="MESSAGE_SENT">Message sent</option>
          <option value="REMINDER">Reminder</option>
        </Select>
      </FormField>

      {type === "MESSAGE_SENT" && (
        <FormField
          label="Channel"
          name="channel"
          required
          hint="Which medium the message went out on."
        >
          <Select name="channel" required defaultValue={defaultChannel || "WHATSAPP"}>
            {MESSAGE_CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </Select>
        </FormField>
      )}
    </div>
  );
}
