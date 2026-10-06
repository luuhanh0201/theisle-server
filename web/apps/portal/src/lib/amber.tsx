/** 1.234 (Vietnamese grouping), an amount of Hổ phách. */
export const fmtAmber = (n: number | null | undefined): string => Number(n ?? 0).toLocaleString('vi-VN');

/** An amount of Hổ phách: "100 <icon>", the word only on hover (amber.svg is the owner's). */
export function Amber({ n, sign = '' }: { n: number | null | undefined; sign?: string }) {
  return <span className="amber-amt" title="Hổ phách">{sign}{fmtAmber(n)} <img className="amber-ico" src="/amber.svg" alt="Hổ phách" /></span>;
}
