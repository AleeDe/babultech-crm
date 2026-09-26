import { formatMoneyPlain, formatCompactMoneyPlain, cn } from "@/lib/utils";
import { convert, companionCurrency } from "@/lib/currency-context";

type Numeric = number | string | null | undefined;

/**
 * An amount, with its reference conversion set quieter beneath or beside it.
 *
 * For places where the two currencies deserve different weight - a table cell,
 * a total. Everywhere else formatMoney gives the same thing as one string.
 */
export function Money({
  value,
  currency = "PKR",
  compact = false,
  stacked = false,
  className,
}: {
  value: Numeric;
  currency?: string;
  compact?: boolean;
  /** Put the conversion on its own line, for narrow columns. */
  stacked?: boolean;
  className?: string;
}) {
  const format = compact ? formatCompactMoneyPlain : formatMoneyPlain;
  const other = companionCurrency(currency);
  const converted = other ? convert(Number(value ?? 0), currency, other) : null;

  return (
    <span className={cn("tabular-nums", className)}>
      {format(value ?? 0, currency)}
      {other && converted !== null && (
        <span
          className={cn("text-xs font-normal text-muted-foreground", stacked ? "block" : "ml-1.5")}
          title={`At the current ${currency}/${other} rate. For reference only; nothing is calculated in ${other}.`}
        >
          ≈ {format(converted, other)}
        </span>
      )}
    </span>
  );
}
