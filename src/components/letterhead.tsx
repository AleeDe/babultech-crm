/**
 * The company's mark and name at the head of a contract: on screen, on the
 * printed copy and on the page where a new hire signs. The PNG sits on a navy
 * tile so the logo's white shapes show on white paper.
 */
export function Letterhead({ companyName, className = "" }: { companyName: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} data-letterhead>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/babultech-mark.png" alt="" width={36} height={36} className="h-9 w-9 rounded-lg" />
      <span className="font-serif text-lg font-semibold tracking-tight">{companyName}</span>
    </div>
  );
}
