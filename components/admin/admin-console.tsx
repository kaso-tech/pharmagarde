import { AccountPage } from "./console/pages/account";
import { AuditPage } from "./console/pages/audit";
import { ContributionsPage } from "./console/pages/contributions";
import { DashboardPage } from "./console/pages/dashboard";
import { DirectoryPage } from "./console/pages/directory";
import { DutyPage } from "./console/pages/duty";
import { HoursPage } from "./console/pages/hours";
import { PremiumPage } from "./console/pages/premium";
import { SystemPage } from "./console/pages/system";
import { UsersPage } from "./console/pages/users";
import { AdminShell } from "./console/shell";
import type { AdminSection } from "./console/shared";

const PAGES: Record<AdminSection, () => React.JSX.Element> = {
  dashboard: DashboardPage,
  directory: DirectoryPage,
  contributions: ContributionsPage,
  duty: DutyPage,
  hours: HoursPage,
  users: UsersPage,
  premium: PremiumPage,
  audit: AuditPage,
  system: SystemPage,
  account: AccountPage,
};

/** Console d'administration : structure commune (menu, barre supérieure) et page de la section. */
export function AdminConsoleScreen({ section }: { section: AdminSection }) {
  const Page = PAGES[section];
  return (
    <AdminShell section={section}>
      <Page />
    </AdminShell>
  );
}
