import { Route, Switch } from "wouter";
import { Toaster } from "sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider, Gate } from "./crm/session";
import { AuthPage } from "./crm/auth";
import { AdminSetupPage } from "./crm/admin-setup";
import { Layout } from "./crm/layout";
import { Dashboard, Profile } from "./crm/dashboard";
import { Customers, CustomerEditor } from "./crm/customers";
import { CustomerDetail } from "./crm/customer-detail";
import { CompanySettings } from "./crm/company";
import { UserManagement } from "./crm/users";
import { RolesSettings } from "./crm/roles";
import { AuditTrail } from "./crm/audit";
import NotFound from "./pages/NotFound";
import type { ReactNode } from "react";

function ProtectedPage({
  children,
  permission,
  leadership,
}: {
  children: ReactNode;
  permission?: string;
  leadership?: boolean;
}) {
  return (
    <Layout>
      <Gate permission={permission} leadership={leadership}>
        {children}
      </Gate>
    </Layout>
  );
}
function Router() {
  return (
    <Switch>
      <Route path="/login">{() => <AuthPage mode="login" />}</Route>
      <Route path="/register">{() => <AuthPage mode="register" />}</Route>
      <Route path="/admin-setup">{() => <AdminSetupPage />}</Route>
      <Route path="/verify-email">{() => <AuthPage mode="verify" />}</Route>
      <Route path="/forgot-password">{() => <AuthPage mode="forgot" />}</Route>
      <Route path="/reset-password">{() => <AuthPage mode="reset" />}</Route>
      <Route path="/">
        {() => (
          <ProtectedPage>
            <Dashboard />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/profile">
        {() => (
          <ProtectedPage>
            <Profile />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/customers/new">
        {() => (
          <ProtectedPage permission="customers.create">
            <CustomerEditor />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/customers/:id/edit">
        {params => (
          <ProtectedPage permission="customers.update">
            <CustomerEditor id={params.id} />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/customers/:id">
        {params => (
          <ProtectedPage permission="customers.read">
            <CustomerDetail id={params.id} />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/customers">
        {() => (
          <ProtectedPage permission="customers.read">
            <Customers />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/settings/users">
        {() => (
          <ProtectedPage leadership permission="users.read">
            <UserManagement />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/settings/roles">
        {() => (
          <ProtectedPage leadership permission="roles.read">
            <RolesSettings />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/settings/company">
        {() => (
          <ProtectedPage leadership permission="company.read">
            <CompanySettings />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/audit">
        {() => (
          <ProtectedPage permission="audit.read">
            <AuditTrail />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Toaster richColors closeButton position="top-right" theme="light" />
        <Router />
      </AuthProvider>
    </ErrorBoundary>
  );
}
