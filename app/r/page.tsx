import ReferralLanding from "./referral-landing";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: { ref?: string; sig?: string; launch?: string };
};

export default function ReferralPage({ searchParams }: Props) {
  const code = typeof searchParams.ref === "string" ? searchParams.ref.slice(0, 80) : "";
  const signature = typeof searchParams.sig === "string" ? searchParams.sig.slice(0, 256) : "";
  return <ReferralLanding code={code} signature={signature} autoLaunch={searchParams.launch !== "0"} />;
}
