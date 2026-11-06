import ReferralLanding from "./referral-landing";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ ref?: string; sig?: string; launch?: string }>;
};

export default async function ReferralPage({ searchParams }: Props) {
  const params = await searchParams;
  const code = typeof params.ref === "string" ? params.ref.slice(0, 80) : "";
  const signature = typeof params.sig === "string" ? params.sig.slice(0, 256) : "";
  return <ReferralLanding code={code} signature={signature} autoLaunch={params.launch !== "0"} />;
}
