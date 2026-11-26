import type { AppData } from "../App.tsx";
import { PageHeader } from "../components/common.tsx";
import { useT } from "../i18n.tsx";

/** Placeholder until the page is built in this pull request. */
export function QuotePrintPage(_props: { data: AppData; id: string }) {
  const t = useT();
  return <PageHeader title={t("Připravuje se", "Coming soon")} />;
}
